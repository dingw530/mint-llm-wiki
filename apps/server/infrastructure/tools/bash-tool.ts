import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import { BaseTool } from '../../agent-runtime/tooling/base-tool.js';
import type {
  PermissionResult,
  ToolContext,
  ToolMetadata,
} from '../../agent-runtime/tooling/tool-contracts.js';
import { checkCommand, isHighRiskBashCommand } from '../../domains/tool-security/index.js';
import * as path from 'path';
import { getMintWorkspacePath } from '../filesystem/mint-workspace.js';
import { sandboxRunner, type SandboxMetadata } from './sandbox/sandbox-runner.js';

// ── 输入 Schema ──

const BashInputSchema = z.object({
  command: z.string().describe('要执行的命令'),
  cwd: z.string().optional().describe('可选工作目录，必须位于 Runtime 允许的目录边界内'),
  timeout: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .optional()
    .default(30000)
    .describe('超时时间（毫秒），默认 30000'),
});

type BashInput = z.infer<typeof BashInputSchema>;

// ── 输出类型 ──

export interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  sandbox: SandboxMetadata;
}

// ── Wiki 内容读取检测 ──

const WIKI_READ_REASON = 'Wiki 知识库文件必须使用 wiki_search 工具读取，禁止使用 bash';

/**
 * 会把文件内容打印到 stdout 的命令。
 * 刻意不含 ls/find/cd/wc —— 它们只输出文件名或计数，不含文件内容。
 */
const CONTENT_PRINTING_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'rg',
  'sed',
  'awk',
  'sort',
  'uniq',
  'diff',
]);

/** stdout 被重定向（排除 `2>` 这类仅重定向 stderr 的写法）。 */
const STDOUT_REDIRECT_RE = /(?:^|[^0-9])>{1,2}(?!>)/;

/** 转义正则元字符，供目录名拼接使用。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 命令是否引用了 Wiki 根目录；裸目录名仅在其作为路径片段出现时才算命中。 */
function referencesWiki(command: string, wikiPath: string): boolean {
  const resolved = path.resolve(wikiPath);
  if (command.includes(resolved) || command.includes(wikiPath)) return true;
  const dirName = escapeRegExp(path.basename(resolved));
  return new RegExp(`(?:^|[\\s'"=(])${dirName}(?:/|$)`, 'm').test(command);
}

/** 判断命令是否为就地改写（输出不回显内容）。 */
function isInPlaceEdit(firstToken: string, rest: string): boolean {
  if (firstToken === 'sed' || firstToken === 'perl') {
    return (
      /(?:^|\s)-[A-Za-z]*i[A-Za-z]*(?:\.[^\s]*)?(?=\s|$)/.test(rest) ||
      /(?:^|\s)--in-place/.test(rest)
    );
  }
  if (firstToken === 'awk' || firstToken === 'gawk') {
    return /(?:^|\s)-i\s+inplace\b/.test(rest);
  }
  return false;
}

/**
 * 判断命令是否会把 Wiki 文件内容打印进对话——该行为必须改走 wiki_search。
 * 写操作（重定向、就地改写）与不输出内容的命令一律放行，交由工具策略按路径审批。
 * @param command 完整的 shell 命令
 * @param wikiPath 已配置的 Wiki 根目录
 * @returns 是否属于需拦截的 Wiki 内容读取
 */
function isWikiContentRead(command: string, wikiPath: string): boolean {
  const trimmed = command.trim();
  const firstToken = trimmed.split(/[\s|;&]+/)[0] ?? '';
  if (!CONTENT_PRINTING_COMMANDS.has(firstToken)) return false;
  if (!referencesWiki(trimmed, wikiPath)) return false;
  if (STDOUT_REDIRECT_RE.test(trimmed)) return false;
  return !isInPlaceEdit(firstToken, trimmed.slice(firstToken.length));
}

// ── Bash 工具 ──

export class BashTool extends BaseTool<BashInput, BashOutput> {
  readonly name = 'bash';
  readonly description =
    '执行 shell 命令并返回输出结果。适合运行脚本、代码编译等场景。注意：Wiki 知识库的文件内容必须使用 wiki_search 工具读取，不得用 cat/grep 等命令打印；对 Wiki 目录的写操作（脚本、sed -i 等）会先请求用户批准。';
  readonly inputSchema = BashInputSchema;

  isEnabled(): boolean {
    return process.env.AI_CHAT_BASH_ENABLED !== 'false';
  }

  isReadOnly(): boolean {
    return false;
  }

  isIdempotent(): boolean {
    return false;
  }

  getMetadata(): ToolMetadata {
    return { ...super.getMetadata(), approvalMode: 'conditional' };
  }

  checkPermission(input: BashInput, context: ToolContext): PermissionResult {
    const result = checkCommand(input.command);
    if (!result.allowed) {
      return { allowed: false, reason: result.reason };
    }

    // 只拦截会把 Wiki 文件内容打印进对话的读取；写操作与其余命令交由工具策略按路径处理。
    const wikiPath = context.wikiPath;
    if (wikiPath && isWikiContentRead(input.command, wikiPath)) {
      return { allowed: false, reason: WIKI_READ_REASON };
    }

    return { allowed: true };
  }

  async execute(input: BashInput, context: ToolContext): Promise<BashOutput> {
    if (isHighRiskBashCommand(input.command) && !context.approvalGranted) {
      return {
        stdout: '',
        stderr: 'Approval required: high-risk Bash command',
        exitCode: null,
        duration: 0,
        sandbox: {
          state: 'denied',
          sandboxed: false,
          backend: 'none',
          reason: 'high-risk Bash command requires approval',
        },
      };
    }
    const startTime = Date.now();
    const cwd = input.cwd ?? getMintWorkspacePath();
    if (!input.cwd) {
      await mkdir(cwd, { recursive: true });
    }

    const result = await sandboxRunner.run(
      {
        command: input.command,
        cwd,
        timeoutMs: input.timeout ?? 30000,
        invocationId: `${context.conversationId}-${startTime}`,
        allowHostFallback: !isHighRiskBashCommand(input.command),
      },
      context,
    );
    return { ...result, sandbox: result.metadata };
  }
}
