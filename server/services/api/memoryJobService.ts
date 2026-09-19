import * as messageRepo from '../../repositories/messageRepository.js';
import * as memoryJobRepo from '../../repositories/memoryJobRepository.js';
import * as settingsService from './settingsService.js';
import * as memoryService from './memoryService.js';
import type { Message } from '../../types.js';
import type { MemoryExtractionMessage } from './memoryService.js';

let scheduled = false;
let running = false;
let stopping = false;
let drainPromise: Promise<void> | undefined;
let scheduledPromise: Promise<void> | undefined;

/** 将会话加入持久化记忆处理队列，并触发当前进程的 worker。 */
export function enqueueMemoryProcessing(
  conversationId: string,
  throughMessageId: string | null = null,
): void {
  memoryJobRepo.enqueue(conversationId, throughMessageId);
  scheduleDrain();
}

/** 恢复服务重启前遗留的任务，并启动记忆 worker。 */
export function startMemoryProcessing(): void {
  stopping = false;
  memoryJobRepo.recoverProcessing();
  scheduleDrain();
}

/** Stop scheduling new memory work and wait for the current drain to finish. */
export function stopMemoryProcessing(): Promise<void> {
  stopping = true;
  scheduled = false;
  return Promise.all([drainPromise, scheduledPromise]).then(() => undefined);
}

function scheduleDrain(): void {
  if (stopping || scheduled || running) return;
  scheduled = true;
  scheduledPromise = new Promise<void>((resolve) => {
    setImmediate(() => {
      scheduled = false;
      scheduledPromise = undefined;
      if (stopping) {
        resolve();
        return;
      }
      drainPromise = drain();
      void drainPromise.then(resolve, resolve).finally(() => {
        drainPromise = undefined;
      });
    });
  });
}

/** 截取任务请求时点之前的消息，避免新消息被旧任务误处理。 */
function selectSnapshot(messages: Message[], throughMessageId: string | null): Message[] {
  if (!throughMessageId) return messages;
  const snapshotIndex = messages.findIndex((message) => message.id === throughMessageId);
  return snapshotIndex >= 0 ? messages.slice(0, snapshotIndex + 1) : messages;
}

function isExtractionRole(role: string): role is MemoryExtractionMessage['role'] {
  return role === 'user' || role === 'assistant';
}

/** 保留记忆提取所需的角色、正文、ID 和时间信息。 */
function toExtractionMessages(messages: Message[]): MemoryExtractionMessage[] {
  return messages.flatMap((message) => {
    if (!isExtractionRole(message.role)) return [];
    return [
      {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      },
    ];
  });
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    let job = memoryJobRepo.claimNext();
    while (job && !stopping) {
      try {
        const messages = selectSnapshot(
          messageRepo.findByConversationId(job.conversationId),
          job.requestedThroughMessageId,
        );
        const extractionMessages = toExtractionMessages(messages);
        if (
          extractionMessages.some((message) => message.role === 'user') &&
          extractionMessages.some((message) => message.role === 'assistant')
        ) {
          const succeeded = await memoryService.performExtraction(
            settingsService.getAiSettings(),
            extractionMessages,
            job.conversationId,
            job.id,
          );
          if (!succeeded) throw new Error('记忆提取失败');
        }
        memoryJobRepo.complete(job.id, job.requestedThroughMessageId);
      } catch (error) {
        const errorCode =
          error instanceof Error && error.message === '记忆提取失败'
            ? 'extraction_failed'
            : 'memory_processing_failed';
        memoryService.recordMemoryProcessingFailure(job.conversationId, job.id, errorCode);
        memoryJobRepo.fail(job.id, 'memory_processing_failed');
      }
      job = stopping ? undefined : memoryJobRepo.claimNext();
    }
  } finally {
    running = false;
  }
}
