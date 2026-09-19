import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSddDocument } from '../sdd-adapter.mjs';

test('reads AC, DS and TP identifiers from SDD documents', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-harness-sdd-'));
  const changeDir = path.join(rootDir, 'docs', 'changes', 'demo');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'product-spec.md'), '- AC-001: behavior\n');
  await fs.writeFile(path.join(changeDir, 'design-doc.md'), 'DS-001\n| AC-001 | DS-001 |\n');
  await fs.writeFile(path.join(changeDir, 'exec-plan.md'), '| TP-001 | task | 进行中 |\n');
  await fs.writeFile(path.join(changeDir, 'traceability.md'), 'AC-001 → DS-001 → TP-001\n');

  const result = await readSddDocument(rootDir, 'demo');
  assert.deepEqual(result.acceptanceCriteria, ['AC-001']);
  assert.deepEqual(result.designDecisions, ['DS-001']);
  assert.deepEqual(result.taskPlans, ['TP-001']);
  assert.equal(result.currentTp, 'TP-001');
});

test('reads an explicit verification plan for claim-level gating', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mint-harness-plan-'));
  const changeDir = path.join(rootDir, 'docs', 'changes', 'demo');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'product-spec.md'), 'AC-001\n');
  await fs.writeFile(
    path.join(changeDir, 'verification-plan.json'),
    JSON.stringify({
      version: 1,
      mode: 'claims',
      claims: [{ id: 'AC-001', statement: 'x', requiredEvidence: ['unit'], probes: ['unit'] }],
    }),
  );

  const result = await readSddDocument(rootDir, 'demo');
  assert.equal(result.verificationPlan.mode, 'claims');
  assert.equal(result.verificationPlan.claims[0].probes[0], 'unit');
});
