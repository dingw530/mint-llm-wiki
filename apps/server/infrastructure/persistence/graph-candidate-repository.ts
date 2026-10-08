import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db.js';

export type CandidateStatus = 'pending' | 'accepted' | 'rejected' | 'expired';
export interface GraphEdgeCandidate {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  evidence: string;
  confidence: number;
  candidateScore: number;
  sourcePage: string;
  targetPage: string;
  status: CandidateStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}
interface GraphEdgeCandidateRow {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  evidence: string;
  confidence: number;
  candidate_score: number;
  source_page: string;
  target_page: string;
  status: CandidateStatus;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}
const map = (r: GraphEdgeCandidateRow): GraphEdgeCandidate => ({
  id: r.id,
  sourceId: r.source_id,
  targetId: r.target_id,
  relation: r.relation,
  evidence: r.evidence,
  confidence: r.confidence,
  candidateScore: r.candidate_score,
  sourcePage: r.source_page,
  targetPage: r.target_page,
  status: r.status,
  reviewNote: r.review_note,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
});
export function expirePending(): void {
  getDb()
    .prepare(
      "UPDATE graph_edge_candidates SET status='expired' WHERE status='pending' AND created_at < datetime('now','-30 days')",
    )
    .run();
}
export function list(status?: CandidateStatus): GraphEdgeCandidate[] {
  expirePending();
  const rows: GraphEdgeCandidateRow[] = status
    ? getDb()
        .prepare<unknown[], GraphEdgeCandidateRow>(
          'SELECT * FROM graph_edge_candidates WHERE status=? ORDER BY confidence DESC, created_at DESC',
        )
        .all(status)
    : getDb()
        .prepare<unknown[], GraphEdgeCandidateRow>(
          'SELECT * FROM graph_edge_candidates ORDER BY confidence DESC, created_at DESC',
        )
        .all();
  return rows.map(map);
}
export function create(
  input: Omit<GraphEdgeCandidate, 'id' | 'status' | 'reviewNote' | 'createdAt' | 'reviewedAt'>,
): GraphEdgeCandidate {
  const id = uuidv4(),
    now = new Date().toISOString();
  getDb()
    .prepare('INSERT INTO graph_edge_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      input.sourceId,
      input.targetId,
      input.relation,
      input.evidence,
      input.confidence,
      input.candidateScore,
      input.sourcePage,
      input.targetPage,
      'pending',
      null,
      now,
      null,
    );
  return { id, ...input, status: 'pending', reviewNote: null, createdAt: now, reviewedAt: null };
}
export function get(id: string): GraphEdgeCandidate | null {
  const row = getDb()
    .prepare<unknown[], GraphEdgeCandidateRow>('SELECT * FROM graph_edge_candidates WHERE id=?')
    .get(id);
  return row ? map(row) : null;
}
export function review(id: string, status: 'accepted' | 'rejected', note?: string): void {
  getDb()
    .prepare('UPDATE graph_edge_candidates SET status=?, review_note=?, reviewed_at=? WHERE id=?')
    .run(status, note?.trim() || null, new Date().toISOString(), id);
}
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
