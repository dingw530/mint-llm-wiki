# Wiki 搜索应用层迁移

日期：2026-10-03。基线：`853ea79`。工程重构，保留 plugin/MCP 配置、插件目录、插件变更文档与相关文档索引的未提交状态。

## 范围与职责

- `services/api/wikiSearchService.ts` → `domains/wiki/wiki-search-service.ts`，从既有 Wiki 公共 index 导出原搜索、重建、健康检查及按文档回填 API。
- `repositories/wikiSearchRepository.ts` → `infrastructure/persistence/wiki-search-repository.ts`；三个既有搜索/混合搜索/仓储测试迁入对应目录，共搬迁五个文件。
- 新增 `infrastructure/search/wiki-search-runtime.ts`，转接既有设置、vector/Embedding、rerank 和 resilience 运行时实现；不移动提供商实现，不改变调用参数、配置、超时或失败分类。
- 领域的运行上下文只要求 getJevSettings，由原 RuntimeContext 结构性满足；文件操作改用 Wiki 既有文件适配器。
- 保持 FTS/hash 幂等索引、RRF/rerank、最佳片段/页面聚合、source-family 补充、结果证据粒度、向量失败降级、生命周期过滤与访问计数更新的顺序和规则。长函数/循环/分支分解为命名函数；事务中的 statement 准备与写入顺序不变。旧 Row 断言换成类型化 prepare。

摄入队列和独立 Wiki 向量回填作业当时不在该批搬迁范围。随后向量回填应用服务迁至 `application/wiki/wiki-vector-backfill-service.ts`，通过 Wiki 公共 API 读取文档和向量能力，并通过持久化 adapter 管理回填作业状态。WikiSearchTool 的直接 lifecycle 访问仍由前批规则登记，待工具/反馈接口收敛时移除。

MCP 搜索入口只更新原搜索 API 导入路径，不改协议实现，也不修改 plugin/MCP 配置。摄入回归测试合并了两条指向同一 Wiki 公共 index 的 mock，避免后一条覆盖 registerCompiledKnowledge。

## 影响与历史

pre-edit GitNexus 服务和仓储 impact 均为 MEDIUM。现有图谱不包含所有本批新路径，且曾有异常字段/流程展开；实际依赖以 TypeScript 解析的边界检查和源码引用盘点补证。所有旧搜索服务/仓储路径引用已更新。

按“旧路径的职责提取、类型/格式准备及运行时适配 → 搬迁”两步临时候选提交核验，默认 git log --follow 找回五个来源文件的全部旧提交，缺失数为 0；真实 index、HEAD 和 refs 未修改。正式提交应保留准备和搬迁的拆分。

## 验证

- focused suite：17 个文件、85 项通过，包含关键词/混合搜索、生命周期、索引事务、摄入回归、rerank/vector 及架构边界。
- 完整 verify:source：通过。Server 1064 项通过、16 项跳过；Client 90 项通过；agent-eval 57 项通过；类型检查、工程测试、lint 和各包构建通过，Electron server bundle 通过。
- 本批格式检查与 git diff --check 通过；迁移搜索/仓储代码符合函数/循环/分支长度约束。
- 测试使用临时 Wiki/SQLite 与 provider mocks；没有向真实 Embedding/Jev/LLM 发送知识库内容，不把工程回归作为真实检索质量评估。

本批尚未提交，前批正式提交及其历史保持原样。
