/**
 * TypeSafe Jev（System One）请求、答案与调用结果类型。
 *
 * Jev 不生成文本：输入 `state` 与一组有类型的 `questions`，返回受选项约束的结构化答案。
 * 该接口形态与 `ApiAdapter` 的 messages → stream/call 完全不同，因此独立于适配器层。
 */

/** Choice 问题的选项映射：选项 id → 该选项的判定说明。 */
export type JevChoiceCriteria = Record<string, string | null>;

/** Score 问题的有序档位描述，至少两档。 */
export type JevScoreCriteria = readonly string[];

/** Noul（是/否）问题的可选界定说明。 */
export interface JevNoulCriteria {
  true?: string;
  false?: string;
}

/** 从选项中选择一项。 */
export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: JevChoiceCriteria;
}

/** 沿有序档位打分，分数可以落在两档之间。 */
export interface JevScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: JevScoreCriteria;
}

/** 判断一条陈述是否为真，返回值即"为真"的概率。 */
export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: JevNoulCriteria;
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion;

/** Jev 接受的 state 形态：纯文本、带描述性键的对象，或文本数组。Jev 只接受文本。 */
export type JevState = string | Record<string, string> | string[];

/** 一次 System One 请求。`questions` 的 key 不会发送给模型。 */
export interface JevRequest {
  state: JevState;
  model: string;
  questions: Record<string, JevQuestion>;
}

/** 归一化后的 Choice 答案。 */
export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
}

/** 归一化后的 Score 答案。 */
export interface JevScoreAnswer {
  type: 'score';
  score: number;
  legend: readonly string[];
  confidence: number;
}

/** 归一化后的 Noul 答案；该类型没有 confidence。 */
export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

/** Jev 调用失败的归类，用于降级审计。 */
export type JevFailureReason =
  | 'not_configured'
  | 'invalid_key'
  | 'invalid_request'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'network_error'
  | 'malformed_response'
  | 'unknown';

/** Jev 连接配置。 */
export interface JevConfig {
  /** System One 端点；可指向自建代理。 */
  apiUrl: string;
  /** 已解密的 API Key；空字符串表示未配置。 */
  apiKey: string;
  /** 模型 id。 */
  model: string;
  /** 单次调用的总墙钟预算（毫秒），含重试与退避。 */
  timeoutMs: number;
}

/** 调用结果：成功携带归一化答案，失败携带可审计的失败原因。 */
export type JevCallResult =
  | {
      ok: true;
      answers: Record<string, JevAnswer>;
      latencyMs: number;
    }
  | {
      ok: false;
      reason: JevFailureReason;
      status?: number;
      message: string;
      latencyMs: number;
    };
