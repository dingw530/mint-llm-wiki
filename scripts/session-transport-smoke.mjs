import { spawn as spawnProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** 在独立服务进程中检查快照与 SSE 游标交界的无丢失、无重复行为。 */
async function runSessionTransportSmoke() {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mint-session-transport-'));
  const databasePath = path.join(temporaryDirectory, 'transport.db');
  const conversationId = `transport-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  const callId = `call-${randomUUID()}`;
  const worker = spawnWorker(
    createWorkerSource({ databasePath, conversationId, runId, callId }),
    databasePath,
  );
  let firstStream;
  let secondStream;
  let ipcState;
  const originalDbPath = process.env.AI_CHAT_DB_PATH;
  const originalEncryptionKey = process.env.AI_CHAT_ENCRYPTION_KEY;

  try {
    const address = await waitForJsonMarker(worker, 'SESSION_TRANSPORT_READY ');
    const baseUrl = `http://127.0.0.1:${address.port}/conversations/${conversationId}/trajectory`;
    const snapshot = await getSnapshot(`${baseUrl}?afterSeq=0&pageSize=100`);
    const originalEntry = snapshot.entries.find((entry) => entry.callId === callId);
    if (!originalEntry || originalEntry.status !== 'running') {
      throw new Error('轨迹快照没有包含正在执行的工具调用');
    }
    ipcState = await connectElectronIpcTransport({
      databasePath,
      conversationId,
      highWatermark: snapshot.highWatermark,
    });
    if (ipcState.snapshot.highWatermark !== snapshot.highWatermark) {
      throw new Error('HTTP 和 Electron IPC 快照水位不一致');
    }

    worker.stdin.write('append-result\n');
    await waitForMarker(worker, 'SESSION_TRANSPORT_RESULT_COMMITTED');
    const ipcUpdatePromise = waitForSenderUpdate(ipcState.sender, ipcState.subscriptionId);
    firstStream = await readFirstSseUpdate(`${baseUrl}/events?afterSeq=${snapshot.highWatermark}`);
    const ipcUpdate = await ipcUpdatePromise;
    const completedEntry = firstStream.update.entries.find(
      (entry) => entry.id === originalEntry.id,
    );
    if (!completedEntry || completedEntry.status !== 'success') {
      throw new Error('快照与订阅交界的工具结果没有补发');
    }
    if (completedEntry.eventIds.length !== originalEntry.eventIds.length + 1) {
      throw new Error('工具行没有保留结果事件身份');
    }
    const ipcCompletedEntry = ipcUpdate.entries.find((entry) => entry.id === originalEntry.id);
    if (!ipcCompletedEntry || ipcCompletedEntry.status !== completedEntry.status) {
      throw new Error('HTTP SSE 与 Electron IPC 工具状态不一致');
    }
    const resultEventId = completedEntry.eventIds.at(-1);
    if (!resultEventId) throw new Error('工具结果缺少持久事件标识');
    const [httpDetail, ipcDetail] = await Promise.all([
      fetchTrajectoryDetail(`${baseUrl}/events/${resultEventId}`),
      callTrajectoryIpc(
        ipcState.eventDetailHandler,
        ipcState.sender,
        conversationId,
        resultEventId,
      ),
    ]);
    if (JSON.stringify(httpDetail) !== JSON.stringify(ipcDetail)) {
      throw new Error('HTTP 与 Electron IPC 详情语义不一致');
    }
    await ipcState.unsubscribe({ sender: ipcState.sender }, ipcState.subscriptionId);
    const ipcUpdateCount = ipcState.updates.length;

    worker.stdin.write('append-terminal\n');
    secondStream = await readFirstSseUpdate(
      `${baseUrl}/events?afterSeq=${firstStream.update.cursor}`,
      {
        'Last-Event-ID': String(firstStream.update.cursor),
      },
    );
    if (!secondStream.update.entries.some((entry) => entry.kind === 'lifecycle')) {
      throw new Error('SSE Last-Event-ID 重连没有补发后续终态事件');
    }
    if (secondStream.update.entries.some((entry) => entry.id === originalEntry.id)) {
      throw new Error('SSE 重连重复发送了已确认的工具行');
    }
    if (ipcState.updates.length !== ipcUpdateCount) {
      throw new Error('Electron IPC 取消后仍收到订阅事件');
    }

    process.stdout.write(
      `SESSION_TRANSPORT_OK ${JSON.stringify({
        snapshotWatermark: snapshot.highWatermark,
        resultCursor: firstStream.update.cursor,
        firstToolStatus: originalEntry.status,
        updatedToolStatus: completedEntry.status,
        reconnectCursor: secondStream.update.cursor,
        duplicateToolEntry: false,
        ipcSnapshotParity: true,
        ipcUpdateParity: true,
        ipcDetailParity: true,
        ipcCancelled: true,
      })}\n`,
    );
  } finally {
    firstStream?.close();
    secondStream?.close();
    ipcState?.closeDb();
    await stopWorker(worker);
    restoreEnvironment('AI_CHAT_DB_PATH', originalDbPath);
    restoreEnvironment('AI_CHAT_ENCRYPTION_KEY', originalEncryptionKey);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** 在同一隔离数据库上创建标准 IPC snapshot/detail handler 和轨迹 stream handler。 */
async function connectElectronIpcTransport(input) {
  process.env.AI_CHAT_DB_PATH = input.databasePath;
  process.env.AI_CHAT_ENCRYPTION_KEY = 'session-transport-smoke-encryption-key';
  const endpointUrl = pathToFileURL(
    path.join(repositoryRoot, 'apps/server/endpoints/definitions/conversations.ts'),
  ).href;
  const registryUrl = pathToFileURL(
    path.join(repositoryRoot, 'apps/server/endpoints/generate/ipcHandlers.ts'),
  ).href;
  const endpointModule = await import(endpointUrl);
  const ipcModule = await import(registryUrl);
  const dbModule = await import(pathToFileURL(path.join(repositoryRoot, 'apps/server/db.ts')).href);
  const descriptors = endpointModule.conversationsEndpoints;
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  ipcModule.registerIpcHandlers(
    descriptors.filter((descriptor) =>
      ['conversations:getTrajectory', 'conversations:getTrajectoryEvent'].includes(descriptor.id),
    ),
    {},
    ipcMain,
  );
  const electronIpc = require(path.join(repositoryRoot, 'apps/electron/ipc/trajectory.js'));
  const senderState = { updates: [], waiters: [] };
  const sender = {
    id: 42,
    send: (channel, subscriptionId, payload) => {
      if (channel !== 'conversations:trajectoryUpdate') return;
      senderState.updates.push({ subscriptionId, payload });
      for (const waiter of senderState.waiters.splice(0)) waiter(payload);
    },
    once: () => undefined,
    removeListener: () => undefined,
  };
  sender._transportUpdates = senderState.updates;
  sender._transportWaiters = senderState.waiters;
  electronIpc.registerTrajectoryHandlers({
    ipcMain,
    services: { endpointRegistry: { getByResource: () => descriptors } },
  });
  const snapshot = await handlers.get('conversations:getTrajectory')(
    { sender },
    input.conversationId,
    { afterSeq: 0, pageSize: 100 },
  );
  const subscription = await handlers.get('conversations:subscribeTrajectory')(
    { sender },
    input.conversationId,
    input.highWatermark,
  );
  return {
    snapshot,
    sender,
    updates: senderState.updates,
    waiters: senderState.waiters,
    subscriptionId: subscription.subscriptionId,
    eventDetailHandler: handlers.get('conversations:getTrajectoryEvent'),
    unsubscribe: handlers.get('conversations:unsubscribeTrajectory'),
    closeDb: dbModule.closeDb,
  };
}

/** 等待指定 Electron sender 收到的下一条轨迹增量。 */
function waitForSenderUpdate(sender, subscriptionId) {
  const existing = sender._transportUpdates?.find((item) => item.subscriptionId === subscriptionId);
  if (existing) return Promise.resolve(existing.payload);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('等待 Electron IPC 轨迹增量超时')), 5000);
    sender._transportWaiters?.push((payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

/** 通过注册后的 IPC 详情处理器读取同一事件。 */
function callTrajectoryIpc(handler, sender, conversationId, eventId) {
  return handler({ sender }, conversationId, eventId);
}

/** 通过 HTTP 详情 endpoint 读取同一事件。 */
async function fetchTrajectoryDetail(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`轨迹详情返回 HTTP ${response.status}`);
  return response.json();
}

/** 恢复传输 smoke 修改的父进程数据库环境变量。 */
function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** 从真实 endpoint descriptors 启动同一轨迹 HTTP/SSE 服务。 */
function createWorkerSource(input) {
  const servicePath = (file) => pathToFileURL(path.join(repositoryRoot, 'apps/server', file)).href;
  return `
    const [expressModule, routerModule, endpointModule, dbModule, conversationModule,
      sessionModule, writerModule] = await Promise.all([
      import('express'),
      import(${JSON.stringify(servicePath('endpoints/generate/expressRoutes.ts'))}),
      import(${JSON.stringify(servicePath('endpoints/definitions/conversations.ts'))}),
      import(${JSON.stringify(servicePath('db.ts'))}),
      import(${JSON.stringify(servicePath('infrastructure/persistence/conversation-repository.ts'))}),
      import(${JSON.stringify(servicePath('infrastructure/persistence/conversation-session-repository.ts'))}),
      import(${JSON.stringify(servicePath('application/conversations/session-run-writer.ts'))}),
    ]);
    dbModule.getDb();
    conversationModule.create({ id: ${JSON.stringify(input.conversationId)}, title: 'Transport smoke', routingMode: 'manual' });
    const repository = new sessionModule.ConversationSessionRepository();
    const initial = repository.ensureConversation(${JSON.stringify(input.conversationId)});
    const lease = repository.claimOwner(${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 30000);
    const writer = new writerModule.ConversationSessionRunWriter(repository,
      ${JSON.stringify(input.conversationId)}, ${JSON.stringify(input.runId)}, 'transport-turn', lease, initial.lastSequence);
    writer.startUserTurn('transport-user', '更新工具结果', new Date().toISOString());
    writer.recordModelMessage(1, [{ role: 'assistant', content: null, tool_calls: [{
      id: ${JSON.stringify(input.callId)}, type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ path: 'fixture.txt', content: 'ok' }) },
    }] }]);
    writer.recordToolDispatch({ callId: ${JSON.stringify(input.callId)}, toolName: 'write_file',
      argumentsJson: JSON.stringify({ path: 'fixture.txt', content: 'ok' }), retrySafety: 'never' });
    const descriptors = endpointModule.conversationsEndpoints.filter((endpoint) =>
      endpoint.id === 'conversations:getTrajectory' ||
      endpoint.id === 'conversations:getTrajectoryEvent' ||
      endpoint.id === 'conversations:streamTrajectory');
    const app = expressModule.default();
    app.use('/conversations', routerModule.createResourceRouter(descriptors));
    const server = app.listen(0, '127.0.0.1', () => {
      process.stdout.write('SESSION_TRANSPORT_READY ' + JSON.stringify({ port: server.address().port }) + '\\n');
    });
    process.stdin.setEncoding('utf8');
    let buffer = '';
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line === 'append-result') {
          writer.recordToolResult({ callId: ${JSON.stringify(input.callId)}, toolName: 'write_file',
            status: 'success', durationMs: 10,
            message: { role: 'tool', tool_call_id: ${JSON.stringify(input.callId)}, content: 'written' } });
          process.stdout.write('SESSION_TRANSPORT_RESULT_COMMITTED\\n');
        }
        if (line === 'append-terminal') {
          writer.recordRunTerminal('completed');
          process.stdout.write('SESSION_TRANSPORT_TERMINAL_COMMITTED\\n');
        }
      }
    });
    process.on('SIGTERM', () => { server.close(() => { writer.close(); dbModule.closeDb(); process.exit(0); }); });
  `;
}

/** 读取同一高水位内的安全轨迹快照。 */
async function getSnapshot(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`轨迹快照返回 HTTP ${response.status}`);
  return response.json();
}

/** 连接 SSE 并读取首个数据事件；调用 close 中止该请求。 */
async function readFirstSseUpdate(url, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`轨迹 SSE 返回 HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const update = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('等待 SSE 轨迹事件超时')), 5000);
    const read = async () => {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('SSE 在数据事件前关闭');
          buffer += decoder.decode(chunk.value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';
          const data = blocks
            .flatMap((block) => block.split('\n'))
            .find((line) => line.startsWith('data: '));
          if (!data) continue;
          clearTimeout(timeout);
          resolve(JSON.parse(data.slice(6)));
          return;
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    };
    void read();
  });
  return { update, close: () => controller.abort() };
}

/** 等待子进程输出指定标记及其 JSON 值。 */
function waitForJsonMarker(worker, marker) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error(`等待 ${marker} 超时`)), 15_000);
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (chunk) => (buffer += chunk));
    worker.stdout.on('data', (chunk) => {
      buffer += chunk;
      const line = buffer.split('\n').find((item) => item.startsWith(marker));
      if (!line) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line.slice(marker.length)));
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(`transport worker exited early: ${String(code)} ${String(signal)} ${buffer}`),
      );
    });
  });
}

/** 等待子进程输出标记。 */
function waitForMarker(worker, marker) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error(`等待 ${marker} 超时`)), 10_000);
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (chunk) => (buffer += chunk));
    worker.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes(marker)) return;
      clearTimeout(timeout);
      resolve();
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(`transport worker exited early: ${String(code)} ${String(signal)} ${buffer}`),
      );
    });
  });
}

/** 停止 transport 服务进程并确保它退出。 */
async function stopWorker(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill('SIGTERM');
  await new Promise((resolve) => worker.once('exit', resolve));
}

/** 启动使用临时数据库的 tsx 子进程。 */
function spawnWorker(source, databasePath) {
  return spawnProcess(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', source],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        AI_CHAT_DB_PATH: databasePath,
        AI_CHAT_ENCRYPTION_KEY: 'session-transport-smoke-encryption-key',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

runSessionTransportSmoke().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
