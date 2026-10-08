const app = document.querySelector('#app');
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const sec = (value) => `${(value / 1000).toFixed(1)} 秒`;
const deltaPct = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} 个百分点`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

/** 将数据集标识转换为报告页使用的中文名称。 */
function datasetName(dataset) {
  return dataset === 'wiki-rag' ? 'Wiki / RAG' : dataset;
}

/** 将评测器输出的英文原因转换为可读的中文诊断。 */
function translateReason(reason) {
  if (reason === 'wiki search call limit exceeded') return 'Wiki 搜索次数超出限制';
  if (reason === 'loop detected') return '检测到推理循环';
  if (reason === 'veto rubric failed') return '触发禁止条件，结果被否决';
  if (reason === 'citation is not grounded in retrieved evidence')
    return '最终引用未落在本次检索证据中';

  const rubric = reason.match(/^(essential|important|optional) rubric failed: (.+)$/);
  if (rubric)
    return `${{ essential: '必要项', important: '重要项', optional: '可选项' }[rubric[1]]} Rubric 未通过：${rubric[2]}`;

  const state = reason.match(/^final state assertion failed: (.+)$/);
  if (state) return `最终状态断言未通过：${state[1]}`;

  const alternatives = reason.match(/^missing answer alternatives: (.+)$/);
  if (alternatives) return `缺少应提供的替代答案：${alternatives[1]}`;

  const source = reason.match(/^missing required source: (.+)$/);
  if (source) return `缺少必需来源：${source[1]}`;

  const retrievalSource = reason.match(/^retrieval missing required source: (.+)$/);
  if (retrievalSource) return `检索未覆盖必需来源：${retrievalSource[1]}`;

  const citations = reason.match(/^not enough citations: expected (\d+), got (\d+)$/);
  if (citations) return `最终答案引用不足：应有 ${citations[1]} 条，实际 ${citations[2]} 条`;

  return reason;
}

/** 将可选百分比字段格式化为展示文本。 */
function formatPercent(value) {
  return typeof value === 'number' ? pct(value) : '—';
}

/** 将可选数值字段格式化为不带小数的展示文本。 */
function formatCount(value) {
  return typeof value === 'number'
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
    : '—';
}

/** 根据报告中的失败原因生成最多三条高频诊断。 */
function failureInsights(results) {
  const counts = new Map();
  results
    .filter((result) => !result.passed)
    .forEach((result) => {
      (result.reasons?.length ? result.reasons : ['未通过，但未记录具体原因']).forEach((reason) => {
        const label = translateReason(reason);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      });
    });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

/** 格式化指标卡片中的数值，支持百分比、耗时和一般数值。 */
function formatMetricValue(value, format = 'percent') {
  if (typeof value !== 'number') return '—';
  if (format === 'duration') return sec(value);
  if (format === 'number') return value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  return formatPercent(value);
}

/** 格式化版本对比中的差值，避免把耗时误显示为百分点。 */
function formatMetricDelta(value, format = 'percent') {
  const absolute = Math.abs(value);
  if (format === 'duration') return sec(absolute);
  if (format === 'number') return absolute.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  return `${(absolute * 100).toFixed(1)} 个百分点`;
}

/** 为指标卡片生成当前值、基线值和提升/降低提示。 */
function renderMetricComparison(metric, comparison) {
  if (!comparison || !metric.key || typeof comparison.deltas?.[metric.key] !== 'number') return '';
  const delta = comparison.deltas[metric.key];
  const currentValue = metric.value;
  const baselineValue = comparison.baselineValues?.[metric.key];
  if (typeof currentValue !== 'number' || typeof baselineValue !== 'number') return '';
  const neutral = Math.abs(delta) < 0.000001;
  const improved = metric.direction === 'lower' ? delta < 0 : delta > 0;
  const tone = neutral ? 'neutral' : improved ? 'positive' : 'negative';
  const label = neutral
    ? `→ 持平`
    : `${delta > 0 ? '↑' : '↓'} ${formatMetricDelta(delta, metric.format)}`;
  return `<div class="metric-comparison ${tone}"><span>${label}</span><small>基线 ${formatMetricValue(baselineValue, metric.format)} <i>→</i> 当前 ${formatMetricValue(currentValue, metric.format)}</small></div>`;
}

/** 将指标配置渲染为统一的指标卡片。 */
function renderMetricCards(metrics, comparison) {
  return metrics
    .map(
      ({ label, value, description, tone = '', key, format = 'percent', direction = 'higher' }) =>
        `<article class="metric ${tone}" data-metric="${esc(key || label)}"><span class="metric-label">${label}</span><b class="number">${formatMetricValue(value, format)}</b>${renderMetricComparison({ key, value, format, direction }, comparison)}<small>${description}</small></article>`,
    )
    .join('');
}

/** 渲染通过构成环，突出当前报告的通过与失败比例。 */
function renderPassRing(summary) {
  const total = typeof summary.totalRuns === 'number' ? summary.totalRuns : 0;
  const passed = typeof summary.passedRuns === 'number' ? summary.passedRuns : 0;
  const passRate = total > 0 ? Math.max(0, Math.min(1, passed / total)) : 0;
  return `<div class="pass-visual"><div class="visual-heading"><div><p class="eyebrow">运行构成</p><h2>通过 / 未通过</h2></div><span>${formatCount(total)} 次运行</span></div><div class="pass-visual-body"><div class="pass-ring" style="--pass-angle:${(passRate * 360).toFixed(2)}deg" role="img" aria-label="${formatPercent(passRate)} 的运行通过"><div><strong class="number">${formatPercent(passRate)}</strong><small>严格通过</small></div></div><div class="ring-legend"><span><i class="legend-dot pass"></i>通过 <b class="number">${formatCount(passed)}</b></span><span><i class="legend-dot fail"></i>未通过 <b class="number">${formatCount(Math.max(0, total - passed))}</b></span></div></div></div>`;
}

/** 渲染质量 Gate 横向条形图；有基线时用细线叠加当前值。 */
function renderQualityBars(summary, comparison) {
  const metrics = [
    { key: 'answerGatePassAt1', label: '答案 Gate', tone: 'answer' },
    { key: 'evidenceGatePassAt1', label: '证据 Gate', tone: 'evidence' },
    { key: 'qualityPassAt1', label: '质量通过率', tone: 'quality' },
    { key: 'judgePassAt1', label: 'Judge 通过率', tone: 'judge' },
    { key: 'citationGroundingRate', label: '引用落地率', tone: 'citation' },
  ];
  const hasBaseline = Boolean(comparison);
  const rows = metrics
    .map((metric) => {
      const current = summaryMetric(summary, metric.key);
      const baseline = comparison?.baselineValues?.[metric.key];
      const currentWidth =
        typeof current === 'number' ? Math.max(0, Math.min(100, current * 100)) : 0;
      const baselineWidth =
        typeof baseline === 'number' ? Math.max(0, Math.min(100, baseline * 100)) : 0;
      return `<div class="bar-row"><div class="bar-meta"><span>${metric.label}</span><b class="number">${formatPercent(current)}</b></div><div class="bar-track" aria-label="${metric.label} ${formatPercent(current)}">${typeof baseline === 'number' ? `<span class="bar-baseline" style="width:${baselineWidth.toFixed(2)}%"></span>` : ''}<span class="bar-current ${metric.tone}" style="width:${currentWidth.toFixed(2)}%"></span></div></div>`;
    })
    .join('');
  return `<div class="quality-visual"><div class="visual-heading"><div><p class="eyebrow">质量信号</p><h2>Gate 一览</h2></div><span>${hasBaseline ? '细线为基线' : '当前版本'}</span></div><div class="bar-chart">${rows}</div></div>`;
}

/** 将数字指标转换为可快速扫描的轻量图形。 */
function renderVisualizations(summary, comparison) {
  return `<section class="visual-section" aria-label="评测图形概览">${renderPassRing(summary)}${renderQualityBars(summary, comparison)}</section>`;
}

/** 渲染逐题稳定性统计，兼容旧报告中没有 caseStats 的情况。 */
function renderCaseStats(caseStats) {
  if (!caseStats.length) return '<p class="muted">当前报告没有逐题稳定性统计。</p>';
  return caseStats
    .map(
      (stat) =>
        `<div class="case-row"><strong>${esc(stat.caseId)}</strong><span>${stat.passedRuns} / ${stat.runs} 次通过</span><span class="number">${formatPercent(stat.passRate)}</span><span class="number">Pass@k ${formatPercent(stat.passAtK)}</span><span class="number">Pass^k ${formatPercent(stat.passPowerK)}</span>${Number.isFinite(stat.recallAtK) ? `<span class="number">Recall@5 ${formatPercent(stat.recallAtK)}</span>` : ''}<span class="number">${sec(stat.meanLatencyMs)}</span></div>`,
    )
    .join('');
}

const comparisonMetricNames = [
  'passAt1',
  'queryPassAt1',
  'answerPassAt1',
  'answerGatePassAt1',
  'evidenceGatePassAt1',
  'qualityPassAt1',
  'passAtK',
  'passPowerK',
  'recallAtK',
  'toolBudgetPassRate',
  'wikiSearchBudgetPassRate',
  'toolSuccessRate',
  'retrievalCoverageRate',
  'citationCoverageRate',
  'citationAccuracyRate',
  'citationGroundingRate',
  'abstentionAccuracy',
  'essentialPassRate',
  'importantPassRate',
  'optionalPassRate',
  'answerJudgePassAt1',
  'evidenceJudgePassAt1',
  'judgePassAt1',
  'averageJudgeScore',
  'averageLatencyMs',
  'p95LatencyMs',
  'averageRounds',
  'averageToolCalls',
  'averageWikiSearchCalls',
];

/** 渲染版本选择器；没有版本索引时保持旧报告页面的无控件状态。 */
function renderVersionControls(report, versions) {
  if (!versions.length) return '';
  const currentId = versions.some((version) => version.id === report.resultVersion)
    ? report.resultVersion
    : versions[0].id;
  const baselineId = versions.find((version) => version.id !== currentId)?.id || '';
  const versionLabel = (version) =>
    `${esc(version.id)} · ${new Date(version.generatedAt).toLocaleString('zh-CN')}${version.langfuseUploadedAt ? ' · 已上传 Langfuse' : ''}`;
  const options = versions
    .map(
      (version) =>
        `<option value="${esc(version.id)}" ${version.id === currentId ? 'selected' : ''}>${versionLabel(version)}</option>`,
    )
    .join('');
  const baselineOptions = `<option value="">不选择基线</option>${versions.map((version) => `<option value="${esc(version.id)}" ${version.id === baselineId ? 'selected' : ''}>${versionLabel(version)}</option>`).join('')}`;
  return `<section class="version-toolbar" data-testid="version-toolbar"><div class="version-copy"><p class="eyebrow">结果版本库</p><strong>在同一数据集上追踪变化</strong><small>选择当前结果和基线，查看确定性指标的真实增量。</small></div><div class="version-fields"><label>当前版本<select id="current-version" aria-label="当前版本">${options}</select></label><label>基线版本<select id="baseline-version" aria-label="基线版本">${baselineOptions}</select></label><button id="compare-versions" type="button">比较两个版本</button><span id="version-status" role="status">${report.comparison ? '已加载版本对比' : `${versions.length} 个版本可用`}</span></div></section>`;
}

/** 读取兼容旧报告字段的指标值，缺失时保留为空而不是伪装成 0。 */
function summaryMetric(summary, name) {
  if (typeof summary?.[name] === 'number') return summary[name];
  if (name === 'queryPassAt1' || name === 'answerPassAt1' || name === 'passPowerK')
    return typeof summary?.passAt1 === 'number' ? summary.passAt1 : null;
  return null;
}

/** 在 viewer 中复用 CLI 的同名指标差值规则。 */
function compareVersionReports(current, baseline) {
  const currentValues = Object.fromEntries(
    comparisonMetricNames.map((name) => [name, summaryMetric(current.summary, name)]),
  );
  const baselineValues = Object.fromEntries(
    comparisonMetricNames.map((name) => [name, summaryMetric(baseline.summary, name)]),
  );
  const deltas = Object.fromEntries(
    comparisonMetricNames.map((name) => [
      name,
      typeof currentValues[name] === 'number' && typeof baselineValues[name] === 'number'
        ? currentValues[name] - baselineValues[name]
        : null,
    ]),
  );
  const warnings = [];
  if (current.dataset !== baseline.dataset)
    warnings.push(`数据集不同：${baseline.dataset} → ${current.dataset}`);
  if (current.version !== baseline.version)
    warnings.push(`数据集版本不同：${baseline.version} → ${current.version}`);
  return {
    ...current,
    comparison: {
      baselineGeneratedAt: baseline.generatedAt,
      baselineVersion: baseline.version,
      baselineResultVersion: baseline.resultVersion,
      baselineValues,
      warnings,
      deltas,
    },
  };
}

async function loadVersionReport(version, versions) {
  const entry = versions.find((candidate) => candidate.id === version);
  if (!entry) throw new Error(`找不到评测结果版本：${version}`);
  const response = await fetch(`versions/${encodeURIComponent(entry.reportFile)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`无法加载评测结果版本：${version}`);
  return response.json();
}

/** 绑定 viewer 的版本切换和比较交互。 */
function bindVersionControls(report, versions) {
  if (!versions.length) return;
  const currentSelect = document.querySelector('#current-version');
  const baselineSelect = document.querySelector('#baseline-version');
  const compareButton = document.querySelector('#compare-versions');
  const status = document.querySelector('#version-status');
  currentSelect?.addEventListener('change', async (event) => {
    const selected = event.target.value;
    status.textContent = '正在加载版本…';
    try {
      render(await loadVersionReport(selected, versions), versions);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  compareButton?.addEventListener('click', async () => {
    if (!baselineSelect.value || !currentSelect.value) {
      status.textContent = '请选择当前版本和基线版本';
      return;
    }
    status.textContent = '正在生成对比…';
    try {
      const [current, baseline] = await Promise.all([
        loadVersionReport(currentSelect.value, versions),
        loadVersionReport(baselineSelect.value, versions),
      ]);
      render(compareVersionReports(current, baseline), versions);
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function render(report, versions = []) {
  if (!report) {
    app.innerHTML =
      '<section class="empty"><b>∅</b><p class="eyebrow">评测报告</p><h1>暂无评测报告</h1><p>请先运行评测命令生成 <code>report.json</code>。</p></section>';
    return;
  }

  const s = report.summary ?? {};
  const results = report.results ?? [];
  const queryPassAt1 = s.queryPassAt1 ?? s.passAt1;
  const queryPassedRuns = s.queryPassedRuns ?? s.passedRuns;
  const failedRuns = results.filter((result) => !result.passed).length;
  const failedCases = new Set(
    results.filter((result) => !result.passed).map((result) => result.caseId),
  ).size;
  const caseCount =
    report.caseStats?.length ?? new Set(results.map((result) => result.caseId)).size;
  const insights = failureInsights(results);
  const k = s.passAtKValue ?? s.passPowerKValue ?? '?';
  const metrics = [
    {
      key: 'queryPassAt1',
      label: '查询通过率',
      value: queryPassAt1,
      description: '回答、检索证据和引用满足题目要求',
      tone: 'accent',
    },
    {
      key: 'answerPassAt1',
      label: '回答质量',
      value: s.answerPassAt1 ?? s.passAt1,
      description: '回答内容与无答案拒答行为',
      tone: 'accent',
    },
    {
      key: 'passAtK',
      label: `Pass@${k}`,
      value: s.passAtK,
      description: '多次尝试中至少一次通过的概率',
      tone: 'accent',
    },
    {
      key: 'passPowerK',
      label: `Pass^${s.passPowerKValue ?? k}`,
      value: s.passPowerK ?? s.passAt1,
      description: '连续多次运行全部通过的稳定性',
      tone: 'accent',
    },
  ];
  const qualityMetrics = [
    {
      key: 'answerGatePassAt1',
      label: '答案 Gate',
      value: s.answerGatePassAt1,
      description: '答案硬条件通过后，关键词信号或语义 Judge 通过的比例',
    },
    {
      key: 'evidenceGatePassAt1',
      label: '证据 Gate',
      value: s.evidenceGatePassAt1,
      description: '检索覆盖、引用身份和证据语义均通过的比例',
    },
    {
      key: 'qualityPassAt1',
      label: '质量通过率',
      value: s.qualityPassAt1,
      description: '答案 Gate 与证据 Gate 同时通过的比例',
    },
    {
      key: 'retrievalCoverageRate',
      label: '检索覆盖率',
      value: s.retrievalCoverageRate,
      description: '检索结果覆盖目标来源的比例',
    },
    ...(Number.isFinite(s.recallAtK)
      ? [
          {
            key: 'recallAtK',
            label: `来源 Recall@${s.recallAtKValue ?? 5}`,
            value: s.recallAtK,
            description: `目标来源出现在前 ${s.recallAtKValue ?? 5} 个检索结果中的比例；统计 ${s.recallAtKRuns ?? 0} 次运行`,
          },
        ]
      : []),
    {
      key: 'citationCoverageRate',
      label: '引用覆盖率',
      value: s.citationCoverageRate,
      description: '最终答案覆盖检索证据的比例',
    },
    {
      key: 'citationAccuracyRate',
      label: '引用准确率',
      value: s.citationAccuracyRate,
      description: '最终答案引用正确来源的比例',
    },
    {
      key: 'abstentionAccuracy',
      label: '拒答准确率',
      value: s.abstentionAccuracy,
      description: '无答案场景下正确拒答的比例',
    },
    {
      key: 'essentialPassRate',
      label: '必要项通过率',
      value: s.essentialPassRate,
      description: 'Essential Rubric 的通过比例',
    },
    {
      key: 'importantPassRate',
      label: '重要项通过率',
      value: s.importantPassRate,
      description: 'Important Rubric 的通过比例',
    },
    {
      key: 'optionalPassRate',
      label: '可选项通过率',
      value: s.optionalPassRate,
      description: 'Optional Rubric 的通过比例',
    },
    {
      key: 'judgePassAt1',
      label: 'Judge 通过率',
      value: s.judgePassAt1,
      description: '硬门禁通过后，语义 Judge 的通过比例',
    },
    {
      key: 'averageJudgeScore',
      label: 'Judge 加权分',
      value: s.averageJudgeScore,
      description: '正确性、证据、完整性等语义维度加权得分',
    },
    {
      key: 'passAt1',
      label: '严格通过率',
      value: s.passAt1,
      description: '回答、引用和工具预算全部通过',
    },
  ];
  const efficiencyMetrics = [
    {
      key: 'averageLatencyMs',
      label: '平均耗时',
      value: s.averageLatencyMs,
      format: 'duration',
      direction: 'lower',
      description: '每次运行从开始到结束的平均耗时',
    },
    {
      key: 'p95LatencyMs',
      label: 'P95 耗时',
      value: s.p95LatencyMs,
      format: 'duration',
      direction: 'lower',
      description: '95% 的运行耗时不超过此值',
    },
    {
      key: 'toolBudgetPassRate',
      label: '工具预算',
      value: s.toolBudgetPassRate,
      description: '工具调用未超出题目限制',
    },
    {
      key: 'wikiSearchBudgetPassRate',
      label: 'Wiki 检索预算',
      value: s.wikiSearchBudgetPassRate,
      description: 'Wiki 搜索未超出题目限制',
    },
    {
      key: 'averageRounds',
      label: '平均轮数',
      value: s.averageRounds,
      format: 'number',
      direction: 'lower',
      description: '每次运行的平均推理轮数',
    },
    {
      key: 'averageToolCalls',
      label: '平均工具调用',
      value: s.averageToolCalls,
      format: 'number',
      direction: 'lower',
      description: '每次运行的平均工具调用数',
    },
    {
      key: 'averageWikiSearchCalls',
      label: '平均 Wiki 搜索',
      value: s.averageWikiSearchCalls,
      format: 'number',
      direction: 'lower',
      description: '每次运行的平均 Wiki 搜索数',
    },
    {
      key: 'toolSuccessRate',
      label: '工具调用成功率',
      value: s.toolSuccessRate,
      description: '工具调用返回成功结果的比例',
    },
  ];
  const metricMarkup = renderMetricCards(metrics, report.comparison);
  const resultMarkup = results
    .map((result) => {
      const reasons = (result.reasons ?? []).map(translateReason).join(' · ') || '无';
      const judge = result.judge?.skipped
        ? '跳过'
        : result.judge
          ? `${result.judgePassed ? '通过' : '未通过'} ${formatPercent(result.judge.weightedScore)}`
          : '—';
      const judgeReason = result.judge?.shortReason ? ` · Judge：${result.judge.shortReason}` : '';
      const fullDiagnostic = reasons + judgeReason;
      return `<div class="row"><strong><i class="${result.passed ? 'pass' : 'fail'}"></i>${esc(result.caseId)} <small>第 ${result.runIndex ?? 1} 次</small></strong><span>${result.passed ? '通过' : '未通过'}</span><span>${esc(judge)}</span><span class="number">${result.toolCalls} 次</span><span class="number">${result.citationCount ?? 0} / ${result.retrievedCitationCount ?? 0}</span><span class="number">${formatPercent(result.rubricScore)}</span><span class="number">${sec(result.latencyMs)}</span><span class="reason" title="${esc(fullDiagnostic)}">${esc(fullDiagnostic)}</span></div>`;
    })
    .join('');
  const comparisonMarkup = report.comparison
    ? `<section class="comparison"><div><p class="eyebrow">版本对比</p><h2>当前结果 vs 基线</h2></div><div class="comparison-copy"><p><strong>${esc(report.resultVersion || '当前版本')}</strong><span class="comparison-arrow">→</span><strong>${esc(report.comparison.baselineResultVersion || '基线版本')}</strong></p><small>指标卡片已显示提升、降低及当前 / 基线数值。</small>${report.comparison.warnings.length ? `<small class="warning">${esc(report.comparison.warnings.join('；'))}</small>` : ''}</div></section>`
    : '';
  const insightMarkup = insights.length
    ? insights
        .map(
          ([reason, count]) =>
            `<li><span>${esc(reason)}</span><b class="number">${count} 次</b></li>`,
        )
        .join('')
    : '<li><span>本次运行没有失败原因。</span><b class="number">0 次</b></li>';
  const qualityMarkup = renderMetricCards(qualityMetrics, report.comparison);
  const efficiencyMarkup = renderMetricCards(efficiencyMetrics, report.comparison);
  const currentVersion = versions.find((version) => version.id === report.resultVersion);
  const langfuseMarkup = currentVersion?.langfuseUploadedAt
    ? `<span class="meta meta-success" title="${esc(currentVersion.langfuseUploadedAt)}">已上传 Langfuse</span>`
    : '';

  app.innerHTML = `<header class="page-header"><div class="page-brand"><div class="brand-mark"><img src="mint-icon.svg" alt="Mint" /></div><div><p class="eyebrow">评测工作台 / ${esc(datasetName(report.dataset))}</p><h1>Mint LLM Wiki <em>评测</em></h1><p class="sub">确定性门禁 · 语义 Judge · 证据质量 · 执行效率</p></div></div><div class="header-meta"><span class="meta">${esc(report.resultVersion || '未命名')}</span><span class="meta">数据集 v${esc(report.version)}</span><span class="meta">${new Date(report.generatedAt).toLocaleString('zh-CN')}</span>${langfuseMarkup}</div></header>${renderVersionControls(report, versions)}${comparisonMarkup}<section class="overview"><div class="score"><span>查询通过率 · Pass@1</span><strong class="number">${formatPercent(queryPassAt1)}</strong><small>${formatCount(queryPassedRuns)} / ${formatCount(s.totalRuns)} 次查询通过</small><div class="score-foot"><span>${caseCount} 条用例</span><span>${report.runsPerCase ?? 1} 次 / 用例</span></div></div><div class="metrics">${metricMarkup}</div></section><section class="run-summary"><div><span class="eyebrow">运行概览</span><strong class="number">${formatCount(s.totalRuns)}</strong><small>总运行次数</small></div><div><span class="eyebrow">完整通过</span><strong class="number">${formatCount(s.passedRuns)}</strong><small>严格通过的运行</small></div><div><span class="eyebrow">Judge 运行</span><strong class="number">${formatCount(s.judgeRuns)}</strong><small>完成语义评审的运行</small></div><div><span class="eyebrow">平均轮数</span><strong class="number">${s.averageRounds?.toFixed(1) ?? '—'}</strong><small>每次运行</small></div></section>${renderVisualizations(s, report.comparison)}<section class="metric-section"><div class="section-head"><div><p class="eyebrow">质量拆解</p><h2>回答、证据与 Judge</h2></div><span>越高越好</span></div><div class="metrics detail-grid">${qualityMarkup}</div></section><section class="metric-section"><div class="section-head"><div><p class="eyebrow">效率拆解</p><h2>执行成本与稳定性</h2></div><span>时间越低越好 · 通过率越高越好</span></div><div class="metrics detail-grid">${efficiencyMarkup}</div></section><section class="insights"><div><p class="eyebrow">失败诊断</p><h2>最常见的问题</h2><p class="muted">按失败运行中的原因统计，帮助优先处理影响最大的短板。</p></div><ol>${insightMarkup}</ol></section><section class="guide"><div><p class="eyebrow">指标说明</p><h2>如何阅读这份报告</h2></div><p><b>严格通过率</b>由答案、引用和工具预算等确定性门禁决定；<b>Judge 通过率</b>只统计通过硬门禁后在正确性、证据和完整性上的语义评审。两者并列展示，不互相覆盖。</p></section><section class="stability"><div class="section-head"><div><p class="eyebrow">稳定性</p><h2>逐题通过情况</h2></div><span>${caseCount} 条用例</span></div><div class="case-table"><div class="case-row case-head"><span>用例</span><span>通过次数</span><span>通过率</span><span>Pass@k</span><span>Pass^k</span><span>平均耗时</span></div>${renderCaseStats(report.caseStats ?? [])}</div></section><section class="trace"><div class="section-head"><div><p class="eyebrow">逐次结果</p><h2>每次运行明细</h2></div><span>${results.length} 次运行</span></div><div class="table"><div class="row head"><span>用例</span><span>硬门禁</span><span>Judge</span><span>工具调用</span><span>引用（展示 / 检索）</span><span>确定性 Rubric</span><span>耗时</span><span>诊断</span></div>${resultMarkup}</div></section>`;
  bindVersionControls(report, versions);
}

async function loadViewer() {
  const [reportResponse, versionsResponse] = await Promise.all([
    fetch('report.json', { cache: 'no-store' }),
    fetch('versions/index.json', { cache: 'no-store' }),
  ]);
  const reportPayload = reportResponse.ok ? await reportResponse.json() : null;
  const versionsPayload = versionsResponse.ok ? await versionsResponse.json() : { versions: [] };
  render(
    reportPayload?.report ?? reportPayload,
    Array.isArray(versionsPayload.versions) ? versionsPayload.versions : [],
  );
}

loadViewer().catch(() => render(null));
