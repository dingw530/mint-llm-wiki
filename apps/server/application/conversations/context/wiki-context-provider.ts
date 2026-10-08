import type { ContextProvider } from './context-provider.js';

const WIKI_PROVIDER_ORDER = 100;

/** Build the existing Wiki access, cleanup, efficiency, and citation instruction block. */
function buildWikiInstructions(wikiPath: string): string {
  return [
    `⚠️ Wiki 知识库使用规则（必须遵守）：知识库根目录: ${wikiPath}`,
    '',
    '【访问与清理规则】',
    '- 严禁使用 bash 工具读取、搜索或列出 Wiki 目录下的任何文件。bash 的读文件操作（cat/ls/grep/cd 等）已被系统拦截，执行会直接报错。',
    '- 不要尝试 cd 到 Wiki 目录，不要用 cat 打开 .md 文件，不要用 grep 搜索关键词。所有 Wiki 文件访问必须使用 wiki_search 工具。',
    '- 处理 wiki lint 时，如果 lint 已明确确认某个知识库文件需要清理，可以使用 bash 删除该文件；仅限 Wiki 根目录内、已确认的目标文件，不得删除其他路径或整个知识库目录。',
    '',
    '【wiki_search 工具使用指南】',
    '- question 模式返回与 chunkId 对齐的章节证据；paths 模式返回 page 粒度的完整文件。引用时必须遵守返回结果中的 granularity。',
    '- 支持两种模式：',
    '  · question 模式：输入关键词搜索，返回匹配度最高的章节 chunk 证据',
    '  · paths 模式：直接传入文件路径列表，批量读取多个文件的完整内容',
    '- 已知文件路径时，始终用 paths 模式一次读完，paths 接受任意数量的路径。',
    '- 每轮最多发起一次 wiki_search；如需覆盖多个关键词，请合并到一次 question 查询中。',
    '',
    '【知识库结构】',
    '- Wiki 根目录下的 _index.md 是首页，包含分类索引和最近更新，建议先读取了解整体结构。',
    '- Wiki 根目录下分 pages/（结构化页面）、sources/（原始材料）等子目录。',
    '- pages/ 下的文件是正式知识页面，按领域/主题组织子目录。',
    '- sources/ 下的文件是原始材料（直播转录、笔记等）。',
    '- 文件名格式通常为 "主题-子主题.md"，如 pages/AI实践/LLM-Wiki-系统架构与编译流水线.md。',
    '- 第一次搜索获取到文件路径后，后续直接使用 paths 模式读取即可，无需再次搜索。',
    '',
    '【效率建议】',
    '- 一次 search 返回的结果通常已包含足够信息，避免反复换关键词搜索。',
    '- 如需查阅多个页面，优先使用一次 paths 批量读取，减少工具调用轮次。',
    '- 对知识库不熟悉时，先读取 _index.md 了解整体结构，再决定要查阅哪些页面。',
    '',
    '【Chat 知识链接协议】',
    '- 在最终回答中引用正式 Wiki 页面时，必须使用 Markdown 链接：`[页面标题](mint-wiki://open?path=<URL编码后的相对路径>)`。',
    '- path 必须是 Wiki 根目录下的相对路径（优先使用 pages/ 下的正式页面），例如 `pages/AI实践/LLM-Wiki.md`。',
    '- 不要输出 Wiki 磁盘绝对路径、file:// 链接或普通文件路径作为可点击引用。',
    '- wiki_search 原始工具结果提供 chunkId 和 granularity；聊天编排层会在发给你的工具结果中追加本轮引用 refId（如 C1）。',
    '- 只有工具结果中实际出现的 refId 才可以使用；引用对应事实时，将 [C1] 放在完整句子的句末标点之后。',
    '- [C1] 不得插入句子、短语、括号或分号中间；不要写成“这是 [C1] 一个例子”，应写成“这是一个例子。[C1]”。',
    '- 一段包含多个来源时，将各标记放在各自完整句子的末尾，例如“第一项结论。[C1] 第二项结论。[C2]”。',
    '- [C1] 等标记会作为轻量引用保留在回答正文中；不要解释标记含义，也不要删除或改写标记。',
    '- 问题要求“哪些、分别、包含哪些要素”时，先枚举完整要点，再解释原因或关系；不要用一句泛化概括替代多个要求。',
    '- 如果回答涉及多个独立结论，优先让每个要点都对应检索到的证据；证据不足时明确限定，不要用常识补齐。',
  ].join('\n');
}

/** Create the Wiki instruction source for a configured knowledge base. */
export function createWikiContextProvider(): ContextProvider {
  return {
    id: 'wiki-instructions',
    order: WIKI_PROVIDER_ORDER,
    provide: ({ settings }) =>
      settings.wikiPath
        ? {
            id: 'wiki-instructions',
            placement: 'system',
            content: buildWikiInstructions(settings.wikiPath),
          }
        : undefined,
  };
}
