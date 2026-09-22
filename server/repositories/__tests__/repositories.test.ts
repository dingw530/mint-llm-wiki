import { describe, expect, it, vi, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import * as endpointRepo from '../endpointRepository.js';
import * as graphRepo from '../graphRepository.js';
import * as candidateRepo from '../graphCandidateRepository.js';
import * as routingLogRepo from '../routingLogRepository.js';
import * as endpointService from '../../services/api/endpointService.js';
import { encrypt } from '../../services/utils/encryption.js';

function cleanEndpoints() {
  endpointRepo.getAll().forEach((e) => {
    try {
      endpointRepo.del(e.id);
    } catch {}
  });
}
function cleanGraph() {
  graphRepo.getAllEdges().forEach((e) => {
    try {
      graphRepo.deleteEdge(e.id);
    } catch {}
  });
  graphRepo.getGraphData().nodes.forEach((n) => {
    try {
      graphRepo.deleteNode(n.id);
    } catch {}
  });
}

// ── endpointRepository ──

describe('endpointRepository', () => {
  afterAll(() => cleanEndpoints());

  it('CRUD lifecycle', () => {
    cleanEndpoints();
    expect(endpointRepo.count()).toBe(0);
    expect(endpointRepo.getActive()).toBeNull();
    expect(endpointRepo.getAll()).toEqual([]);

    endpointRepo.insert({
      id: 'er1',
      name: 'One',
      apiUrl: 'https://a.com',
      apiKey: 'sk-1',
      modelId: 'm1',
      isActive: true,
      sortOrder: 0,
    });
    endpointRepo.insert({
      id: 'er2',
      name: 'Two',
      apiUrl: 'https://b.com',
      apiKey: '',
      modelId: 'm2',
      isActive: false,
      sortOrder: 1,
    });
    expect(endpointRepo.count()).toBe(2);
    expect(endpointRepo.getById('er1')!.name).toBe('One');
    expect(endpointRepo.getById('nope')).toBeNull();
    expect(endpointRepo.getActive()!.id).toBe('er1');
    expect(endpointRepo.getAll()).toHaveLength(2);
    expect(endpointRepo.update('er1', { name: 'UPD' })!.name).toBe('UPD');
    expect(endpointRepo.update('nope', { name: 'x' })).toBeNull();
    endpointRepo.setActive('er2');
    expect(endpointRepo.getActive()!.id).toBe('er2');
    expect(endpointRepo.getById('er1')!.isActive).toBe(false);
    endpointRepo.del('er1');
    expect(endpointRepo.getById('er1')).toBeNull();
    expect(endpointRepo.count()).toBe(1);
  });
});

// ── endpointService ──

describe('endpointService', () => {
  afterAll(() => cleanEndpoints());

  it('validateInput', () => {
    expect(() => endpointService.create({} as any)).toThrow();
    expect(() =>
      endpointService.create({ name: '', apiUrl: 'https://v.com', modelId: 'm' }),
    ).toThrow();
    expect(() => endpointService.create({ name: 'x', apiUrl: 'bad', modelId: 'm' })).toThrow();
    expect(() =>
      endpointService.create({ name: 'x', apiUrl: 'https://v.com', modelId: '' }),
    ).toThrow();
    expect(() =>
      endpointService.create({ name: 'a'.repeat(51), apiUrl: 'https://v.com', modelId: 'm' }),
    ).toThrow();
  });

  it('creates first as active, second inactive', () => {
    cleanEndpoints();
    const r = endpointService.create({ name: 'A1', apiUrl: 'https://f.com', modelId: 'm1' });
    expect(r.isActive).toBe(true);
    const r2 = endpointService.create({ name: 'A2', apiUrl: 'https://s.com', modelId: 'm2' });
    expect(r2.isActive).toBe(false);
  });

  it('duplicate name', () => {
    expect(() =>
      endpointService.create({ name: 'A1', apiUrl: 'https://x.com', modelId: 'm' }),
    ).toThrow();
  });

  it('getById', () => {
    const list = endpointService.list().endpoints;
    expect(endpointService.getById(list[0].id)).not.toBeNull();
    expect(endpointService.getById('nope')).toBeNull();
  });

  it('update', () => {
    const a1 = endpointService.list().endpoints.find((e) => e.name === 'A1')!;
    const u = endpointService.updateEndpoint(a1.id, {
      name: 'Renamed',
      apiUrl: 'https://new.com',
      modelId: 'm1',
    });
    expect(u.name).toBe('Renamed');
    expect(() =>
      endpointService.updateEndpoint('nope', { name: 'X', apiUrl: 'https://v.com', modelId: 'm' }),
    ).toThrow();
  });

  it('activate', () => {
    const a2 = endpointService.list().endpoints.find((e) => e.name === 'A2')!;
    endpointService.activate(a2.id);
    expect(endpointService.getActiveEndpoint()!.id).toBe(a2.id);
    expect(() => endpointService.activate('nope')).toThrow();
  });

  it('getActiveAiConfig', () => {
    const c = endpointService.getActiveAiConfig();
    expect(c).not.toBeNull();
    expect(c!.modelId).toBe('m2');
  });

  it('tracks endpoint verification independently from activation', () => {
    cleanEndpoints();
    const endpoint = endpointService.create({
      name: 'Verified',
      apiUrl: 'https://verified.com',
      modelId: 'm',
    });
    expect(endpointService.hasVerifiedTextEndpoint()).toBe(false);

    const verified = endpointService.markVerified(endpoint.id);
    expect(verified.verifiedAt).toBeTruthy();
    expect(endpointService.hasVerifiedTextEndpoint()).toBe(true);

    endpointService.updateEndpoint(endpoint.id, {
      name: 'Verified',
      apiUrl: 'https://changed.com',
      modelId: 'm',
    });
    expect(endpointService.hasVerifiedTextEndpoint()).toBe(false);
  });

  it('remove: non-existent first, then last fails', () => {
    cleanEndpoints();
    endpointService.create({ name: 'X', apiUrl: 'https://x.com', modelId: 'm' });
    endpointService.create({ name: 'Y', apiUrl: 'https://y.com', modelId: 'm' });
    expect(() => endpointService.remove('nope')).toThrow(/不存在/);
    endpointService.remove(endpointService.list().endpoints[0].id);
    expect(() => endpointService.remove(endpointService.list().endpoints[0].id)).toThrow(/保留/);
  });

  it('migrateLegacyEndpoint returns null when endpoints exist', () => {
    cleanEndpoints();
    endpointService.create({ name: 'M', apiUrl: 'https://e.com', modelId: 'm' });
    expect(endpointService.migrateLegacyEndpoint({ apiUrl: 'https://x.com' })).toBeNull();
  });
});

// ── graphRepository ──

describe('graphRepository', () => {
  afterAll(() => cleanGraph());

  it('CRUD lifecycle', () => {
    cleanGraph();
    // Verify clean
    expect(graphRepo.getGraphData().nodes).toEqual([]);

    const PREFIX = `gr_${Date.now()}_`;
    const n1 = graphRepo.createNode({ label: `${PREFIX}A`, type: 'concept', sourceFile: 'a.md' });
    const n2 = graphRepo.createNode({ label: `${PREFIX}B`, type: 'practice', sourceFile: 'b.md' });
    expect(graphRepo.getGraphData().nodes).toHaveLength(2);
    expect(graphRepo.searchNodes(PREFIX)).toHaveLength(2);
    expect(graphRepo.searchNodes(`${PREFIX}A`)).toHaveLength(1);
    expect(graphRepo.searchNodes(`${PREFIX}x`)).toEqual([]);
    expect(graphRepo.getNode(n1.id)!.label).toBe(`${PREFIX}A`);
    expect(graphRepo.getNode('nope')).toBeNull();
    expect(graphRepo.getAllNodesWithSource().length).toBe(2);

    graphRepo.updateNodeType(n1.id, 'methodology');
    expect(graphRepo.getNode(n1.id)!.type).toBe('methodology');

    graphRepo.createEdge({ sourceId: n1.id, relation: '包含', targetId: n2.id });
    expect(graphRepo.getAllEdges()).toHaveLength(1);
    expect(graphRepo.findEdgeByTriple(n1.id, '包含', n2.id)).not.toBeNull();
    expect(graphRepo.findEdgeByTriple(n1.id, 'x', n2.id)).toBeNull();
    expect(graphRepo.getNodeNeighbors(n1.id)!.edges).toHaveLength(1);
    expect(graphRepo.getNodeNeighbors('nope')).toBeNull();

    graphRepo.deleteEdge(graphRepo.getAllEdges()[0].id);
    expect(graphRepo.getAllEdges()).toHaveLength(0);
    graphRepo.deleteNode(n2.id);
    expect(graphRepo.getNode(n2.id)).toBeNull();
  });

  it('transactions work', () => {
    const PREFIX = `tx_${Date.now()}_`;
    const na = graphRepo.createNode({ label: `${PREFIX}A`, type: 'concept', sourceFile: 'ta.md' });
    const nb = graphRepo.createNode({ label: `${PREFIX}B`, type: 'concept', sourceFile: 'tb.md' });
    graphRepo.transaction(() => {
      graphRepo.createEdge({ sourceId: na.id, relation: '案例', targetId: nb.id });
    });
    expect(graphRepo.getAllEdges()).toHaveLength(1);
  });
});

// ── graphCandidates ──

describe('graphCandidates', () => {
  afterAll(() => {
    candidateRepo.list().forEach((c) => {
      try {
        candidateRepo.review(c.id, 'rejected');
      } catch {}
    });
    cleanGraph();
  });

  it('CRUD lifecycle', () => {
    cleanGraph();
    expect(candidateRepo.list()).toEqual([]);

    const PREFIX = `gc_${Date.now()}_`;
    const n1 = graphRepo.createNode({
      label: `${PREFIX}Src`,
      type: 'concept',
      sourceFile: 'cs.md',
    });
    const n2 = graphRepo.createNode({
      label: `${PREFIX}Tgt`,
      type: 'concept',
      sourceFile: 'ct.md',
    });
    candidateRepo.create({
      sourceId: n1.id,
      targetId: n2.id,
      relation: '基于',
      evidence: 'e',
      confidence: 0.8,
      candidateScore: 0.7,
      sourcePage: 'cs.md',
      targetPage: 'ct.md',
    });
    expect(candidateRepo.list()).toHaveLength(1);
    expect(candidateRepo.list('pending')).toHaveLength(1);

    const c = candidateRepo.list()[0];
    expect(candidateRepo.get(c.id)).not.toBeNull();
    expect(candidateRepo.get('nope')).toBeNull();
    candidateRepo.review(c.id, 'accepted');
    expect(candidateRepo.get(c.id)!.status).toBe('accepted');

    const n3 = graphRepo.createNode({
      label: `${PREFIX}Src2`,
      type: 'concept',
      sourceFile: 'cs2.md',
    });
    const n4 = graphRepo.createNode({
      label: `${PREFIX}Tgt2`,
      type: 'concept',
      sourceFile: 'ct2.md',
    });
    candidateRepo.create({
      sourceId: n3.id,
      targetId: n4.id,
      relation: '约束',
      evidence: 'e',
      confidence: 0.6,
      candidateScore: 0.5,
      sourcePage: 'cs2.md',
      targetPage: 'ct2.md',
    });
    const p = candidateRepo.list('pending').find((x) => x.sourceId === n3.id)!;
    candidateRepo.review(p.id, 'rejected', 'no');
    expect(candidateRepo.get(p.id)!.reviewNote).toBe('no');
  });
});

// ── routingLogRepository ──

describe('routingLogRepository', () => {
  it('CRUD lifecycle', () => {
    const uid = randomUUID().slice(0, 8);
    const cid = `c_${uid}`;
    routingLogRepo.create({
      id: `rl_${uid}_1`,
      conversation_id: cid,
      message_id: 'm1',
      agent_id: 'custom-agent',
      confidence: 0.95,
      method: 'keyword',
      latency_ms: 5,
      message_preview: '自定义请求',
      locked_agent: null,
      routing_mode: 'auto',
      created_at: new Date().toISOString(),
    });
    routingLogRepo.create({
      id: `rl_${uid}_2`,
      conversation_id: cid,
      message_id: null,
      agent_id: 'general',
      confidence: 0,
      method: 'fallback',
      latency_ms: 0,
      message_preview: 'hi',
      locked_agent: null,
      routing_mode: 'manual',
      created_at: new Date().toISOString(),
    });
    expect(routingLogRepo.findAll({ conversationId: cid })).toHaveLength(2);

    const pgid = `pg_${uid}`;
    for (let i = 0; i < 5; i++)
      routingLogRepo.create({
        id: `rl_${uid}_pg_${i}`,
        conversation_id: pgid,
        message_id: null,
        agent_id: 'g',
        confidence: 0,
        method: 'f',
        latency_ms: 0,
        message_preview: `${i}`,
        locked_agent: null,
        routing_mode: 'a',
        created_at: new Date().toISOString(),
      });
    expect(routingLogRepo.findAll({ conversationId: pgid, page: 1, pageSize: 3 })).toHaveLength(3);
    expect(routingLogRepo.findAll({ conversationId: pgid, page: 2, pageSize: 3 })).toHaveLength(2);
  });
});
