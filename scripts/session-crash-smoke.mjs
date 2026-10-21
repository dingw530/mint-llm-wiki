import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverUrl = (file) => pathToFileURL(path.join(repositoryRoot, 'apps/server', file)).href;
const zodUrl = pathToFileURL(require.resolve('zod', { paths: [repositoryRoot] })).href;

/** 在隔离数据库中运行工具并于文件写入后强制结束进程。 */
async function runCrashRecoveryProbe() {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mint-session-crash-'));
  const databasePath = path.join(temporaryDirectory, 'session.db');
  const targetPath = path.join(temporaryDirectory, 'partial.txt');
  const conversationId = `crash-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  const callId = `call-${randomUUID()}`;

  try {
    await interruptAfterToolEffect({
      databasePath,
      targetPath,
      conversationId,
      runId,
      callId,
    });
    const partialContent = await readFile(targetPath, 'utf8');
    if (partialContent !== '第一段已写入\n') throw new Error('工具副作用未停在预期的部分状态');
    await wait(2_200);
    const evidence = await recoverInNewProcess({
      databasePath,
      targetPath,
      conversationId,
      runId,
      callId,
      temporaryDirectory,
    });
    process.stdout.write(`SESSION_CRASH_OK ${JSON.stringify(evidence)}\n`);
    const preEffectEvidence = await runPreEffectCrashProbe(temporaryDirectory);
    process.stdout.write(`SESSION_PRE_EFFECT_CRASH_OK ${JSON.stringify(preEffectEvidence)}\n`);
    const succeededEvidence = await runSucceededLedgerWithoutSessionResultProbe(temporaryDirectory);
    process.stdout.write(`SESSION_LEDGER_SUCCESS_OK ${JSON.stringify(succeededEvidence)}\n`);
    const notStartedEvidence = await runNotDispatchedToolProbe(temporaryDirectory);
    process.stdout.write(`SESSION_NOT_STARTED_OK ${JSON.stringify(notStartedEvidence)}\n`);
    const resultCommittedEvidence =
      await runResultCommittedBeforeNextRoundProbe(temporaryDirectory);
    process.stdout.write(
      `SESSION_RESULT_COMMITTED_OK ${JSON.stringify(resultCommittedEvidence)}\n`,
    );
    const deniedWriteEvidence = await runDeniedWriteProbe(temporaryDirectory);
    process.stdout.write(`SESSION_WRITE_DENIED_OK ${JSON.stringify(deniedWriteEvidence)}\n`);
    const approvalEvidence = await runColdApprovalProbe(temporaryDirectory);
    process.stdout.write(`SESSION_COLD_APPROVAL_OK ${JSON.stringify(approvalEvidence)}\n`);
    const fencingEvidence = await runCrossProcessFencingProbe(temporaryDirectory);
    process.stdout.write(`SESSION_CROSS_PROCESS_FENCING_OK ${JSON.stringify(fencingEvidence)}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** 在工具副作用和 Ledger success 已提交、Session result 尚未写入时强退并核对。 */
async function runSucceededLedgerWithoutSessionResultProbe(temporaryDirectory) {
  const input = {
    databasePath: path.join(temporaryDirectory, 'ledger-succeeded.db'),
    targetPath: path.join(temporaryDirectory, 'ledger-succeeded.txt'),
    conversationId: `succeeded-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    callId: `call-${randomUUID()}`,
  };
  const worker = spawnWorker(createSucceededToolWorkerSource(input), input.databasePath);
  await waitForMarker(worker, 'SESSION_LEDGER_SUCCESS_COMMITTED');
  worker.kill('SIGKILL');
  const exit = await waitForExit(worker);
  if (exit.signal !== 'SIGKILL') throw new Error('Ledger success 探针未被 SIGKILL 结束');
  await wait(2_200);
  const recovery = spawnWorker(createSucceededRecoveryWorkerSource(input), input.databasePath);
  const output = await collectWorkerOutput(recovery);
  if (output.exitCode !== 0)
    throw new Error(`Ledger success 冷恢复失败：${output.stderr || output.stdout}`);
  const line = output.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_SUCCESS_RECONCILIATION '));
  if (!line) throw new Error(`Ledger success 恢复未返回证据：${output.stdout}`);
  return JSON.parse(line.slice('SESSION_SUCCESS_RECONCILIATION '.length));
}

/** 在分派和 Ledger claim 已提交、工具副作用开始前强退。 */
async function runPreEffectCrashProbe(temporaryDirectory) {
  const input = {
    databasePath: path.join(temporaryDirectory, 'pre-effect.db'),
    targetPath: path.join(temporaryDirectory, 'pre-effect.txt'),
    conversationId: `pre-effect-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    callId: `call-${randomUUID()}`,
    crashBeforeEffect: true,
    expectedLedgerStatus: 'outcome_unknown',
    expectedAttempt: 1,
    expectedRecoveryEventStatus: 'outcome_unknown',
    expectedFileContent: '',
    expectedMessageFragment: 'outcome is unknown',
    expectDispatch: true,
  };
  const worker = spawnWorker(createCrashWorkerSource(input), input.databasePath);
  await waitForMarker(worker, 'SESSION_DISPATCH_COMMITTED_NO_EFFECT');
  worker.kill('SIGKILL');
  const exit = await waitForExit(worker);
  if (exit.signal !== 'SIGKILL') throw new Error('副作用前强退探针未被 SIGKILL 结束');
  await wait(2_200);
  const recovery = spawnWorker(createRecoveryWorkerSource(input), input.databasePath);
  const output = await collectWorkerOutput(recovery);
  if (output.exitCode !== 0)
    throw new Error(`副作用前崩溃恢复失败：${output.stderr || output.stdout}`);
  const line = output.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_RECOVERY_EVIDENCE '));
  if (!line) throw new Error(`副作用前恢复没有返回证据：${output.stdout}`);
  return JSON.parse(line.slice('SESSION_RECOVERY_EVIDENCE '.length));
}

/** 在模型工具调用已提交、但 Ledger 分派尚未提交时强退并核对。 */
async function runNotDispatchedToolProbe(temporaryDirectory) {
  const input = {
    databasePath: path.join(temporaryDirectory, 'not-dispatched.db'),
    targetPath: path.join(temporaryDirectory, 'must-not-exist.txt'),
    conversationId: `not-started-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    callId: `call-${randomUUID()}`,
    expectedLedgerStatus: 'missing',
    expectedAttempt: 0,
    expectedRecoveryEventStatus: 'not_started',
    expectedFileContent: '',
    expectedMessageFragment: 'was recorded by the model but was not committed',
    expectDispatch: false,
  };
  const worker = spawnWorker(createNotDispatchedWorkerSource(input), input.databasePath);
  await waitForMarker(worker, 'SESSION_MODEL_TOOL_CALL_COMMITTED');
  worker.kill('SIGKILL');
  const exit = await waitForExit(worker);
  if (exit.signal !== 'SIGKILL') throw new Error('未分派工具调用探针未被 SIGKILL 结束');
  await wait(2_200);
  const recovery = spawnWorker(createRecoveryWorkerSource(input), input.databasePath);
  const output = await collectWorkerOutput(recovery);
  if (output.exitCode !== 0)
    throw new Error(`未分派调用恢复失败：${output.stderr || output.stdout}`);
  const line = output.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_RECOVERY_EVIDENCE '));
  if (!line) throw new Error(`未分派调用恢复没有返回证据：${output.stdout}`);
  return JSON.parse(line.slice('SESSION_RECOVERY_EVIDENCE '.length));
}

/** 验证独立进程中的活动租约阻止修复，过期持有者随后被 fencing 拒绝。 */
async function runCrossProcessFencingProbe(temporaryDirectory) {
  const input = {
    databasePath: path.join(temporaryDirectory, 'cross-process-fencing.db'),
    targetPath: path.join(temporaryDirectory, 'fencing-target.txt'),
    conversationId: `fencing-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    callId: `call-${randomUUID()}`,
    expectedLedgerStatus: 'missing',
    expectedAttempt: 0,
    expectedRecoveryEventStatus: 'outcome_unknown',
    expectedFileContent: '',
    expectedMessageFragment: 'outcome is unknown',
    expectDispatch: true,
  };
  const owner = spawnWorker(createActiveOwnerWorkerSource(input), input.databasePath);
  await waitForMarker(owner, 'SESSION_ACTIVE_OWNER_READY');
  const blocked = spawnWorker(createActiveOwnerCheckWorkerSource(input), input.databasePath);
  const blockedOutput = await collectWorkerOutput(blocked);
  if (
    blockedOutput.exitCode !== 0 ||
    !blockedOutput.stdout.includes('SESSION_ACTIVE_OWNER_BLOCKED')
  ) {
    owner.kill('SIGKILL');
    throw new Error(
      `活动持有者没有阻止另一进程修复：${blockedOutput.stderr || blockedOutput.stdout}`,
    );
  }
  await wait(2_200);
  const recovery = spawnWorker(createRecoveryWorkerSource(input), input.databasePath);
  const recoveryOutput = await collectWorkerOutput(recovery);
  if (recoveryOutput.exitCode !== 0) {
    owner.kill('SIGKILL');
    throw new Error(`fencing 探针冷恢复失败：${recoveryOutput.stderr || recoveryOutput.stdout}`);
  }
  const newOwner = spawnWorker(createNewLeaseHolderWorkerSource(input), input.databasePath);
  await waitForMarker(newOwner, 'SESSION_NEW_OWNER_READY');
  const ownerOutput = await collectWorkerOutput(owner);
  newOwner.kill('SIGKILL');
  if (ownerOutput.exitCode !== 0 || !ownerOutput.stdout.includes('SESSION_STALE_OWNER_REJECTED')) {
    throw new Error(`旧持有者未被 fencing 拒绝：${ownerOutput.stderr || ownerOutput.stdout}`);
  }
  const line = recoveryOutput.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_RECOVERY_EVIDENCE '));
  if (!line) throw new Error(`fencing 恢复没有返回证据：${recoveryOutput.stdout}`);
  return {
    activeOwner: 'blocked',
    staleOwner: 'fenced',
    recovery: JSON.parse(line.slice('SESSION_RECOVERY_EVIDENCE '.length)),
  };
}

/** 在工具结果已提交、下一模型轮次尚未开始时强退并核验不会重复修复。 */
async function runResultCommittedBeforeNextRoundProbe(temporaryDirectory) {
  const input = {
    databasePath: path.join(temporaryDirectory, 'result-committed.db'),
    targetPath: path.join(temporaryDirectory, 'result-committed.txt'),
    conversationId: `result-committed-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    callId: `call-${randomUUID()}`,
    sessionResultCommitted: true,
  };
  const worker = spawnWorker(createSucceededToolWorkerSource(input), input.databasePath);
  await waitForMarker(worker, 'SESSION_TOOL_RESULT_COMMITTED');
  worker.kill('SIGKILL');
  const exit = await waitForExit(worker);
  if (exit.signal !== 'SIGKILL') throw new Error('结果已提交探针未被 SIGKILL 结束');
  await wait(2_200);
  const recovery = spawnWorker(
    createCommittedResultRecoveryWorkerSource(input),
    input.databasePath,
  );
  const output = await collectWorkerOutput(recovery);
  if (output.exitCode !== 0)
    throw new Error(`结果已提交恢复失败：${output.stderr || output.stdout}`);
  const line = output.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_COMMITTED_RESULT_RECONCILIATION '));
  if (!line) throw new Error(`结果已提交恢复没有返回证据：${output.stdout}`);
  return JSON.parse(line.slice('SESSION_COMMITTED_RESULT_RECONCILIATION '.length));
}

/** 让 Bash 路径策略拒绝写入，并验证工具处理器没有产生副作用。 */
async function runDeniedWriteProbe(temporaryDirectory) {
  const input = {
    databasePath: path.join(temporaryDirectory, 'write-denied.db'),
    targetPath: path.join(temporaryDirectory, 'denied-output.txt'),
    conversationId: `write-denied-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    callId: `call-${randomUUID()}`,
  };
  const worker = spawnWorker(createDeniedWriteWorkerSource(input), input.databasePath);
  await waitForMarker(worker, 'SESSION_WRITE_POLICY_DENIED');
  worker.kill('SIGKILL');
  const exit = await waitForExit(worker);
  if (exit.signal !== 'SIGKILL') throw new Error('写入拒绝探针未被 SIGKILL 结束');
  await wait(2_200);
  const recovery = spawnWorker(createDeniedWriteRecoveryWorkerSource(input), input.databasePath);
  const output = await collectWorkerOutput(recovery);
  if (output.exitCode !== 0) throw new Error(`写入拒绝恢复失败：${output.stderr || output.stdout}`);
  const line = output.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_WRITE_DENIED_RECONCILIATION '));
  if (!line) throw new Error(`写入拒绝恢复没有返回证据：${output.stdout}`);
  return JSON.parse(line.slice('SESSION_WRITE_DENIED_RECONCILIATION '.length));
}

/** 在审批暂停状态强退，验证重启后审批过期且未分派工具标为未执行。 */
async function runColdApprovalProbe(temporaryDirectory) {
  const input = {
    databasePath: path.join(temporaryDirectory, 'cold-approval.db'),
    targetPath: path.join(temporaryDirectory, 'approval-target.txt'),
    conversationId: `approval-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    callId: `call-${randomUUID()}`,
  };
  const worker = spawnWorker(createColdApprovalWorkerSource(input), input.databasePath);
  await waitForMarker(worker, 'SESSION_APPROVAL_PAUSED');
  worker.kill('SIGKILL');
  const exit = await waitForExit(worker);
  if (exit.signal !== 'SIGKILL') throw new Error('冷审批探针未被 SIGKILL 结束');
  await wait(2_200);
  const recovery = spawnWorker(createColdApprovalRecoveryWorkerSource(input), input.databasePath);
  const output = await collectWorkerOutput(recovery);
  if (output.exitCode !== 0) throw new Error(`冷审批恢复失败：${output.stderr || output.stdout}`);
  const line = output.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_COLD_APPROVAL_RECONCILIATION '));
  if (!line) throw new Error(`冷审批恢复没有返回证据：${output.stdout}`);
  return JSON.parse(line.slice('SESSION_COLD_APPROVAL_RECONCILIATION '.length));
}

/** 启动子进程，等工具完成一次外部写入后发送 SIGKILL。 */
async function interruptAfterToolEffect(input) {
  const worker = spawnWorker(createCrashWorkerSource(input), input.databasePath);
  const ready = await waitForMarker(worker, 'SESSION_TOOL_EFFECT_COMMITTED');
  if (!ready) throw new Error('工具执行进程未报告副作用检查点');
  worker.kill('SIGKILL');
  const exit = await waitForExit(worker);
  if (exit.signal !== 'SIGKILL') throw new Error(`强退信号不符：${String(exit.signal)}`);
}

/** 重启一个新进程，运行冷修复并检查模型投影和 Ledger 状态。 */
async function recoverInNewProcess(input) {
  const worker = spawnWorker(createRecoveryWorkerSource(input), input.databasePath);
  const output = await collectWorkerOutput(worker);
  if (output.exitCode !== 0) {
    throw new Error(`重启恢复进程失败：${output.stderr || output.stdout}`);
  }
  const line = output.stdout
    .split('\n')
    .find((item) => item.startsWith('SESSION_RECOVERY_EVIDENCE '));
  if (!line) throw new Error(`恢复进程未返回证据：${output.stdout}`);
  return JSON.parse(line.slice('SESSION_RECOVERY_EVIDENCE '.length));
}

/** 创建使用同一个隔离数据库和加密密钥的 TypeScript 子进程。 */
function spawnWorker(source, databasePath) {
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      AI_CHAT_DB_PATH: databasePath,
      AI_CHAT_ENCRYPTION_KEY: 'session-crash-smoke-encryption-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 等待子进程的单行检查点输出，并处理错误或超时。 */
function waitForMarker(worker, marker, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let errors = '';
    const timeout = setTimeout(() => reject(new Error(`等待 ${marker} 超时`)), timeoutMs);
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (chunk) => (errors += chunk));
    worker.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes(marker)) {
        clearTimeout(timeout);
        resolve(true);
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code, signal) => {
      if (buffer.includes(marker)) return;
      clearTimeout(timeout);
      reject(
        new Error(
          `子进程提前退出：code=${String(code)} signal=${String(signal)} ${errors || buffer}`,
        ),
      );
    });
  });
}

/** 等待一个被强制结束的进程退出。 */
function waitForExit(worker) {
  return new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

/** 收集恢复进程的标准输出和错误输出。 */
function collectWorkerOutput(worker, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      worker.kill('SIGKILL');
      reject(new Error('恢复进程超时'));
    }, timeoutMs);
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stdout.on('data', (chunk) => (stdout += chunk));
    worker.stderr.on('data', (chunk) => (stderr += chunk));
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: exitCode ?? (signal ? 1 : 0) });
    });
  });
}

/** 构造执行到文件副作用后保持阻塞的工具进程。 */
function createCrashWorkerSource(input) {
  return `
    const [{ getDb }, conversations, sessionModule, writerModule, runtimeModule, registryModule,
      executorModule, executionModule, approvalModule, invocationModule, baseToolModule, zodModule, fsModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-repository.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/session-run-writer.ts'))}),
      import(${JSON.stringify(serverUrl('agent-runtime/tooling/runtime-context.ts'))}),
      import(${JSON.stringify(serverUrl('application/agent-runtime/tooling/tool-registry.ts'))}),
      import(${JSON.stringify(serverUrl('application/agent-runtime/tooling/tool-executor.ts'))}),
      import(${JSON.stringify(serverUrl('application/agent-runtime/tool-execution-service.ts'))}),
      import(${JSON.stringify(serverUrl('application/agent-runtime/tooling/tool-approval-store.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/tool-invocation-repository.ts'))}),
      import(${JSON.stringify(serverUrl('agent-runtime/tooling/base-tool.ts'))}),
      import(${JSON.stringify(zodUrl)}),
      import('node:fs'),
    ]);
    const db = getDb();
    conversations.create({ id: ${JSON.stringify(input.conversationId)}, title: 'Crash recovery', routingMode: 'manual' });
    const repository = new sessionModule.ConversationSessionRepository(db);
    const initialState = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 2000);
    const writer = new writerModule.ConversationSessionRunWriter(
      repository,
      ${JSON.stringify(input.conversationId)},
      ${JSON.stringify(input.runId)},
      'turn-crash-probe',
      lease,
      initialState.lastSequence,
    );
    writer.startUserTurn('message-crash-probe', '写入文件', new Date().toISOString());
    writer.recordModelMessage(1, [{
      role: 'assistant', content: null, tool_calls: [{
        id: ${JSON.stringify(input.callId)}, type: 'function',
        function: { name: 'crash_write_file', arguments: JSON.stringify({ path: ${JSON.stringify(input.targetPath)}, content: '第一段已写入\\n第二段尚未写入\\n' }) },
      }],
    }]);
    class CrashWriteTool extends baseToolModule.BaseTool {
      name = 'crash_write_file';
      description = '隔离强退探针';
      inputSchema = zodModule.z.object({ path: zodModule.z.string(), content: zodModule.z.string() });
      isReadOnly() { return false; }
      getMetadata() {
        return {
          source: 'builtin', riskLevel: 'high', sideEffect: 'external',
          retrySafety: 'never', requiresApproval: false,
        };
      }
      async execute(input) {
        if (${JSON.stringify(input.crashBeforeEffect === true)}) {
          process.stdout.write('SESSION_DISPATCH_COMMITTED_NO_EFFECT\\n');
          return new Promise(() => {});
        }
        fsModule.writeFileSync(input.path, input.content.split('\\n')[0] + '\\n', 'utf8');
        process.stdout.write('SESSION_TOOL_EFFECT_COMMITTED\\n');
        return new Promise(() => {});
      }
    }
    const registry = new registryModule.ToolRegistry();
    registry.register(new CrashWriteTool());
    const invocations = new invocationModule.ToolInvocationRepository(db);
    const service = new executionModule.ToolExecutionService(
      registry,
      new executorModule.ToolExecutor(registry),
      new approvalModule.ToolApprovalStore(),
      undefined,
      () => {},
      invocations,
      { record: () => {} },
    );
    const runtimeContext = runtimeModule.createRuntimeContext({ sessionRecorder: writer });
    const pending = service.executeToolDetailed({
      id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'crash_write_file', arguments: JSON.stringify({ path: ${JSON.stringify(input.targetPath)}, content: '第一段已写入\\n第二段尚未写入\\n' }) },
    }, ${JSON.stringify(input.conversationId)}, {
      runId: ${JSON.stringify(input.runId)}, approvalGranted: true, runtimeContext,
    });
    pending.catch((error) => process.stderr.write(String(error) + '\\n'));
  `;
}

/** 构造尚未进入 Ledger 的模型工具调用记录进程。 */
function createNotDispatchedWorkerSource(input) {
  return `
    const [dbModule, conversations, sessionModule, writerModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-repository.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/session-run-writer.ts'))}),
    ]);
    const db = dbModule.getDb();
    conversations.create({ id: ${JSON.stringify(input.conversationId)}, title: 'Not started recovery', routingMode: 'manual' });
    const repository = new sessionModule.ConversationSessionRepository(db);
    const state = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 2000);
    const writer = new writerModule.ConversationSessionRunWriter(repository,
      ${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 'turn-not-started', lease, state.lastSequence);
    writer.startUserTurn('message-not-started', '写入文件', new Date().toISOString());
    writer.recordModelMessage(1, [{ role: 'assistant', content: null, tool_calls: [{
      id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'write_file', arguments: ${JSON.stringify(JSON.stringify({ path: input.targetPath, content: 'must not be written' }))} },
    }] }]);
    process.stdout.write('SESSION_MODEL_TOOL_CALL_COMMITTED\\n');
    await new Promise(() => {});
  `;
}

/** 构造持有活动租约、并在租约被接管后尝试写入的旧进程。 */
function createActiveOwnerWorkerSource(input) {
  const argumentsJson = JSON.stringify({ path: input.targetPath, content: 'never-written' });
  return `
    const [dbModule, conversations, sessionModule, writerModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-repository.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/session-run-writer.ts'))}),
    ]);
    const db = dbModule.getDb();
    conversations.create({ id: ${JSON.stringify(input.conversationId)}, title: 'Cross process fencing', routingMode: 'manual' });
    const repository = new sessionModule.ConversationSessionRepository(db);
    const initial = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 2000);
    const writer = new writerModule.ConversationSessionRunWriter(repository,
      ${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 'turn-fencing', lease, initial.lastSequence);
    writer.startUserTurn('message-fencing', '检查活动租约', new Date().toISOString());
    writer.recordModelMessage(1, [{ role: 'assistant', content: null, tool_calls: [{
      id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'write_file', arguments: ${JSON.stringify(argumentsJson)} },
    }] }]);
    writer.recordToolDispatch({ callId: ${JSON.stringify(input.callId)}, toolName: 'write_file',
      argumentsJson: ${JSON.stringify(argumentsJson)}, retrySafety: 'never' });
    process.stdout.write('SESSION_ACTIVE_OWNER_READY\\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const current = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const staleEvent = {
      schemaVersion: 1, conversationId: ${JSON.stringify(input.conversationId)},
      eventId: 'stale-owner-terminal', runId: ${JSON.stringify(input.runId)},
      turnId: 'turn-fencing', createdAt: new Date().toISOString(),
      type: 'run_terminal', outcome: 'completed', seq: current.lastSequence + 1,
    };
    try {
      repository.appendBatch(${JSON.stringify(input.conversationId)}, current.lastSequence,
        lease.ownerFence, [staleEvent]);
      throw new Error('旧持有者意外写入成功');
    } catch (error) {
      if (error.code !== 'SESSION_OWNER_STALE') throw error;
    }
    process.stdout.write('SESSION_STALE_OWNER_REJECTED\\n');
    dbModule.closeDb();
  `;
}

/** 构造竞争进程，确认活动会话所有者存在时冷修复不写入事件。 */
function createActiveOwnerCheckWorkerSource(input) {
  return `
    const [dbModule, sessionModule, recoveryModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/conversation-session-recovery-service.ts'))}),
    ]);
    dbModule.getDb();
    const repository = new sessionModule.ConversationSessionRepository();
    const before = repository.ensureConversation(${JSON.stringify(input.conversationId)}).lastSequence;
    const result = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository });
    const after = repository.ensureConversation(${JSON.stringify(input.conversationId)}).lastSequence;
    if (result.status !== 'blocked_active_owner' || result.events.length !== 0 || before !== after) {
      throw new Error('活动持有者期间发生了冷修复写入');
    }
    process.stdout.write('SESSION_ACTIVE_OWNER_BLOCKED\\n');
    dbModule.closeDb();
  `;
}

/** 构造恢复后取得新 fencing token 并保持写入租约的进程。 */
function createNewLeaseHolderWorkerSource(input) {
  return `
    const [dbModule, sessionModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
    ]);
    dbModule.getDb();
    const repository = new sessionModule.ConversationSessionRepository();
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, 'new-fence-owner', 8000);
    process.stdout.write('SESSION_NEW_OWNER_READY ' + lease.ownerFence + '\\n');
    await new Promise((resolve) => setTimeout(resolve, 8000));
    dbModule.closeDb();
  `;
}

/** 构造被 Bash 路径策略拒绝、且工具处理器不能触发文件写入的运行。 */
function createDeniedWriteWorkerSource(input) {
  const command = `cat > ${input.targetPath}`;
  const argumentsJson = JSON.stringify({ command });
  const moduleFiles = [
    'db.ts',
    'infrastructure/persistence/conversation-repository.ts',
    'infrastructure/persistence/conversation-session-repository.ts',
    'application/conversations/session-run-writer.ts',
    'agent-runtime/tooling/runtime-context.ts',
    'application/agent-runtime/tooling/tool-registry.ts',
    'application/agent-runtime/tooling/tool-executor.ts',
    'application/agent-runtime/tool-execution-service.ts',
    'application/agent-runtime/tooling/tool-approval-store.ts',
    'infrastructure/persistence/tool-invocation-repository.ts',
    'agent-runtime/tooling/base-tool.ts',
  ];
  const imports = moduleFiles.map((file) => `import(${JSON.stringify(serverUrl(file))})`);
  return `
    const [dbModule, conversations, sessionModule, writerModule, runtimeModule, registryModule,
      executorModule, executionModule, approvalModule, invocationModule, baseToolModule,
      zodModule, fsModule] = await Promise.all([
      ${imports.join(',\n      ')}, import(${JSON.stringify(zodUrl)}), import('node:fs')
    ]);
    const db = dbModule.getDb();
    conversations.create({ id: ${JSON.stringify(input.conversationId)}, title: 'Write denied recovery', routingMode: 'manual' });
    const repository = new sessionModule.ConversationSessionRepository(db);
    const state = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 2000);
    const writer = new writerModule.ConversationSessionRunWriter(repository,
      ${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 'turn-write-denied', lease, state.lastSequence);
    writer.startUserTurn('message-write-denied', '尝试越界写入', new Date().toISOString());
    writer.recordModelMessage(1, [{ role: 'assistant', content: null, tool_calls: [{
      id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'bash', arguments: ${JSON.stringify(argumentsJson)} },
    }] }]);
    let executionCount = 0;
    class DeniedBashProbeTool extends baseToolModule.BaseTool {
      name = 'bash';
      description = 'Bash policy denial probe';
      inputSchema = zodModule.z.object({ command: zodModule.z.string() });
      isReadOnly() { return false; }
      getMetadata() { return { source: 'builtin', riskLevel: 'high', sideEffect: 'filesystem', retrySafety: 'never', requiresApproval: false }; }
      async execute() { executionCount += 1; fsModule.writeFileSync(${JSON.stringify(input.targetPath)}, 'must not exist'); return 'unexpected'; }
    }
    const registry = new registryModule.ToolRegistry();
    registry.register(new DeniedBashProbeTool());
    const invocations = new invocationModule.ToolInvocationRepository(db);
    const service = new executionModule.ToolExecutionService(registry,
      new executorModule.ToolExecutor(registry), new approvalModule.ToolApprovalStore(),
      undefined, () => {}, invocations, { record: () => {} });
    const result = await service.executeToolDetailed({ id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'bash', arguments: ${JSON.stringify(argumentsJson)} } },
      ${JSON.stringify(input.conversationId)}, { runId: ${JSON.stringify(input.runId)},
        approvalGranted: true, runtimeContext: runtimeModule.createRuntimeContext() });
    if (result.success || result.errorCode !== 'POLICY_DENIED' || executionCount !== 0 || fsModule.existsSync(${JSON.stringify(input.targetPath)})) {
      throw new Error('策略拒绝后工具处理器或文件副作用仍发生');
    }
    writer.recordToolResult({ callId: ${JSON.stringify(input.callId)}, toolName: 'bash',
      status: 'failed', dispatchCommitted: false,
      message: { role: 'tool', tool_call_id: ${JSON.stringify(input.callId)}, content: result.error || '' } });
    process.stdout.write('SESSION_WRITE_POLICY_DENIED\\n');
    await new Promise(() => {});
  `;
}

/** 构造重启进程核验策略拒绝结果没有被标成未执行或被重放。 */
function createDeniedWriteRecoveryWorkerSource(input) {
  return `
    const [dbModule, sessionModule, recoveryModule, invocationModule, modelModule, fsModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/conversation-session-recovery-service.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/tool-invocation-repository.ts'))}),
      import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'packages/session/src/model-projection.ts')).href)}),
      import('node:fs'),
    ]);
    dbModule.getDb();
    const invocations = new invocationModule.ToolInvocationRepository();
    invocations.markInterruptedUnknown();
    const repository = new sessionModule.ConversationSessionRepository();
    const recovery = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    const events = repository.readAll(${JSON.stringify(input.conversationId)});
    const messages = modelModule.deriveModelHistory(events);
    const result = events.find((event) => event.type === 'tool_result' && event.callId === ${JSON.stringify(input.callId)});
    const synthetic = events.filter((event) => event.type === 'recovery_result' && event.callId === ${JSON.stringify(input.callId)});
    const toolMessage = messages.find((message) => message.role === 'tool' && message.tool_call_id === ${JSON.stringify(input.callId)});
    if (recovery.status !== 'repaired' || result?.status !== 'failed' || result.dispatchCommitted !== false || synthetic.length !== 0) {
      throw new Error('策略拒绝后的真实失败结果被恢复逻辑覆盖');
    }
    if (invocations.get(${JSON.stringify(input.runId)}, ${JSON.stringify(input.callId)}) || fsModule.existsSync(${JSON.stringify(input.targetPath)})) {
      throw new Error('策略拒绝错误创建 Ledger 调用或文件副作用');
    }
    if (!toolMessage || !String(toolMessage.content).includes('Policy denied')) {
      throw new Error('模型历史没有保留策略拒绝结果');
    }
    const second = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    if (second.status !== 'nothing_to_repair') throw new Error('策略拒绝重复恢复产生了事件');
    process.stdout.write('SESSION_WRITE_DENIED_RECONCILIATION ' + JSON.stringify({
      recovery: recovery.status, toolResult: result.status, dispatchCommitted: result.dispatchCommitted,
      ledgerStatus: 'missing', sideEffectExists: fsModule.existsSync(${JSON.stringify(input.targetPath)}),
      modelRetainsPolicyDenial: true, syntheticResults: synthetic.length, duplicateRecovery: second.status,
    }) + '\\n');
    dbModule.closeDb();
  `;
}

/** 构造有待审批调用、尚未分派工具的暂停运行进程。 */
function createColdApprovalWorkerSource(input) {
  const argumentsJson = JSON.stringify({ path: input.targetPath, content: 'approval must expire' });
  return `
    const [dbModule, conversations, sessionModule, writerModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-repository.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/session-run-writer.ts'))}),
    ]);
    const db = dbModule.getDb();
    conversations.create({ id: ${JSON.stringify(input.conversationId)}, title: 'Cold approval recovery', routingMode: 'manual' });
    const repository = new sessionModule.ConversationSessionRepository(db);
    const state = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 2000);
    const writer = new writerModule.ConversationSessionRunWriter(repository,
      ${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 'turn-approval', lease, state.lastSequence);
    writer.startUserTurn('message-approval', '请批准写入', new Date().toISOString());
    writer.recordModelMessage(1, [{ role: 'assistant', content: null, tool_calls: [{
      id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'write_file', arguments: ${JSON.stringify(argumentsJson)} },
    }] }]);
    writer.recordApproval({ callId: ${JSON.stringify(input.callId)}, toolName: 'write_file',
      status: 'requested', reason: '需要用户确认' });
    process.stdout.write('SESSION_APPROVAL_PAUSED\\n');
    await new Promise(() => {});
  `;
}

/** 构造重启进程检查审批过期、未分派事实和未知副作用未发生。 */
function createColdApprovalRecoveryWorkerSource(input) {
  return `
    const [dbModule, sessionModule, recoveryModule, invocationModule, fsModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/conversation-session-recovery-service.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/tool-invocation-repository.ts'))}),
      import('node:fs'),
    ]);
    dbModule.getDb();
    const repository = new sessionModule.ConversationSessionRepository();
    const invocations = new invocationModule.ToolInvocationRepository();
    const recovery = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    const events = repository.readAll(${JSON.stringify(input.conversationId)});
    const expired = events.find((event) => event.type === 'approval' && event.callId === ${JSON.stringify(input.callId)} && event.status === 'expired');
    const result = events.find((event) => event.type === 'recovery_result' && event.callId === ${JSON.stringify(input.callId)});
    const interruption = events.find((event) => event.type === 'turn_interrupted');
    if (recovery.status !== 'repaired' || !expired || result?.status !== 'not_started' || !interruption) {
      throw new Error('审批过期或未分派工具恢复状态不正确');
    }
    if (invocations.get(${JSON.stringify(input.runId)}, ${JSON.stringify(input.callId)}) || fsModule.existsSync(${JSON.stringify(input.targetPath)})) {
      throw new Error('过期审批恢复发生了工具调用或文件副作用');
    }
    const second = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    if (second.status !== 'nothing_to_repair') throw new Error('重复恢复追加了审批或工具结果');
    process.stdout.write('SESSION_COLD_APPROVAL_RECONCILIATION ' + JSON.stringify({
      approvalStatus: expired.status, toolStatus: result.status,
      dispatchCommitted: false, sideEffectExists: false, interrupted: Boolean(interruption),
      duplicateRecovery: second.status,
    }) + '\\n');
    dbModule.closeDb();
  `;
}

/** 构造工具副作用和 Ledger success 已提交、但没有 Session 结果的进程。 */
function createSucceededToolWorkerSource(input) {
  const argumentsJson = JSON.stringify({ path: input.targetPath, content: 'SUCCESS_EFFECT\n' });
  const moduleFiles = [
    'db.ts',
    'infrastructure/persistence/conversation-repository.ts',
    'infrastructure/persistence/conversation-session-repository.ts',
    'application/conversations/session-run-writer.ts',
    'agent-runtime/tooling/runtime-context.ts',
    'application/agent-runtime/tooling/tool-registry.ts',
    'application/agent-runtime/tooling/tool-executor.ts',
    'application/agent-runtime/tool-execution-service.ts',
    'application/agent-runtime/tooling/tool-approval-store.ts',
    'infrastructure/persistence/tool-invocation-repository.ts',
    'agent-runtime/tooling/base-tool.ts',
  ];
  const imports = moduleFiles.map((file) => `import(${JSON.stringify(serverUrl(file))})`);
  return `
    const [dbModule, conversations, sessionModule, writerModule, runtimeModule, registryModule,
      executorModule, executionModule, approvalModule, invocationModule, baseToolModule,
      zodModule, fsModule] = await Promise.all([
      ${imports.join(',\n      ')}, import(${JSON.stringify(zodUrl)}), import('node:fs')
    ]);
    const db = dbModule.getDb();
    conversations.create({ id: ${JSON.stringify(input.conversationId)}, title: 'Ledger success recovery', routingMode: 'manual' });
    const repository = new sessionModule.ConversationSessionRepository(db);
    const initialState = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 2000);
    const writer = new writerModule.ConversationSessionRunWriter(repository,
      ${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 'turn-success-probe',
      lease, initialState.lastSequence);
    writer.startUserTurn('message-success-probe', '追加一行', new Date().toISOString());
    writer.recordModelMessage(1, [{ role: 'assistant', content: null, tool_calls: [{
      id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'append_probe_file', arguments: ${JSON.stringify(argumentsJson)} },
    }] }]);
    writer.recordToolDispatch({ callId: ${JSON.stringify(input.callId)}, toolName: 'append_probe_file',
      argumentsJson: ${JSON.stringify(argumentsJson)}, retrySafety: 'never' });
    class AppendProbeTool extends baseToolModule.BaseTool {
      name = 'append_probe_file';
      description = 'Ledger success crash probe';
      inputSchema = zodModule.z.object({ path: zodModule.z.string(), content: zodModule.z.string() });
      isReadOnly() { return false; }
      getMetadata() { return { source: 'builtin', riskLevel: 'high', sideEffect: 'external', retrySafety: 'never', requiresApproval: false }; }
      async execute(input) { fsModule.appendFileSync(input.path, input.content, 'utf8'); return { written: true }; }
    }
    const registry = new registryModule.ToolRegistry();
    registry.register(new AppendProbeTool());
    const invocations = new invocationModule.ToolInvocationRepository(db);
    const service = new executionModule.ToolExecutionService(registry,
      new executorModule.ToolExecutor(registry), new approvalModule.ToolApprovalStore(),
      undefined, () => {}, invocations, { record: () => {} });
    const toolCall = { id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'append_probe_file', arguments: ${JSON.stringify(argumentsJson)} } };
    const result = await service.executeToolDetailed(toolCall, ${JSON.stringify(input.conversationId)}, {
      runId: ${JSON.stringify(input.runId)}, approvalGranted: true, runtimeContext: runtimeModule.createRuntimeContext(),
    });
    const invocation = invocations.get(${JSON.stringify(input.runId)}, ${JSON.stringify(input.callId)});
    if (!result.success || invocation?.status !== 'succeeded' || invocation.attempt !== 1) {
      throw new Error('副作用完成后 Ledger 未持久化 succeeded');
    }
    if (${JSON.stringify(input.sessionResultCommitted === true)}) {
      writer.recordToolResult({ callId: ${JSON.stringify(input.callId)}, toolName: 'append_probe_file',
        status: 'success', message: { role: 'tool', tool_call_id: ${JSON.stringify(input.callId)},
          content: JSON.stringify(result.data) } });
      process.stdout.write('SESSION_TOOL_RESULT_COMMITTED\\n');
    } else {
      process.stdout.write('SESSION_LEDGER_SUCCESS_COMMITTED\\n');
    }
    await new Promise(() => {});
  `;
}

/** 构造新进程核对 Ledger succeeded 且模型结果缺失的情形。 */
function createSucceededRecoveryWorkerSource(input) {
  return `
    const [dbModule, sessionModule, recoveryModule, invocationModule, fsModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/conversation-session-recovery-service.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/tool-invocation-repository.ts'))}),
      import('node:fs'),
    ]);
    dbModule.getDb();
    const invocations = new invocationModule.ToolInvocationRepository();
    invocations.markInterruptedUnknown();
    const repository = new sessionModule.ConversationSessionRepository();
    const recovery = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    const events = repository.readAll(${JSON.stringify(input.conversationId)});
    const invocation = invocations.get(${JSON.stringify(input.runId)}, ${JSON.stringify(input.callId)});
    const repair = events.find((event) => event.type === 'recovery_result' && event.callId === ${JSON.stringify(input.callId)});
    const content = fsModule.readFileSync(${JSON.stringify(input.targetPath)}, 'utf8');
    if (recovery.status !== 'repaired' || invocation?.status !== 'succeeded' || invocation.attempt !== 1) {
      throw new Error('恢复时必须保留 Ledger succeeded 和原始 attempt');
    }
    if (content !== 'SUCCESS_EFFECT\\n') throw new Error('恢复过程重复执行了文件副作用');
    if (repair?.ledgerStatus !== 'succeeded' || !String(repair.message.content).includes('Do not invoke it again')) {
      throw new Error('模型历史没有说明 Ledger success 必须对账且禁止重放');
    }
    const second = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    if (second.status !== 'nothing_to_repair') throw new Error('重复恢复追加了重复结果');
    process.stdout.write('SESSION_SUCCESS_RECONCILIATION ' + JSON.stringify({
      ledgerStatus: invocation.status, attempts: invocation.attempt, fileContent: content,
      recoveryStatus: repair.status, retryInstruction: repair.message.content, duplicateRecovery: second.status,
    }) + '\\n');
    dbModule.closeDb();
  `;
}

/** 构造重启进程，确认已提交的工具结果不会被合成结果覆盖或重复追加。 */
function createCommittedResultRecoveryWorkerSource(input) {
  return `
    const [dbModule, sessionModule, recoveryModule, invocationModule, modelModule, fsModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/conversation-session-recovery-service.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/tool-invocation-repository.ts'))}),
      import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'packages/session/src/model-projection.ts')).href)}),
      import('node:fs'),
    ]);
    dbModule.getDb();
    const invocations = new invocationModule.ToolInvocationRepository();
    invocations.markInterruptedUnknown();
    const repository = new sessionModule.ConversationSessionRepository();
    const recovery = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    const events = repository.readAll(${JSON.stringify(input.conversationId)});
    const invocation = invocations.get(${JSON.stringify(input.runId)}, ${JSON.stringify(input.callId)});
    const messages = modelModule.deriveModelHistory(events);
    const actualToolResults = events.filter((event) => event.type === 'tool_result' && event.callId === ${JSON.stringify(input.callId)});
    const syntheticResults = events.filter((event) => event.type === 'recovery_result' && event.callId === ${JSON.stringify(input.callId)});
    const modelToolResult = messages.find((message) => message.role === 'tool' && message.tool_call_id === ${JSON.stringify(input.callId)});
    const fileContent = fsModule.readFileSync(${JSON.stringify(input.targetPath)}, 'utf8');
    if (recovery.status !== 'repaired' || invocation?.status !== 'succeeded' || invocation.attempt !== 1) {
      throw new Error('恢复没有保留成功账本事实');
    }
    if (actualToolResults.length !== 1 || syntheticResults.length !== 0 || !modelToolResult) {
      throw new Error('已提交的模型可见工具结果丢失或被重复合成');
    }
    if (fileContent !== 'SUCCESS_EFFECT\\n') throw new Error('工具副作用被再次执行');
    const second = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    if (second.status !== 'nothing_to_repair') throw new Error('重复恢复产生了多余工具结果');
    process.stdout.write('SESSION_COMMITTED_RESULT_RECONCILIATION ' + JSON.stringify({
      ledgerStatus: invocation.status, attempts: invocation.attempt,
      toolResults: actualToolResults.length, syntheticResults: syntheticResults.length,
      modelHasActualResult: Boolean(modelToolResult), fileContent,
      interrupted: events.some((event) => event.type === 'turn_interrupted'), duplicateRecovery: second.status,
    }) + '\\n');
    dbModule.closeDb();
  `;
}

/** 构造新进程中的账本修复、历史重建和副作用核验步骤。 */
function createRecoveryWorkerSource(input) {
  const expectedLedgerStatus = input.expectedLedgerStatus ?? 'outcome_unknown';
  const expectedAttempt = input.expectedAttempt ?? 1;
  const expectedRecoveryEventStatus = input.expectedRecoveryEventStatus ?? 'outcome_unknown';
  const expectedFileContent = input.expectedFileContent ?? '第一段已写入\n';
  const expectedMessageFragment = input.expectedMessageFragment ?? 'outcome is unknown';
  const expectDispatch = input.expectDispatch ?? true;
  return `
    const [dbModule, sessionModule, recoveryModule, invocationModule, modelModule, fsModule] = await Promise.all([
      import(${JSON.stringify(serverUrl('db.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(serverUrl('application/conversations/conversation-session-recovery-service.ts'))}),
      import(${JSON.stringify(serverUrl('infrastructure/persistence/tool-invocation-repository.ts'))}),
      import(${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'packages/session/src/model-projection.ts')).href)}),
      import('node:fs'),
    ]);
    dbModule.getDb();
    const invocations = new invocationModule.ToolInvocationRepository();
    invocations.markInterruptedUnknown();
    const repository = new sessionModule.ConversationSessionRepository();
    const recovery = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    const events = repository.readAll(${JSON.stringify(input.conversationId)});
    const messages = modelModule.deriveModelHistory(events);
    const invocation = invocations.get(${JSON.stringify(input.runId)}, ${JSON.stringify(input.callId)});
    const fileContent = fsModule.existsSync(${JSON.stringify(input.targetPath)})
      ? fsModule.readFileSync(${JSON.stringify(input.targetPath)}, 'utf8') : '';
    const repair = events.find((event) => event.type === 'recovery_result' && event.callId === ${JSON.stringify(input.callId)});
    const dispatch = events.some((event) => event.type === 'tool_dispatch_committed' && event.callId === ${JSON.stringify(input.callId)});
    const ledgerStatus = invocation?.status ?? 'missing';
    if (recovery.status !== 'repaired' || repair?.status !== ${JSON.stringify(expectedRecoveryEventStatus)} ||
        ledgerStatus !== ${JSON.stringify(expectedLedgerStatus)} || (invocation?.attempt ?? 0) !== ${JSON.stringify(expectedAttempt)}) {
      throw new Error('账本或 Session 恢复结果不符合预期');
    }
    if (fileContent !== ${JSON.stringify(expectedFileContent)}) throw new Error('修复过程修改了原文件副作用');
    if (dispatch !== ${JSON.stringify(expectDispatch)}) throw new Error('工具分派状态不符合预期');
    const call = messages.find((message) => message.role === 'assistant' && Array.isArray(message.tool_calls));
    const toolResult = messages.find((message) => message.role === 'tool' && message.tool_call_id === ${JSON.stringify(input.callId)});
    if (!call || !toolResult || !String(toolResult.content).includes(${JSON.stringify(expectedMessageFragment)})) {
      throw new Error('模型历史未恢复原调用和未知结果');
    }
    const repeated = recoveryModule.repairInterruptedConversation(${JSON.stringify(input.conversationId)}, { repository, invocations });
    if (repeated.status !== 'nothing_to_repair') throw new Error('重复恢复追加了第二份合成结果');
    process.stdout.write('SESSION_RECOVERY_EVIDENCE ' + JSON.stringify({
      recovery: recovery.status,
      ledgerStatus,
      attempts: invocation?.attempt ?? 0,
      fileBytes: Buffer.byteLength(fileContent),
      modelHasOriginalCall: Boolean(call),
      modelHasUnknownResult: Boolean(toolResult),
      recoveryEventStatus: repair.status,
      dispatchCommitted: dispatch,
      duplicateRecovery: repeated.status,
      lastSequence: repository.ensureConversation(${JSON.stringify(input.conversationId)}).lastSequence,
    }) + '\\n');
    dbModule.closeDb();
  `;
}

/** 等待进程退出前给出简短延迟，确保 DB lease 已经过期。 */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

runCrashRecoveryProbe().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
