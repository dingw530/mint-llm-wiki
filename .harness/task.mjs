/**
 * @typedef {Object} HarnessCheck
 * @property {string} name
 * @property {string} command
 * @property {string[]} [args]
 * @property {number} [timeoutMs]
 * @property {string} [cwd]
 * @property {string[]} [artifacts]
 * @property {Record<string, string>} [env]
 * @property {string} [evidenceLevel]
 * @property {string[]} [invariants]
 */

/**
 * @typedef {Object} HarnessTask
 * @property {string} changeId
 * @property {string} changeDir
 * @property {string|null} currentTp
 * @property {string[]} acceptanceCriteria
 * @property {string[]} designDecisions
 * @property {string[]} taskPlans
 * @property {HarnessCheck[]} checks
 * @property {string[]} allowedPaths
 * @property {string[]} protectedPaths
 * @property {number} maxIterations
 * @property {Object} verification
 */

export function defaultHarnessConfig() {
  return {
    maxIterations: 3,
    allowedPaths: [],
    protectedPaths: [
      '.harness/',
      '.claude/skills/',
      'tests/architecture/',
      'vitest.config.ts',
      'server/vitest.config.ts',
      'client/vitest.config.ts',
    ],
    checks: [
      {
        name: 'harness-test',
        command: 'npm',
        args: ['run', 'harness:test'],
        timeoutMs: 120000,
      },
      {
        name: 'browser-ac',
        command: 'node',
        args: ['.harness/browser-scenario.mjs'],
        timeoutMs: 120000,
      },
    ],
  };
}

/**
 * 创建 Harness 的运行任务协议。
 * @param {Object} input
 * @param {string} input.rootDir
 * @param {string} input.changeId
 * @param {import('./sdd-adapter.mjs').SddDocument} input.sdd
 * @param {Partial<HarnessTask>} [input.config]
 * @returns {HarnessTask}
 */
export function createHarnessTask({ rootDir, changeId, sdd, config = {} }) {
  const defaults = defaultHarnessConfig();
  const changeDir = sdd.changePath;
  return {
    changeId,
    changeDir,
    currentTp: sdd.currentTp || null,
    acceptanceCriteria: sdd.acceptanceCriteria,
    designDecisions: sdd.designDecisions,
    taskPlans: sdd.taskPlans,
    checks: config.checks || defaults.checks,
    allowedPaths: config.allowedPaths || defaults.allowedPaths,
    protectedPaths: config.protectedPaths || defaults.protectedPaths,
    maxIterations: config.maxIterations || defaults.maxIterations,
    verification: config.verification ||
      sdd.verificationPlan || { mode: 'legacy', claims: [], allowLegacy: false },
    rootDir,
  };
}

export function validateTask(task) {
  if (!task.changeId) throw new Error('Harness task requires changeId');
  if (!Array.isArray(task.checks) || task.checks.length === 0)
    throw new Error('Harness task requires at least one check');
  if (!Number.isInteger(task.maxIterations) || task.maxIterations < 1)
    throw new Error('Harness task maxIterations must be a positive integer');
  for (const check of task.checks) {
    if (!check.name || !check.command) throw new Error('Each check requires name and command');
    if (check.args && !Array.isArray(check.args))
      throw new Error(`Check ${check.name} args must be an array`);
  }
  const verification = task.verification || { mode: 'legacy', claims: [] };
  if (!['legacy', 'claims'].includes(verification.mode)) {
    throw new Error('Harness verification mode must be legacy or claims');
  }
  if (!Array.isArray(verification.claims))
    throw new Error('Harness verification claims must be an array');
  if (verification.mode === 'claims') {
    const acceptanceCriteria = new Set(task.acceptanceCriteria);
    const claimIds = new Set(verification.claims.map((claim) => claim.id));
    const missingClaims = task.acceptanceCriteria.filter((id) => !claimIds.has(id));
    if (missingClaims.length > 0) {
      throw new Error(`Verification plan is missing claims: ${missingClaims.join(', ')}`);
    }
    for (const claim of verification.claims) {
      if (!acceptanceCriteria.has(claim.id)) {
        throw new Error(`Verification claim ${claim.id} is not a declared acceptance criterion`);
      }
    }
  }
  for (const claim of verification.claims) {
    if (!claim.id || !claim.statement)
      throw new Error('Each verification claim requires id and statement');
    if (!Array.isArray(claim.requiredEvidence) || claim.requiredEvidence.length === 0) {
      throw new Error(`Claim ${claim.id} requires requiredEvidence`);
    }
    if (!Array.isArray(claim.probes) || claim.probes.length === 0) {
      throw new Error(`Claim ${claim.id} requires probes`);
    }
    if (claim.invariants && !Array.isArray(claim.invariants)) {
      throw new Error(`Claim ${claim.id} invariants must be an array`);
    }
  }
  return task;
}
