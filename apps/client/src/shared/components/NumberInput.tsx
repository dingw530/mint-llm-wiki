import { useState, useRef } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  disabled?: boolean;
}

export default function NumberInput({ value, onChange, min, max, step = 1, id, disabled }: NumberInputProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = (v: number) => {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  };

  const handleDecrement = () => onChange(clamp(value - step));
  const handleIncrement = () => onChange(clamp(value + step));

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed)) onChange(clamp(parsed));
  };

  const handleBlur = () => {
    setFocused(false);
    onChange(clamp(value));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); handleIncrement(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); handleDecrement(); }
  };

  const atMin = min !== undefined && value <= min;
  const atMax = max !== undefined && value >= max;

  return (
    <div className={`number-input-wrapper${focused ? ' is-focused' : ''}`}>
      <button
        type="button"
        className="number-input-btn"
        onClick={handleDecrement}
        disabled={disabled || atMin}
        tabIndex={-1}
        aria-label="减少"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="number-input-field"
        value={value}
        onChange={handleInputChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
      />
      <button
        type="button"
        className="number-input-btn"
        onClick={handleIncrement}
        disabled={disabled || atMax}
        tabIndex={-1}
        aria-label="增加"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
