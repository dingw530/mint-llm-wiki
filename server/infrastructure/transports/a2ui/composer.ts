import type { PersistedUiBlock } from '../../../types.js';
import { WikiSourceReferenceProvider } from './wiki-source-provider.js';
import {
  findWikiCitationMarkers,
  normalizeWikiCitationMarkers,
} from '../../../services/utils/wikiCitationMarkers.js';
import type {
  A2UIEmission,
  A2UIHandleResult,
  A2UIInput,
  A2UIOutput,
  A2UIProvider,
  A2UIReferenceContext,
} from './types.js';

function parseReferenceMarker(value: string): { refId: string; start: number; end: number } | null {
  const marker = findWikiCitationMarkers(value)[0];
  return marker ? { refId: marker.refId, start: marker.start, end: marker.end } : null;
}

/** 统一构造回答内 A2UI 的入口；Provider 通过构造参数扩展，核心循环无需感知具体业务。 */
export class A2UIComposer {
  private readonly providers: A2UIProvider[];
  private readonly blocks: PersistedUiBlock[] = [];
  private readonly pendingEmissions: A2UIEmission[] = [];
  private readonly displayReferenceIds = new Map<string, string>();
  private pendingAnswer = '';
  private answerTextLength = 0;
  private nextReferenceIndex = 1;
  private nextDisplayReferenceIndex = 1;

  constructor(providers: A2UIProvider[] = [new WikiSourceReferenceProvider()]) {
    this.providers = [...providers];
  }

  handle(input: A2UIInput): A2UIHandleResult {
    if (input.event.kind === 'tool_result') {
      return this.handleToolResult(input.event.toolName, input.event.result, {
        runId: input.runId,
        round: input.round,
        toolCallId: input.event.toolCallId,
      });
    }
    if (input.event.kind === 'answer_completed') {
      const result = this.handleAnswerChunk(input.event.content);
      return { outputs: [...result.outputs, ...this.flushPendingEmissions()] };
    }
    return this.handleAnswerChunk(input.event.content);
  }

  /** 返回当前回答已确认的业务 UI Block，供回答落库使用。 */
  getBlocks(): PersistedUiBlock[] {
    return this.blocks.map((block) => ({ ...block, data: { ...block.data } }));
  }

  /** 返回本轮已从 Wiki 搜索结果解析出的全部结构化引用。 */
  getReferences(): Array<{
    evidenceId: string;
    refId: string;
    title: string;
    file: string;
    heading: string;
    chunkId: string;
    granularity: 'chunk' | 'page' | 'source-family';
    contentHash: string;
  }> {
    return this.providers.flatMap((provider) =>
      (provider.getReferences?.() || []).map((reference) => ({
        evidenceId: reference.evidenceId,
        refId: reference.refId,
        title: reference.title,
        file: reference.file,
        heading: reference.heading,
        chunkId: reference.chunkId,
        granularity: reference.granularity,
        contentHash: reference.contentHash,
      })),
    );
  }

  /** 返回与最终回答展示编号一致的引用，供落库、评测和其他结果消费者使用。 */
  getDisplayReferences(): ReturnType<A2UIComposer['getReferences']> {
    return this.getReferences().map((reference) => ({
      ...reference,
      refId: this.getDisplayReferenceId(reference.refId),
    }));
  }

  /** 仅登记原始工具结果中的引用，不改变已经发送给模型的上下文内容。 */
  captureToolResult(toolName: string, result: unknown, context?: A2UIReferenceContext): void {
    this.handleToolResult(toolName, result, context);
  }

  /** 移除未被编译为组件的引用标记，防止前端显示孤立标记。 */
  sanitizeContent(content: string): string {
    return normalizeWikiCitationMarkers(content, (refId) =>
      this.findReference(refId) ? `[${this.getDisplayReferenceId(refId)}]` : undefined,
    )
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /** 按引用在最终回答中的首次出现顺序分配展示用编号。 */
  private getDisplayReferenceId(originalRefId: string): string {
    const existing = this.displayReferenceIds.get(originalRefId);
    if (existing) return existing;
    const displayRefId = `C${this.nextDisplayReferenceIndex++}`;
    this.displayReferenceIds.set(originalRefId, displayRefId);
    return displayRefId;
  }

  private handleToolResult(
    toolName: string,
    rawResult: unknown,
    context: A2UIReferenceContext = { runId: 'capture', round: 0 },
  ): A2UIHandleResult {
    const provider = this.providers.find((candidate) => candidate.toolName === toolName);
    if (!provider) return { outputs: [] };
    const result = provider.handleToolResult(rawResult, this.nextReferenceIndex, context);
    this.nextReferenceIndex = result.nextReferenceIndex;
    return { outputs: [], contextResult: result.contextResult };
  }

  private findReference(refId: string): {
    provider: A2UIProvider;
    reference: NonNullable<ReturnType<A2UIProvider['findReference']>>;
  } | null {
    for (const provider of this.providers) {
      const reference = provider.findReference(refId);
      if (reference) return { provider, reference };
    }
    return null;
  }

  private handleAnswerChunk(content: string): A2UIHandleResult {
    const value = this.pendingAnswer + content;
    this.pendingAnswer = '';
    const outputs: A2UIOutput[] = [];
    let cursor = 0;
    let marker = parseReferenceMarker(value);
    while (marker) {
      if (marker.start > cursor) {
        const text = value.slice(cursor, marker.start);
        this.pushTextOutput(outputs, text);
        this.answerTextLength += text.length;
      }
      const resolved = this.findReference(marker.refId);
      if (resolved) {
        const displayRefId = this.getDisplayReferenceId(marker.refId);
        const displayMarker = `[${displayRefId}]`;
        this.pushTextOutput(outputs, displayMarker);
        this.answerTextLength += displayMarker.length;
        const emission = resolved.provider.createEmission(
          { ...resolved.reference, refId: displayRefId },
          this.blocks.length + this.pendingEmissions.length,
          this.answerTextLength,
        );
        if (emission) this.pendingEmissions.push(emission);
      }
      cursor = marker.end;
      marker = parseReferenceMarker(value.slice(cursor));
      if (marker) marker = { ...marker, start: marker.start + cursor, end: marker.end + cursor };
    }

    const lastOpenBracket = value.lastIndexOf('[', value.length - 1);
    const hasPartialMarker =
      lastOpenBracket >= cursor && !value.slice(lastOpenBracket).includes(']');
    const textEnd = hasPartialMarker ? lastOpenBracket : value.length;
    if (textEnd > cursor) {
      this.appendText(value.slice(cursor, textEnd), outputs);
    }
    if (hasPartialMarker) this.pendingAnswer = value.slice(lastOpenBracket);
    return { outputs };
  }

  private appendText(content: string, outputs: A2UIOutput[]): void {
    let cursor = 0;
    const paragraphBreak = /\n{2,}/g;
    let match = paragraphBreak.exec(content);
    while (match) {
      const boundaryEnd = match.index + match[0].length;
      this.appendTextPart(content.slice(cursor, boundaryEnd), outputs);
      cursor = boundaryEnd;
      match = paragraphBreak.exec(content);
    }
    this.appendTextPart(content.slice(cursor), outputs);
  }

  private appendTextPart(content: string, outputs: A2UIOutput[]): void {
    if (!content) return;
    this.pushTextOutput(outputs, content);
    this.answerTextLength += content.length;
  }

  private pushTextOutput(outputs: A2UIOutput[], content: string): void {
    const last = outputs[outputs.length - 1];
    if (last?.kind === 'text') last.content += content;
    else outputs.push({ kind: 'text', content });
  }

  private flushPendingEmissions(): A2UIOutput[] {
    if (this.pendingEmissions.length === 0) return [];
    const pending = this.pendingEmissions.splice(0);
    return pending.flatMap((emission) => {
      if (emission.block) {
        const block = {
          ...emission.block,
          textOffset: this.answerTextLength,
          data: { ...emission.block.data, textOffset: this.answerTextLength },
        };
        this.blocks.push(block);
        return [{ kind: 'surface', emission: { ...emission, block } } satisfies A2UIOutput];
      }
      return [{ kind: 'surface', emission } satisfies A2UIOutput];
    });
  }
}
