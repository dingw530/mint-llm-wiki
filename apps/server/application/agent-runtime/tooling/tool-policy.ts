import { isIP } from 'node:net';
import path from 'node:path';
import type {
  ToolContext,
  ToolMetadata,
  ToolPolicyDecision,
} from '../../../agent-runtime/tooling/tool-contracts.js';
import { getMintWorkspacePath } from '../../../infrastructure/filesystem/mint-workspace.js';
import { isHighRiskBashCommand } from '../../../domains/tool-security/index.js';

interface PolicyInput {
  toolName: string;
  metadata: ToolMetadata;
  input: unknown;
  context: ToolContext;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) === 6)
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  return false;
}

/** Bash 的授权范围：默认工作区，以及可选、需逐次批准的 Wiki 根目录。 */
interface BashScope {
  workspace: string;
  wikiRoot: string | null;
}

/** 候选路径在授权范围内的三种归属。 */
type BashPathScope = 'workspace' | 'wiki' | 'escape';

/** 命令中出现的绝对路径与显式相对路径候选（`/x`、`./x`、`../x`）。 */
function bashPathCandidates(command: string): string[] {
  return (command.match(/(?:^|\s)(\/[^\s;|&]+|\.\.?\/[^\s;|&]+)/g) || []).map((candidate) =>
    candidate.trim(),
  );
}

/**
 * 判断候选路径是否落在根目录内。
 * @param base `cwd` 按进程工作目录绝对化（cwd 参数为绝对路径）；`root` 以根目录为基准解析相对候选
 * @returns 路径是否位于该根目录内部
 */
function isInsideRoot(candidate: string, root: string, base: 'cwd' | 'root'): boolean {
  const absoluteRoot = path.resolve(root);
  const resolved = base === 'cwd' ? path.resolve(candidate) : path.resolve(absoluteRoot, candidate);
  return resolved === absoluteRoot || resolved.startsWith(`${absoluteRoot}${path.sep}`);
}

/** 归类候选路径的授权级别：工作区内、仅在 Wiki 根目录内，或越界。 */
function classifyBashPath(
  candidate: string,
  scope: BashScope,
  base: 'cwd' | 'root',
): BashPathScope {
  if (isInsideRoot(candidate, scope.workspace, base)) return 'workspace';
  if (scope.wikiRoot && isInsideRoot(candidate, scope.wikiRoot, base)) return 'wiki';
  return 'escape';
}

/**
 * Wiki 根目录必须显式配置、可解析为绝对路径且不是文件系统根，
 * 否则一次批准就会放行整块磁盘。
 * @returns 可信的 Wiki 根目录绝对路径，或 null
 */
function trustedWikiRoot(wikiPath: string | undefined): string | null {
  if (!wikiPath) return null;
  const resolved = path.resolve(wikiPath);
  return path.parse(resolved).root === resolved ? null : resolved;
}

/**
 * 评估 Bash 的路径授权范围。
 * @returns 否决/审批决议；null 表示命令与 cwd 全部落在默认工作区内
 */
function evaluateBashScope(
  command: string,
  cwd: unknown,
  scope: BashScope,
): ToolPolicyDecision | null {
  const cwdScope = typeof cwd === 'string' ? classifyBashPath(cwd, scope, 'cwd') : null;
  if (cwdScope === 'escape') return { action: 'deny', reason: 'Bash 工作目录超出允许范围' };

  const pathScopes = bashPathCandidates(command).map((candidate) =>
    classifyBashPath(candidate, scope, 'root'),
  );
  if (pathScopes.includes('escape'))
    return { action: 'deny', reason: 'Bash 命令访问了允许工作目录之外的路径' };
  if (cwdScope === 'wiki' || pathScopes.includes('wiki'))
    return { action: 'approval_required', reason: 'Bash 命令访问 Wiki 知识库目录，需要用户批准' };
  return null;
}

/** 只消费结构化工具调用数据的默认策略。 */
export function evaluateToolPolicy(input: PolicyInput): ToolPolicyDecision {
  const { toolName, metadata, input: args, context } = input;

  if (metadata.source === 'mcp' && !metadata.serverName) {
    return { action: 'deny', reason: 'MCP 工具缺少可信 Server 来源' };
  }

  if (toolName === 'http_fetch' && typeof args === 'object' && args !== null) {
    const urlValue = (args as { url?: unknown }).url;
    if (typeof urlValue !== 'string') return { action: 'deny', reason: 'HTTP URL 必须为字符串' };
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      return { action: 'deny', reason: 'HTTP URL 格式无效' };
    }
    if (!['http:', 'https:'].includes(url.protocol))
      return { action: 'deny', reason: '仅允许 http/https URL' };
    if (isPrivateHost(url.hostname))
      return { action: 'deny', reason: '禁止访问本机、私有网段或 link-local 地址' };
    const method = String((args as { method?: unknown }).method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD')
      return { action: 'approval_required', reason: `HTTP ${method} 可能产生外部副作用` };
    return { action: 'allow' };
  }

  if (toolName === 'bash' && typeof args === 'object' && args !== null) {
    const command = String((args as { command?: unknown }).command || '');
    const scope: BashScope = {
      workspace: context.allowedWorkingDirectory || getMintWorkspacePath(),
      // 用户显式配置的 Wiki 根目录位于工作区之外：允许触达，但每次都需要用户批准。
      wikiRoot: trustedWikiRoot(context.wikiPath),
    };
    const scoped = evaluateBashScope(command, (args as { cwd?: unknown }).cwd, scope);
    if (scoped) return scoped;
    if (isHighRiskBashCommand(command)) {
      return { action: 'approval_required', reason: 'Bash 命令可能修改系统或访问敏感目录' };
    }
    return { action: 'allow' };
  }

  if (toolName === 'knowledge_graph' && typeof args === 'object' && args !== null) {
    const action = (args as { action?: unknown }).action;
    if (action === 'batch_add') {
      return { action: 'approval_required', reason: '知识图谱批量写入需要用户批准' };
    }
    if (action === 'query_nodes') return { action: 'allow' };
  }

  // 按输入条件审批的工具（http_fetch / bash / knowledge_graph）已在上面各自的分支中返回决策，
  // 不会走到这里。'conditional' 落到这里说明工具声明了条件却没有实现对应分支，
  // 因此按最保守解释处理为需要审批，而不是靠一份硬编码的工具名名单来放行。
  if (
    metadata.approvalMode === 'always' ||
    metadata.approvalMode === 'conditional' ||
    (metadata.approvalMode === undefined && metadata.sideEffect !== 'none') ||
    metadata.requiresApproval ||
    metadata.riskLevel === 'critical' ||
    (metadata.source === 'mcp' && metadata.sideEffect === 'external')
  ) {
    return { action: 'approval_required', reason: '工具元数据要求审批' };
  }

  return { action: 'allow' };
}
