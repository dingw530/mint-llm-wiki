# 执行计划：知识工作台首页收敛

## TP-001：更新默认入口与模块顺序

- 关联：DS-001、DS-002、AC-001、AC-002
- 状态：待启动
- 允许路径：`client/src/router.tsx`、`client/src/shared/components/SidebarHeader.tsx`
- 验证：客户端路由/组件测试、浏览器场景

## TP-002：实现紧凑知识库首页

- 关联：DS-003、DS-004、AC-003、AC-004
- 状态：待启动
- 允许路径：`client/src/features/wiki/WikiPanel.tsx`、`client/src/features/wiki/WikiVectorHealthCard.tsx`、`client/src/styles/wiki.css`
- 验证：Wiki 相关测试、浏览器场景、构建

## TP-003：完整验证与证据回写

- 关联：DS-005、AC-005
- 状态：待启动
- 允许路径：本变更文档目录
- 验证：Harness inspect、Harness verify、Prettier、diff check

## 验证命令

```sh
npm run harness:test
npm run harness:inspect -- --change 2026-09-22-knowledge-workbench-home
npm run typecheck
npm run build
npx prettier --check client/src/router.tsx client/src/shared/components/SidebarHeader.tsx client/src/features/wiki/WikiPanel.tsx client/src/features/wiki/WikiVectorHealthCard.tsx client/src/styles/wiki.css
git diff --check
npm run harness:verify -- --change 2026-09-22-knowledge-workbench-home
```

Docker smoke 需要本机 Docker daemon；当前环境无 `/var/run/docker.sock` 时记录为环境阻塞，不将其误判为业务回归。

### 2026-09-22：Harness run 2026-09-22T09-27-04-213Z-41308

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-22-knowledge-workbench-home/2026-09-22T09-27-04-213Z-41308
- 检查结果：unit:passed, browser-ac:passed, boundary:passed, claims:PASS
