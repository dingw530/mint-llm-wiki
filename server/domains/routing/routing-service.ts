import { createLogger } from '../../utils/logger.js';
import { getErrorMessage } from '../../utils/typeGuards.js';
import { GENERAL_AGENT_ID, keywordMatchAgents } from './legacy-routing-provider.js';
import { resolveRoute } from './routing-policy.js';
import type { KeywordMatchResult } from './legacy-routing-provider.js';
import type { RouteMethod, RoutingAttempt, RoutingResolution, RoutingStep } from './types.js';
import type { Agent, JevSettings } from '../../types.js';
import type { RoutingDependencies } from './ports.js';

// ── 类型定义 ──

export interface RouteResult {
  agentId: string;
  confidence: number; // 0~1
  method: RouteMethod;
  latencyMs: number;
  /** provider 尝试轨迹，用于事后审计；`routing_logs.method` 只记录其降级摘要。 */
  attempts: RoutingAttempt[];
}

export interface RoutingHooks {
  beforeRoute: (
    message: string,
    context: RoutingContext,
  ) => Promise<{ message?: string; skip?: boolean } | null>;
  onRoutingComplete: (result: RouteResult, context: RoutingContext) => Promise<RouteResult | null>;
  shouldDecompose: (message: string, result: RouteResult) => Promise<boolean>;
  decomposeTask: (message: string, result: RouteResult) => Promise<SubTask[]>;
}

export interface SubTask {
  id: string;
  agentId: string;
  message: string;
  order: number;
}

export interface RoutingContext {
  agents: Agent[];
  lockedAgent?: string | null;
  routingMode?: string | null;
  conversationId?: string;
  messageId?: string;
  messagePreview?: string | null;
  runtimeContext?: { getJevSettings(): JevSettings };
}

/** 组装本次路由 provider 步的工厂；默认交给 `createDefaultRoutingSteps`。 */
export type RoutingStepFactory = (
  jev: JevSettings,
  message: string,
  context: RoutingContext,
) => RoutingStep[];

// 默认空实现 hooks
const NOOP_HOOKS: RoutingHooks = {
  beforeRoute: async () => null,
  onRoutingComplete: async (r) => r,
  shouldDecompose: async () => false,
  decomposeTask: async () => [],
};

// ── RoutingService ──

export class RoutingService {
  private hooks: RoutingHooks;
  private stepFactory: RoutingStepFactory;
  private log = createLogger('routing');

  /**
   * Construct a Routing use case with explicit runtime capabilities.
   * @param dependencies Configuration, model and audit ports
   * @param hooks Optional request hooks
   * @param stepFactory Optional provider plan override
   */
  constructor(
    private readonly dependencies: RoutingDependencies,
    hooks?: Partial<RoutingHooks>,
    stepFactory: RoutingStepFactory = dependencies.createDefaultSteps,
  ) {
    this.hooks = { ...NOOP_HOOKS, ...hooks };
    this.stepFactory = stepFactory;
  }

  /**
   * 主路由入口
   * 1. 调用 beforeRoute hook
   * 2. 检测 lockedAgent → 有则跳过自动路由
   * 3. 检测 routingMode === 'manual' → 跳过
   * 4. 用 provider 步解析路由（Jev 开启时先问 Jev，否则等价于原有实现）
   * 5. 调用 onRoutingComplete hook
   * @param message 用户消息
   * @param context 路由上下文
   * @returns 路由结论
   */
  async route(message: string, context: RoutingContext): Promise<RouteResult> {
    const startTime = Date.now();

    // beforeRoute hook
    const hookResult = await this.hooks.beforeRoute(message, context);
    const effectiveMessage = hookResult?.message ?? message;
    if (hookResult?.skip) {
      return this.finalize(this.earlyResult(GENERAL_AGENT_ID, 0, Date.now() - startTime), context);
    }

    // 锁定 Agent 检测
    if (context.lockedAgent) {
      this.log.info('route: locked agent used', {
        agentId: context.lockedAgent,
        conversationId: context.conversationId,
      });
      return this.finalize(
        this.earlyResult(context.lockedAgent, 1.0, Date.now() - startTime),
        context,
      );
    }

    // 手动模式检测
    if (context.routingMode === 'manual') {
      this.log.info('route: manual mode, skip routing', { conversationId: context.conversationId });
      return this.finalize(this.earlyResult(GENERAL_AGENT_ID, 0, Date.now() - startTime), context);
    }

    const resolution = await this.resolveWithProviders(effectiveMessage, context);

    let result: RouteResult = {
      agentId: resolution.agentId,
      confidence: resolution.confidence,
      method: resolution.method,
      latencyMs: Date.now() - startTime,
      attempts: resolution.attempts,
    };

    // onRoutingComplete hook
    const hookApplied = await this.hooks.onRoutingComplete(result, context);
    if (hookApplied) result = { ...hookApplied, attempts: resolution.attempts };

    return this.finalize({ ...result, latencyMs: Date.now() - startTime }, context);
  }

  /**
   * 关键词匹配（同步）
   * 保留该方法作为既有调用方与测试的稳定入口，实现委托给原有路由 provider。
   * @param message 用户消息
   * @param agents 全量 Agent
   * @returns 最佳匹配结果
   */
  keywordMatch(message: string, agents: Agent[]): KeywordMatchResult {
    return keywordMatchAgents(message, agents);
  }

  /**
   * LLM 分类（异步）
   * 保留该方法作为既有调用方与测试的稳定入口，实现委托给原有路由 provider。
   * @param message 用户消息
   * @param candidates 候选 Agent
   * @returns 命中的 agentId 与置信度；不可用时返回 null
   */
  async llmClassify(
    message: string,
    candidates: Agent[],
  ): Promise<{ agentId: string; confidence: number } | null> {
    return this.dependencies.classify(message, candidates);
  }

  /** 构造跳过自动路由时的结论，不带任何 provider 尝试。 */
  private earlyResult(agentId: string, confidence: number, latencyMs: number): RouteResult {
    return { agentId, confidence, method: 'fallback', latencyMs, attempts: [] };
  }

  /**
   * 解析实验设置并组装 provider 步后执行路由。
   * 设置读取或步组装失败时退回纯原有实现，保证实验功能不会让路由不可用。
   * @param message 用户消息
   * @param context 路由上下文
   * @returns 路由结论
   */
  private async resolveWithProviders(
    message: string,
    context: RoutingContext,
  ): Promise<RoutingResolution> {
    const input = { message, agents: context.agents };
    try {
      const jev = context.runtimeContext?.getJevSettings() ?? this.dependencies.getJevSettings();
      const steps = this.stepFactory(jev, message, context);
      return await resolveRoute(input, steps, { jev });
    } catch (error) {
      this.log.warn('route: provider setup failed, falling back to legacy', {
        error: getErrorMessage(error),
      });
      return resolveRoute(input, this.dependencies.legacySteps, {
        jev: this.dependencies.disabledJevSettings,
      });
    }
  }

  /**
   * 最终处理：记录日志 + 写 routing_logs 表
   * @param result 路由结论
   * @param context 路由上下文
   * @returns 原样返回结论
   */
  private async finalize(result: RouteResult, context: RoutingContext): Promise<RouteResult> {
    // 记录到 routing_logs 表
    if (context.conversationId) {
      try {
        this.dependencies.recordRoute(result, context);
      } catch (err) {
        this.log.error('failed to write routing log', { error: String(err) });
      }
    }

    return result;
  }
}
