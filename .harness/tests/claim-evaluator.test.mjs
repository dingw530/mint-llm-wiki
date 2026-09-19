import test from 'node:test';
import assert from 'node:assert/strict';
import { claimsPassed, evaluateClaims } from '../claim-evaluator.mjs';

function task() {
  return {
    verification: {
      mode: 'claims',
      claims: [
        {
          id: 'AC-001',
          statement: 'drains active work',
          requiredEvidence: ['integration'],
          invariants: ['drain'],
          probes: ['lifecycle'],
        },
      ],
    },
  };
}

test('marks a claim passed only when its required evidence is present', () => {
  const result = evaluateClaims(task(), [
    { name: 'lifecycle', status: 'passed', evidenceLevel: 'integration', invariants: ['drain'] },
  ]);
  assert.equal(result.status, 'PASS');
  assert.equal(claimsPassed(result), true);
});

test('does not treat a passing unit check as sufficient integration evidence', () => {
  const result = evaluateClaims(task(), [
    { name: 'lifecycle', status: 'passed', evidenceLevel: 'unit', invariants: ['drain'] },
  ]);
  assert.equal(result.status, 'UNVERIFIED');
  assert.deepEqual(result.claims[0].missingEvidence, ['integration']);
  assert.equal(claimsPassed(result), false);
});

test('propagates failed probes to the claim status', () => {
  const result = evaluateClaims(task(), [
    { name: 'lifecycle', status: 'failed', evidenceLevel: 'integration' },
  ]);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.claims[0].status, 'FAIL');
});

test('requires invariant coverage in addition to evidence level', () => {
  const result = evaluateClaims(task(), [
    { name: 'lifecycle', status: 'passed', evidenceLevel: 'integration', invariants: [] },
  ]);
  assert.equal(result.status, 'UNVERIFIED');
  assert.deepEqual(result.claims[0].missingInvariants, ['drain']);
});

test('legacy tasks are explicitly unverified', () => {
  const result = evaluateClaims({ verification: { mode: 'legacy', claims: [] } }, []);
  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(claimsPassed(result), false);
});
