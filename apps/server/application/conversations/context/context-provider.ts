import type { AiSettings, HistoryMessage } from '../../../types.js';
import type { MemoryScopeSnapshot, MemoryPackingBudget } from '../../../domains/memory/index.js';
import { estimateTokens, estimateMessagesTokens } from '../../../utils/token-estimator.js';
import {
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  DEFAULT_OUTPUT_TOKEN_RESERVE,
} from '../../../agent-runtime/context-window.js';
import { createMemoryContextProvider } from './memory-context-provider.js';
import { createWikiContextProvider } from './wiki-context-provider.js';

export type ContextPlacement = 'system' | 'before-latest-user';

/** Input shared by every context source while one chat request is assembled. */
export interface ContextProviderInput {
  settings: AiSettings;
  userContent: string;
  memoryScope?: MemoryScopeSnapshot;
  memoryBudget?: Omit<MemoryPackingBudget, 'remainingInputTokens'>;
  remainingInputTokens?: number;
}

/** One provider-owned message contribution and its deterministic placement. */
export interface ContextContribution {
  id: string;
  placement: ContextPlacement;
  content: string;
}

/** Synchronous source of contextual request messages. */
export interface ContextProvider {
  id: string;
  order: number;
  provide(input: ContextProviderInput): ContextContribution | undefined;
}

/** Clone message envelopes so context assembly never mutates conversation history. */
function cloneMessages(messages: HistoryMessage[]): HistoryMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.tool_calls === undefined
      ? {}
      : {
          tool_calls: message.tool_calls.map((toolCall) => ({
            ...toolCall,
            function: { ...toolCall.function },
          })),
        }),
  }));
}

/** Return providers in the stable order used for every request. */
function sortProviders(providers: readonly ContextProvider[]): ContextProvider[] {
  return [...providers].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

/** Reject duplicate ids so one context source cannot silently shadow another. */
function assertUniqueProviderIds(providers: readonly ContextProvider[]): void {
  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.id)) throw new Error(`duplicate context provider id: ${provider.id}`);
    ids.add(provider.id);
  }
}

/** Collect non-empty contributions without changing their provider-defined content. */
function collectContributions(
  providers: readonly ContextProvider[],
  input: ContextProviderInput,
  baseMessages: HistoryMessage[],
): ContextContribution[] {
  const orderedProviders = sortProviders(providers);
  const inputBudget =
    input.memoryBudget?.inputBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET - DEFAULT_OUTPUT_TOKEN_RESERVE;
  const contributions: ContextContribution[] = [];
  let usedTokens = estimateMessagesTokens(baseMessages);
  for (const provider of orderedProviders) {
    const remainingInputTokens = Math.max(0, inputBudget - usedTokens);
    const contribution = provider.provide({ ...input, remainingInputTokens });
    if (!contribution || contribution.content.trim() === '') continue;
    contributions.push(contribution);
    usedTokens += estimateTokens(contribution.content) + 4;
  }
  return contributions;
}

/** Apply all system contributions to the existing system prompt or a new first message. */
function applySystemContributions(
  messages: HistoryMessage[],
  contributions: readonly ContextContribution[],
): HistoryMessage[] {
  if (contributions.length === 0) return messages;
  const content = contributions.map((contribution) => contribution.content).join('\n\n');
  const systemIndex = messages.findIndex((message) => message.role === 'system');
  if (systemIndex < 0) return [{ role: 'system', content }, ...messages];

  const systemMessage = messages[systemIndex];
  const updatedSystem = {
    ...systemMessage,
    content: [systemMessage.content, content].filter(Boolean).join('\n\n'),
  };
  return [...messages.slice(0, systemIndex), updatedSystem, ...messages.slice(systemIndex + 1)];
}

/** Locate the final user message without relying on newer Array runtime APIs. */
function findLatestUserIndex(messages: HistoryMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index;
  }
  return -1;
}

/** Insert user-scoped contributions immediately before the latest user message. */
function applyBeforeLatestUserContributions(
  messages: HistoryMessage[],
  contributions: readonly ContextContribution[],
): HistoryMessage[] {
  if (contributions.length === 0) return messages;
  const contextMessages = contributions.map(({ content }) => ({ role: 'user', content }));
  const latestUserIndex = findLatestUserIndex(messages);
  if (latestUserIndex < 0) return [...messages, ...contextMessages];
  return [
    ...messages.slice(0, latestUserIndex),
    ...contextMessages,
    ...messages.slice(latestUserIndex),
  ];
}

/** Default request context sources used by the main conversation entry point. */
export const DEFAULT_CONTEXT_PROVIDERS: readonly ContextProvider[] = [
  createWikiContextProvider(),
  createMemoryContextProvider(),
];

/** Apply provider contributions without mutating the input conversation history. */
export function applyContextProviders(
  messages: HistoryMessage[],
  input: ContextProviderInput,
  providers: readonly ContextProvider[] = DEFAULT_CONTEXT_PROVIDERS,
): HistoryMessage[] {
  assertUniqueProviderIds(providers);
  const contributions = collectContributions(providers, input, messages);
  const assembled = cloneMessages(messages);
  const systemContributions = contributions.filter(
    (contribution) => contribution.placement === 'system',
  );
  const userContributions = contributions.filter(
    (contribution) => contribution.placement === 'before-latest-user',
  );
  return applyBeforeLatestUserContributions(
    applySystemContributions(assembled, systemContributions),
    userContributions,
  );
}
