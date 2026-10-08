import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { getSlashCommandSuggestions, parseSlashCommand, type SlashCommandDefinition } from '../commands/slashCommands';

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
    </svg>
  );
}

interface InputBoxProps {
  onSend: (content: string) => void;
  disabled: boolean;
  children?: ReactNode;
}

export default function InputBox({ onSend, disabled, children }: InputBoxProps) {
  const [text, setText] = useState('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCompositing = useRef(false);

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    const command = parseSlashCommand(trimmed);
    if (command && !command.input) {
      setCommandError(`请补充参数：${command.definition.argumentHint}`);
      return;
    }
    onSend(trimmed);
    setCommandError(null);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const suggestions = getSlashCommandSuggestions(text);
  const selectCommand = (command: SlashCommandDefinition): void => {
    setText(`${command.command} `);
    setCommandError(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isCompositing.current) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  };

  return (
    <div className="input-box">
      <form onSubmit={handleSubmit}>
        <div className="input-box-editor">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCommandError(null);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { isCompositing.current = true; }}
            onCompositionEnd={() => { isCompositing.current = false; }}
            placeholder={disabled ? '等待回复...' : '输入消息...'}
            rows={1}
            disabled={disabled}
            aria-expanded={suggestions.length > 0}
            aria-controls="chat-slash-command-list"
          />
          {suggestions.length > 0 && (
            <div id="chat-slash-command-list" className="slash-command-menu" role="listbox" aria-label="可用工具命令">
              <div className="slash-command-menu-heading">快速调用工具</div>
              {suggestions.map((command) => (
                <button
                  key={command.command}
                  type="button"
                  className="slash-command-option"
                  role="option"
                  aria-label={command.command}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectCommand(command)}
                >
                  <span className="slash-command-option-main">
                    <strong>{command.label}</strong>
                    <span>{command.description}</span>
                  </span>
                  <small>{command.argumentHint}</small>
                </button>
              ))}
            </div>
          )}
          {commandError && <p className="input-box-command-error" role="alert">{commandError}</p>}
        </div>
        <div className="input-box-toolbar">
          <div className="input-box-context">{children}</div>
          <div className="input-box-hints" aria-hidden="true">
            <span><kbd>Enter</kbd> 发送</span>
            <span><kbd>Shift</kbd><b>+</b><kbd>Enter</kbd> 换行</span>
          </div>
          <button
            type="submit"
            className="send-btn"
            disabled={disabled || !text.trim()}
            aria-label="发送消息"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </div>
  );
}
