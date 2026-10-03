// ── Mint · 清言 REPL 交互模块 ──
// 使用 node:readline 实现的交互式命令行界面

import * as readline from 'node:readline';
import chalk from 'chalk';
import * as conversationService from '../domains/conversations/index.js';
import * as messageService from '../services/messageService.js';
import { TerminalSink } from '../services/sink.js';

export async function runRepl(startConvId?: string): Promise<void> {
  let convId = startConvId || conversationService.create({ title: 'CLI Chat' }).id;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('mint> '),
  });

  console.log(chalk.dim('Mint · 清言 CLI 模式。输入 /help 查看命令。'));

  rl.prompt();

  rl.on('line', async (line: string) => {
    const cmd = line.trim();

    if (cmd === '/exit' || cmd === '/quit') {
      rl.close();
      return;
    }
    if (cmd === '/clear') {
      console.clear();
      rl.prompt();
      return;
    }
    if (cmd === '/help') {
      console.log(
        chalk.dim(`
  /exit, /quit   退出
  /clear         清屏
  /new           新建对话
  /help          显示帮助
      `),
      );
      rl.prompt();
      return;
    }
    if (cmd === '/new') {
      convId = conversationService.create({ title: 'CLI Chat' }).id;
      console.log(chalk.dim('已创建新对话'));
      rl.prompt();
      return;
    }

    if (cmd) {
      const sink = new TerminalSink();
      try {
        await messageService.sendMessage(convId, cmd, sink);
      } catch (err) {
        console.error(chalk.red(`\n错误: ${(err as Error).message}`));
      }
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.dim('\n再见!'));
    process.exit(0);
  });
}
