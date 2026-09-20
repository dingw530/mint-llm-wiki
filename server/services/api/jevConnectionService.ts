import { JEV_TIMEOUT_MS, callJev } from '../jev/jevClient.js';
import type { JevFailureReason } from '../jev/types.js';

/** 测试连接使用的极小 state，避免为一次探测消耗预算。 */
const PROBE_STATE = 'Connection test.';

export interface JevConnectionInput {
  /** 待测端点；调用方已解析表单值与已存值。 */
  apiUrl: string;
  /** 待测密钥（明文）；调用方已解析表单值与已存值。 */
  apiKey: string;
  /** 待测模型 id。 */
  model: string;
}

export interface JevConnectionTestResult {
  success: boolean;
  message: string;
}

/** 失败原因到用户可见文案的映射。 */
const FAILURE_MESSAGES: Record<JevFailureReason, string> = {
  not_configured: 'Jev API Key 未配置',
  invalid_key: 'Jev API Key 无效',
  invalid_request: 'Jev 拒绝了请求内容',
  rate_limited: 'Jev 触发限流，请稍后重试',
  overloaded: 'Jev 服务当前过载，请稍后重试',
  timeout: 'Jev 连接超时',
  network_error: 'Jev 端点不可达或返回异常状态',
  malformed_response: 'Jev 响应结构无法解析',
  unknown: 'Jev 连接失败',
};

/**
 * 用给定配置发起一次最小 System One 请求，验证端点与密钥可用。
 * 不写入任何设置，也不创建或修改业务数据。
 * @param input 待测连接配置
 * @returns 成功或可读的失败提示；永不抛异常
 */
export async function testJevConnection(
  input: JevConnectionInput,
): Promise<JevConnectionTestResult> {
  const apiUrl = input.apiUrl.trim();
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiUrl) return { success: false, message: 'Jev Endpoint 不能为空' };
  if (!apiKey) return { success: false, message: 'Jev API Key 未配置' };
  if (!model) return { success: false, message: 'Jev 模型不能为空' };

  const result = await callJev(
    { apiUrl, apiKey, model, timeoutMs: JEV_TIMEOUT_MS },
    {
      state: PROBE_STATE,
      model,
      questions: {
        reachable: { type: 'noul', instructions: 'Is this a connection test?' },
      },
    },
    { operation: 'connection_test' },
  );

  if (result.ok) return { success: true, message: 'Jev 连接成功' };
  return { success: false, message: FAILURE_MESSAGES[result.reason] };
}
