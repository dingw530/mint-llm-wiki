import * as fs from 'fs';
import * as path from 'path';
import { getNodesWithSource, findNodeByLabel, createGraphCandidate } from './graph-service.js';
import { getAdapter } from '../../infrastructure/ai/adapters/api-adapter.js';
import { normalizeGraphRelation } from '../../utils/graphOntology.js';
import type { AiSettings } from '../../types.js';
import type { CompiledPage } from '../../services/utils/wikiShared.js';
import { isRecord } from '../../utils/typeGuards.js';

const ALLOWED = ['基于', '导致', '应对', '应用于', '约束', '案例', '区别于'];
const GENERIC = new Set(['ai', '产品', '工程', '实践']);
const words = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[a-z]{2,}|[\u4e00-\u9fff]{2}/g) || []).filter(
      (word) => !GENERIC.has(word),
    ),
  );
const score = (a: CompiledPage, title: string, body: string) => {
  const x = words(a.title + ' ' + a.tags.join(' '));
  const y = words(title + ' ' + body.slice(0, 1200));
  let hit = 0;
  x.forEach((w) => {
    if (y.has(w)) hit++;
  });
  return x.size ? hit / x.size : 0;
};

export async function generateCrossBatchCandidates(
  settings: AiSettings,
  wikiPath: string,
  pages: CompiledPage[],
): Promise<void> {
  const current = new Set(pages.map((page) => page.filename));
  const existing = getNodesWithSource().filter(
    (node) => node.sourceFile && !current.has(node.sourceFile),
  );
  const pairs = pages
    .flatMap((page) =>
      existing
        .map((node) => {
          const file = path.join(wikiPath, node.sourceFile!);
          const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
          return { page, node, body, score: score(page, node.label, body) };
        })
        .filter((item) => item.score >= 0.25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
    )
    .slice(0, 12);
  if (!pairs.length) return;
  const adapter = getAdapter(settings.apiType || 'openai-chat');
  if (!adapter) return;
  const prompt = `只审查以下跨批次页面对。仅在关系明确时返回 JSON 数组，每项含 source,target,relation,evidence,confidence。relation 只能是 ${ALLOWED.join('、')}；evidence 必须来自页面摘要，confidence 为0到1。\n${JSON.stringify(pairs.map((p) => ({ source: p.page.title, sourceText: p.page.content.slice(0, 600), target: p.node.label, targetText: p.body.slice(0, 600), candidateScore: p.score })))}`;
  const raw = await adapter.call(
    [
      { role: 'system', content: '你是严谨的知识图谱审核器，只输出合法 JSON 数组。' },
      { role: 'user', content: prompt },
    ],
    { modelId: settings.modelId },
    settings.apiUrl,
    settings.apiKey,
    { maxTokens: 2048, temperature: 0.1 },
  );
  let judged: Record<string, unknown>[] = [];
  try {
    const parsed: unknown = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    if (!Array.isArray(parsed)) return;
    judged = parsed.filter(isRecord);
  } catch {
    return;
  }
  for (const item of judged) {
    const pair = pairs.find((p) => p.page.title === item.source && p.node.label === item.target);
    const relation = normalizeGraphRelation(String(item.relation || ''));
    const confidence = Number(item.confidence);
    const evidence = String(item.evidence || '').trim();
    if (
      !pair ||
      !relation ||
      !ALLOWED.includes(relation) ||
      !evidence ||
      confidence < 0.6 ||
      confidence > 1
    )
      continue;
    const source = findNodeByLabel(pair.page.title);
    if (!source) continue;
    createGraphCandidate({
      sourceId: source.id,
      targetId: pair.node.id,
      relation,
      evidence: evidence.slice(0, 160),
      confidence,
      candidateScore: pair.score,
      sourcePage: pair.page.filename,
      targetPage: pair.node.sourceFile!,
    });
  }
}
