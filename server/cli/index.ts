#!/usr/bin/env node
// ── Mint · 清言 CLI 入口 ──
// 提供 REPL 和子命令模式，通过 Sink 接口直接调用服务层

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';

// 确保加密密钥（CLI 需要从环境变量读取）
if (!process.env.AI_CHAT_ENCRYPTION_KEY) {
  console.error(chalk.red('错误: AI_CHAT_ENCRYPTION_KEY 环境变量未设置'));
  console.error(chalk.dim('请设置环境变量后重试'));
  process.exit(1);
}

const program = new Command('mint').description('Mint · 清言 — AI Chat CLI').version('1.0.0');

program
  .command('chat [message]')
  .description('交互式对话 (REPL) 或发送单条消息')
  .option('--agent <id>', '指定 Agent')
  .option('--conv <id>', '使用已有会话')
  .option('--no-stream', '非流式输出')
  .action(async (message, options) => {
    const { handleChat } = await import('./commands/chat.js');
    await handleChat(message, options);
  });

program
  .command('conversations')
  .description('管理会话')
  .argument('<action>', 'list | delete')
  .argument('[id]', '会话 ID（delete 时需要）')
  .action(async (action, id) => {
    const { handleConversations } = await import('./commands/conversations.js');
    await handleConversations(action, id);
  });

program
  .command('settings')
  .description('管理设置')
  .argument('<action>', 'show | set')
  .argument('[key]', '设置键')
  .argument('[value]', '设置值')
  .action(async (action, key, value) => {
    const { handleSettings } = await import('./commands/settings.js');
    await handleSettings(action, key, value);
  });

const wikiCommand = program.command('wiki').description('管理 Wiki 知识库');

wikiCommand
  .command('migrate-lifecycle [path]')
  .description('将已有 pages/*.md 回填到知识生命周期表')
  .action(async (wikiPath?: string) => {
    const { get } = await import('../services/api/settingsService.js');
    const { migrateExistingWikiPages } =
      await import('../services/api/wikiKnowledgeLifecycleService.js');
    const targetPath = wikiPath || get().wikiPath;
    if (!targetPath) throw new Error('未提供 Wiki 路径，且设置中没有 wikiPath');
    const result = migrateExistingWikiPages(targetPath);
    console.log(JSON.stringify({ wikiPath: targetPath, ...result }, null, 2));
    if (result.errors.length > 0) process.exitCode = 1;
  });

program
  .command('serve')
  .description('启动 HTTP 服务（Web 界面用）')
  .option('--port <number>', '端口号')
  .action(async (options) => {
    const { shutdownServer, startServer } = await import('../index.js');
    const port = await startServer(options.port ? parseInt(options.port, 10) : undefined);
    console.log(chalk.green(`\nWeb UI: http://localhost:${port}`));
    console.log(chalk.dim('按 Ctrl+C 停止'));
    await new Promise<void>((resolve) => {
      let stopping = false;
      const stop = (signal: string): void => {
        if (stopping) return;
        stopping = true;
        void shutdownServer(signal).finally(resolve);
      };
      process.once('SIGINT', () => stop('SIGINT'));
      process.once('SIGTERM', () => stop('SIGTERM'));
    });
  });

// 无子命令时默认进入 REPL
program.action(async () => {
  const { runRepl } = await import('./repl.js');
  await runRepl();
});

program.parse(process.argv);
