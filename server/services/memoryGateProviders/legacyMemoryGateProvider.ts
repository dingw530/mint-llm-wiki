import type { MemoryGateProvider, MemoryGateSkipReason } from './types.js';

/**
 * 原有价值判断：问候语集合加自指正则。
 * 行为与接入 Jev 之前完全一致，`memoryService.isConversationValuable` 由本模块再导出。
 */

/** 短于该长度视为信息量不足。 */
const MIN_VALUABLE_LENGTH = 10;

/** 纯感叹/寒暄列表——过滤无信息含量的常见短语。 */
const GREETING_SET = new Set([
  '哈哈',
  '好的',
  '谢谢',
  '明白了',
  '知道了',
  '收到',
  '嗯嗯',
  '好的呢',
  'ok',
  'okay',
  '好的谢谢',
  '好的谢谢啦',
  '明白了谢谢',
  '好的明白了',
  '对',
  '是',
  '好',
  '嗯',
  '行',
  '可以',
  '没问题',
  '不错',
  '厉害',
  '你好',
  'hello',
  'hi',
  '嗨',
]);

/** 自指模式正则——检测用户是否在分享个人信息。 */
const SELF_REF_PATTERNS = [
  /我(?:叫|是|的|来自|从事|做|在|就[职任]|有|喜欢|爱|希望|想|要|觉得|认为|习惯|通常|用|正在|之前|过去|目前|现在|以后|未来)/,
  /(?:喜欢|不喜欢|偏爱|倾向于|习惯|愿意|希望|想要|更(?:愿意|喜欢|倾向于))(?![^。]*[？?])/,
  /(?:不对|不是|错了|更正|纠正|应该说|其实是|我[的想]意思是|你说[得错]|你理解错)/,
  /(?:在做|在搞|开发|项目中|项目是|技术栈|用的|使用|采用|负责|从事|参与)/,
  /(?:打算|计划|目标|想要|希望|准备|正在[学研调开]|学习|研究|调研)/,
  /(?:在[哪这]|来自|毕业于|工作在|就职于|负责|从事|主[要做]).{2,}/,
  /我(?:的名字叫|的称呼是|可以叫我|全名(?:是|为)).{1,}/,
  /(?:年[龄纪]|岁[数了]).{0,5}\d+/,
];

/**
 * 判断用户消息是否不值得记忆，返回原因；值得记忆时返回 null。
 * 这是 `isConversationValuable` 与 provider 结论的唯一事实源，避免两处判断漂移。
 * @param userContent 用户消息
 * @returns 跳过原因，或 null 表示值得记忆
 */
export function describeLegacySkipReason(userContent: string): MemoryGateSkipReason | null {
  if (!userContent || typeof userContent !== 'string') return 'too_short';
  const text = userContent.trim();
  if (text.length < MIN_VALUABLE_LENGTH) return 'too_short';
  if (GREETING_SET.has(text.toLowerCase())) return 'greeting';
  return SELF_REF_PATTERNS.some((pattern) => pattern.test(text)) ? null : 'not_worth_remembering';
}

/**
 * 判断用户消息是否包含值得记忆的信息。
 * 在调用 LLM 提取 API 前执行，避免无效 API 调用。纯同步操作，<5ms。
 * @param userContent 用户消息
 * @returns 是否值得记忆
 */
export function isConversationValuable(userContent: string): boolean {
  return describeLegacySkipReason(userContent) === null;
}

/**
 * 构造原有记忆门控 provider。
 * @returns 记忆门控 provider
 */
export function createLegacyMemoryGateProvider(): MemoryGateProvider {
  return {
    id: 'legacy',
    evaluate: async ({ userContent }) => {
      const reason = describeLegacySkipReason(userContent);
      return reason === null ? { kind: 'memorize' } : { kind: 'skip', reason };
    },
  };
}
