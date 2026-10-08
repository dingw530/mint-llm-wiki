/**
 * 图谱关系本体：定义允许的关系、同义词归一化与语义优先级。
 */
export const GRAPH_RELATIONS = [
  '包含',
  '属于',
  '基于',
  '区别于',
  '演进到',
  '演化自',
  '提供',
  '实现',
  '支持',
  '定义',
  '导致',
  '应对',
  '应用于',
  '约束',
  '案例',
  'references',
] as const;

export type GraphRelation = (typeof GRAPH_RELATIONS)[number];

const RELATION_SYNONYM_MAP: Record<string, GraphRelation> = {
  组成部分: '包含',
  组成: '包含',
  '由…组成': '包含',
  包括: '包含',
  '是…的一种': '属于',
  归类于: '属于',
  分类为: '属于',
  建立在: '基于',
  依赖于: '基于',
  '建立在…之上': '基于',
  不同于: '区别于',
  '与…不同': '区别于',
  对比: '区别于',
  演变为: '演进到',
  发展为: '演进到',
  进化为: '演进到',
  源于: '演化自',
  起源于: '演化自',
  输出: '提供',
  产生: '提供',
  达成: '实现',
  支撑: '支持',
  辅助: '支持',
  规定: '定义',
  规范: '定义',
  引发: '导致',
  造成: '导致',
  解决: '应对',
  缓解: '应对',
  用于: '应用于',
  使用于: '应用于',
  限制: '约束',
  制约: '约束',
  实例: '案例',
  案例是: '案例',
};

const RELATION_PRIORITY: Record<GraphRelation, number> = {
  包含: 100,
  属于: 100,
  定义: 95,
  导致: 90,
  应对: 90,
  约束: 90,
  基于: 85,
  应用于: 85,
  案例: 85,
  提供: 80,
  实现: 80,
  支持: 80,
  区别于: 75,
  演进到: 75,
  演化自: 75,
  references: 0,
};

/** 将同义关系归一化；不在本体内的关系返回 null。 */
export function normalizeGraphRelation(relation: string): GraphRelation | null {
  const normalized = relation.trim();
  if ((GRAPH_RELATIONS as readonly string[]).includes(normalized)) {
    return normalized as GraphRelation;
  }
  return RELATION_SYNONYM_MAP[normalized] || null;
}

/** 主语义边仲裁时使用的固定优先级。 */
export function getGraphRelationPriority(relation: GraphRelation): number {
  return RELATION_PRIORITY[relation];
}
