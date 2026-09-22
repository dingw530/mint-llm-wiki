import type { Request, Response } from 'express';
import { Router } from 'express';
import * as messageService from '../services/messageService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ResSink } from '../services/sink.js';
import { validateSlashCommand } from '../services/api/slashCommandService.js';

const router = Router();

// 获取指定会话的消息列表（按创建时间升序）
router.get('/:id/messages', (req: Request, res: Response) => {
  const messages = messageService.getMessages(req.params.id as string);
  res.json({ messages });
});

// 发送消息：保存用户消息后以 SSE 流式返回 AI 回复
router.post(
  '/:id/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const { content, agent, regenerate, files, control, slashCommand: rawSlashCommand } = req.body;
    if (control?.type === 'tool_approval') {
      if (
        (control.action !== 'approve' && control.action !== 'deny') ||
        typeof control.approvalId !== 'string'
      ) {
        res.status(400).json({ error: 'Invalid tool approval control message' });
        return;
      }
      req.on('close', () => {
        if (res.headersSent && !res.writableEnded) res.end();
      });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      await messageService.resumeToolApproval(
        req.params.id as string,
        control.approvalId,
        control.action,
        new ResSink(res),
      );
      return;
    }
    const slashCommand =
      rawSlashCommand === undefined ? undefined : validateSlashCommand(rawSlashCommand);
    if (rawSlashCommand !== undefined && !slashCommand) {
      res.status(400).json({ error: 'Invalid slash command or empty command input' });
      return;
    }
    if (!content && !files?.length) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    // 客户端断开连接时清理
    req.on('close', () => {
      if (res.headersSent && !res.writableEnded) {
        res.end();
      }
    });

    // 设置 SSE 头后通过 ResSink 包装，再传入服务层
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sink = new ResSink(res);
    await messageService.sendMessage(
      req.params.id as string,
      content || '',
      sink,
      agent,
      regenerate,
      files,
      slashCommand || undefined,
    );
  }),
);

export default router;
