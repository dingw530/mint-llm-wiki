import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitest = (name, files, evidenceLevel, invariants) => ({
  name,
  command: '../node_modules/.bin/vitest',
  args: ['run', ...files, '--poolOptions.threads.singleThread'],
  cwd: 'apps/server',
  timeoutMs: 60_000,
  evidenceLevel,
  invariants,
});
const checks = [
  vitest(
    'tool-execution-security',
    [
      'application/agent-runtime/__tests__/tool-execution-security.test.ts',
      'application/agent-runtime/__tests__/tool-approval-service.test.ts',
    ],
    'integration',
    ['no_execution_before_approval', 'single_use_approval'],
  ),
  vitest(
    'tool-approval-write-guard-integration',
    [
      'application/agent-runtime/__tests__/tool-approval-service.test.ts',
      'application/agent-runtime/__tests__/tool-execution-service.test.ts',
    ],
    'integration',
    ['approval_state_consistency', 'regression_free'],
  ),
  vitest(
    'tool-schema-contract',
    [
      'agent-runtime/tooling/__tests__/json-schema-policy.test.ts',
      'application/agent-runtime/__tests__/tool-execution-security.test.ts',
    ],
    'unit',
    ['schema_closed', 'schema_depth_bounded', 'no_execution_on_invalid_schema'],
  ),
  vitest(
    'mcp-schema-validation',
    [
      'infrastructure/mcp/__tests__/mcp-tool-adapter.test.ts',
      'infrastructure/mcp/__tests__/mcp-client-manager.test.ts',
    ],
    'integration',
    ['schema_validation_complete', 'no_remote_call_on_invalid_input'],
  ),
  vitest(
    'tool-input-cross-field',
    [
      'application/tools/wiki/__tests__/wiki-ingest-tool.test.ts',
      'application/tools/wiki/__tests__/wiki-search-tool.test.ts',
    ],
    'integration',
    ['no_side_effect_on_crossfield_invalid'],
  ),
  {
    name: 'tool-outcome-unknown-smoke',
    command: 'node',
    args: ['scripts/tool-outcome-unknown-smoke.mjs'],
    timeoutMs: 60_000,
    evidenceLevel: 'process-smoke',
    invariants: ['idempotence', 'no_replay_after_unknown', 'durable_invocation_state'],
  },
  vitest(
    'tool-retry-policy',
    [
      'application/agent-runtime/__tests__/tool-retry-policy.test.ts',
      'infrastructure/persistence/__tests__/tool-invocation-repository.test.ts',
    ],
    'integration',
    ['retry_safety_enforced', 'bounded_retry'],
  ),
  vitest(
    'tool-error-contract',
    [
      'application/agent-runtime/__tests__/tool-execution-security.test.ts',
      'application/agent-runtime/__tests__/tool-execution-service.test.ts',
    ],
    'integration',
    ['error_contract_stable', 'no_stack_leak'],
  ),
  vitest(
    'agent-tool-regression',
    [
      'application/agent-runtime/__tests__/tool-approval-service.test.ts',
      'infrastructure/mcp/__tests__/mcp-client-manager.test.ts',
      'application/tools/wiki/__tests__/wiki-ingest-tool.test.ts',
      'application/agent-runtime/__tests__/tool-retry-policy.test.ts',
    ],
    'integration',
    ['regression_free', 'recovery_consistent'],
  ),
  vitest(
    'tool-audit-log-integration',
    ['application/agent-runtime/__tests__/tool-audit-log.test.ts'],
    'integration',
    ['audit_sink_connected', 'terminal_log_present'],
  ),
  vitest(
    'tool-audit-redaction',
    ['application/agent-runtime/__tests__/tool-audit-log.test.ts'],
    'integration',
    ['no_sensitive_value_in_logs', 'safe_summary_only'],
  ),
  {
    name: 'tool-approval-write-guard',
    command: 'node',
    args: ['.harness/browser-scenario.mjs'],
    timeoutMs: 120_000,
    evidenceLevel: 'browser',
    invariants: ['approval_state_consistency'],
    env: {
      PWTEST_DAEMON_SESSION_DIR:
        process.env.PWTEST_DAEMON_SESSION_DIR || path.join(tmpdir(), 'mint-playwright-daemon'),
    },
  },
];
const args = [
  '.harness/cli.mjs',
  'verify',
  '--change',
  '2026-10-07-agent-tool-guardrails',
  '--checks',
  JSON.stringify(checks),
];
const child = spawn(process.execPath, args, { cwd: repositoryRoot, stdio: 'inherit' });
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
