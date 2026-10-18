# Electron 自动更新与版本发布设计

## 背景与约束

仓库已有 `electron-builder` 和 macOS DMG 构建。生产应用把 Client、Server 和原生依赖打包到同一 Electron 应用中。主进程在 `before-quit` 中等待本地 Server 关闭，因此安装更新必须沿用该关闭流程。

## 方案与决策

### DS-001：更新器

采用 `electron-updater`。它支持 electron-builder 的 GitHub Releases 更新清单和 macOS ZIP 更新包。开发模式默认跳过检查；打包应用启动后检查并自动下载更新。显式启用本机测试源的行为见 DS-005。

下载完成时由主进程向 Mint renderer 发送版本事件，主界面显示主题化提示，提供“现在重启”和“忽略此版本”。忽略版本写入 `localStorage`，因此应用重启后仍会隐藏该版本提示；更高版本会正常提示。关闭更新器的退出时自动安装，只有用户选择重启时才执行更新。安装前先调用现有 Server 关闭流程，再调用更新器，避免更新过程切断正在运行的本地服务。

### DS-002：发布源与流程

GitHub Releases 作为更新源。发布 tag 触发 macOS 构建工作流；流水线先检查 tag 与所有第一方 workspace 的版本号，再构建 DMG、ZIP 和更新元数据，执行产物检查并附加到 Draft Release。维护者检查后手动发布 Draft。正式 Release 发布后，已安装应用可以通过 GitHub 更新源发现该版本。

第一版沿用现有 macOS 支持范围。生成的 DMG 用于首次安装；ZIP 和 `latest-mac.yml` 供 `electron-updater` 使用。发布包需由 Apple Developer 证书签名，并通过公证；缺少签名凭据时不发布正式产物。

### DS-003：版本

根 `package.json` 是版本号权威来源。根目录和所有第一方 workspace 的 `package.json` 统一为 `0.1.0`。增加版本一致性检查，发布 tag 使用 `v0.1.0` 形式。下一次补丁版或功能版由维护者更新版本并创建匹配 tag；此次不增加自动改版本的命令，以免无意创建 tag 或提交。

### DS-004：签名门禁

正式发布工作流要求 Apple 代码签名和公证凭据。缺少任一凭据时，tag 发布任务立即失败，不会创建可供用户下载的 Draft Release。

### DS-005：开发模式本地测试源

开发源必须同时满足显式开关和 loopback URL 校验。通过 `setFeedURL` 指定 `generic` provider，并设置 `forceDevUpdateConfig`，以便 `electron-updater` 在未打包进程中运行。Updater 仍会读取 `apps/electron/dev-app-update.yml` 获取缓存目录；该文件只保存 loopback 默认值和缓存名称。测试模式保留自动下载，但关闭退出时自动安装；下载完成后通过同一 IPC 在 Mint renderer 显示更新 toast，安装按钮禁用，用户可忽略该版本。打包应用忽略这两个环境变量，仍使用 Release 内的 GitHub 配置。

### DS-006：更新阶段日志

应用日志记录 updater 是否启用、使用哪种源、何时开始检查、是否发现更新，以及哪个版本已下载。日志不输出 feed URL、凭据或频繁的下载进度事件；下载错误继续经过现有脱敏函数。

### DS-007：关于页与手动检查

设置窗口“关于”页通过 Electron IPC 读取 `app.getVersion()` 并请求手动检查。主进程仅在 GitHub 源已配置的打包应用或显式启用的 loopback 开发源中执行检查；默认开发模式返回不可检查状态。手动检查复用 `autoUpdater.checkForUpdates()`，发现更新后沿用自动下载、renderer toast 和明确安装流程。renderer 显示最新、发现更新、未启用和失败状态；检查错误只返回脱敏信息。

## 责任边界

- Electron 主进程负责检查、下载和安装更新；Mint renderer 负责显示更新提示和记录忽略版本。
- Electron 主进程提供当前版本和手动检查 IPC；设置“关于”页负责展示版本与检查结果。
- 现有 Server 生命周期负责优雅关闭本地服务。
- GitHub Actions 负责版本校验、macOS 构建、安装包检查和 Draft Release 产物上传。
- GitHub Release 的发布动作由维护者完成。

## 影响与风险

- macOS 更新依赖代码签名保持一致；更换签名身份会导致现有安装无法接受更新。
- 自动下载会消耗带宽和磁盘空间。下载失败时应保持当前版本可用。
- 更新源不可达不应阻止应用启动。
- GitHub 仓库若为私有仓库，终端用户无法在没有安全认证方案的情况下访问 Release；需确认仓库可见性。
- GitNexus 对 Electron 主进程生命周期返回 CRITICAL 风险，关联 30+ 执行流程。实现只在 Electron 入口接入独立 updater 控制器，并保留现有 Server shutdown。

## 验收证据矩阵

| AC     | 设计点                           | Probe                                     | 最低证据        |
| ------ | -------------------------------- | ----------------------------------------- | --------------- |
| AC-001 | 根版本和 workspace 版本检查      | 版本一致性脚本及正反例                    | 自动化检查      |
| AC-002 | packaged-only 更新检查、后台下载 | Updater 测试和 Electron 进程冒烟          | 单元 + 进程级   |
| AC-003 | 主界面提示、忽略版本、明确安装与 Server 关闭顺序 | renderer 提示、IPC 生命周期检查 | UI + 集成 + 进程级 |
| AC-004 | 错误保持应用可用、日志脱敏       | 错误路径和日志断言                        | 单元            |
| AC-005 | macOS 发布产物和 Draft Release   | Electron artifact 检查、workflow 静态测试 | 构建产物 + 静态 |
| AC-006 | 签名凭据门禁                     | Workflow 配置检查                         | 静态 + CI       |
| AC-009 | 关于页版本信息与手动更新检查     | 设置浏览器场景和 Updater IPC 检查          | 浏览器 + 单元   |

## 桌面验收说明

更新提示显示在 Mint renderer。Electron preload 暴露下载事件和明确安装动作；Harness 外部浏览器不包含 Electron preload，因此需要 Electron 冒烟检查提示与 IPC 行为。真实签名、公证和 GitHub Release 更新需要 CI Secrets 和真实发布源，本次代码验证不能替代该外部验收。

## 开发模式本地源验证

先构建一个版本号高于开发应用的测试包，再通过只监听 `127.0.0.1` 的静态文件服务提供 `latest-mac.yml` 与 ZIP：

```sh
npm run electron:build:mac -- --config.extraMetadata.version=0.1.1 --config.directories.output=release/dev-update
python3 -m http.server 4173 --bind 127.0.0.1 --directory apps/electron/release/dev-update
MINT_ENABLE_LOCAL_UPDATE_TESTS=1 MINT_LOCAL_UPDATE_URL=http://127.0.0.1:4173/ npm run electron:dev
```

第二条命令会持续运行；在另一个终端执行第三条。开发应用应从本机源发现并下载 `0.1.1`，然后显示 Mint 更新 toast，标注“本地测试更新已下载”；主操作显示“仅测试提示”并禁用。测试模式不会调用 `quitAndInstall`，也不会关闭 Server；关闭环境变量后，开发应用不检查更新。

## 追溯矩阵

| AC                     | 设计           | Probe                                         |
| ---------------------- | -------------- | --------------------------------------------- |
| AC-001                 | DS-003         | 版本一致性与 tag 检查                         |
| AC-002、AC-003、AC-004 | DS-001         | Updater 单元/生命周期测试与 Electron smoke    |
| AC-005                 | DS-002、DS-003 | macOS artifact 与 release workflow 静态测试   |
| AC-006                 | DS-004         | 签名 Secrets 门禁静态测试                     |
| AC-007                 | DS-005         | 开发模式开关、loopback URL 校验和下载提示单测 |
| AC-008                 | DS-006         | 更新阶段事件日志与脱敏断言                    |
