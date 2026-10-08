import { useState } from 'react';
import type { ReActStep as ReActStepData } from '@/types';

function ThoughtIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 017 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z" fill="currentColor" opacity="0.7"/>
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" fill="currentColor"/>
    </svg>
  );
}

function truncate(str: string | undefined | null, max: number): string | undefined | null {
  if (!str || str.length <= max) return str;
  return str.substring(0, max) + '...';
}

interface ReActStepProps {
  step: ReActStepData;
  isLast: boolean;
}

export default function ReActStep({ step, isLast }: ReActStepProps) {
  const [collapsed, setCollapsed] = useState(false);

  const { type, content, toolName, arguments: args, result, error, retryCount, duration, summary } = step as ReActStepData & Record<string, unknown>;
  const shortSummary = truncate(summary as string | undefined, 80);
  const isExpandable = type === 'tool_call_end' && result;

  let icon, label, body: React.ReactNode;

  switch (type) {
    case 'thought':
      icon = <ThoughtIcon />;
      label = '思考';
      body = content ? <div className="react-thought-content">{content}</div> : null;
      break;

    case 'tool_call_start':
      icon = <ToolIcon />;
      label = `调用工具: ${toolName || ''}${shortSummary ? ` · ${shortSummary}` : ''}`;
      body = args ? (
        <div className="react-tool-args">
          <pre>{JSON.stringify(args, null, 2)}</pre>
        </div>
      ) : null;
      break;

    case 'tool_call_end':
      icon = <ToolIcon />;
      label = `工具返回: ${toolName || ''}${shortSummary ? ` · ${shortSummary}` : ''}${duration ? ` (${(Number(duration) / 1000).toFixed(1)}s)` : ''}`;
      body = (
        <div className="react-tool-result">
          <pre>{truncate(result, 500)}</pre>
        </div>
      );
      break;

    case 'tool_call_error':
      icon = <ToolIcon />;
      label = `工具失败: ${toolName || ''}${retryCount ? ` (重试 ${retryCount} 次)` : ''}`;
      body = error ? (
        <div className="react-tool-error">
          {truncate(error, 200)}
        </div>
      ) : null;
      break;

    default:
      return null;
  }

  const expandable = isExpandable ? (collapsed ? ' collapsed' : ' expanded') : '';

  return (
    <div className={`react-step react-step-${type}${expandable}`}>
      <div className="react-step-header" onClick={() => isExpandable && setCollapsed(!collapsed)}>
        <span className="react-step-icon">{icon}</span>
        <span className="react-step-label">{label}</span>
        {isLast && type !== 'tool_call_end' && <span className="react-step-cursor">●</span>}
      </div>
      {(!collapsed && body) && <div className="react-step-body">{body}</div>}
    </div>
  );
}
