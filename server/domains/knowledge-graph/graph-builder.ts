import * as graphRepo from '../../infrastructure/persistence/graph-repository.js';
import type { CompiledPage, Relationship } from '../../services/utils/wikiShared.js';
import { resolveWikiMarkdownLink } from '../../services/utils/wikiLinkProtocol.js';
import { getGraphRelationPriority, normalizeGraphRelation } from '../../utils/graphOntology.js';

// ── Types ──

export interface BuildGraphResult {
  nodesCreated: number;
  edgesCreated: number;
  errors: string[];
}

/** Resolve a page node's category from the caller's Wiki schema adapter. */
export type GraphNodeTypeResolver = (filename: string, wikiPath?: string) => string;

function defaultNodeType(filename: string): string {
  return filename.split('/')[1] || '未分类';
}

// ── Relation Normalization ──

export function normalizeRelation(relation: string): string {
  return normalizeGraphRelation(relation) || relation.trim();
}

interface PrimaryRelationship extends Relationship {
  relation: Exclude<ReturnType<typeof normalizeGraphRelation>, null | 'references'>;
  confidence: number;
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** 为同一无序页面对选择唯一的主语义边。 */
function selectPrimaryRelationships(relationships: Relationship[]): PrimaryRelationship[] {
  const selected = new Map<string, PrimaryRelationship>();

  for (const relationship of relationships) {
    const relation = normalizeGraphRelation(relationship.relation);
    if (!relation || relation === 'references' || !relationship.source || !relationship.target)
      continue;
    if (relationship.source === relationship.target) continue;

    const candidate: PrimaryRelationship = {
      ...relationship,
      relation,
      confidence: normalizeConfidence(relationship.confidence, relationship.evidence ? 0.75 : 0.55),
    };
    const key =
      candidate.source < candidate.target
        ? `${candidate.source}|${candidate.target}`
        : `${candidate.target}|${candidate.source}`;
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, candidate);
      continue;
    }

    const candidateScore =
      getGraphRelationPriority(candidate.relation) * 100 +
      candidate.confidence * 10 +
      (candidate.evidence ? 1 : 0) +
      (candidate.reason ? 0.1 : 0);
    const existingScore =
      getGraphRelationPriority(existing.relation) * 100 +
      existing.confidence * 10 +
      (existing.evidence ? 1 : 0) +
      (existing.reason ? 0.1 : 0);
    if (candidateScore > existingScore) selected.set(key, candidate);
  }

  return [...selected.values()];
}

// ── Markdown Link Extraction ──

export function extractWikiLinks(content: string, sourcePath = 'pages/index.md'): string[] {
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(content)) !== null) {
    const target = resolveWikiMarkdownLink(sourcePath, match[2]);
    if (!target?.path.startsWith('pages/')) continue;
    const pathParts = target.path.split('/');
    const filename = pathParts.pop() || '';
    pathParts.push(filename.replace(/[\s]+/g, '-'));
    links.push(pathParts.join('/'));
  }
  return links;
}

// ── Entity Name Normalization ──

// ── Main ──

/**
 * 从 Wiki 编译结果构建知识图谱。
 *
 * 3 阶段 Pipeline：
 * 1. 创建页面节点（按 label 去重）
 * 2. LLM relationships → 语义边（关系名规范化后入库）
 * 3. 交叉链接提取 → references 边
 *
 * 所有操作在事务中执行。
 */
export function buildGraphFromPages(
  pages: CompiledPage[],
  relationships: Relationship[] = [],
  wikiPath?: string,
  nodeTypeResolver?: GraphNodeTypeResolver,
): BuildGraphResult {
  const errors: string[] = [];

  if (pages.length === 0) {
    return { nodesCreated: 0, edgesCreated: 0, errors: [] };
  }

  interface NodeSpec {
    label: string;
    type: string;
    sourceFile: string;
  }

  const nodeSpecs: NodeSpec[] = pages.map((page) => ({
    label: page.title,
    type: nodeTypeResolver
      ? nodeTypeResolver(page.filename, wikiPath)
      : defaultNodeType(page.filename),
    sourceFile: page.filename,
  }));
  const sourceFileByTitle = new Map(nodeSpecs.map((spec) => [spec.label, spec.sourceFile]));
  const primaryRelationships = selectPrimaryRelationships(relationships);

  const result = graphRepo.transaction(() => {
    let nodesCreated = 0;
    let edgesCreated = 0;
    const referencePairKey = (sourceId: string, targetId: string): string =>
      sourceId < targetId ? `${sourceId}|${targetId}` : `${targetId}|${sourceId}`;
    const referencePairs = new Set(
      graphRepo
        .getAllEdges()
        .filter((edge) => edge.relation === 'references')
        .map((edge) => referencePairKey(edge.sourceId, edge.targetId)),
    );
    const semanticPairs = new Set(
      graphRepo
        .getAllEdges()
        .filter((edge) => edge.relation !== 'references')
        .map((edge) => referencePairKey(edge.sourceId, edge.targetId)),
    );

    // Phase 1: Create page nodes with dedup by label
    const labelToId = new Map<string, string>();

    for (const spec of nodeSpecs) {
      const existing = graphRepo.searchNodes(spec.label);
      const match = existing.find((n) => n.label === spec.label);
      if (match) {
        labelToId.set(spec.label, match.id);
        if (match.type !== spec.type) {
          graphRepo.updateNodeType(match.id, spec.type);
        }
        continue;
      }

      try {
        const node = graphRepo.createNode({
          label: spec.label,
          type: spec.type,
          sourceFile: spec.sourceFile,
        });
        labelToId.set(spec.label, node.id);
        nodesCreated++;
      } catch (err) {
        errors.push('创建节点失败 [' + spec.label + ']: ' + (err as Error).message);
      }
    }

    // Phase 2: LLM relationships → semantic edges
    for (const rel of primaryRelationships) {
      const sourceId = labelToId.get(rel.source);
      const targetId = labelToId.get(rel.target);
      if (!sourceId || !targetId) {
        errors.push('关系 ' + rel.source + ' → ' + rel.target + ': 节点未找到');
        continue;
      }

      try {
        const pairKey = referencePairKey(sourceId, targetId);
        if (semanticPairs.has(pairKey)) continue;

        graphRepo.createEdge({
          sourceId,
          relation: rel.relation,
          targetId,
          source: 'ai-generated',
          properties: {
            strength: 'semantic',
            confidence: rel.confidence,
            reason: rel.reason || undefined,
            evidence: rel.evidence || rel.reason || undefined,
            evidenceType: rel.evidence ? 'source_excerpt' : 'generated_rationale',
            sourceFile: sourceFileByTitle.get(rel.source),
          },
        });
        semanticPairs.add(pairKey);
        edgesCreated++;
      } catch (err) {
        errors.push(
          '创建边失败 [' + rel.source + ' → ' + rel.target + ']: ' + (err as Error).message,
        );
      }
    }

    // Phase 3: Cross-reference link extraction
    const pageFilenameToTitle = new Map<string, string>();
    for (const page of pages) {
      pageFilenameToTitle.set(page.filename, page.title);
    }

    for (const page of pages) {
      const links = extractWikiLinks(page.content, page.filename);
      for (const linkTarget of links) {
        const targetTitle = pageFilenameToTitle.get(linkTarget);
        if (!targetTitle) continue;

        const sourceId = labelToId.get(page.title);
        const targetId = labelToId.get(targetTitle);
        if (!sourceId || !targetId) continue;

        try {
          const existingPairEdges = graphRepo
            .getAllEdges()
            .filter((edge) => edge.sourceId === sourceId && edge.targetId === targetId);
          const pairKey = referencePairKey(sourceId, targetId);
          if (
            existingPairEdges.length === 0 &&
            !referencePairs.has(pairKey) &&
            !semanticPairs.has(pairKey)
          ) {
            graphRepo.createEdge({
              sourceId,
              relation: 'references',
              targetId,
              source: 'auto-extracted',
              properties: {
                strength: 'weak',
                confidence: 0.25,
                evidence: '页面关联链接',
                sourceFile: page.filename,
              },
            });
            referencePairs.add(pairKey);
            edgesCreated++;
          }
        } catch (err) {
          errors.push(
            '创建 references 边失败 [' +
              page.title +
              ' → ' +
              targetTitle +
              ']: ' +
              (err as Error).message,
          );
        }
      }

      // Also check for cross-batch references (links to pages outside current batch)
      // Extract links and try to find them in existing nodes
      if (wikiPath) {
        const crossLinks = extractWikiLinks(page.content, page.filename);
        for (const linkTarget of crossLinks) {
          // If not in current batch, look up by source_file
          if (pageFilenameToTitle.has(linkTarget)) continue;

          // Try to find existing node that matches this filename
          const existingNode = graphRepo.searchNodes('');
          const matched = existingNode.find((n) => n.sourceFile === linkTarget);
          if (matched) {
            const sourceId = labelToId.get(page.title);
            const targetId = matched.id;
            if (sourceId && targetId) {
              try {
                const pairKey = referencePairKey(sourceId, targetId);
                if (!referencePairs.has(pairKey) && !semanticPairs.has(pairKey)) {
                  graphRepo.createEdge({
                    sourceId,
                    relation: 'references',
                    targetId,
                    source: 'auto-extracted',
                    properties: {
                      strength: 'weak',
                      confidence: 0.25,
                      evidence: '页面关联链接',
                      sourceFile: page.filename,
                    },
                  });
                  referencePairs.add(pairKey);
                  edgesCreated++;
                }
              } catch (err) {
                errors.push(
                  '创建跨批次 references 边失败 [' + page.title + ']: ' + (err as Error).message,
                );
              }
            }
          }
        }
      }
    }

    return { nodesCreated, edgesCreated, errors };
  });

  return result;
}
