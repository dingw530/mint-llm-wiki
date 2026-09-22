# 移除图片生成能力追溯总览

## 变更状态

状态：已完成
完成日期：2026-09-22

## 追溯矩阵

| AC     | 设计         | TP            | 状态                              |
| ------ | ------------ | ------------- | --------------------------------- |
| AC-001 | Client       | TP-001/TP-002 | 已验证                            |
| AC-002 | Server       | TP-001        | 已验证                            |
| AC-003 | Endpoint     | TP-002        | 已验证                            |
| AC-004 | Message      | TP-001        | 已验证                            |
| AC-005 | Boundary     | TP-003        | 已验证（历史 migration/文档除外） |
| AC-006 | Verification | TP-003        | 已验证                            |

## 执行记录

| TP     | 状态   | 产出                                            | 验证                                             |
| ------ | ------ | ----------------------------------------------- | ------------------------------------------------ |
| TP-001 | 已完成 | 图片页面、组件、API、服务、路由、渲染和测试删除 | `npm test` 通过                                  |
| TP-002 | 已完成 | 文本 endpoint 收敛、Electron manifest 重生成    | `npm run typecheck`、`npm run build` 通过        |
| TP-003 | 已完成 | 残留审计、文档和 manifest 更新                  | 静态搜索、格式检查、diff check、`harness:test` 与 `harness:inspect` 通过 |

## 已知保留项

- `server/db.ts` 和 `server/migrations/index.ts` 保留历史 `image_data` / endpoint category 列，避免修改不可变迁移或破坏已有数据库。
- `docs/changes/2026-05-30-image-model-support/` 与 `docs/changes/2026-06-07-image-chat/` 保留为历史记录，不再作为当前产品入口或实现依据。
