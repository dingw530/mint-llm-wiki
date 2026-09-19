// ── 通用类型 ──

export interface Conversation {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  lockedAgent: string | null;
  routingMode: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  runId?: string;
  reasoning?: string | null;
  imageData?: string | null;
  createdAt: string;
  _tempId?: string;
  segments?: ContentSegment[];
  uiBlocks?: PersistedUiBlock[];
  estimatedTokens?: number;
  tokenUsage?: { totalTokens: number; inputTokens: number; outputTokens: number };
  errorCategory?: 'retryable' | 'configuration' | 'unknown';
}

export interface PersistedUiBlock {
  id: string;
  messageId: string;
  blockIndex: number;
  textOffset: number;
  kind: string;
  version: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WikiCategory {
  name: string;
  description: string;
  include: string[];
  exclude: string[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  type: string;
  systemPrompt: string | null;
  mcpServerIds: string[];
  available: boolean;
  errorMessage: string | null;
  triggerKeywords: string[];
  createdAt: string;
  updatedAt: string;
  label?: string;
  error?: string;
}

export interface Memory {
  id: string;
  content: string;
  category: string;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  status?: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  tools?: McpTool[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface EndpointOutput {
  id: string;
  name: string;
  apiUrl: string;
  apiKeyMasked: string;
  modelId: string;
  apiType: string;
  category: 'text' | 'image';
  verifiedAt?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EndpointInput {
  name: string;
  apiUrl: string;
  apiKey?: string;
  modelId: string;
  apiType?: string;
  category?: 'text' | 'image';
}

export interface VisibleSettings {
  apiUrl: string;
  apiKeyMasked: string;
  modelId: string;
  systemPrompt: string;
  thinkingMode: boolean;
  memoryEnabled: boolean;
  routingMode: string;
  reactMaxIterations: number;
  toolMaxRetries: number;
  showReactSteps: boolean;
  activeEndpointId: string | null;
  activeEndpointName: string | null;
  wikiPath: string;
  wikiSearchMode: 'keyword' | 'hybrid';
  embeddingApiUrl: string;
  embeddingModel: string;
  embeddingDimensions: number;
  vectorStore: 'sqlite' | 'chroma';
  chromaUrl: string;
  chromaApiKeyMasked: string;
}

export interface SettingsInput {
  apiUrl?: string;
  apiKey?: string;
  modelId?: string;
  systemPrompt?: string;
  thinkingMode?: boolean;
  memoryEnabled?: boolean;
  routingMode?: string;
  reactMaxIterations?: number;
  toolMaxRetries?: number;
  showReactSteps?: boolean;
  wikiPath?: string;
  wikiSearchMode?: 'keyword' | 'hybrid';
  embeddingApiUrl?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  vectorStore?: 'sqlite' | 'chroma';
  chromaUrl?: string;
  chromaApiKey?: string;
}

// ── SSE 流类型 ──

export interface StreamChunk {
  content?: string;
  reasoning?: string;
  type?: string;
  agent?: string;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

// ── 内容段类型（按时间顺序展示思维链 + 工具调用 + 正文） ──

export interface ThinkingSegment {
  type: 'thinking';
  content: string;
}

export interface ToolCallSegment {
  type: 'tool_call';
  callId?: string;
  toolName: string;
  summary?: string;
  status: 'running' | 'done' | 'error' | 'approval_required';
  arguments?: unknown;
  result?: string;
  error?: string;
  duration?: number;
  retryCount?: number;
  approvalId?: string;
  approvalReason?: string;
}

export interface TextSegment {
  type: 'text';
  content: string;
}

export interface A2uiSegment {
  type: 'a2ui';
  segmentId: string;
  messages: Record<string, unknown>[];
}

export type ContentSegment = ThinkingSegment | ToolCallSegment | TextSegment | A2uiSegment;

// ── ReAct 步骤类型 ──

export interface ThoughtStep {
  type: 'thought';
  content: string;
}

export interface ToolCallStartStep {
  type: 'tool_call_start';
  callId?: string;
  toolName: string;
  arguments: unknown;
  summary?: string;
}

export interface ToolCallEndStep {
  type: 'tool_call_end';
  callId?: string;
  toolName: string;
  result: string;
  duration: number;
  summary?: string;
}

export interface ToolCallErrorStep {
  type: 'tool_call_error';
  callId?: string;
  toolName: string;
  error: string;
  retryCount: number;
  status?: 'retrying' | 'failed' | 'approval_required';
  approvalId?: string;
  approvalReason?: string;
}

export type ReActStep = ThoughtStep | ToolCallStartStep | ToolCallEndStep | ToolCallErrorStep;

export type DecisionTraceKind =
  | 'start'
  | 'round'
  | 'action'
  | 'result'
  | 'retry'
  | 'error'
  | 'fallback'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface DecisionTraceItem {
  id: string;
  kind: DecisionTraceKind;
  label: string;
  detail?: string;
  status?: 'active' | 'done' | 'error';
}

// ── SSE 回调类型 ──

export interface SendCallbacks {
  onChunk?: (chunk: string) => void;
  onA2ui?: (data: Record<string, unknown>) => void;
  onReasoning?: (chunk: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  onTitle?: (title: string) => void;
  onRouting?: (agentId: string) => void;
  onThought?: (content: string) => void;
  onToolCallStart?: (data: Record<string, unknown>) => void;
  onToolCallEnd?: (data: Record<string, unknown>) => void;
  onToolCallError?: (data: Record<string, unknown>) => void;
  onToolApprovalRequired?: (data: Record<string, unknown>) => void;
  onAnswerReady?: (content: string) => void;
  onRunStarted?: (data: Record<string, unknown>) => void;
  onRoundStarted?: (data: Record<string, unknown>) => void;
  onAgentStatus?: (data: Record<string, unknown>) => void;
  onLoopDetected?: (data: Record<string, unknown>) => void;
  onRunCompleted?: (data: Record<string, unknown>) => void;
  onRunCancelled?: (data: Record<string, unknown>) => void;
  onTokenUsage?: (data: Record<string, unknown>) => void;
}

export interface SendOptions {
  regenerate?: boolean;
  slashCommand?: {
    command: string;
    input: string;
  };
  control?: {
    type: 'tool_approval';
    approvalId: string;
    action: 'approve' | 'deny';
  };
}

export interface StreamReturn {
  abort: () => void;
}

// ── 图片生成类型 ──

export interface ImageGenerateParams {
  endpointId: string;
  prompt: string;
  size?: string;
  quality?: string;
  output_format?: string;
}

export interface GeneratedImage {
  url: string;
  revised_prompt?: string;
  b64_json?: string;
}

export interface GenerateImageResult {
  created: number;
  data: GeneratedImage[];
}

// ── Electron IPC API 类型 ──

export interface ElectronAPI {
  isElectron: boolean;
  platform?: string;

  // 流式对话
  sendMessage: (
    convId: string,
    content: string,
    agent?: string,
    regenerate?: boolean,
    slashCommand?: SendOptions['slashCommand'],
  ) => void;
  streamRecoveryAction: (conversationId: string, actionId: string) => void;
  onChunk: (conversationId: string, callback: (data: string) => void) => () => void;
  onDone: (conversationId: string, callback: () => void) => () => void;
  onError: (conversationId: string, callback: (err: string) => void) => () => void;
  removeListener: (channel: string, callback?: (...args: never[]) => void) => void;
  subscribeIngestionEvents: (conversationId: string) => Promise<{ subscribed: boolean }>;
  onA2ui: (callback: (data: string) => void) => void;

  // 会话
  getConversations: (type?: string) => Promise<{ conversations: Conversation[] }>;
  createConversation: (title?: string, type?: string) => Promise<{ conversation: Conversation }>;
  deleteConversation: (id: string) => Promise<{ success: boolean }>;
  clearAllConversations: () => Promise<{ changes: number }>;
  patchConversation: (
    id: string,
    data: { title?: string; lockedAgent?: string | null },
  ) => Promise<{ conversation: Conversation }>;
  renameConversation: (id: string, title: string) => Promise<{ conversation: Conversation }>;
  lockAgent: (id: string, agentId: string | null) => Promise<{ conversation: Conversation }>;
  generateTitle: (id: string) => Promise<{ title: string }>;
  resolveToolApproval: (
    conversationId: string,
    approvalId: string,
    data: { action: 'approve' | 'deny' },
  ) => Promise<unknown>;
  getRecoverableAgentRuns: (conversationId: string) => Promise<unknown>;
  resolveAgentRunRecovery: (
    conversationId: string,
    runId: string,
    data: {
      action: 'continue' | 'retry' | 'abandon';
      idempotencyKey: string;
      confirmation?: boolean;
    },
  ) => Promise<unknown>;

  // 消息
  getMessages: (convId: string) => Promise<{ messages: Message[] }>;

  // 设置
  getSettings: () => Promise<VisibleSettings>;
  saveSettings: (data: SettingsInput) => Promise<{ success: boolean }>;
  testEmbeddingConnection: (data: {
    apiUrl: string;
    model: string;
    dimensions: number;
  }) => Promise<{ success: boolean; message?: string; dimensions?: number }>;
  testChromaConnection: (data: { url: string; apiKey?: string }) => Promise<{
    success: boolean;
    message?: string;
  }>;

  // Agent
  getAgents: () => Promise<{ agents: Agent[] }>;
  getAgent: (id: string) => Promise<{ agent: Agent }>;
  createAgent: (data: Partial<Agent>) => Promise<{ agent: Agent }>;
  updateAgent: (id: string, data: Partial<Agent>) => Promise<{ agent: Agent }>;
  deleteAgent: (id: string) => Promise<{ success: boolean }>;

  // 端点
  getEndpoints: () => Promise<{ endpoints: EndpointOutput[] }>;
  createEndpoint: (data: EndpointInput) => Promise<{ endpoint: EndpointOutput }>;
  updateEndpoint: (
    id: string,
    data: Partial<EndpointInput>,
  ) => Promise<{ endpoint: EndpointOutput }>;
  deleteEndpoint: (id: string) => Promise<{ success: boolean }>;
  activateEndpoint: (id: string) => Promise<{ success: boolean }>;
  listEndpointModels: (data: {
    apiUrl: string;
    apiKey?: string;
    modelId: string;
    apiType?: string;
  }) => Promise<{ models: string[]; available: boolean }>;
  testEndpointConnection: (data: {
    endpointId?: string;
    name: string;
    apiUrl: string;
    apiKey?: string;
    modelId: string;
    apiType?: string;
  }) => Promise<{
    success: boolean;
    errorCategory?: 'retryable' | 'configuration' | 'unknown';
    errorMessage?: string;
    endpoint?: EndpointOutput;
  }>;

  // 记忆
  getMemories: (category?: string) => Promise<Memory[]>;
  createMemory: (data: { content: string; category?: string }) => Promise<Memory>;
  updateMemory: (id: string, data: { content?: string; category?: string }) => Promise<Memory>;
  deleteMemory: (id: string) => Promise<{ success: boolean }>;

  // MCP Server
  getMcpServers: () => Promise<{ servers: McpServer[] }>;
  getMcpServer: (id: string) => Promise<{ server: McpServer }>;
  createMcpServer: (data: Partial<McpServer>) => Promise<{ server: McpServer }>;
  updateMcpServer: (id: string, data: Partial<McpServer>) => Promise<{ server: McpServer }>;
  deleteMcpServer: (id: string) => Promise<{ success: boolean }>;
  restartMcpServer: (id: string) => Promise<{ server: McpServer }>;

  // 技能
  getSkills: () => Promise<{ skills: { name: string; description: string }[] }>;

  // Bash 安全
  getBashSecurity: () => Promise<{ blockedCommands: string[]; blockedDirs: string[] }>;
  updateBashSecurity: (data: {
    blockedCommands: string[];
    blockedDirs: string[];
  }) => Promise<{ success: boolean }>;

  // 文件
  downloadFile?: (url: string, filename: string) => Promise<{ success?: boolean; reason?: string }>;

  // Wiki
  openWikiInObsidian: () => Promise<{ success: boolean }>;
  listWiki: () => Promise<{ tree: WikiFileTreeNode[]; total: number }>;
  getWikiHeat: (limit?: number) => Promise<import('@/services/api/wiki').WikiHeatResponse>;
  getWikiVectorHealth: () => Promise<import('@/services/api/wiki').WikiVectorHealth>;
  startWikiVectorBackfill: (input: {
    scope: 'all' | 'prefix' | 'selected';
    prefix?: string;
    paths?: string[];
  }) => Promise<{ job: import('@/services/api/wiki').WikiVectorBackfillJob }>;
  getWikiVectorBackfill: (
    jobId: string,
  ) => Promise<{ job: import('@/services/api/wiki').WikiVectorBackfillJob }>;
  retryWikiVectorBackfill: (
    jobId: string,
  ) => Promise<{ job: import('@/services/api/wiki').WikiVectorBackfillJob }>;
  readWiki: (
    path: string,
  ) => Promise<{ content: string; path: string; name: string; size: number }>;
  uploadWiki: (data: {
    name: string;
    size: number;
    buffer: number[];
  }) => Promise<{ jobId: string; sourceFile: string; fileName: string; fileSize: number }>;
  getJobStatus: (jobId: string) => Promise<UploadJob>;
  listWikiJobs: (status?: string, limit?: number) => Promise<{ jobs: UploadJob[]; total: number }>;
  getWikiJob: (jobId: string) => Promise<{ job: UploadJob }>;
  retryWikiJob: (jobId: string) => Promise<{ job: UploadJob }>;
  cancelWikiJob: (jobId: string) => Promise<{ job: UploadJob }>;
  removeWikiJob: (jobId: string) => Promise<{ success: true; jobId: string }>;
  getWikiSchema: () => Promise<{ categories: WikiCategory[] }>;
  addWikiCategory: (category: string) => Promise<{ categories: WikiCategory[] }>;
  removeWikiCategory: (category: string) => Promise<{ categories: WikiCategory[] }>;
  updateWikiSchema: (schema: {
    categories: WikiCategory[];
  }) => Promise<{ categories: WikiCategory[] }>;

  // 知识图谱
  listGraphCandidates: (status?: string) => Promise<unknown[]>;
  acceptGraphCandidate: (id: string) => Promise<unknown>;
  rejectGraphCandidate: (id: string, data?: { note?: string }) => Promise<{ success: boolean }>;
}

export interface UploadJob {
  id: string;
  status: string;
  fileName: string;
  fileSize: number;
  progress: number;
  step: string;
  result?: {
    sourceFile: string;
    format: string;
    textLength: number;
    pageCount?: number;
    preview: string;
    pages?: { filename: string; title: string; size: number }[];
    graphErrors?: string[];
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
  sourceType?: 'upload' | 'chat';
  conversationId?: string | null;
  fileCount?: number;
  attempts?: number;
  statusLabel?: string;
  phase?: 'active' | 'success' | 'error' | 'cancelled';
  isTerminal?: boolean;
  isSuccessful?: boolean;
  canCancel?: boolean;
  canRetry?: boolean;
}

export interface WikiFileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  modifiedAt: number;
  children?: WikiFileTreeNode[];
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
