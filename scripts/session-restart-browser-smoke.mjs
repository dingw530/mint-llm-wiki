import { spawn as spawnProcess, execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverUrl = (file) => pathToFileURL(path.join(root, 'apps/server', file)).href;

/** 在同一隔离 DB 上重启真实 HTTP 服务，并通过真实浏览器完成轨迹核对。 */
async function runRestartBrowserSmoke() {
  const state = {
    directory: await mkdtemp(path.join(os.tmpdir(), 'mint-session-restart-browser-')),
    browserSession: `mint-restart-${randomUUID()}`,
    modelRequests: [],
    apiBeforeRestart: undefined,
    apiAfterRestart: undefined,
    databaseModule: undefined,
    modelServer: undefined,
    browserOpened: false,
    originalEnv: {
      dbPath: process.env.AI_CHAT_DB_PATH,
      encryptionKey: process.env.AI_CHAT_ENCRYPTION_KEY,
      clientDist: process.env.AI_CHAT_CLIENT_DIST,
    },
  };
  const fixture = {
    databasePath: path.join(state.directory, 'restart.db'),
    targetPath: path.join(state.directory, 'crash-fixture.txt'),
    conversationId: `restart-${randomUUID()}`,
    originRunId: `origin-${randomUUID()}`,
    readCallId: `read-${randomUUID()}`,
    callId: `write-${randomUUID()}`,
    messageId: `message-${randomUUID()}`,
    newQuestion: '请先核对文件的实际状态，再决定是否继续。',
  };
  const evidenceDirectory = process.env.HARNESS_RUN_DIR
    ? path.resolve(process.env.HARNESS_RUN_DIR)
    : path.join(
        root,
        '.harness/runs/2026-10-20-session-trajectory-recovery',
        `session-restart-browser-${Date.now()}`,
      );
  await mkdir(evidenceDirectory, { recursive: true });
  state.modelServer = await startDeterministicModel(state.modelRequests);
  const apiPort = await availablePort();
  const clientPath = path.join(root, 'apps/client/dist');

  try {
    Object.assign(process.env, {
      AI_CHAT_DB_PATH: fixture.databasePath,
      AI_CHAT_ENCRYPTION_KEY: 'session-restart-browser-encryption-key',
    });
    const seed = await seedInterruptedConversation(fixture, state.modelServer.port);
    state.databaseModule = seed.databaseModule;
    fixture.dispatchEventId = seed.dispatchEventId;
    state.apiBeforeRestart = await startApiWorker(apiPort, fixture.databasePath, clientPath);
    await assertApiReady(apiPort, fixture.conversationId);
    state.apiBeforeRestart.kill('SIGKILL');
    await waitForExit(state.apiBeforeRestart);
    await delay(5_500);
    state.apiAfterRestart = await startApiWorker(apiPort, fixture.databasePath, clientPath);
    const browserEvidence = await runRealBrowser(state, fixture, apiPort, evidenceDirectory);
    const evidence = await verifyPersistedRecovery(state, fixture);
    await stopApiWorker(state.apiAfterRestart, 'SIGTERM');
    state.apiAfterRestart = undefined;
    state.databaseModule.closeDb();
    await copyFile(fixture.databasePath, path.join(evidenceDirectory, 'restart.db'));
    await copyFile(fixture.targetPath, path.join(evidenceDirectory, 'partial-file.txt'));
    const modelRequestPath = path.join(evidenceDirectory, 'model-request.json');
    writeFileSync(modelRequestPath, `${JSON.stringify(state.modelRequests, null, 2)}\n`);
    const report = {
      ...evidence,
      browserEvidence,
      modelRequests: state.modelRequests.length,
      persistedDatabase: path.join(evidenceDirectory, 'restart.db'),
      partialFile: path.join(evidenceDirectory, 'partial-file.txt'),
      modelRequestPath,
    };
    writeFileSync(
      path.join(evidenceDirectory, 'verification-evidence.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`SESSION_RESTART_BROWSER_OK ${JSON.stringify(report)}\n`);
  } finally {
    if (state.browserOpened) runPlaywright(state.browserSession, ['close']);
    if (state.apiBeforeRestart && state.apiBeforeRestart.exitCode === null) {
      await stopApiWorker(state.apiBeforeRestart, 'SIGKILL');
    }
    if (state.apiAfterRestart) await stopApiWorker(state.apiAfterRestart, 'SIGTERM');
    await closeFakeModel(state.modelServer.server);
    state.databaseModule?.closeDb();
    restoreEnvironment('AI_CHAT_DB_PATH', state.originalEnv.dbPath);
    restoreEnvironment('AI_CHAT_ENCRYPTION_KEY', state.originalEnv.encryptionKey);
    restoreEnvironment('AI_CHAT_CLIENT_DIST', state.originalEnv.clientDist);
    await rm(state.directory, { recursive: true, force: true });
  }
}

/** 创建只返回固定最终答案的本地 OpenAI-compatible 流服务。 */
async function startDeterministicModel(requests) {
  const server = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const common = {
      id: 'chatcmpl-session-restart',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'mint-session-fixture',
    };
    response.write(
      `data: ${JSON.stringify({
        ...common,
        choices: [{ index: 0, delta: { content: '已完成只读核对。' }, finish_reason: null }],
      })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({
        ...common,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    );
    response.end('data: [DONE]\n\n');
  });
  const port = await listenOnAvailablePort(server);
  return { server, port };
}

/** 在隔离 SQLite 中创建消息、Session 工具调用、Ledger executing 与部分文件。 */
async function seedInterruptedConversation(fixture, modelPort) {
  const modules = await Promise.all([
    import(serverUrl('db.ts')),
    import(serverUrl('infrastructure/persistence/conversation-repository.ts')),
    import(serverUrl('domains/model-endpoints/model-endpoint-service.ts')),
    import(serverUrl('infrastructure/persistence/conversation-session-repository.ts')),
    import(serverUrl('application/conversations/session-run-writer.ts')),
    import(serverUrl('infrastructure/persistence/tool-invocation-repository.ts')),
    import(serverUrl('repositories/messageRepository.js')),
  ]);
  const [
    dbModule,
    conversations,
    endpointService,
    sessionModule,
    writerModule,
    invocationModule,
    messages,
  ] = modules;
  const database = dbModule.getDb();
  conversations.create({
    id: fixture.conversationId,
    title: '轨迹恢复验收',
    routingMode: 'manual',
  });
  endpointService.create({
    name: 'Session Restart Fixture',
    apiUrl: `http://127.0.0.1:${modelPort}`,
    apiKey: 'fixture-key',
    modelId: 'mint-session-fixture',
    apiType: 'openai-chat',
  });
  writeFileSync(fixture.targetPath, '第一段已写入\n', 'utf8');

  const repository = new sessionModule.ConversationSessionRepository(database);
  const initial = repository.ensureConversation(fixture.conversationId);
  const lease = repository.claimOwner(fixture.conversationId, fixture.originRunId, 5_000);
  const writer = new writerModule.ConversationSessionRunWriter(
    repository,
    fixture.conversationId,
    fixture.originRunId,
    'origin-turn',
    lease,
    initial.lastSequence,
  );
  const createdAt = new Date().toISOString();
  const oldPrompt = '请分段写入 crash-fixture.txt';
  repository.withTransaction(() => {
    messages.create({
      id: fixture.messageId,
      conversationId: fixture.conversationId,
      role: 'user',
      content: oldPrompt,
      createdAt,
    });
    writer.startUserTurn(fixture.messageId, oldPrompt, createdAt);
  });
  const readArgumentsJson = JSON.stringify({ path: fixture.targetPath });
  const argumentsJson = JSON.stringify({
    path: fixture.targetPath,
    content: '第一段已写入\n第二段尚未写入\n',
  });
  writer.recordToolCatalog(1, []);
  writer.recordModelMessage(1, [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: fixture.readCallId,
          type: 'function',
          function: { name: 'read_file', arguments: readArgumentsJson },
        },
      ],
    },
  ]);
  const invocations = new invocationModule.ToolInvocationRepository(database);
  const readClaim = invocations.beginWithClaim(
    {
      runId: fixture.originRunId,
      callId: fixture.readCallId,
      invocationId: createHash('sha256')
        .update(`${fixture.originRunId}:${fixture.readCallId}`)
        .digest('hex'),
      toolName: 'read_file',
      inputHash: createHash('sha256').update(readArgumentsJson).digest('hex'),
      retrySafety: 'safe',
      argumentsJson: readArgumentsJson,
    },
    () =>
      writer.recordToolDispatch({
        callId: fixture.readCallId,
        toolName: 'read_file',
        argumentsJson: readArgumentsJson,
        retrySafety: 'safe',
      }),
  );
  if (!readClaim.allowed) throw new Error('Failed to seed the completed read invocation');
  invocations.finish({
    runId: fixture.originRunId,
    callId: fixture.readCallId,
    status: 'succeeded',
    retryable: false,
  });
  writer.recordToolResult({
    callId: fixture.readCallId,
    toolName: 'read_file',
    status: 'success',
    message: {
      role: 'tool',
      tool_call_id: fixture.readCallId,
      content: JSON.stringify({ content: readFileSync(fixture.targetPath, 'utf8') }),
    },
  });
  writer.recordModelMessage(2, [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: fixture.callId,
          type: 'function',
          function: { name: 'write_file', arguments: argumentsJson },
        },
      ],
    },
  ]);
  const claim = invocations.beginWithClaim(
    {
      runId: fixture.originRunId,
      callId: fixture.callId,
      invocationId: createHash('sha256')
        .update(`${fixture.originRunId}:${fixture.callId}`)
        .digest('hex'),
      toolName: 'write_file',
      inputHash: createHash('sha256').update(argumentsJson).digest('hex'),
      retrySafety: 'never',
      argumentsJson,
    },
    () =>
      writer.recordToolDispatch({
        callId: fixture.callId,
        toolName: 'write_file',
        argumentsJson,
        retrySafety: 'never',
      }),
  );
  if (!claim.allowed) throw new Error('Failed to seed the interrupted tool invocation');
  const dispatchEvent = repository
    .readAll(fixture.conversationId)
    .find((event) => event.type === 'tool_dispatch_committed' && event.callId === fixture.callId);
  if (!dispatchEvent) throw new Error('Seeded tool dispatch event is missing');
  dbModule.closeDb();
  return { databaseModule: dbModule, dispatchEventId: dispatchEvent.eventId };
}

/** 启动一个真正加载 server app 的 HTTP 子进程。 */
async function startApiWorker(port, databasePath, clientPath) {
  const source = `
    const server = await import(${JSON.stringify(serverUrl('index.ts'))});
    const port = await server.startServer(Number(process.env.PORT));
    process.stdout.write('SESSION_RESTART_SERVER_READY ' + JSON.stringify({ port, clientPath: process.env.AI_CHAT_CLIENT_DIST }) + '\\n');
    process.once('SIGTERM', () => { void server.shutdownServer('restart-browser-smoke').finally(() => process.exit(0)); });
  `;
  const worker = spawnProcess(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', source],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        AI_CHAT_DB_PATH: databasePath,
        AI_CHAT_ENCRYPTION_KEY: 'session-restart-browser-encryption-key',
        AI_CHAT_CLIENT_DIST: clientPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitForJsonMarker(worker, 'SESSION_RESTART_SERVER_READY ');
  return worker;
}

/** 验证服务器 A 确实读取过隔离会话，再让服务进程退出。 */
async function assertApiReady(port, conversationId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/conversations`);
  if (!response.ok) throw new Error(`Pre-restart API returned HTTP ${response.status}`);
  const body = await response.json();
  if (!body.conversations?.some((conversation) => conversation.id === conversationId)) {
    throw new Error('Pre-restart server did not read the seeded conversation');
  }
}

/** 在真实浏览器中打开恢复会话、切换轨迹、发送核对问题并检查草稿。 */
async function runRealBrowser(state, fixture, apiPort, evidenceDirectory) {
  const browserSession = state.browserSession;
  state.browserOpened = true;
  const pageUrl = `http://127.0.0.1:${apiPort}/chat`;
  runPlaywright(browserSession, ['open', pageUrl]);
  runPlaywright(browserSession, ['click', "getByRole('tab', { name: '轨迹' })"]);
  const initialTrace = await waitForBrowserText(browserSession, '结果未知');
  assertContains(initialTrace, '本轮意外停止', 'cold recovery interruption');
  assertContains(initialTrace, '最后一段记录未完整提交', 'partial streamed tail marker');
  assertContains(initialTrace, 'read_file', 'previous successful tool trace');
  runPlaywright(browserSession, ['click', `getByTestId('trace-row-${fixture.dispatchEventId}')`]);
  const details = await waitForBrowserText(browserSession, fixture.targetPath);
  assertContains(details, '第一段已写入', 'persisted partial file detail');

  runPlaywright(browserSession, ['click', "getByRole('tab', { name: '对话' })"]);
  runPlaywright(browserSession, ['fill', "getByPlaceholder('输入消息...')", fixture.newQuestion]);
  runPlaywright(browserSession, ['click', "getByRole('tab', { name: '轨迹' })"]);
  runPlaywright(browserSession, ['click', "getByRole('tab', { name: '对话' })"]);
  const draft = runPlaywright(browserSession, [
    'eval',
    `document.querySelector('textarea[placeholder="输入消息..."]')?.value || document.querySelector('[contenteditable="true"]')?.textContent`,
  ]);
  if (!draft.includes(fixture.newQuestion))
    throw new Error('Switching to the trace tab discarded the composer draft');
  runPlaywright(browserSession, ['click', "getByRole('button', { name: '发送消息' })"]);
  const answer = await waitForBrowserText(browserSession, '已完成只读核对');
  assertContains(answer, '已完成只读核对', 'final assistant answer');
  const requests = runPlaywright(browserSession, ['requests']);
  assertContains(requests, '/trajectory', 'trajectory API request');
  assertContains(requests, '/messages', 'new user message request');
  if (requests.includes('/recovery-actions'))
    throw new Error('Normal continuation called the old recovery retry API');
  const screenshotPath = path.join(evidenceDirectory, 'trajectory-after-restart.png');
  runPlaywright(browserSession, ['screenshot', `--filename=${screenshotPath}`]);
  return { answer, screenshotPath };
}

/** 检查真实模型请求、Ledger attempt 和重启后的 Session 投影。 */
async function verifyPersistedRecovery(state, fixture) {
  const request = state.modelRequests.at(-1);
  if (!request || !Array.isArray(request.messages))
    throw new Error('Fake model did not capture a chat request');
  const messages = request.messages;
  const oldReadCall = messages.findIndex(
    (message) =>
      message.role === 'assistant' &&
      message.tool_calls?.some((call) => call.id === fixture.readCallId),
  );
  const oldReadResult = messages.findIndex(
    (message) => message.role === 'tool' && message.tool_call_id === fixture.readCallId,
  );
  const oldCall = messages.findIndex(
    (message) =>
      message.role === 'assistant' &&
      message.tool_calls?.some((call) => call.id === fixture.callId),
  );
  const unknownResult = messages.findIndex(
    (message) => message.role === 'tool' && message.tool_call_id === fixture.callId,
  );
  const newQuestion = messages.findIndex(
    (message) => message.role === 'user' && String(message.content).includes(fixture.newQuestion),
  );
  if (
    oldReadCall < 0 ||
    oldReadResult <= oldReadCall ||
    oldCall <= oldReadResult ||
    unknownResult <= oldCall ||
    newQuestion <= unknownResult
  ) {
    throw new Error(
      'New model request did not preserve the prior read result and unknown call before the new question',
    );
  }
  if (!String(messages[unknownResult].content).toLowerCase().includes('unknown')) {
    throw new Error('Model request omitted the old invocation unknown-outcome warning');
  }

  const db = await import(serverUrl('db.ts'));
  const sessionModule = await import(
    serverUrl('infrastructure/persistence/conversation-session-repository.ts')
  );
  const invocationModule = await import(
    serverUrl('infrastructure/persistence/tool-invocation-repository.ts')
  );
  const messageRepository = await import(serverUrl('repositories/messageRepository.js'));
  const repository = new sessionModule.ConversationSessionRepository();
  const events = repository.readAll(fixture.conversationId);
  const oldInvocation = new invocationModule.ToolInvocationRepository().get(
    fixture.originRunId,
    fixture.callId,
  );
  const priorRead = new invocationModule.ToolInvocationRepository().get(
    fixture.originRunId,
    fixture.readCallId,
  );
  const recoveryResults = events.filter(
    (event) => event.type === 'recovery_result' && event.callId === fixture.callId,
  );
  const assistantRows = messageRepository
    .findByConversationId(fixture.conversationId)
    .filter(
      (message) => message.role === 'assistant' && message.content.includes('已完成只读核对'),
    );
  const fileContent = readFileSync(fixture.targetPath, 'utf8');
  const newUserEvents = events.filter(
    (event) => event.type === 'user_message' && event.content === fixture.newQuestion,
  );
  if (
    oldInvocation?.attempt !== 1 ||
    priorRead?.status !== 'succeeded' ||
    priorRead.attempt !== 1 ||
    recoveryResults.length !== 1 ||
    assistantRows.length !== 1
  ) {
    throw new Error(
      'Restart recovery duplicated the side effect, repair event or assistant answer',
    );
  }
  if (fileContent !== '第一段已写入\n' || newUserEvents.length !== 1) {
    throw new Error('Restart recovery changed the partial file or duplicated the new user turn');
  }
  const ledgerStatus = oldInvocation.status;
  db.closeDb();
  return {
    modelSawOriginalCall: true,
    modelSawUnknownResultBeforeNewQuestion: true,
    oldToolAttempt: oldInvocation.attempt,
    oldToolStatus: ledgerStatus,
    priorReadResultPreserved: oldReadResult > oldReadCall,
    repairEvents: recoveryResults.length,
    assistantAnswers: assistantRows.length,
    partialFileUnchanged: true,
  };
}

/** 启动使用相同 DB 与静态客户端的真实 server 进程。 */
/** 运行一个 Playwright CLI 命令并返回浏览器输出。 */
function runPlaywright(session, args) {
  try {
    return execFileSync('playwright-cli', [`-s=${session}`, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
  } catch (error) {
    const output = error.stdout?.toString() ?? '';
    const diagnostics = error.stderr?.toString() ?? '';
    throw new Error(`playwright-cli ${args[0]} failed: ${diagnostics}\n${output}`);
  }
}

/** 轮询真实页面文本，直到轨迹或最终答案出现。 */
async function waitForBrowserText(session, target, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let pageText = '';
  while (Date.now() < deadline) {
    pageText = runPlaywright(session, ['eval', 'document.body.innerText']);
    if (pageText.includes(target)) return pageText;
    await delay(300);
  }
  throw new Error(`浏览器未出现文本 ${target}：${pageText.slice(-800)}`);
}

/** 确认检查点文本包含预期内容。 */
function assertContains(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} does not contain ${expected}`);
}

/** 选择一个当前可用的 loopback TCP 端口。 */
async function availablePort() {
  const server = createNetServer();
  const port = await listenOnAvailablePort(server);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

/** 启动 HTTP 服务并返回操作系统分配的 loopback 端口。 */
function listenOnAvailablePort(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('本地服务没有可用 TCP 端口'));
        return;
      }
      resolve(address.port);
    });
  });
}

/** 等待 marker 行并解析随后的 JSON。 */
function waitForJsonMarker(worker, marker, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(
      () => reject(new Error(`等待 ${marker} 超时：${stderr}`)),
      timeoutMs,
    );
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stdout.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout.split('\n').find((entry) => entry.startsWith(marker));
      if (!line) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line.slice(marker.length)));
    });
    worker.stderr.on('data', (chunk) => (stderr += chunk));
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `server process exited before ${marker}: ${String(code)} ${String(signal)} ${stderr}`,
        ),
      );
    });
  });
}

/** 等待子进程退出并回收其 stdio listener。 */
function waitForExit(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => worker.once('exit', resolve));
}

/** 停止 API 子进程。 */
async function stopApiWorker(worker, signal) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill(signal);
  await waitForExit(worker);
}

/** 关闭本地模型 fixture server。 */
async function closeFakeModel(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

/** 等待指定毫秒数。 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 恢复或删除脚本临时设置的环境变量。 */
function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

runRestartBrowserSmoke().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
