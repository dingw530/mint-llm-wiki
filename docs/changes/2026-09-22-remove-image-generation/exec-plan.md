# 执行计划：移除图片生成能力

## TP-001：删除图片运行时链路

- 删除图片页面、组件、样式、客户端 API、服务端 image service、图片 endpoint 和图片消息路由。
- 删除消息图片读写/渲染和图片端点配置分支。

## TP-002：收敛文本端点与会话契约

- 将 active code 中的 endpoint 类型、repository、service、设置 UI 和 endpoint descriptor 收敛为文本端点。
- 会话创建不再接受 image 类型。
- 重新生成 Electron manifest。

## TP-003：验证与追溯

- 运行定向测试、全量测试、typecheck、build、Prettier 和 diff check。
- 进行残留搜索，记录历史 migration/文档例外。

## 验证命令

```sh
npm test
npm run typecheck
npm run build
npx prettier --check <modified-files>
git diff --check
```
