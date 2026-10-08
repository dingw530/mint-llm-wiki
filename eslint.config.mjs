// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Global ignore — 不扫描生成目录
  { ignores: ['**/dist/**', '**/node_modules/**', '**/electron-dist/**', '**/*.cjs'] },

  // 全局推荐规则
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 关闭与 Prettier 冲突的规则
  prettierConfig,

  // 主规则集 — 针对 apps/server/ 的 TypeScript 代码
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off', // tsc 已处理类型检查，ESLint no-undef 对 TS 是噪声
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',

      // Return types are enforced by TypeScript inference and JSDoc conventions;
      // keeping this rule enabled created 136 legacy warnings without improving
      // the production signal.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-require-imports': 'off', // tsx 支持 require

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // 测试文件放宽规则
  {
    files: ['apps/server/**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // 脚本文件（CommonJS 模式 tsx 脚本）
  {
    files: ['apps/server/scripts/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Client-side TypeScript/React code runs in the browser, with Vite config
  // files additionally needing Node globals. Keep legacy migration warnings
  // visible without making the existing client codebase unlintable.
  {
    files: ['apps/client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-expressions': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-expressions': 'off',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['apps/client/vite.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
