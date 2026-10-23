import { z } from 'zod';
import { BaseTool } from '../../../agent-runtime/tooling/base-tool.js';
import type { AgentRunPersistence } from '../../../agent-runtime/agent-run-persistence.js';
import type {
  PermissionResult,
  ToolContext,
} from '../../../agent-runtime/tooling/tool-contracts.js';
import { agentRunEventRepository } from '../../../infrastructure/persistence/agent-run-event-repository.js';
import {
  toolInvocationRepository,
  type ToolInvocationRecord,
  type ToolInvocationRepository,
} from '../../../infrastructure/persistence/tool-invocation-repository.js';

const GetToolInvocationInputSchema = z
  .object({
    run_id: z.string().min(1).describe('目标工具调用所属的 Agent Run ID'),
    call_id: z.string().min(1).describe('目标运行内的 Tool Call ID'),
    include_arguments: z
      .boolean()
      .optional()
      .default(false)
      .describe('是否读取完整原始参数，默认 false；仅在对账需要时开启，可能包含敏感正文'),
  })
  .strict();

type GetToolInvocationInput = z.infer<typeof GetToolInvocationInputSchema>;
type InvocationReader = Pick<ToolInvocationRepository, 'get' | 'getArguments'>;
type RunReader = Pick<AgentRunPersistence, 'read'>;
type InvocationArguments =
  { status: 'not_requested' | 'missing' | 'unavailable' } | { status: 'available'; json: string };

interface GetToolInvocationOutput {
  invocation: ToolInvocationRecord;
  arguments: InvocationArguments;
  toolResultStored: false;
  externalStateVerified: false;
  reconciliationRequired: boolean;
  note: string;
}

const SCOPE_DENIED = '只能查询当前会话所属运行的工具调用记录';
const LEDGER_NOTE =
  '这是 Ledger 调用记录，不包含完整 Tool Result，也未核实外部状态。executing 或 outcome_unknown 时不得直接重放；请先通过对应只读工具或人工核对实际结果。';

/** Reads durable invocation evidence within the current conversation. */
export class GetToolInvocationTool extends BaseTool<
  GetToolInvocationInput,
  GetToolInvocationOutput
> {
  readonly name = 'get_tool_invocation';
  readonly description =
    '按 run_id 和 call_id 查询当前会话所属运行的工具调用 Ledger，返回工具名、状态、参数哈希、尝试次数、时间和错误码。默认仅返回元数据；include_arguments=true 才读取完整原始参数，可能包含敏感正文。此工具不返回完整 Tool Result、不查询外部系统、不恢复或重放调用。遇到 outcome_unknown，先读取参数定位目标，再用对应只读工具核实实际结果。';
  readonly inputSchema = GetToolInvocationInputSchema;

  /**
   * Injects the durable readers without opening a database during registration.
   * @param invocations Invocation metadata and encrypted argument reader.
   * @param runs Durable run events used to prove conversation ownership.
   */
  constructor(
    private readonly invocations: InvocationReader = toolInvocationRepository,
    private readonly runs: RunReader = agentRunEventRepository,
  ) {
    super();
  }

  /** @returns True because querying does not modify the target invocation. */
  isReadOnly(): boolean {
    return true;
  }

  /** @returns True because repeated reads do not repeat the target operation. */
  isIdempotent(): boolean {
    return true;
  }

  /**
   * Verifies ownership using durable context rather than model-supplied scope.
   * @param input Target run and call selectors.
   * @param context Trusted execution context with the current conversation ID.
   * @returns Permission denial when ownership is absent or cannot be read.
   */
  checkPermission(input: GetToolInvocationInput, context: ToolContext): PermissionResult {
    if (!context.conversationId?.trim()) return { allowed: false, reason: SCOPE_DENIED };
    try {
      const first = this.runs.read(input.run_id)[0];
      if (
        first?.sequence === 1 &&
        first.runId === input.run_id &&
        first.event.type === 'run_started' &&
        first.event.runId === input.run_id &&
        first.event.conversationId === context.conversationId
      ) {
        return { allowed: true };
      }
    } catch {
      // Unreadable run ownership must never permit argument decryption.
    }
    return { allowed: false, reason: SCOPE_DENIED };
  }

  /**
   * Rechecks ownership before returning metadata and explicitly requested arguments.
   * @param input Target identity and optional argument inclusion.
   * @param context Trusted current conversation scope.
   * @returns Ledger evidence without changing or replaying the target invocation.
   */
  async execute(
    input: GetToolInvocationInput,
    context: ToolContext,
  ): Promise<GetToolInvocationOutput> {
    const permission = this.checkPermission(input, context);
    if (!permission.allowed) throw new Error(SCOPE_DENIED);
    const invocation = this.invocations.get(input.run_id, input.call_id);
    if (!invocation) throw new Error('当前会话中未找到该工具调用记录');
    return {
      invocation: { ...invocation },
      arguments: this.readArguments(input),
      toolResultStored: false,
      externalStateVerified: false,
      reconciliationRequired:
        invocation.status === 'executing' || invocation.status === 'outcome_unknown',
      note: LEDGER_NOTE,
    };
  }

  /** @returns A call label that does not expose the target parameters. */
  getCallSummary(): string {
    return '查询工具调用记录';
  }

  /**
   * Summarizes metadata without copying decrypted arguments into the label.
   * @param result Structured Ledger evidence.
   * @returns Tool name and recorded status only.
   */
  getResultSummary(result: GetToolInvocationOutput): string {
    return `调用记录：${result.invocation.toolName}（${result.invocation.status}）`;
  }

  /**
   * Reads plaintext only when requested and preserves missing or unreadable states.
   * @param input Authorized invocation selectors and argument inclusion flag.
   * @returns Original JSON or a state without raw exception details.
   */
  private readArguments(input: GetToolInvocationInput): InvocationArguments {
    if (input.include_arguments !== true) return { status: 'not_requested' };
    try {
      const json = this.invocations.getArguments(input.run_id, input.call_id);
      return json === undefined ? { status: 'missing' } : { status: 'available', json };
    } catch {
      return { status: 'unavailable' };
    }
  }
}
