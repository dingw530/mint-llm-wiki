import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import type { ToolContext, ToolMetadata } from '../../../agent-runtime/tooling/tool-contracts.js';
import * as settingsService from '../../../application/settings/settings-service.js';
import { resolveWikiIdentityWithJev } from '../../../infrastructure/ai/jev/wiki-identity-provider.js';
import { mergeExistingWikiPage } from '../../../domains/wiki/index.js';
import { getWikiPath } from '../../wiki/wiki-path.js';

const WikiMergeInputSchema = z.object({
  sourcePath: z
    .string()
    .min(1)
    .describe('要合并的既有 Wiki 页面路径，例如 pages/concepts/source.md'),
});

type WikiMergeInput = z.infer<typeof WikiMergeInputSchema>;

interface WikiMergeOutput {
  sourcePath: string;
  targetPath: string;
  revisionPath: string;
  provider: string;
  candidateCount: number;
  message: string;
}

/** Merge one existing Wiki page into its automatically resolved canonical page. */
export class WikiMergeTool extends BaseTool<WikiMergeInput, WikiMergeOutput> {
  readonly name = 'wiki_merge';
  readonly description =
    '将一个既有 Wiki 知识页合并到同一实体或概念的规范页面。工具会按页面标题和 aliases 召回少量候选，优先使用已启用的 Jev 判断；Jev 未启用或不可用时使用 LLM。只有明确判定为同一实体时才会合并。成功后删除源页，保留源页修订记录，并更新生命周期、图谱、索引和 manifest。需要用户审批。';
  readonly inputSchema = WikiMergeInputSchema;

  isReadOnly(): boolean {
    return false;
  }

  isConcurrencySafe(): boolean {
    return false;
  }

  getMetadata(): ToolMetadata {
    return { ...super.getMetadata(), approvalMode: 'always', retrySafety: 'never' };
  }

  getCallSummary(input: WikiMergeInput): string {
    return `正在查找「${input.sourcePath}」的合并目标`;
  }

  getResultSummary(result: WikiMergeOutput): string {
    return result.message;
  }

  async execute(_input: WikiMergeInput, context: ToolContext): Promise<WikiMergeOutput> {
    const wikiPath = getWikiPath();
    if (!wikiPath) throw new Error('Wiki 路径未配置，请在设置中配置 wikiPath');
    if (!context.approvalGranted) throw new Error('wiki_merge 需要用户审批');
    return mergeExistingWikiPage(
      settingsService.getAiSettings(),
      wikiPath,
      _input.sourcePath,
      settingsService.getJevSettings(),
      resolveWikiIdentityWithJev,
    );
  }
}
