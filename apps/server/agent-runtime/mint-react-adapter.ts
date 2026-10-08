import {
  createReactAgent,
  type ReActModel,
  type ReActToolDefinition,
  type ReActToolExecutor,
} from '@mint/react-runtime';
import type { HistoryMessage, TokenUsage, ToolDefinition } from '../types.js';

export interface MintFrameworkTool extends ReActToolDefinition {
  native: ToolDefinition;
}

/** Wraps the portable ReAct engine with Mint message and tool-definition types. */
export function createMintReactAgent(
  model: ReActModel<HistoryMessage, MintFrameworkTool, TokenUsage>,
  toolExecutor: ReActToolExecutor<HistoryMessage, TokenUsage>,
  maxSteps: number,
) {
  return createReactAgent<HistoryMessage, MintFrameworkTool, TokenUsage>({
    model,
    toolExecutor,
    policy: { maxSteps, continueOnToolError: true },
  });
}

/** Adds a generic tool name/schema view while retaining Mint's original definition. */
export function toMintFrameworkTool(tool: ToolDefinition): MintFrameworkTool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters,
    native: tool,
  };
}
