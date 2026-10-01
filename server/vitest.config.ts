import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['**/__tests__/**/*.test.ts'],
    // Integration suites use SQLite fixtures; concurrent files race on them.
    fileParallelism: false,
    env: {
      AI_CHAT_LOG_LEVEL: 'debug',
      AI_CHAT_DB_PATH: process.env.AI_CHAT_DB_PATH || '/tmp/ai-chat-vitest.db',
      AI_CHAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    },
    server: {
      deps: {
        fallbackCJS: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['services/**/*.ts', 'utils/**/*.ts', 'repositories/**/*.ts'],
      exclude: [
        // AI 适配器需要真实 API 密钥，集成测试覆盖
        'services/adapters/**/*.ts',
      ],
      thresholds: {
        lines: 65,
        functions: 65,
        branches: 65,
        statements: 65,
      },
    },
  },
});
