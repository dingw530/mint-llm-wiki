// ── Conversations 命令模块 ──
// 管理会话：列出、删除

import chalk from 'chalk';
import * as conversationService from '../../domains/conversations/index.js';

export async function handleConversations(action: string, id?: string): Promise<void> {
  switch (action) {
    case 'list': {
      const convs = conversationService.list();
      if (convs.length === 0) {
        console.log(chalk.dim('暂无对话'));
        return;
      }
      console.log(chalk.bold('\n对话列表:'));
      for (const c of convs) {
        const shortId = c.id.substring(0, 8);
        const title = c.title.length > 30 ? c.title.substring(0, 30) + '...' : c.title;
        console.log(
          `  ${chalk.cyan(shortId)}  ${chalk.white(title)}  ${chalk.dim(c.type)}  ${chalk.dim(new Date(c.updatedAt).toLocaleString())}`,
        );
      }
      break;
    }
    case 'delete': {
      if (!id) {
        console.error(chalk.red('请指定会话 ID'));
        return;
      }
      try {
        conversationService.remove(id);
        console.log(chalk.green('已删除'));
      } catch (err) {
        console.error(chalk.red(`删除失败: ${(err as Error).message}`));
      }
      break;
    }
    default:
      console.error(chalk.red('未知操作，支持: list, delete'));
  }
}
