import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, Graph, GraphEvent, Node } from '@visactor/vgraph';
import { getGraphData } from '@/services/api';
import type { GraphEdge, GraphNode } from '@/services/api/wiki';
import GraphCandidatePanel from './GraphCandidatePanel';

interface NodeDetailProps {
  node: GraphNode | null;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  onClose: () => void;
  onOpenFile?: (path: string) => void;
}

function NodeDetailPanel({ node, edges, allNodes, onClose, onOpenFile }: NodeDetailProps) {
  if (!node) return null;
  const outgoing = edges.filter((edge) => edge.sourceId === node.id);
  const incoming = edges.filter((edge) => edge.targetId === node.id);
  const label = (edge: GraphEdge) =>
    edge.properties.strength === 'weak' || edge.relation === 'references'
      ? '关联（弱）'
      : edge.relation;
  return (
    <div className="graph-node-detail">
      <div className="graph-node-detail-header">
        <h3 className="graph-node-detail-title">{node.label}</h3>
        <button className="graph-node-detail-close" onClick={onClose} aria-label="关闭">
          &times;
        </button>
      </div>
      <div className="graph-node-detail-body">
        <div className="graph-node-detail-field">
          <span className="graph-node-detail-label">类型</span>
          <span className="graph-node-detail-value">{node.type}</span>
        </div>
        {node.sourceFile && (
          <div className="graph-node-detail-field">
            <span className="graph-node-detail-label">来源文件</span>
            <span
              className="graph-node-detail-value graph-node-detail-link"
              onClick={() => onOpenFile?.(node.sourceFile!)}
            >
              {node.sourceFile}
            </span>
          </div>
        )}
        {Object.keys(node.properties).length > 0 && (
          <div className="graph-node-detail-field">
            <span className="graph-node-detail-label">属性</span>
            <pre className="graph-node-detail-props">
              {JSON.stringify(node.properties, null, 2)}
            </pre>
          </div>
        )}
      </div>
      {(outgoing.length > 0 || incoming.length > 0) && (
        <div className="graph-node-detail-relations">
          <h4 className="graph-node-detail-section-title">关系</h4>
          {outgoing.map((edge) => (
            <Relation
              key={edge.id}
              direction="→"
              node={allNodes.find((item) => item.id === edge.targetId)}
              label={label(edge)}
            />
          ))}
          {incoming.map((edge) => (
            <Relation
              key={edge.id}
              direction="←"
              node={allNodes.find((item) => item.id === edge.sourceId)}
              label={label(edge)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Relation({
  direction,
  node,
  label,
}: {
  direction: string;
  node?: GraphNode;
  label: string;
}) {
  return (
    <div className="graph-node-detail-relation">
      <span className="graph-node-detail-relation-arrow">{direction}</span>
      <span className="graph-node-detail-relation-label">{label}</span>
      {node && (
        <span className="graph-node-detail-relation-node">
          {direction} {node.label}
        </span>
      )}
    </div>
  );
}

export function getFadedColor(bg: string): string {
  const hex = bg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},0.12)`;
}
/** 画布优先保证图形可读性，完整标题由悬停提示和详情面板承载。 */
export function getGraphNodeLabel(label: string): string {
  return label.length > 16 ? `${label.slice(0, 16)}...` : label;
}
export function getGraphNodeSize(degree: number): number {
  return Math.min(28, 8 + Math.sqrt(Math.max(0, degree)) * 2.5);
}
type GraphEdgeData = { relation?: string; properties?: GraphEdge['properties']; strength?: string };
export function isReferenceGraphEdge(edge: GraphEdgeData): boolean {
  return edge.relation === 'references';
}
export function isWeakGraphEdge(edge: GraphEdgeData): boolean {
  return (
    edge.properties?.strength === 'weak' || edge.strength === 'weak' || isReferenceGraphEdge(edge)
  );
}
export function getGraphEdgeStrokeStyle(edge: GraphEdgeData): string {
  return isReferenceGraphEdge(edge) ? '#DDE3E8' : '#C3CBD3';
}
export function getGraphEdgeLabelOpacity(edge: GraphEdgeData): number {
  return isReferenceGraphEdge(edge) ? 0 : 1;
}
export function getGraphEdgeWidth(edge: GraphEdgeData): number {
  if (isWeakGraphEdge(edge)) return 0.6;
  const confidence =
    typeof edge.properties?.confidence === 'number' ? edge.properties.confidence : 0.55;
  return 0.7 + confidence * 0.4;
}

/** 移除没有任何关系的节点，避免图谱中出现无法探索的游离点。 */
export function removeIsolatedGraphNodes(data: { nodes: GraphNode[]; edges: GraphEdge[] }): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const connectedIds = new Set<string>();
  data.edges.forEach((edge) => {
    connectedIds.add(edge.sourceId);
    connectedIds.add(edge.targetId);
  });
  const nodes = data.nodes.filter((node) => connectedIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter(
    (edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
  );
  return { nodes, edges };
}

const NODE_COLORS = [
  '#5678D6',
  '#EB8D2F',
  '#59A649',
  '#E0BA2D',
  '#A56AAD',
  '#6DBEC9',
  '#D95145',
  '#A0A0AD',
  '#94674E',
  '#ED848F',
  '#666',
];

function getNodeColor(category: unknown): string {
  if (typeof category === 'number') return NODE_COLORS[Math.abs(category) % NODE_COLORS.length];
  const value = String(category ?? 'concept');
  const index = [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return NODE_COLORS[index % NODE_COLORS.length];
}

interface WikiGraphPanelProps {
  onOpenFile?: (path: string) => void;
}

export default function WikiGraphPanel({ onOpenFile }: WikiGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const allNodesRef = useRef<GraphNode[]>([]);
  const allEdgesRef = useRef<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedNodeEdges, setSelectedNodeEdges] = useState<GraphEdge[]>([]);
  const [graphStats, setGraphStats] = useState({ nodes: 0, semanticEdges: 0, weakReferences: 0 });
  const [panel, setPanel] = useState<'graph' | 'candidates'>('graph');

  const selectNode = useCallback((event: GraphEvent) => {
    const target = event.target;
    if (!target || target.type !== 'node') return;
    const node = allNodesRef.current.find((item) => item.id === target.get('id'));
    if (!node) return;
    setSelectedNode(node);
    setSelectedNodeEdges(
      allEdgesRef.current.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id),
    );
  }, []);

  useEffect(() => {
    if (panel !== 'graph' || !containerRef.current) return;
    let disposed = false;
    async function loadGraph() {
      setLoading(true);
      setError(null);
      try {
        const raw = await getGraphData();
        if (disposed) return;
        const graphData = removeIsolatedGraphNodes(raw);
        allNodesRef.current = graphData.nodes;
        allEdgesRef.current = graphData.edges;
        const weakReferences = graphData.edges.filter(isWeakGraphEdge).length;
        setGraphStats({
          nodes: graphData.nodes.length,
          semanticEdges: graphData.edges.length - weakReferences,
          weakReferences,
        });
        if (graphData.nodes.length === 0) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const {
          CategoryLegend,
          Graph,
          ForceCenter,
          ForceCollision,
          ForceLink,
          ForceManyBody,
          dragCanvas,
          dragNode,
          highlightRelations,
          panZoom,
          showDetails,
        } = await import('@visactor/vgraph');
        const graphRefForForces: { current: Graph | null } = { current: null };
        const collisionForce = new ForceCollision({
          options: {
            width: (data: { id: string }) => {
              const node = graphRefForForces.current?.getNodeById(data.id);
              return node?.layer ? node.layer.getBBoxForHit().width + 3 : 20;
            },
            height: (data: { id: string }) => {
              const node = graphRefForForces.current?.getNodeById(data.id);
              return node?.layer ? node.layer.getBBoxForHit().height + 3 : 20;
            },
          },
        });
        const forces = {
          link: new ForceLink({ options: { distance: 50 } }),
          charge: new ForceManyBody({ options: { strength: -60 } }),
          collide: collisionForce,
          center: new ForceCenter({ options: { x: rect.width / 2, y: rect.height / 2 } }),
        };
        const graph: Graph = new Graph({
          container,
          width: Math.max(rect.width, 320),
          height: Math.max(rect.height, 320),
          minRatio: 0.3,
          maxRatio: 10,
          layout: {
            type: 'force',
            options: {
              forces,
              maxIteration: 300,
              tickIterations: 10,
              onTick: () => graph.refresh(),
              onEnd: () => graph.fitView(),
              clearOnEndOnFirstCall: true,
            },
          },
          setDefaultNode: (data) => ({
            type: 'circle',
            width: getGraphNodeSize(Number(data.degree) || 0),
            height: getGraphNodeSize(Number(data.degree) || 0),
            fillStyle: getNodeColor(data.category),
            strokeStyle: '#fff',
            lineWidth: 1,
            label: {
              text: getGraphNodeLabel(data.label),
              fontSize: 10,
              textBaseline: 'top',
              textAlign: 'center',
              offsetY: 16,
              fillStyle: '#333',
              strokeStyle: '#fff',
              opacity: 1,
              originSize: 10,
            },
            cursor: 'pointer',
          }),
          setNodeStateStyles: (state) =>
            state === 'active' ? { fillStyle: '#64b5cd' } : undefined,
          setDefaultEdge: (data) => ({
            type: 'quadratic',
            styles: { curveOffset: -8, curvePosition: 0.5 },
            lineWidth: getGraphEdgeWidth(data),
            lineDash: isReferenceGraphEdge(data) ? [4, 4] : undefined,
            strokeStyle: isWeakGraphEdge(data) ? getGraphEdgeStrokeStyle(data) : '#ccc',
            label: {
              text: data.relation,
              position: 0.3,
              textBaseline: 'middle',
              textAlign: 'center',
              fillStyle: '#4c72b0',
              strokeStyle: '#fff',
              opacity: getGraphEdgeLabelOpacity(data),
              autoRotate: true,
              originSize: 11,
            },
            endArrow: !isWeakGraphEdge(data),
          }),
          setEdgeStateStyles: (
            state: string,
            data: GraphEdgeData,
            edge: Edge,
          ): Record<string, unknown> | undefined => {
            const label = edge.getLabel();
            if (state === 'show') {
              label?.set('opacity', getGraphEdgeLabelOpacity(data));
              return {
                endArrow: { width: 6 / graph.getZoomRatio(), height: 10 / graph.getZoomRatio() },
                lineWidth: (edge.get('lineWidth') * 1.5) / graph.getZoomRatio(),
              };
            }
            if (state === 'active') {
              label?.set('opacity', getGraphEdgeLabelOpacity(data));
              return {
                endArrow: !isWeakGraphEdge(data),
                lineDash: isReferenceGraphEdge(data) ? [4, 4] : undefined,
                strokeStyle: isReferenceGraphEdge(data) ? '#BFC9D1' : '#64b5cd',
              };
            }
            return undefined;
          },
        });
        graphRefForForces.current = graph;
        graph.addBehavior(panZoom);
        graph.addBehavior(dragCanvas);
        graph.addBehavior(highlightRelations);
        graph.addBehavior(showDetails, {
          showEdgeState: 'show',
          targets: ['node', 'edge'],
          updateLabels: () => {
            const ratio = graph.getZoomRatio();
            graph
              .getNodes()
              .forEach((node) =>
                node.getLabel()?.set('fontSize', node.getLabel()?.get('originSize') / ratio),
              );
            graph.getEdges().forEach((edge) => {
              const label = edge.getLabel();
              label?.set('fontSize', label.get('originSize') / ratio);
              edge.removeState('show');
              edge.setState('show');
            });
            graph.draw();
          },
        });
        graph.addBehavior(dragNode, {
          delegate: false,
          onDrag: (node: Node) => {
            node.set('fx', node.get('x'));
            node.set('fy', node.get('y'));
            graph.layout();
          },
          onDrop: (node: Node) => {
            node.set('fx', undefined);
            node.set('fy', undefined);
            graph.layout();
          },
        });
        graph.on('node:click', selectNode);
        graph.on('canvas:click', () => {
          setSelectedNode(null);
          setSelectedNodeEdges([]);
        });
        const nodeDegrees = new Map<string, number>();
        graphData.edges.forEach((edge) => {
          nodeDegrees.set(edge.sourceId, (nodeDegrees.get(edge.sourceId) ?? 0) + 1);
          nodeDegrees.set(edge.targetId, (nodeDegrees.get(edge.targetId) ?? 0) + 1);
        });
        graph.data({
          nodes: graphData.nodes.map((node) => ({
            ...node,
            id: node.id,
            label: node.label,
            category: node.type,
            degree: nodeDegrees.get(node.id) ?? 0,
          })),
          edges: graphData.edges.map((edge) => ({
            id: edge.id,
            source: edge.sourceId,
            target: edge.targetId,
            relation: edge.relation,
            strength: edge.properties.strength,
          })),
        });
        graphRef.current = graph;
        const legend = document.createElement('div');
        legend.className = 'wiki-graph-legend';
        container.append(legend);
        new CategoryLegend(graph, {
          container: legend,
          encodeAttr: 'category',
          target: 'node',
          encodeStyles: (data) => ({
            marker: { type: 'circle', fillStyle: getNodeColor(data.category) },
          }),
          click: { enable: true },
          width: 120,
          height: 180,
        });
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : '加载图谱失败');
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void loadGraph();
    return () => {
      disposed = true;
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [panel, selectNode]);

  useEffect(() => {
    const graph = graphRef.current;
    const query = searchQuery.trim().toLowerCase();
    if (!graph) return;
    const relatedIds = new Set<string>();
    if (selectedNode)
      allEdgesRef.current.forEach((edge) => {
        if (edge.sourceId === selectedNode.id) relatedIds.add(edge.targetId);
        if (edge.targetId === selectedNode.id) relatedIds.add(edge.sourceId);
      });
    graph.getNodes().forEach((node) => {
      const id = String(node.get('id'));
      const item = allNodesRef.current.find((candidate) => candidate.id === id);
      if (!item) return;
      graph.removeState(node, 'blur');
      graph.removeState(node, 'active');
      const unmatchedSearch = !!query && !item.label.toLowerCase().includes(query);
      const unrelated = !!selectedNode && id !== selectedNode.id && !relatedIds.has(id);
      if (unmatchedSearch || unrelated) graph.setState(node, 'blur', true);
      else if (selectedNode) graph.setState(node, 'active', true);
    });
    graph.refresh();
  }, [searchQuery, selectedNode]);

  if (!loading && !error && allNodesRef.current.length === 0)
    return (
      <div className="wiki-graph-container">
        <div className="wiki-graph-empty">
          <div className="wiki-graph-empty-icon">◎</div>
          <h3>暂无图谱数据</h3>
          <p>可通过 AI 对话添加实体和关系，或通过 API 手动录入</p>
        </div>
      </div>
    );
  return (
    <div className="wiki-graph-container">
      <div className="wiki-graph-toolbar">
        <div className="wiki-graph-search-box">
          <span className="wiki-graph-search-icon">⌕</span>
          <input
            type="text"
            className="wiki-graph-search-input"
            placeholder="搜索节点..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <div className="wiki-graph-stats" aria-label="图谱统计">
          <span>
            <strong>{graphStats.nodes}</strong> 节点
          </span>
          <span>
            <strong>{graphStats.semanticEdges}</strong> 语义边
          </span>
          <span>
            <strong>{graphStats.weakReferences}</strong> 关联
          </span>
        </div>
        <div className="wiki-graph-view-switch">
          <button
            className={panel === 'graph' ? 'is-active' : ''}
            onClick={() => setPanel('graph')}
          >
            图谱
          </button>
          <button
            className={panel === 'candidates' ? 'is-active' : ''}
            onClick={() => setPanel('candidates')}
          >
            候选
          </button>
        </div>
        {error && <span className="wiki-graph-error">{error}</span>}
        {loading && <span className="wiki-graph-loading">加载中...</span>}
      </div>
      {panel === 'graph' && <div ref={containerRef} className="wiki-graph-canvas" />}
      {panel === 'candidates' && <GraphCandidatePanel />}
      {panel === 'graph' && (
        <NodeDetailPanel
          node={selectedNode}
          edges={selectedNodeEdges}
          allNodes={allNodesRef.current}
          onClose={() => setSelectedNode(null)}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  );
}
