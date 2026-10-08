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

function bashPathsStayInDirectory(command: string, directory: string): boolean {
  const root = path.resolve(directory);
  const candidates = command.match(/(?:^|\s)(\/[^\s;|&]+|\.\.?\/[^\s;|&]+)/g) || [];
  return candidates.every((candidate) => {
    const value = candidate.trim();
    const resolved = path.resolve(root, value);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  });
}

function pathStaysInDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
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
    const directory = context.allowedWorkingDirectory ?? getMintWorkspacePath();
    const cwd = (args as { cwd?: unknown }).cwd;
    if (directory && typeof cwd === 'string' && !pathStaysInDirectory(cwd, directory)) {
      return { action: 'deny', reason: 'Bash 工作目录超出允许范围' };
    }
    if (directory && !bashPathsStayInDirectory(command, directory)) {
      return { action: 'deny', reason: 'Bash 命令访问了允许工作目录之外的路径' };
    }
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

  if (
    metadata.approvalMode === 'always' ||
    (metadata.approvalMode === undefined && metadata.sideEffect !== 'none') ||
    (metadata.approvalMode === 'conditional' &&
      toolName !== 'http_fetch' &&
      toolName !== 'bash' &&
      toolName !== 'knowledge_graph') ||
    metadata.requiresApproval ||
    metadata.riskLevel === 'critical' ||
    (metadata.source === 'mcp' && metadata.sideEffect === 'external')
  ) {
    return { action: 'approval_required', reason: '工具元数据要求审批' };
  }

  return { action: 'allow' };
}
