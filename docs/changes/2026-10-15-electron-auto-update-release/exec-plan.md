# Electron 自动更新与版本发布执行计划

## 完成定义

- 第一方项目版本统一为 `0.1.0`，并有 tag/版本一致性检查。
- 打包 macOS 应用可自动检查和下载更新；用户可在 Mint 界面选择安装或忽略当前版本。
- 下载完成后 Mint 主界面显示提示；用户可安装或忽略该版本，忽略状态跨重启保留。
- 更新安装服从现有本地 Server 关闭生命周期。
- 开发者可用显式环境开关和 loopback HTTP 更新源测试检查/下载；开发模式不安装更新。
- GitHub Actions 可从版本 tag 构建并检查 macOS DMG、ZIP 和更新元数据，将它们上传到 Draft Release。
- 更新逻辑失败时应用仍能启动和继续使用。
- 设置“关于”页显示应用版本，并可手动检查当前已启用的更新源。

## 前置条件

- Node.js 20.19.4。
- GitHub Actions Release 流程使用 `contents: write` 权限。
- 正式发布前配置 Apple 代码签名和公证 Secrets；具体 Secret 名称由 CI 实现确定。
- 当前 GitHub 仓库应允许目标用户读取 Release。

## Task Plans

### TP-001：版本统一与发布门禁

- 状态：已完成
- 产出：第一方 workspace 版本号、版本一致性验证脚本及 npm 命令。
- Probe：`node scripts/check-release-version.mjs --tag v0.1.0`；`node --test scripts/check-release-version.test.mjs`。
- 完成标准：AC-001 PASS。
- 执行记录：2026-10-15 完成；根项目和所有第一方 workspace 已统一为 `0.1.0`，内部 `agent-eval → mint-server` 依赖范围已同步。版本校验脚本接受匹配 tag 并拒绝版本漂移；相关 node:test 通过。

### TP-002：Electron 自动更新运行时

- 状态：已完成
- 产出：`electron-updater` 配置、主进程更新生命周期、错误日志与测试。
- Probe：development/packaged 分支、无更新、可用更新、下载完成、下载失败、更新失败、明确安装和忽略版本。
- 完成标准：AC-002、AC-003、AC-004 PASS。
- 执行记录：2026-10-15 完成；已加入 `electron-updater`、packaged-only 检查、下载完成提示、立即安装/稍后安装分支及日志脱敏。10 项定向测试通过；macOS 包含 updater 和 `app-update.yml` 的检查通过；Electron Server 启停进程冒烟通过。签名因本机无 Apple Developer Identity 被跳过。

### TP-003：macOS 发布产物和 GitHub Release 流水线

- 状态：已完成
- 产出：DMG+ZIP 构建配置、tag 发布工作流、产物校验与 Draft Release 上传。
- Probe：本地或 CI macOS artifact 验证；workflow 对版本不匹配和签名 Secrets 缺失的拒绝路径。
- 完成标准：AC-005、AC-006 PASS；真实签名、公证与发布链路未配置时标为外部未验证。
- 执行记录：2026-10-15 完成；macOS target 增加 DMG+ZIP，配置 GitHub Draft Release。新增 tag-triggered workflow，先校验版本，再要求 Apple 签名/公证 Secrets，最后构建并上传 Draft Release。静态工作流测试通过；真实 GitHub 发布未执行。

### TP-004：Harness 验证与证据回写

- 状态：已完成
- 产出：验证计划、桌面浏览器场景适用性说明、Harness 运行证据和文档追溯更新。
- Probe：相关单测、Electron 进程冒烟、Electron macOS artifact 检查、版本脚本、Harness inspect/verify。
- 完成标准：8 条 AC 按所需证据评级；真实发布项使用外部配置作为前置条件。
- 执行记录：2026-10-18 完成；Harness verify 的 8 条 AC 全部 PASS。最终运行记录：`.harness/runs/2026-10-15-electron-auto-update-release/2026-10-18T10-13-56-058Z-75575/`。签名/公证凭据和真实 GitHub Release 未配置，因此没有执行真实发布。

### TP-005：开发模式本地更新源

- 状态：已完成
- 产出：显式环境开关、loopback URL 校验、仅下载的开发更新流程、Updater 配置文件和事件日志。
- 产出：更新检查、版本可用和下载完成日志；不记录完整更新源地址。
- Probe：默认关闭、合法本机 URL、拒绝远端 URL、下载完成不安装。
- 完成标准：AC-007、AC-008 PASS。

### TP-006：Mint 主界面更新提示与版本忽略

- 状态：进行中
- 产出：正式更新和本地测试源共用 Mint renderer toast；按来源和版本忽略提示。
- Probe：更新提示浏览器场景、Updater 生命周期检查。
- 完成标准：AC-003、AC-007 PASS。
- 执行记录：2026-10-18：功能已实现，目标场景和生命周期检查尚未运行。

### TP-007：关于页与手动检查更新

- 状态：进行中
- 产出：设置“关于”页、当前版本展示、受已启用更新源约束的手动检查 IPC 和状态提示。
- Probe：关于页浏览器场景；Updater IPC 检查返回 disabled、current、available、error 状态。
- 完成标准：AC-009 PASS。
- 执行记录：2026-10-18：关于页与手动检查 IPC 已实现，Client typecheck、Prettier、JS 语法和 diff 检查通过；Updater 单测与浏览器场景尚未运行。
- 执行记录：2026-10-18 完成；修复 `electron-updater` 下载时读取 `dev-app-update.yml` 导致的 ENOENT，并捕获自动下载的独立 Promise rejection；新增 updater 禁用/检查/有更新/无更新/下载完成日志。12 项 updater 测试通过，AC-007/AC-008 和 Harness 8 条 AC 全部 PASS。未记录完整 feed URL。

## 风险与依赖

- GitNexus 对 Electron 主进程生命周期返回 CRITICAL 风险，关联 30+ 执行流程；改动范围仅限 Electron 启动/退出钩子，Server 业务实现保持不变。
- Apple 签名和公证 Secrets、GitHub 仓库可见性尚未确认；代码和工作流可完成，但真实端到端发布可能需外部配置。
- 自动更新依赖在线 GitHub Release 和有效签名；离线、HTTP 错误和签名失败路径必须不影响已安装版本运行。

## 验证方式

- `node scripts/check-release-version.mjs --tag v0.1.0`
- `node scripts/check-release-version.mjs --tag v0.2.0`（期望拒绝）
- Electron updater 与版本脚本单测。
- `node scripts/electron-lifecycle-smoke.mjs`。
- `npm run verify:electron-artifact:mac`（仅 macOS）。
- `npm run harness:inspect -- --change 2026-10-15-electron-auto-update-release`
- `npm run harness:verify -- --change 2026-10-15-electron-auto-update-release --checks '<task-specific checks>'`

## 执行备注

- GitNexus CLI 1.6.12；仓库 `mint-ai-chat`，分支 `develop`，索引刷新至当前提交 `3470643`。Electron 主进程符号影响为 CRITICAL；风险来自其与 Server 生命周期和多个进程流的关联。实现只在 Electron 入口接入独立 updater 控制器，并保留现有 Server shutdown。

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
