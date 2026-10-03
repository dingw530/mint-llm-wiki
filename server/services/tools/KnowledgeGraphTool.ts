import { z } from 'zod';
import { BaseTool } from './BaseTool.js';
import type { ToolContext } from './BaseTool.js';
import type { GraphNode } from '../../domains/knowledge-graph/index.js';
import * as graphRepo from '../../domains/knowledge-graph/index.js';

// ── 批量操作子 Schema ──

const BatchNodeSchema = z.object({
  label: z.string().min(1).describe('节点名称'),
  type: z.string().min(1).describe('节点分类，必须与知识库 _schema.json 中的分类名称一致'),
  sourceFile: z.string().min(1).describe('来源 wiki 文件路径，如 pages/极限编程.md'),
});

const BatchEdgeSchema = z.object({
  sourceNodeLabel: z.string().min(1).describe('源节点名称'),
  relation: z.string().min(1).describe('关系类型，如"包含实践"、"要求"、"属于"'),
  targetNodeLabel: z.string().min(1).describe('目标节点名称'),
});

const KnowledgeGraphInputSchema = z.object({
  action: z
    .enum(['query_nodes', 'batch_add'])
    .describe('操作类型：query_nodes=搜索节点，batch_add=批量创建节点和关系（优先使用）'),
  // query_nodes
  query: z.string().optional().describe('搜索关键词（action=query_nodes 时使用）'),
  // batch_add
  nodes: z
    .array(BatchNodeSchema)
    .optional()
    .describe('批量添加的节点列表（action=batch_add 时使用）'),
  edges: z
    .array(BatchEdgeSchema)
    .optional()
    .describe('批量添加的关系列表（action=batch_add 时使用）。关系必须使用已定义的图谱关系本体。'),
});

type KnowledgeGraphInput = z.infer<typeof KnowledgeGraphInputSchema>;

interface KnowledgeGraphOutput {
  message: string;
  data?: Record<string, unknown>;
}

/**
 * 知识图谱工具：允许 AI 在对话中查询和批量操作三元关系图谱数据。
 * 支持搜索节点、批量创建节点和关系。
 * 添加边时通过节点名称模糊匹配，无需 AI 知道数据库 ID。
 */
export class KnowledgeGraphTool extends BaseTool<KnowledgeGraphInput, KnowledgeGraphOutput> {
  readonly name = 'knowledge_graph';
  readonly description =
    '操作知识图谱三元关系数据。支持：搜索节点(query_nodes)、批量创建节点和关系(batch_add)。用户说"加到图谱""提取到图谱"时使用此工具。批量创建时每个节点必须关联来源文件(sourceFile)。';

  readonly inputSchema = KnowledgeGraphInputSchema;

  isReadOnly(): boolean {
    return false;
  }

  isConcurrencySafe(): boolean {
    return false;
  }

  async execute(input: KnowledgeGraphInput, _context: ToolContext): Promise<KnowledgeGraphOutput> {
    switch (input.action) {
      // ── 查询节点 ──
      case 'query_nodes': {
        const q = input.query || '';
        if (!q.trim()) {
          const all = graphRepo.getGraphData();
          return {
            message:
              all.nodes.length > 0
                ? `图谱中共有 ${all.nodes.length} 个节点、${all.edges.length} 条关系`
                : '图谱中暂无数据',
            data: { nodes: all.nodes, edges: all.edges },
          };
        }
        const results = graphRepo.searchNodes(q);
        return {
          message:
            results.length > 0
              ? `找到 ${results.length} 个匹配的节点：${results.map((n) => n.label).join('、')}`
              : `未找到匹配 "${q}" 的节点`,
          data: { nodes: results },
        };
      }

      // ── 批量创建节点和关系 ──
      case 'batch_add': {
        const nodes = input.nodes || [];
        const edges = input.edges || [];

        if (nodes.length === 0 && edges.length === 0) {
          throw new Error('批量创建至少需要提供一个节点或一条关系');
        }

        const createdNodes: GraphNode[] = [];
        const createdEdges: { sourceLabel: string; relation: string; targetLabel: string }[] = [];
        const errors: string[] = [];

        // 1. 创建所有节点（按 label 去重）
        for (const n of nodes) {
          try {
            if (!n.sourceFile?.trim()) {
              errors.push(`节点"${n.label}"缺少来源文件(sourceFile)`);
              continue;
            }
            const label = n.label.trim();
            const sourceFile = n.sourceFile.trim();
            // 按 label 去重
            const existing = graphRepo.searchNodes(label);
            const match = existing.find((ex) => ex.label === label);
            if (match) {
              createdNodes.push(match);
              continue;
            }
            const node = graphRepo.createNode({ label, type: n.type, sourceFile });
            createdNodes.push(node);
          } catch (err) {
            errors.push(`节点"${n.label}"创建失败: ${(err as Error).message}`);
          }
        }

        // 2. 创建所有关系
        for (const e of edges) {
          try {
            const sources = graphRepo.searchNodes(e.sourceNodeLabel.trim());
            const targets = graphRepo.searchNodes(e.targetNodeLabel.trim());

            if (sources.length === 0) {
              errors.push(
                `关系"${e.sourceNodeLabel}→${e.targetNodeLabel}"失败：源节点"${e.sourceNodeLabel}"不存在`,
              );
              continue;
            }
            if (targets.length === 0) {
              errors.push(
                `关系"${e.sourceNodeLabel}→${e.targetNodeLabel}"失败：目标节点"${e.targetNodeLabel}"不存在`,
              );
              continue;
            }

            const source =
              sources.find((n: GraphNode) => n.label === e.sourceNodeLabel.trim()) || sources[0];
            const target =
              targets.find((n: GraphNode) => n.label === e.targetNodeLabel.trim()) || targets[0];

            // 按 (sourceId, relation, targetId) 去重
            const relation = e.relation.trim();
            const existingEdge = graphRepo.findEdgeByTriple(source.id, relation, target.id);
            if (existingEdge) {
              createdEdges.push({ sourceLabel: source.label, relation, targetLabel: target.label });
              continue;
            }

            graphRepo.createEdge({
              sourceId: source.id,
              relation,
              targetId: target.id,
            });
            createdEdges.push({ sourceLabel: source.label, relation, targetLabel: target.label });
          } catch (err) {
            errors.push(
              `关系"${e.sourceNodeLabel}→${e.targetNodeLabel}"创建失败: ${(err as Error).message}`,
            );
          }
        }

        // 3. 构建返回消息
        const parts: string[] = [];
        if (createdNodes.length > 0) {
          parts.push(
            `添加了 ${createdNodes.length} 个节点：${createdNodes.map((n) => `「${n.label}」`).join('、')}`,
          );
        }
        if (createdEdges.length > 0) {
          parts.push(
            `建立了 ${createdEdges.length} 条关系：${createdEdges.map((e) => `「${e.sourceLabel}」—[${e.relation}]→「${e.targetLabel}」`).join('、')}`,
          );
        }
        if (errors.length > 0) {
          parts.push(`遇到 ${errors.length} 个错误：${errors.join('；')}`);
        }

        return {
          message: parts.length > 0 ? parts.join('；') : '没有执行任何操作',
          data: {
            nodes: createdNodes,
            edges: createdEdges,
            errors: errors.length > 0 ? errors : undefined,
          },
        };
      }

      default:
        throw new Error(`不支持的操作: ${input.action}`);
    }
  }
}
