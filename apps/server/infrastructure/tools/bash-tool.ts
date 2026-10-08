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

// ── Bash 工具 ──

export class BashTool extends BaseTool<BashInput, BashOutput> {
  readonly name = 'bash';
  readonly description =
    '执行 shell 命令并返回输出结果。适合运行脚本、代码编译等场景。注意：Wiki 知识库文件必须使用 wiki_search 工具读取，禁止通过 bash 读取。';
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

    // 拦截对 Wiki 目录的读取操作（必须使用 wiki_search）
    const wikiPath = context.wikiPath;
    if (wikiPath) {
      const cmd = input.command;
      const wikiDirName = path.basename(wikiPath);
      // 读取命令匹配
      const readCmdRe =
        /^(cat|head|tail|less|more|grep|rg|find|ls|wc|diff|sort|uniq|awk|sed|xargs|cd)/;
      // 检测命令是否访问 Wiki 目录：包含绝对路径、包含目录名、或 cd 进 wiki 目录
      const accessesWiki =
        cmd.includes(wikiPath) ||
        new RegExp(`\\b${wikiDirName}\\b`).test(cmd) ||
        (cmd.trim().startsWith('cd ') && cmd.includes(wikiDirName));
      if (readCmdRe.test(cmd.trim()) && accessesWiki) {
        return {
          allowed: false,
          reason: 'Wiki 知识库文件必须使用 wiki_search 工具读取，禁止使用 bash',
        };
      }
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
