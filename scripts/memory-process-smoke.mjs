#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const serverRoot = join(root, 'server');
const withNodeVersion = join(root, 'scripts/with-node-version.cjs');
const tempDir = mkdtempSync(join(tmpdir(), 'mint-memory-process-'));
const databasePath = join(tempDir, 'data.db');
process.env.AI_CHAT_DB_PATH = databasePath;
process.env.AI_CHAT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.AI_CHAT_LOG_LEVEL = 'debug';
const env = {
  ...process.env,
  PATH: [join(serverRoot, 'node_modules/.bin'), join(root, 'node_modules/.bin'), process.env.PATH]
    .filter(Boolean)
    .join(delimiter),
};

function runSingleMessage(conversationId, query) {
  const result = spawnSync(
    process.execPath,
    [
      withNodeVersion,
      'tsx',
      'cli/index.ts',
      'chat',
      query,
      '--conv',
      conversationId,
      '--no-stream',
    ],
    { cwd: serverRoot, env, encoding: 'utf8', timeout: 30_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'CLI chat failed');
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function runReplMessage(conversationId, query) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [withNodeVersion, 'tsx', 'cli/index.ts', 'chat', '--conv', conversationId],
      {
        cwd: serverRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let promptCount = 0;
    let querySent = false;
    let exitSent = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('CLI REPL smoke timed out'));
    }, 30_000);
    const collect = (chunk) => {
      output += chunk.toString();
      const currentPromptCount = (output.match(/mint> /g) || []).length;
      if (!querySent && currentPromptCount >= 1) {
        querySent = true;
        child.stdin.write(`${query}\n`);
      } else if (querySent && !exitSent && currentPromptCount >= 2) {
        exitSent = true;
        child.stdin.write('/exit\n');
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(output || `CLI REPL exited with code ${code}`));
        return;
      }
      resolve(output);
    });
  });
}

function assertOneSelectedMemory(output, entryName) {
  const observation = output.match(/memory context prepared.*"selectedRetrievalCount":(\d+)/);
  const blockCount = output.match(/memory context prepared.*"injectedMemoryBlockCount":(\d+)/);
  if (!observation || Number(observation[1]) !== 1 || !blockCount || Number(blockCount[1]) !== 1) {
    throw new Error(`${entryName} did not inject exactly one lexical memory fact block`);
  }
}

async function seedDatabase() {
  const dbModule = await import('../server/dist/db.js');
  const settingsRepository = await import('../server/dist/repositories/settingsRepository.js');
  const conversationRepository =
    await import('../server/dist/infrastructure/persistence/conversation-repository.js');
  const memoryService = await import('../server/dist/domains/memory/index.js');
  const conversation = conversationRepository.create({
    id: 'memory-process-conversation',
    title: 'Memory process smoke',
  });
  settingsRepository.upsertAll({ memoryEnabled: 'true', apiUrl: '', apiKey: '', modelId: 'smoke' });
  memoryService.createMemory({
    id: 'memory-process-smoke-fact',
    content: 'Mint uses TypeScript with SQLite FTS5 for local memory search',
    category: 'project',
    memoryKey: 'project.mint.storage',
    contextPolicy: 'retrievable',
    scopeKind: 'global',
  });
  memoryService.initializeMemorySearchIndex();
  dbModule.closeDb();
  return conversation.id;
}

try {
  const conversationId = await seedDatabase();
  const query = 'Mint TypeScript SQLite FTS5';
  const chatOutput = runSingleMessage(conversationId, query);
  assertOneSelectedMemory(chatOutput, 'CLI chat');

  const replOutput = await runReplMessage(conversationId, query);
  assertOneSelectedMemory(replOutput, 'CLI REPL');

  const { getDb, closeDb } = await import('../server/dist/db.js');
  const memory = getDb()
    .prepare('SELECT access_count FROM memories WHERE id = ?')
    .get('memory-process-smoke-fact');
  const userMessages = getDb()
    .prepare("SELECT count(*) AS count FROM messages WHERE conversation_id = ? AND role = 'user'")
    .get(conversationId);
  if (memory?.access_count !== 2 || userMessages?.count !== 2) {
    throw new Error(
      `CLI restart persistence or selected-only access accounting failed: ${JSON.stringify({ memory, userMessages })}`,
    );
  }
  closeDb();
  const report = {
    status: 'passed',
    entries: ['cli-chat', 'cli-repl'],
    selectedRetrievalCountPerEntry: 1,
    accessCountAfterRestart: memory.access_count,
    persistedUserMessages: userMessages.count,
    modelProviderCalls: 0,
    database: 'isolated-temp-fixture',
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    const { closeDb } = await import('../server/dist/db.js');
    closeDb();
  } catch {
    // The child process may have failed before the built server module was loaded.
  }
  rmSync(tempDir, { recursive: true, force: true });
}
