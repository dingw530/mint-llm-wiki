import NumberInput from '@/shared/components/NumberInput';

type StringSetter = (value: string) => void;
type BooleanSetter = (value: boolean) => void;
type NumberSetter = (value: number) => void;

export interface GeneralTabProps {
  systemPrompt: string;
  setSystemPrompt: StringSetter;
  thinkingMode: boolean;
  setThinkingMode: BooleanSetter;
  memoryEnabled: boolean;
  setMemoryEnabled: BooleanSetter;
  routingMode: string;
  setRoutingMode: StringSetter;
  theme: string;
  setTheme: StringSetter;
  reactMaxIterations: number;
  setReactMaxIterations: NumberSetter;
  toolMaxRetries: number;
  setToolMaxRetries: NumberSetter;
  showReactSteps: boolean;
  setShowReactSteps: BooleanSetter;
}

export default function GeneralTab({
  systemPrompt,
  setSystemPrompt,
  thinkingMode,
  setThinkingMode,
  memoryEnabled,
  setMemoryEnabled,
  routingMode,
  setRoutingMode,
  theme,
  setTheme,
  reactMaxIterations,
  setReactMaxIterations,
  toolMaxRetries,
  setToolMaxRetries,
  showReactSteps,
  setShowReactSteps,
}: GeneralTabProps) {
  return (
    <>
      <div className="form-group">
        <label htmlFor="systemPrompt">系统提示词</label>
        <textarea
          id="systemPrompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="你是一个有帮助的助手..."
          rows={4}
          style={{ resize: 'vertical' }}
        />
      </div>
      <div className="form-group">
        <label>模式</label>
        <div className="mode-toggle">
          <button className={!thinkingMode ? 'active' : ''} onClick={() => setThinkingMode(false)}>
            快速
          </button>
          <button className={thinkingMode ? 'active' : ''} onClick={() => setThinkingMode(true)}>
            深度思考
          </button>
        </div>
      </div>
      <div className="form-group">
        <label>记忆功能</label>
        <div className="mode-toggle">
          <button
            type="button"
            className={!memoryEnabled ? 'active' : ''}
            onClick={() => setMemoryEnabled(false)}
          >
            关闭
          </button>
          <button
            type="button"
            className={memoryEnabled ? 'active' : ''}
            onClick={() => setMemoryEnabled(true)}
          >
            开启
          </button>
        </div>
        <p className="form-help">开启后，AI 会从对话中提取关键信息并在后续对话中参考。</p>
      </div>
      <div className="form-group">
        <label>路由模式</label>
        <div className="mode-toggle">
          <button
            type="button"
            className={routingMode === 'auto' ? 'active' : ''}
            onClick={() => setRoutingMode('auto')}
          >
            自动
          </button>
          <button
            type="button"
            className={routingMode === 'manual' ? 'active' : ''}
            onClick={() => setRoutingMode('manual')}
          >
            手动
          </button>
        </div>
        <p className="form-help">自动模式下，AI 会根据消息内容自动选择合适的 Agent。</p>
      </div>
      <div className="form-group"></div>
      <div className="form-group">
        <label>主题皮肤</label>
        <div className="mode-toggle">
          <button
            type="button"
            className={theme === 'mint' ? 'active' : ''}
            onClick={() => setTheme('mint')}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#2AA87D',
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            ></span>
            Mint 沁绿
          </button>
          <button
            type="button"
            className={theme === 'snow' ? 'active' : ''}
            onClick={() => setTheme('snow')}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#5575CF',
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            ></span>
            蓝雪花
          </button>
          <button
            type="button"
            className={theme === 'anthropic' ? 'active' : ''}
            onClick={() => setTheme('anthropic')}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#E18C6E',
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            ></span>
            Anthropic
          </button>
          <button
            type="button"
            className={theme === 'reddot' ? 'active' : ''}
            onClick={() => setTheme('reddot')}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#D03050',
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            ></span>
            炽红
          </button>
        </div>
        <p className="form-help">切换应用的色彩主题风格，即时生效。</p>
      </div>
      <hr className="settings-divider" />
      <h4 className="settings-subheading">ReAct 推理设置</h4>
      <div className="form-group">
        <label htmlFor="reactMaxIterations">最大迭代次数</label>
        <NumberInput
          id="reactMaxIterations"
          value={reactMaxIterations}
          onChange={setReactMaxIterations}
          min={0}
          max={20}
        />
        <p className="form-help">
          AI 在单次回复中最多可连续调用工具的轮数（0~20）。设为 0 则使用传统模式。
        </p>
      </div>
      <div className="form-group">
        <label htmlFor="toolMaxRetries">工具重试次数</label>
        <NumberInput
          id="toolMaxRetries"
          value={toolMaxRetries}
          onChange={setToolMaxRetries}
          min={0}
          max={10}
        />
        <p className="form-help">工具调用失败时的最大重试次数（0~10）。设为 0 则不重试。</p>
      </div>
      <div className="form-group">
        <label>显示推理过程</label>
        <div className="mode-toggle">
          <button
            type="button"
            className={showReactSteps ? 'active' : ''}
            onClick={() => setShowReactSteps(true)}
          >
            显示
          </button>
          <button
            type="button"
            className={!showReactSteps ? 'active' : ''}
            onClick={() => setShowReactSteps(false)}
          >
            隐藏
          </button>
        </div>
        <p className="form-help">控制 ReAct 推理过程中工具调用的步骤信息是否在对话中展示。</p>
      </div>
    </>
  );
}
