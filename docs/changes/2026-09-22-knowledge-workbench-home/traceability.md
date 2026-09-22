# 知识工作台首页收敛追溯总览

## 变更状态

状态：已完成
完成日期：2026-09-22

## 追溯矩阵

| AC     | 设计   | TP     | 状态             |
| ------ | ------ | ------ | ---------------- |
| AC-001 | DS-001 | TP-001 | PASS             |
| AC-002 | DS-002 | TP-001 | PASS             |
| AC-003 | DS-003 | TP-002 | PASS             |
| AC-004 | DS-004 | TP-002 | PASS             |
| AC-005 | DS-005 | TP-003 | PASS（定向验证） |

## 执行记录

| TP     | 状态   | 产出                             | 验证                                                                  |
| ------ | ------ | -------------------------------- | --------------------------------------------------------------------- |
| TP-001 | 已完成 | 根路由与侧栏模块顺序调整         | 客户端测试、浏览器模块场景                                            |
| TP-002 | 已完成 | 紧凑知识工作台首页、索引状态兜底 | 客户端测试、浏览器知识库场景、build                                   |
| TP-003 | 已完成 | SDD、浏览器场景和验证计划        | 定向 Harness claims PASS；标准全量 Harness 的 Docker smoke 受环境阻塞 |

## 验证证据

- 定向 Harness run：`.harness/runs/2026-09-22-knowledge-workbench-home/2026-09-22T09-27-04-213Z-41308/`
- `npm run test:client`：22 个测试文件、83 个测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npx prettier --check` 与 `git diff --check`：通过。
- `npm run harness:inspect -- --change 2026-09-22-knowledge-workbench-home`：通过。
- `npm run harness:browser -- --change 2026-09-22-knowledge-workbench-home`：通过；补齐 `browser-wiki-capabilities` 的文件树 mock 后，4 个浏览器场景全部通过。
- 本轮视觉反馈：调整 `.wiki-welcome` 顶部留白，浏览器截图确认提问输入框位于主内容区域中部附近。

## 未验证项与环境限制

- 标准全量 Harness 的 `docker-smoke` 未通过：当前机器没有运行 Docker daemon，`/var/run/docker.sock` 不存在。
- Harness 浏览器日志仍有项目既有的 CSP `frame-ancestors` 警告；不影响本次页面断言。

### 2026-09-22：Harness run 2026-09-22T09-27-04-213Z-41308

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-09-22-knowledge-workbench-home/2026-09-22T09-27-04-213Z-41308
- 检查结果：unit:passed, browser-ac:passed, boundary:passed, claims:PASS

### 2026-09-22：浏览器反馈修复 Harness run 2026-09-22T09-42-44-951Z-56398

- 状态：completed
- TP：TP-002 / TP-003
- 轮次：1
- 证据目录：`.harness/runs/2026-09-22-knowledge-workbench-home/browser-1790070168994-56398/`
- 检查结果：browser-root-route:passed, browser-module-navigation:passed, browser-knowledge-home:passed, browser-wiki-capabilities:passed
- 反馈闭环：修正 `browser-wiki-capabilities` 场景的 `api/wiki/list` mock，使其与文件树收敛断言一致；未修改产品逻辑。

### 2026-09-22：首页垂直布局反馈 Harness run 2026-09-22T09-48-47-413Z-60044

- 状态：completed
- TP：TP-002
- 证据目录：`.harness/runs/2026-09-22-knowledge-workbench-home/browser-1790070534222-60044/`
- 检查结果：4 个浏览器场景全部通过；截图确认提问输入框接近主内容区域垂直中心。

### 2026-09-22：卡片视觉弱化 Harness run 2026-09-22T09-51-01-742Z-63614

- 状态：completed
- TP：TP-002
- 证据目录：`.harness/runs/2026-09-22-knowledge-workbench-home/browser-1790070675203-63614/`
- 检查结果：4 个浏览器场景全部通过；知识状态和开始工作卡片的边框、背景与阴影已降低对比度。
