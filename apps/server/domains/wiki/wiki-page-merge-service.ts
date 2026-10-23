import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AiSettings } from '../../types.js';
import type { JevSettings } from '../../types.js';
import * as lifecycleRepository from '../../infrastructure/persistence/wiki-lifecycle-repository.js';
import {
  readWikiManifest,
  updateIndexMd,
  writePreparedWikiPages,
  writeWikiManifest,
} from '../../infrastructure/filesystem/wiki-content.js';
import { inferWikiGraphNodeType } from '../../infrastructure/filesystem/wiki-graph-metadata.js';
import * as graphService from '../knowledge-graph/index.js';
import { prepareExistingWikiPageMerge, remapWikiPageLinks } from './wiki-compiler.js';
import { registerWikiPageMerge } from './wiki-knowledge-lifecycle-service.js';
import { rebuildWikiSearchIndex } from './wiki-search-service.js';
import { isWikiRelativePathSafe } from './wiki-path-safety.js';
import type { WikiIdentityProviderCall } from './identity/types.js';

export interface WikiPageMergeResult {
  sourcePath: string;
  targetPath: string;
  revisionPath: string;
  provider: string;
  candidateCount: number;
  message: string;
}

/** Resolve and merge an existing Wiki page, preserving its original Markdown as a revision. */
export async function mergeExistingWikiPage(
  settings: AiSettings,
  wikiPath: string,
  sourcePath: string,
  jevSettings: JevSettings,
  jevIdentityProvider: WikiIdentityProviderCall,
): Promise<WikiPageMergeResult> {
  const plan = await prepareExistingWikiPageMerge(
    settings,
    wikiPath,
    sourcePath,
    jevSettings,
    jevIdentityProvider,
  );
  if (plan.decision.kind !== 'match' || !plan.mergedTargetPage) {
    const reason = plan.decision.kind === 'uncertain' ? plan.decision.reason : 'no_identity_match';
    throw new Error(`未执行知识页合并：${reason || plan.decision.kind}。源页面已保留。`);
  }

  const source = plan.sourcePath;
  const target = plan.mergedTargetPage;
  if (source === target.filename) throw new Error('源页面与目标页面相同，拒绝合并');
  if (!isWikiRelativePathSafe(wikiPath, target.filename)) throw new Error('目标页面路径无效');

  const revisionId = createHash('sha256')
    .update(`${source}\0${plan.sourceMarkdown}`)
    .digest('hex')
    .slice(0, 24);
  const revisionPath = `sources/wiki-merge-revisions/${revisionId}.md`;
  const revisionAbsolutePath = path.resolve(wikiPath, revisionPath);
  fs.mkdirSync(path.dirname(revisionAbsolutePath), { recursive: true });
  if (fs.existsSync(revisionAbsolutePath)) {
    const existingRevision = fs.readFileSync(revisionAbsolutePath, 'utf8');
    if (existingRevision !== plan.sourceMarkdown) throw new Error('知识页修订快照发生 hash 冲突');
  } else {
    fs.writeFileSync(revisionAbsolutePath, plan.sourceMarkdown, 'utf8');
  }

  const manifest = readWikiManifest(wikiPath);
  const manifestId = `wiki-merge-${revisionId}`;
  const manifestEntry = {
    id: manifestId,
    sourceFile: revisionPath,
    archivedFiles: [revisionPath],
    pageFiles: [target.filename],
    summary: `合并 ${source} 到 ${target.filename}`,
    createdAt: new Date().toISOString(),
  };
  const priorTarget = fs.readFileSync(path.resolve(wikiPath, target.filename), 'utf8');
  const remappedTarget = {
    ...target,
    content: remapWikiPageLinks(target.content, target.filename, source, target.filename),
  };
  let targetWritten = false;
  let databaseCommitted = false;
  try {
    writePreparedWikiPages(wikiPath, [remappedTarget]);
    targetWritten = true;
    lifecycleRepository.transaction(() => {
      registerWikiPageMerge(revisionPath, plan.sourceMarkdown, source, remappedTarget);
      graphService.mergeWikiPageNode(
        source,
        target.filename,
        target.title,
        inferWikiGraphNodeType(target.filename, wikiPath),
      );
    });
    databaseCommitted = true;
    const existingEntry = manifest.entries.find((entry) => entry.id === manifestId);
    if (!existingEntry) {
      manifest.entries.push(manifestEntry);
      writeWikiManifest(wikiPath, manifest);
    }
    const sourceAbsolutePath = path.resolve(wikiPath, source);
    if (!isWikiRelativePathSafe(wikiPath, source)) throw new Error('源页面路径无效，无法删除');
    fs.unlinkSync(sourceAbsolutePath);
    updateIndexMd(wikiPath, [{ filename: target.filename, title: target.title }]);
    await rebuildWikiSearchIndex(wikiPath, getEmbeddingConfig(settings));
    return {
      sourcePath: source,
      targetPath: target.filename,
      revisionPath,
      provider: plan.decision.provider,
      candidateCount: plan.candidates.length,
      message: `已将「${plan.sourcePage.title}」合并到「${target.title}」，源页面修订已保存。`,
    };
  } catch (error) {
    if (targetWritten && !databaseCommitted)
      fs.writeFileSync(path.resolve(wikiPath, target.filename), priorTarget, 'utf8');
    const sourceAbsolutePath = path.resolve(wikiPath, source);
    if (!fs.existsSync(sourceAbsolutePath)) {
      fs.mkdirSync(path.dirname(sourceAbsolutePath), { recursive: true });
      fs.writeFileSync(sourceAbsolutePath, plan.sourceMarkdown, 'utf8');
    }
    throw error;
  }
}

function getEmbeddingConfig(settings: AiSettings) {
  if (settings.wikiSearchMode !== 'hybrid') return undefined;
  return {
    apiUrl: settings.embeddingApiUrl,
    model: settings.embeddingModel,
    dimensions: settings.embeddingDimensions,
    vectorStore: settings.vectorStore,
    chromaUrl: settings.chromaUrl,
    chromaApiKey: settings.chromaApiKey,
  };
}
