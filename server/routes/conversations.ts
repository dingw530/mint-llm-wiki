import type { Request, Response } from 'express';
import { Router } from 'express';
import * as conversationService from '../domains/conversations/index.js';
import * as messageRepo from '../repositories/messageRepository.js';
import * as settingsService from '../application/settings/settings-service.js';
import { generateTitle } from '../services/aiProxy.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// 生成对话标题：读取首条消息，调用 AI 生成标题后更新 DB（best-effort）
router.post(
  '/:id/generate-title',
  asyncHandler(async (req: Request, res: Response) => {
    const conversationId = req.params.id as string;

    const messages = messageRepo.findByConversationId(conversationId);
    const firstUser = messages.find((m) => m.role === 'user');
    const firstAssistant = messages.find((m) => m.role === 'assistant');

    if (!firstUser || !firstAssistant) {
      res.json({ title: '' });
      return;
    }

    const settings = settingsService.getAiSettings();
    const title = await generateTitle(settings, firstUser.content, firstAssistant.content);

    if (title) {
      conversationService.rename(conversationId, title);
      res.json({ title });
    } else {
      res.json({ title: '' });
    }
  }),
);

export default router;
