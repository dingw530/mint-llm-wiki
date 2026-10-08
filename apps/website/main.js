const translations = {
  zh: {
    siteTitle: 'Mint Docs — LLM Wiki',
    headerStatus: '开源知识工作台',
    github: 'GitHub ↗',
    sidebarIntro: '把知识编译成上下文，再带进真实工作。',
    sidebarFooter: '持续补充中',
    navStart: '开始',
    navOverview: '概览',
    navDemo: '本地演示',
    navQuickStart: '快速开始',
    navConcepts: '概念',
    navWhat: 'Mint 是什么',
    navArchitecture: '架构分工',
    navLifecycle: '上下文生命周期',
    navGuides: '指南',
    navInterface: '界面对应',
    navSignals: '知识信号',
    breadcrumbOverview: '概览',
    pageTitle: 'Mint 文档',
    pageLede:
      'Mint 是一个以 LLM Wiki 为知识核心、以 Chat 为交互入口、以 Agent 和 Tools 为执行出口的开源 AI 工作台。',
    docMetaOne: '阅读时间 · 5 分钟',
    docMetaTwo: '范围 · 产品与架构',
    demoKicker: 'LOCAL DEMO / 03:00',
    demoTitle: '看 Mint 如何把知识带进工作',
    demoBody:
      '从本地资料开始，经过 Wiki、检索和 Agent，最后回到一个可追溯的回答。视频中的每一步都对应当前应用里的真实界面。',
    demoBadge: 'OFFLINE FIRST',
    demoCaption: '本地演示：导入资料、检索知识、生成带引用的回答。',
    videoFallback: '你的浏览器不支持视频播放，请直接下载演示视频。',
    whatTitle: 'Mint 要解决什么问题？',
    whatBody:
      '普通聊天可以回答一次问题，却很难持续记住项目背景、知识来源和已经做过的决定。Mint 把这些内容放进一个可编译、可检索、可追溯的知识层，再让对话和 Agent 使用同一份上下文。',
    principleLabel: '核心判断',
    principleBody:
      '如果上下文不能被留下、定位和继续使用，AI 的每次回答都可能只是一次性的文本生成。',
    quickTitle: '从一个真实问题开始',
    quickBody:
      '不需要先理解所有模块。准备一份正在使用的项目资料，然后用一个具体问题走完下面的路径。',
    quickStepOneTitle: '放入资料',
    quickStepOneBody: '导入 Wiki 页面、README、设计文档或会议记录，保留来源。',
    quickStepTwoTitle: '检查知识状态',
    quickStepTwoBody: '查看页面、关系和知识热度，先知道哪些内容已经可用。',
    quickStepThreeTitle: '在 Chat 中追问',
    quickStepThreeBody: '围绕一个问题逐步追问，并回到来源核对上下文。',
    quickStepFourTitle: '交给执行层',
    quickStepFourBody: '需要行动时，再让 Agent 或 Tools 带着上下文完成下一步。',
    architectureTitle: '组件如何分工',
    architectureBody: 'Mint 不是把所有能力塞进一个聊天框。每一层有明确职责，也有明确的产出。',
    tableLayer: '层',
    tableResponsibility: '负责什么',
    tableOutput: '产出什么',
    wikiResponsibility: '积累、组织和编译知识',
    wikiOutput: '可检索的页面、关系和来源',
    contextResponsibility: '把相关内容带入当前任务',
    contextOutput: '有边界的上下文',
    chatResponsibility: '提供最低摩擦的交互入口',
    chatOutput: '问题、追问和回答',
    agentResponsibility: '根据上下文推进任务',
    agentOutput: '动作、结果和可回看的过程',
    lifecycleTitle: '上下文生命周期',
    lifecycleBody:
      '同一份知识会经历从来源到执行的几次转换。理解这条链，可以判断问题出在“没有资料”“没有检索到”，还是“没有执行”。',
    pipelineOne: 'Sources',
    pipelineOneBody: '原始页面与文件',
    pipelineTwo: 'Wiki',
    pipelineTwoBody: '结构与关系',
    pipelineThree: 'Context',
    pipelineThreeBody: '当前任务需要的片段',
    pipelineFour: 'Action',
    pipelineFourBody: '对话、工具与 Agent',
    interfaceTitle: '这些概念在界面里对应什么？',
    interfaceBody:
      '左侧是进入不同工作面的导航，中间是当前任务，知识库页面则提供来源、关系和生命周期信号。下面是当前实现中的真实界面。',
    figureCaption: '知识热度页面：从访问反馈中识别值得继续维护的知识。',
    signalsTitle: '知识信号是什么？',
    signalsBody:
      '知识库不应该只是文件列表。访问、召回和关系可以成为反馈信号，帮助判断哪些页面正在被使用、哪些内容需要更新，以及下一次检索应该优先看到什么。',
    signalUseTitle: '被谁使用',
    signalUseBody: '访问和召回反馈。',
    signalCareTitle: '哪里需要维护',
    signalCareBody: '过期、孤立或低热度页面。',
    signalNextTitle: '下一步看什么',
    signalNextBody: '关系和检索优先级。',
    footerNote: '这是一份随实现持续更新的文档。',
    footerLink: '在 GitHub 查看源码 ↗',
    tocLabel: '本页目录',
    tocWhat: 'Mint 要解决什么问题？',
    tocDemo: '本地演示',
    tocQuick: '从一个真实问题开始',
    tocArchitecture: '组件如何分工',
    tocLifecycle: '上下文生命周期',
    tocInterface: '界面对应',
    tocSignals: '知识信号',
    tocRelated: '相关入口',
  },
  en: {
    siteTitle: 'Mint Docs — LLM Wiki',
    headerStatus: 'Open knowledge workspace',
    github: 'GitHub ↗',
    sidebarIntro: 'Compile knowledge into context, then carry it into real work.',
    sidebarFooter: 'Continuously updated',
    navStart: 'START',
    navOverview: 'Overview',
    navDemo: 'Local demo',
    navQuickStart: 'Quick start',
    navConcepts: 'CONCEPTS',
    navWhat: 'What is Mint?',
    navArchitecture: 'Architecture',
    navLifecycle: 'Context lifecycle',
    navGuides: 'GUIDES',
    navInterface: 'The interface',
    navSignals: 'Knowledge signals',
    breadcrumbOverview: 'Overview',
    pageTitle: 'Mint documentation',
    pageLede:
      'Mint is an open AI workspace with an LLM Wiki as its knowledge core, Chat as its interaction surface, and Agents and Tools as its execution layer.',
    docMetaOne: 'Read · 5 min',
    docMetaTwo: 'Scope · product and architecture',
    demoKicker: 'LOCAL DEMO / 03:00',
    demoTitle: 'See how Mint carries knowledge into work',
    demoBody:
      'Start with a local source, move through Wiki, retrieval, and the Agent, then return to an answer you can trace. Every step in the video maps to a real screen in the app.',
    demoBadge: 'OFFLINE FIRST',
    demoCaption: 'Local demo: import a source, retrieve knowledge, and answer with citations.',
    videoFallback: 'Your browser does not support video playback. Download the demo video instead.',
    whatTitle: 'What problem does Mint solve?',
    whatBody:
      'A chat can answer one question, but it rarely keeps the project background, source material, and decisions that make the next question useful. Mint puts those things into a compilable, searchable, traceable knowledge layer, then lets conversations and Agents use the same context.',
    principleLabel: 'THE PRINCIPLE',
    principleBody:
      'If context cannot be kept, located, and reused, every AI answer risks becoming a one-off piece of generated text.',
    quickTitle: 'Start with a real question',
    quickBody:
      'You do not need to understand every module first. Bring one project source you already use, then walk through this path with a concrete question.',
    quickStepOneTitle: 'Bring in the source',
    quickStepOneBody:
      'Import Wiki pages, README files, design docs, or meeting notes while keeping their origin.',
    quickStepTwoTitle: 'Check the knowledge state',
    quickStepTwoBody:
      'Look at pages, relationships, and usage signals to see what is ready to use.',
    quickStepThreeTitle: 'Ask in Chat',
    quickStepThreeBody:
      'Follow one question through a conversation, then return to the source to check the context.',
    quickStepFourTitle: 'Hand it to execution',
    quickStepFourBody:
      'When an action is needed, let an Agent or Tool move the next step forward with context in hand.',
    architectureTitle: 'How the components divide the work',
    architectureBody:
      'Mint does not put every capability inside one chat box. Each layer has a clear responsibility and a clear output.',
    tableLayer: 'Layer',
    tableResponsibility: 'Responsibility',
    tableOutput: 'Output',
    wikiResponsibility: 'Accumulate, organize, and compile knowledge',
    wikiOutput: 'Searchable pages, relationships, and sources',
    contextResponsibility: 'Bring relevant material into the current task',
    contextOutput: 'Bounded context',
    chatResponsibility: 'Provide the lowest-friction interaction surface',
    chatOutput: 'Questions, follow-ups, and answers',
    agentResponsibility: 'Move the task forward with context',
    agentOutput: 'Actions, results, and a reviewable process',
    lifecycleTitle: 'The context lifecycle',
    lifecycleBody:
      'The same piece of knowledge changes form as it moves from source to execution. This chain helps locate whether a problem is missing material, missing retrieval, or missing action.',
    pipelineOne: 'Sources',
    pipelineOneBody: 'Original pages and files',
    pipelineTwo: 'Wiki',
    pipelineTwoBody: 'Structure and relationships',
    pipelineThree: 'Context',
    pipelineThreeBody: 'The pieces needed now',
    pipelineFour: 'Action',
    pipelineFourBody: 'Chat, Tools, and Agents',
    interfaceTitle: 'Where do these concepts appear in the interface?',
    interfaceBody:
      'The left side leads into different work surfaces, the center holds the current task, and the knowledge pages expose source, relationship, and lifecycle signals. This is a real screen from the current implementation.',
    figureCaption: 'Knowledge heat: use access feedback to find the knowledge worth maintaining.',
    signalsTitle: 'What are knowledge signals?',
    signalsBody:
      'A knowledge base should be more than a file list. Access, recall, and relationships can become feedback signals that show what is being used, what needs care, and what retrieval should surface next.',
    signalUseTitle: 'What is used',
    signalUseBody: 'Access and recall feedback.',
    signalCareTitle: 'What needs care',
    signalCareBody: 'Stale, isolated, or low-signal pages.',
    signalNextTitle: 'What comes next',
    signalNextBody: 'Relationships and retrieval priority.',
    footerNote: 'This documentation evolves with the implementation.',
    footerLink: 'View the source on GitHub ↗',
    tocLabel: 'ON THIS PAGE',
    tocWhat: 'What problem does Mint solve?',
    tocDemo: 'Local demo',
    tocQuick: 'Start with a real question',
    tocArchitecture: 'How the components divide the work',
    tocLifecycle: 'The context lifecycle',
    tocInterface: 'The interface',
    tocSignals: 'Knowledge signals',
    tocRelated: 'RELATED',
  },
};

const toggle = document.querySelector('.language-toggle');

function setLanguage(language) {
  const copy = translations[language];
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.body.classList.toggle('is-english', language === 'en');
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const value = copy[element.dataset.i18n];
    if (value) element.innerHTML = value;
  });
  document.title = copy.siteTitle;
  toggle.setAttribute('aria-pressed', String(language === 'en'));
  localStorage.setItem('mint-site-language', language);
}

const savedLanguage = localStorage.getItem('mint-site-language');
setLanguage(savedLanguage === 'en' ? 'en' : 'zh');
toggle.addEventListener('click', () =>
  setLanguage(document.documentElement.lang === 'zh-CN' ? 'en' : 'zh'),
);
