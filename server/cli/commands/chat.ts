// ── Chat 命令模块 ──
// 支持 REPL 模式（无参数）和单条消息（有参数）

import chalk from 'chalk';
import * as conversationService from '../../domains/conversations/index.js';
import * as messageService from '../../application/conversations/message-service.js';
import { TerminalSink, AccumulatingSink } from '../../infrastructure/transports/sinks.js';

export async function handleChat(
  message?: string,
  options?: { agent?: string; conv?: string; stream?: boolean },
): Promise<void> {
  if (!message) {
    // 无消息 → 进入 REPL
    const { runRepl } = await import('../repl.js');
    await runRepl(options?.conv);
    return;
  }

  // 单条消息模式
  let convId = options?.conv;
  if (!convId) {
    convId = conversationService.create({ title: message.substring(0, 30) }).id;
  }

  const useStream = options?.stream !== false;
  const sink = useStream ? new TerminalSink() : new AccumulatingSink();

  try {
    await messageService.sendMessage(convId, message, sink, options?.agent);
  } catch (err) {
    console.error(chalk.red(`\n错误: ${(err as Error).message}`));
    return;
  }

  if (!useStream) {
    const accSink = sink as AccumulatingSink;
    console.log(chalk.cyan('\n' + accSink.data));
  }
}
