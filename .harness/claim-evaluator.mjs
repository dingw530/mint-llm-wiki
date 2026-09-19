const EVIDENCE_LEVELS = new Map([
  ['static', 1],
  ['unit', 2],
  ['integration', 3],
  ['browser', 3],
  ['process-smoke', 4],
  ['runtime', 4],
  ['manual', 4],
]);

function satisfies(actual, required) {
  return (EVIDENCE_LEVELS.get(actual) || 0) >= (EVIDENCE_LEVELS.get(required) || 99);
}

/** Aggregate executed probe results into claim-level verification statuses. */
export function evaluateClaims(task, results) {
  const verification = task.verification || { mode: 'legacy', claims: [] };
  if (verification.mode !== 'claims') {
    return {
      mode: 'legacy',
      status: 'UNVERIFIED',
      warning: 'No verification-plan.json; command results are not claim-level evidence.',
      claims: [],
    };
  }

  const claims = verification.claims.map((claim) => {
    const probes = claim.probes.map((probe) => results.find((result) => result.name === probe));
    const failed = probes.find((result) => result?.status === 'failed');
    if (failed) {
      return { ...claim, status: 'FAIL', reason: `Probe ${failed.name} failed` };
    }
    const available = probes.filter(Boolean);
    const missingProbes = claim.probes.filter(
      (probe) => !results.some((result) => result.name === probe),
    );
    const missingEvidence = claim.requiredEvidence.filter(
      (required) =>
        !available.some(
          (result) => result.status === 'passed' && satisfies(result.evidenceLevel, required),
        ),
    );
    const missingInvariants = (claim.invariants || []).filter(
      (invariant) =>
        !available.some(
          (result) => result.status === 'passed' && result.invariants.includes(invariant),
        ),
    );
    if (missingProbes.length > 0 || missingEvidence.length > 0 || missingInvariants.length > 0) {
      return {
        ...claim,
        status: 'UNVERIFIED',
        missingProbes,
        missingEvidence,
        missingInvariants,
        reason: 'Required probe or evidence level is missing',
      };
    }
    return { ...claim, status: 'PASS' };
  });
  const status = claims.some((claim) => claim.status === 'FAIL')
    ? 'FAIL'
    : claims.some((claim) => claim.status === 'UNVERIFIED')
      ? 'UNVERIFIED'
      : 'PASS';
  return { mode: 'claims', status, claims };
}

export function claimsPassed(verification) {
  return verification.mode === 'claims' && verification.status === 'PASS';
}
