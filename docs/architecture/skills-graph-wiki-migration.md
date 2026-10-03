# Skills、知识图谱、Wiki 管理与生命周期迁移

日期：2026-10-03。基线：`b2ac34e`，保留 infrastructure 命名、Agents、Conversations 等既有未提交改动及 Codex plugin/MCP 内容。工程重构，不改变 HTTP/IPC/SSE、schema、产品规格或调用提供商。

## 三批范围

| 批次                | 领域职责                                                                                   | 基础设施/装配                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Skills              | frontmatter、目录项解析后的业务投影、查询、缓存与清空                                      | 目录配置、扫描、stat 与文件读取由 `filesystem/skills-directory.ts` 提供                   |
| 知识图谱            | CRUD、候选列表/接受/拒绝、重复审核与语义边校验                                             | `graph-repository.ts`、`graph-candidate-repository.ts`，保留原事务边界                    |
| Wiki 管理与生命周期 | 文件目录/读取/Schema/分类管理、热度、保留分、页面/Claim 状态转换、编译知识注册及旧页面回填 | Wiki filesystem/settings 适配器、`wiki-lifecycle-repository.ts`、bootstrap 的六小时定时器 |

搬迁 17 个服务、仓储、纯保留分函数及既有测试文件；新文件一律 kebab-case。外部消费者统一使用领域公共入口；编译输出、Electron namespace、HTTP 端点、CLI、工具和启动 mocks 的路径同步更新。

Skills 的缺失目录、单文件/目录型 Skill、stat/read 异常隔离、扫描顺序、缓存和清空语义不变。Wiki 文件名规范化、词法路径边界、Schema 写回/分类错误、页面版本与 Claim 强化/冲突/过期规则不变。长循环拆为命名函数；知识注册仍由同一个外层 SQLite 事务包裹，不新增事务或改变事件顺序。SQL 读查询改用类型化 prepare；断言移除和非空写后查询仅影响类型，不新增运行时分支。

Wiki 生命周期定时器移至 `bootstrap/wiki-lifecycle.ts`，原六小时默认值、unref、异常日志和 ServerRuntime 清理职责保持不变。领域 import 不启动调度。

## 过渡边界

不迁移 Wiki 搜索、摄入队列、编译、向量作业、跨批 LLM 关系生成或 Agent Runtime。为避免本批扩大到这些高耦合链路，架构规则仅登记以下直接仓储访问桥接：

- graphBuilder、crossBatchSemanticService → graph repository。
- crossBatchSemanticService → candidate repository。
- wikiSearchService、WikiSearchTool → Wiki lifecycle repository。

迁移对应模块时移除这些例外。共享 Wiki 编译输出类型保持 type-only；现有 parser/schema normalization 暂由 Wiki filesystem adapter 转接。`knowledge-domains-boundary.ts` 检查解析后的 imports、re-exports 和 literal dynamic imports，拒绝未经登记的跨域内部依赖、仓储访问和基础设施反向运行时依赖。

## 验证与风险

- pre-edit GitNexus：图谱服务 HIGH，Wiki 管理与若干仓储 CRITICAL。实际引用按当前源码补证；旧图谱有异常字段及采样限制，不作为完整执行流证明。
- 首轮 focused：21 个文件、127 项通过。
- 完整 verify:source：Server 1064 项通过、16 项跳过，Client 90 项通过，agent-eval 57 项通过；类型检查、工程测试、lint 和各包构建通过。
- 另加 4 项候选审核应用测试，通过真实 SQLite 验证接受、重复审核、无效关系、拒绝及审核写入失败后的事务回滚；与知识生命周期/回填 focused 共 8 项通过。
- Electron server bundle、全部本批修改文件 Prettier check、git diff --check 通过。新迁移领域/基础设施/装配函数无超过 120 行的函数；未迁移的外部模块仅更新路径，原长函数留待其各自职责拆分。
- CLI chat/REPL 的隔离临时数据库 smoke 通过：每次注入一条选中记忆，重启后访问计数与用户消息数均为 2，真实模型调用为 0。
- 未执行真实模型、浏览器、Electron 启动或独立 MCP 启动验收。

## 历史与交付

使用临时 Git index/object directory 按“先在旧路径职责提取、类型/格式整理并补兼容装配 → 再搬迁”构造两步候选提交。默认 git log --follow 能找回 17/17 源文件的全部旧提交，缺失数为 0；真实 index、HEAD 和 refs 未改变。正式提交时应保留准备与搬迁的拆分，避免把职责提取、格式化和路径变化合并后降低 rename detection 相似度。候选对象只验证历史；准备提交需保持旧 API 与调度出口兼容，并正常通过提交 Hook。

本批已按职责准备与路径迁移拆分提交。没有改写既有提交，也没有暂存/提交 plugin、MCP 配置及相关文档索引。

## 正式提交交付（2026-10-03）

已按准备、命名与领域边界拆分提交；所有正常提交 Hook 通过，未使用 no-verify。真实提交链中 40 个搬迁来源文件的默认 git log --follow 核验通过，旧提交缺失数为 0。代码工作区与最终验收快照逐文件一致。

- `e4b1f75`：refactor(server): prepare service and storage domain boundaries
- `03e07b8`：refactor(server): use kebab-case infrastructure filenames
- `0867f2c`：refactor(server): migrate agent and conversation management domains
- `e56bf1b`：refactor(knowledge): migrate skills graph and Wiki lifecycle domains

Codex plugin/MCP 的配置、插件目录、插件变更文档及相关索引条目保留未提交；没有推送。
