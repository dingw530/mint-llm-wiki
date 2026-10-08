// ── Settings 命令模块 ──
// 查看和修改设置

import chalk from 'chalk';
import * as settingsService from '../../application/settings/settings-service.js';

export async function handleSettings(
  action: string,
  _key?: string,
  _value?: string,
): Promise<void> {
  switch (action) {
    case 'show': {
      const settings = settingsService.get();
      console.log(chalk.bold('\n当前设置:'));
      console.log(`  ${chalk.dim('API URL:')}       ${settings.apiUrl || chalk.dim('(未设置)')}`);
      console.log(
        `  ${chalk.dim('API Key:')}       ${settings.apiKeyMasked || chalk.dim('(未设置)')}`,
      );
      console.log(`  ${chalk.dim('模型:')}          ${settings.modelId || chalk.dim('(未设置)')}`);
      console.log(
        `  ${chalk.dim('系统提示词:')}    ${settings.systemPrompt ? settings.systemPrompt.substring(0, 50) + '...' : chalk.dim('(无)')}`,
      );
      console.log(`  ${chalk.dim('思考模式:')}      ${settings.thinkingMode ? '开启' : '关闭'}`);
      console.log(`  ${chalk.dim('记忆:')}          ${settings.memoryEnabled ? '开启' : '关闭'}`);
      console.log(`  ${chalk.dim('路由模式:')}      ${settings.routingMode}`);
      if (settings.activeEndpointName) {
        console.log(`  ${chalk.dim('活动端点:')}     ${settings.activeEndpointName}`);
      }
      break;
    }
    case 'set':
      console.log(chalk.yellow('CLI 暂不支持修改设置，请使用 Web 界面'));
      break;
    default:
      console.error(chalk.red('未知操作，支持: show, set'));
  }
}
