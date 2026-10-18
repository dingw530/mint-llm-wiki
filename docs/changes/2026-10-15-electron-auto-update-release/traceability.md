# 追溯总览：Electron 自动更新与版本发布

## 状态

- 变更状态：进行中
- 开始日期：2026-10-15

## 追溯矩阵

| 需求   | 功能/规则                                      | 验收                   | 设计                   | 任务           | 状态   |
| ------ | ---------------------------------------------- | ---------------------- | ---------------------- | -------------- | ------ |
| US-002 | FP-001、FP-005、FP-006、BR-001                 | AC-001、AC-005、AC-006 | DS-002、DS-003、DS-004 | TP-001、TP-003 | 已完成 |
| US-001 | FP-002、FP-003、FP-004、BR-002、BR-003、BR-004 | AC-002、AC-003、AC-004 | DS-001                 | TP-002、TP-006 | 进行中 |
| US-003 | FP-007、FP-008、BR-005                         | AC-007、AC-008         | DS-005、DS-006         | TP-005、TP-006 | 进行中 |
| US-004 | FP-009                                        | AC-009                 | DS-007                 | TP-007         | 进行中 |

## TP 执行状态

| TP     | 状态   | 产出                                   | 执行记录                                                                                                                                         |
| ------ | ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| TP-001 | 已完成 | 版本统一与发布门禁                     | 2026-10-15：第一方 workspace 版本统一为 0.1.0；匹配/不匹配 tag 与版本漂移测试通过。                                                              |
| TP-002 | 已完成 | Electron 自动更新运行时                | 2026-10-15：10 项定向测试、macOS artifact 和 Electron 生命周期进程冒烟通过；本地代码签名跳过。                                                   |
| TP-003 | 已完成 | macOS 发布产物和 GitHub Release 流水线 | 2026-10-15：DMG/ZIP、GitHub Draft Release、版本与签名门禁完成；静态测试通过，真实发布未运行。                                                    |
| TP-004 | 已完成 | Harness 验证和证据回写                 | 2026-10-18：Harness verify 8 条 AC 全部 PASS；证据目录 `.harness/runs/2026-10-15-electron-auto-update-release/2026-10-18T10-13-56-058Z-75575/`。 |
| TP-005 | 已完成 | 开发模式本地更新源                     | 2026-10-18：修复 dev config ENOENT 和下载拒绝；12 项 updater 测试通过，AC-007/AC-008 PASS。                                                      |
| TP-006 | 进行中 | Mint 主界面更新提示与版本忽略 | 2026-10-18：发布版和开发本地源共用 renderer toast；开发模式禁用安装操作，忽略版本按来源隔离；待执行目标验证。 |
| TP-007 | 进行中 | 设置“关于”页与手动检查更新 | 2026-10-18：版本展示和手动检查入口已实现；Client typecheck、格式、JS 语法和 diff 检查通过；Updater 单测与浏览器场景尚未运行。 |

## 偏差表

| 日期       | 类型     | TP     | 文件                                                                         | 原因                                                                             | 影响                                   | 后续动作                       |
| ---------- | -------- | ------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------ |
| 2026-10-18 | 行为修正 | TP-005 | `apps/electron/dev-app-update.yml`、`apps/electron/services/auto-updater.js` | 下载阶段读取开发配置中的缓存目录；缺文件触发 ENOENT，自动下载 Promise 也未被捕获 | 本机测试源无法完成下载并产生未处理拒绝 | 补 loopback 配置并捕获下载拒绝 |

## 交接

- 当前进度：TP-001 至 TP-005 已完成；TP-006 和 TP-007 进行中。
- 下一步：检查关于页状态、手动检查 IPC 和更新提示场景，并回写证据。
- 已知风险：签名 Secrets 和 GitHub Release 公开可见性待部署环境提供；GitNexus impact 命令本轮超时，已有 Electron 生命周期 CRITICAL 风险记录，改动限定在更新 IPC 与通知界面。

### 2026-10-15：Harness run 2026-10-15T07-17-55-902Z-266

- 状态：failed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-15-electron-auto-update-release/2026-10-15T07-17-55-902Z-266
- 检查结果：release-version-check:passed, updater-unit:passed, updater-lifecycle:passed, electron-smoke:passed, electron-artifact:passed, release-workflow-static:passed, claims:UNVERIFIED

### 2026-10-15：Harness run 2026-10-15T07-21-18-742Z-3363

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-15-electron-auto-update-release/2026-10-15T07-21-18-742Z-3363
- 检查结果：release-version-check:passed, updater-unit:passed, updater-lifecycle:passed, electron-smoke:passed, electron-artifact:passed, release-workflow-static:passed, claims:PASS

### 2026-10-15：Harness run 2026-10-15T07-26-08-210Z-7417

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-15-electron-auto-update-release/2026-10-15T07-26-08-210Z-7417
- 检查结果：release-version-check:passed, updater-unit:passed, updater-lifecycle:passed, electron-smoke:passed, electron-artifact:passed, release-workflow-static:passed, claims:PASS

### 2026-10-15：Harness run 2026-10-15T07-30-00-611Z-10754

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-15-electron-auto-update-release/2026-10-15T07-30-00-611Z-10754
- 检查结果：release-version-check:passed, updater-unit:passed, updater-lifecycle:passed, electron-smoke:passed, electron-artifact:passed, release-workflow-static:passed, claims:PASS

### 2026-10-15：Harness run 2026-10-15T08-05-28-998Z-23688

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-15-electron-auto-update-release/2026-10-15T08-05-28-998Z-23688
- 检查结果：release-version-check:passed, updater-unit:passed, updater-lifecycle:passed, dev-update-source:passed, electron-smoke:passed, electron-artifact:passed, release-workflow-static:passed, claims:PASS

### 2026-10-18：Harness run 2026-10-18T10-08-57-644Z-69453

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-15-electron-auto-update-release/2026-10-18T10-08-57-644Z-69453
- 检查结果：release-version-check:passed, updater-unit:passed, updater-lifecycle:passed, dev-update-source:passed, updater-event-logs:passed, electron-smoke:passed, electron-artifact:passed, release-workflow-static:passed, claims:PASS

### 2026-10-18：Harness run 2026-10-18T10-13-56-058Z-75575

- 状态：completed
- TP：未指定
- 轮次：1
- 证据目录：.harness/runs/2026-10-15-electron-auto-update-release/2026-10-18T10-13-56-058Z-75575
- 检查结果：release-version-check:passed, updater-unit:passed, updater-lifecycle:passed, dev-update-source:passed, updater-event-logs:passed, electron-smoke:passed, electron-artifact:passed, release-workflow-static:passed, claims:PASS
