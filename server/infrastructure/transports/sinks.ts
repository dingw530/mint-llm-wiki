// ── SSE 输出抽象 ──
// 将 AI 流式输出从 Express Response 解耦，支持单元测试和非 HTTP 场景
// 提供三套 Sink 实现:
//   ResSink        → Express HTTP SSE (data: ...\n\n)
//   IpcSink        → Electron IPC 推送 (event.sender.send)
//   TerminalSink   → CLI 终端彩色输出 (chalk)
//   AccumulatingSink → 内存累加 (测试/非流式)

import type { Response as ExpressResponse } from 'express';
import chalk from 'chalk';
import type { ReactEvent } from '../../agent-runtime/react-events.js';
import type { Sink } from '../../agent-runtime/output-sink.js';

export type { Sink } from '../../agent-runtime/output-sink.js';

/**
 * 延迟底层流结束，确保响应完成后的持久化工作先执行。
 * @param delegate 实际输出目标
 */
export class DeferredEndSink implements Sink {
  private pendingEnd = false;

  constructor(private readonly delegate: Sink) {}

  write(data: string): void {
    this.delegate.write(data);
  }

  writeEvent(event: ReactEvent): void {
    if (this.delegate.writeEvent) this.delegate.writeEvent(event);
    else this.delegate.write(JSON.stringify(event));
  }

  end(): void {
    this.pendingEnd = true;
  }

  flush(): void {
    if (this.pendingEnd && !this.delegate.writableEnded) this.delegate.end();
  }

  get headersSent(): boolean {
    return this.delegate.headersSent;
  }

  get writableEnded(): boolean {
    return this.delegate.writableEnded;
  }
}

// Express Response 适配：将数据以 SSE data: 格式写入 HTTP 响应
export class ResSink implements Sink {
  private _ended = false;

  constructor(private res: ExpressResponse) {}

  write(data: string): void {
    if (!this._ended && !this.res.writableEnded) {
      this.res.write(`data: ${data}\n\n`);
    }
  }

  writeEvent(event: ReactEvent): void {
    this.write(JSON.stringify(event));
  }

  end(): void {
    if (!this._ended && !this.res.writableEnded) {
      this.res.write('data: [DONE]\n\n');
      this.res.end();
      this._ended = true;
    }
  }

  get headersSent(): boolean {
    return this.res.headersSent;
  }
  get writableEnded(): boolean {
    return this._ended || this.res.writableEnded;
  }
}

// 累加型 Sink：将流式数据聚合为完整字符串，不输出到任何地方
export class AccumulatingSink implements Sink {
  private _data = '';
  private _ended = false;

  write(data: string): void {
    this._data += data;
  }

  writeEvent(event: ReactEvent): void {
    this.write(JSON.stringify(event));
  }

  end(): void {
    this._ended = true;
  }

  get headersSent(): boolean {
    return false;
  }
  get writableEnded(): boolean {
    return this._ended;
  }
  get data(): string {
    return this._data;
  }
}

// ── Electron IPC 适配：通过 event.sender.send 将 JSON 推送到渲染进程 ──
export class IpcSink implements Sink {
  private _ended = false;

  constructor(
    private event: { sender: { send: (channel: string, ...args: unknown[]) => void } },
    private readonly conversationId?: string,
  ) {}

  write(data: string): void {
    if (!this._ended) {
      if (this.conversationId) this.event.sender.send('chat:chunk', this.conversationId, data);
      else this.event.sender.send('chat:chunk', data);
    }
  }

  writeEvent(event: ReactEvent): void {
    this.write(JSON.stringify(event));
  }

  end(): void {
    if (!this._ended) {
      if (this.conversationId) this.event.sender.send('chat:done', this.conversationId);
      else this.event.sender.send('chat:done');
      this._ended = true;
    }
  }

  get headersSent(): boolean {
    return true;
  }
  get writableEnded(): boolean {
    return this._ended;
  }
}

// ── 终端适配：将流式数据渲染为 ANSI 彩色文本 ──
export class TerminalSink implements Sink {
  private _ended = false;

  write(data: string): void {
    if (this._ended) return;
    try {
      const parsed = JSON.parse(data);
      this.render(parsed);
    } catch {
      process.stdout.write(data);
    }
  }

  writeEvent(event: ReactEvent): void {
    this.write(JSON.stringify(event));
  }

  private render(evt: Record<string, unknown>): void {
    if (evt.content) {
      process.stdout.write(chalk.cyan(String(evt.content)));
    } else if (evt.reasoning && !evt.type) {
      process.stdout.write(chalk.dim.yellow(String(evt.reasoning)));
    } else if (evt.type === 'thought') {
      process.stdout.write(chalk.dim.yellow('\n[思考] ' + (evt.reasoning || '') + '\n'));
    } else if (evt.type === 'tool_call_start') {
      const args =
        typeof evt.arguments === 'string' ? evt.arguments : JSON.stringify(evt.arguments);
      process.stdout.write(chalk.blue(`\n  → 调用 ${evt.toolName}(${args})\n`));
    } else if (evt.type === 'tool_call_end') {
      const result = typeof evt.result === 'string' ? evt.result.substring(0, 200) : '';
      process.stdout.write(chalk.green(`  ← 结果: ${result}\n`));
    } else if (evt.type === 'tool_call_error') {
      process.stdout.write(chalk.red(`  ← 错误(重试 ${evt.retryCount}): ${evt.error}\n`));
    } else if (evt.type === 'answer_ready') {
      process.stdout.write('\n');
    } else if (evt.type === 'run_failed') {
      process.stdout.write(chalk.red(`\n[失败] ${evt.error || 'ReAct run failed'}\n`));
    } else if (evt.type === 'run_cancelled') {
      process.stdout.write(chalk.yellow('\n[已取消]\n'));
    }
  }

  end(): void {
    this._ended = true;
  }
  get headersSent(): boolean {
    return true;
  }
  get writableEnded(): boolean {
    return this._ended;
  }
}
