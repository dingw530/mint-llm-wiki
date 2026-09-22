import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AiSettings, HistoryMessage, PersistedUiBlock } from './types.js';
import { reactChat } from './services/reactLoopCore.js';
import { parseWikiPage } from './services/utils/wikiShared.js';
import * as settingsService from './services/api/settingsService.js';
import type { ReactEvent } from './services/reactEvents.js';
import { AccumulatingSink } from './services/sink.js';
import type { ReactExecutionPolicy } from './services/reactLoopCore.js';
import { agentRunRegistry } from './services/agentRun.js';
import { createDurableAgentRun } from './services/agentRunFactory.js';
import { findWikiCitationMarkers } from './services/utils/wikiCitationMarkers.js';
import { getWikiVectorHealth } from './services/api/wikiSearchService.js';
import * as agentService from './services/api/agentService.js';
import { routingService } from './services/api/routingService.js';
import { evaluateMemoryGate } from './services/memoryGateProviders/index.js';
import {
  createRuntimeContext,
  type FeatureConfigInput,
  type RuntimeContext,
} from './services/runtime/runtimeContext.js';
export type {
  WikiIngestionRequest,
  WikiIngestionResult,
} from './services/api/wikiIngestionService.js';
export { ingestWikiSource } from './services/api/wikiIngestionService.js';

interface EvalCitation {
  file: string;
  title?: string;
  heading?: string;
  chunkId?: string;
  refId?: string;
  sourceFile?: string;
}

interface EvalWikiReference {
  file: string;
  title: string;
  heading: string;
  chunkId: string;
  refId: string;
}

export interface EvalSettingsInput {
  apiUrl: string;
  apiKey: string;
  modelId: string;
  wikiPath: string;
  wikiSearchMode?: 'keyword' | 'hybrid';
  embeddingApiUrl?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  features?: FeatureConfigInput;
}

const EVAL_WIKI_QUERY_PROTOCOL = [
  '【Wiki-RAG 评测协议】',
  '1. 先用一次 wiki_search 的 question 模式搜索原问题；搜索结果包含完整页面内容和可用的 [C#] 引用标记。',
  '2. 只有在结果为空或明显缺少问题所需主题时，才补充一次搜索；已知多个页面路径时必须用一次 paths 批量读取，不要逐页读取。',
  '3. 每一轮最多发起一个 wiki_search，禁止在同一轮并行发起多个 wiki_search；需要多个文件时使用一次 paths 批量读取。',
  '4. 不要调用 discover_tools、invoke_skill 或 bash 来完成 Wiki 查询；不要为了确认已经获得的内容重复搜索。',
  '5. 最多进行两次 wiki_search，然后必须回答；如果证据不足，明确说明知识库没有足够信息，不要猜测。',
  '6. 每个基于 Wiki 事实的段落都必须在句末使用实际存在的 [C#] 引用；不得使用 [1]、[2] 这类无 C 前缀的编号，也不得编造引用编号。',
  '7. 如果问题要求多个要点、要素或原因，先列出完整清单，再解释各项关系；不要只给泛化总结。',
  '8. 对 write_file 等有副作用工具，发起工具调用本身就是请求审批；运行时会在真正写入前拦截。不要只用文字询问审批，也不要在批准前重复调用或执行其他写入工具。',
].join('\n');

function readCitationSource(wikiPath: string, file: string): string | undefined {
  if (!wikiPath || !file || path.isAbsolute(file)) return undefined;
  const root = path.resolve(wikiPath);
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return undefined;
  try {
    return parseWikiPage(file, fs.readFileSync(resolved, 'utf8')).source || undefined;
  } catch {
    return undefined;
  }
}

function citationFromBlock(wikiPath: string, block: PersistedUiBlock): EvalCitation {
  return {
    file: typeof block.data.file === 'string' ? block.data.file : '',
    title: typeof block.data.title === 'string' ? block.data.title : undefined,
    heading: typeof block.data.heading === 'string' ? block.data.heading : undefined,
    chunkId: typeof block.data.chunkId === 'string' ? block.data.chunkId : undefined,
    refId: typeof block.data.refId === 'string' ? block.data.refId : undefined,
    sourceFile:
      typeof block.data.file === 'string'
        ? readCitationSource(wikiPath, block.data.file)
        : undefined,
  };
}

function citationsFromWikiLinks(wikiPath: string, content: string): EvalCitation[] {
  const citations: EvalCitation[] = [];
  const pattern = /\[([^\]]+)\]\(mint-wiki:\/\/open\?path=([^)]*)\)/g;
  for (const match of content.matchAll(pattern)) {
    try {
      const file = decodeURIComponent(match[2]);
      if (!file.startsWith('pages/')) continue;
      citations.push({
        file,
        title: match[1],
        sourceFile: readCitationSource(wikiPath, file),
      });
    } catch {
      // Ignore malformed links; they are answer content failures, not executor failures.
    }
  }
  return citations;
}

/** 将模型常见的 [1]/[C1] 引用标记映射回本轮 Wiki 搜索引用。 */
export function citationsFromReferenceMarkers(
  wikiPath: string,
  content: string,
  references: EvalWikiReference[],
  existingCitations: EvalCitation[] = [],
): EvalCitation[] {
  const referencesById = new Map(
    references.map((reference) => [reference.refId.toLocaleUpperCase(), reference]),
  );
  const citationsById = new Map(
    existingCitations
      .filter((citation) => citation.refId)
      .map((citation) => [citation.refId!.toLocaleUpperCase(), citation]),
  );
  const citations: EvalCitation[] = [];
  for (const marker of findWikiCitationMarkers(content)) {
    const referenceId = marker.refId.toLocaleUpperCase();
    const existing = citationsById.get(referenceId);
    if (existing) {
      citations.push(existing);
      continue;
    }
    const reference = referencesById.get(referenceId);
    if (reference) citations.push(citationFromReference(wikiPath, reference));
  }
  return citations;
}

function dedupeCitations(citations: EvalCitation[]): EvalCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.file}|${citation.chunkId || ''}|${citation.sourceFile || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(citation.file || citation.title || citation.chunkId || citation.sourceFile);
  });
}

function citationFromReference(wikiPath: string, reference: EvalWikiReference): EvalCitation {
  return {
    file: reference.file,
    title: reference.title,
    heading: reference.heading,
    chunkId: reference.chunkId,
    refId: reference.refId,
    sourceFile: readCitationSource(wikiPath, reference.file),
  };
}

function citationsFromReferences(
  wikiPath: string,
  references: EvalWikiReference[],
): EvalCitation[] {
  return references.map((reference) => citationFromReference(wikiPath, reference));
}

interface EvalCaseInput {
  id: string;
  input: string;
  agent?: string;
  expected?: {
    maxToolCalls?: number;
    maxWikiSearchCalls?: number;
    mustUseTools?: string[];
  };
}

function buildExecutionPolicy(evalCase: EvalCaseInput): ReactExecutionPolicy {
  const maxWikiSearchCalls =
    evalCase.expected?.maxWikiSearchCalls ??
    (evalCase.expected?.mustUseTools?.includes('wiki_search') ? 2 : undefined);
  return {
    maxToolCalls: evalCase.expected?.maxToolCalls,
    maxToolCallsByName:
      maxWikiSearchCalls === undefined ? undefined : { wiki_search: maxWikiSearchCalls },
    maxToolCallsPerRoundByName: maxWikiSearchCalls === undefined ? undefined : { wiki_search: 1 },
  };
}

/** 为每次评测执行创建唯一的持久化运行 ID，避免重复用例覆盖历史事件。 */
export function createEvalRunId(caseId: string): string {
  return `eval:${caseId}:${randomUUID()}`;
}

/** 为隔离评测数据库写入 AI 与 Wiki 配置，避免评测工具读取生产 Wiki。 */
export function configureEvalSettings(input: EvalSettingsInput): AiSettings {
  return configureEvalRuntime(input).settings;
}

/** 为一次评测同时创建 AI 设置和隔离的能力运行时。 */
export function configureEvalRuntime(input: EvalSettingsInput): {
  settings: AiSettings;
  runtimeContext: RuntimeContext;
} {
  settingsService.save({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    modelId: input.modelId,
    wikiPath: input.wikiPath,
    wikiSearchMode: input.wikiSearchMode,
    embeddingApiUrl: input.embeddingApiUrl,
    embeddingModel: input.embeddingModel,
    embeddingDimensions: input.embeddingDimensions,
  });
  const settings = settingsService.getAiSettings();
  return {
    settings,
    runtimeContext: createRuntimeContext({
      features: input.features,
      fallbackJev: settingsService.getJevSettings(),
    }),
  };
}

/** 创建不改写数据库的评测运行时；适用于已准备好的隔离评测库。 */
export function createEvalRuntimeContext(features?: FeatureConfigInput): RuntimeContext {
  return createRuntimeContext({
    features,
    fallbackJev: settingsService.getJevSettings(),
  });
}

/** 返回隔离评测库当前向量索引的覆盖率和失败统计。 */
export function getEvalVectorHealth(settings: AiSettings): ReturnType<typeof getWikiVectorHealth> {
  return getWikiVectorHealth({
    apiUrl: settings.embeddingApiUrl,
    model: settings.embeddingModel,
    dimensions: settings.embeddingDimensions,
  });
}

/** 创建供 agent-eval 使用的 Mint ReAct executor。 */
export function createReactExecutor(
  settings: AiSettings,
  runtimeContext: RuntimeContext = createEvalRuntimeContext(),
) {
  return async (evalCase: EvalCaseInput) => {
    const conversationId = `eval:${evalCase.id}`;
    const resolvedAgent =
      evalCase.agent ||
      (
        await routingService.route(evalCase.input, {
          agents: agentService.list(),
          routingMode: 'auto',
          conversationId,
          runtimeContext,
        })
      ).agentId;
    const selectedAgent =
      resolvedAgent && resolvedAgent !== 'general'
        ? agentService.findById(resolvedAgent)
        : undefined;
    const run = createDurableAgentRun({ runId: createEvalRunId(evalCase.id), conversationId });
    agentRunRegistry.register(run);
    const events: ReactEvent[] = [];
    run.subscribe((event) => events.push(event));
    const sink = new AccumulatingSink();
    const systemPrompt = [
      selectedAgent?.systemPrompt || settings.systemPrompt,
      EVAL_WIKI_QUERY_PROTOCOL,
    ]
      .filter(Boolean)
      .join('\n\n');
    const messages: HistoryMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: evalCase.input },
    ];
    const result = await reactChat(
      messages,
      settings,
      sink,
      resolvedAgent,
      undefined,
      conversationId,
      buildExecutionPolicy(evalCase),
      run,
      runtimeContext,
    );
    const memoryGate = await evaluateMemoryGate(
      { userContent: evalCase.input, conversationId },
      { jev: runtimeContext.getJevSettings() },
    );
    const blockCitations = (result.uiBlocks ?? []).map((block) =>
      citationFromBlock(settings.wikiPath, block),
    );
    const answerMarkerCitations = citationsFromReferenceMarkers(
      settings.wikiPath,
      result.content,
      result.wikiReferences || [],
      blockCitations,
    );
    return {
      content: result.content,
      events,
      state: {
        routingAgent: resolvedAgent,
        memoryGate: {
          providerId: memoryGate.providerId,
          memorize: memoryGate.memorize,
          attempts: memoryGate.attempts,
        },
      },
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      citations: dedupeCitations([
        ...blockCitations,
        ...citationsFromWikiLinks(settings.wikiPath, result.content),
        ...answerMarkerCitations,
      ]),
      retrievedCitations: dedupeCitations(
        citationsFromReferences(settings.wikiPath, result.wikiReferences || []),
      ),
    };
  };
}

/** 读取当前激活的 Mint AI 配置。 */
export { getAiSettings } from './services/api/settingsService.js';
export { getJevSettings } from './services/api/settingsService.js';
export { callJev } from './services/jev/jevClient.js';
export type {
  JevAnswer,
  JevChoiceQuestion,
  JevConfig,
  JevNoulQuestion,
  JevQuestion,
  JevScoreQuestion,
  JevState,
} from './services/jev/types.js';
