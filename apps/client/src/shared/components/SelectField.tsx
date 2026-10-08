import * as Select from '@radix-ui/react-select';
import { forwardRef } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  options: (string | SelectOption)[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  testId?: string;
}

export function toOption(o: string | SelectOption): SelectOption {
  return typeof o === 'string' ? { value: o, label: o } : o;
}

function SelectField(
  { options, value, onChange, placeholder, disabled, className, id, testId }: SelectFieldProps,
  ref: React.Ref<HTMLButtonElement>,
) {
  const resolved = options.map(toOption);
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger
        ref={ref}
        className={`select-field-trigger ${className || ''}`}
        aria-label={placeholder}
        id={id}
        data-testid={testId}
      >
        <Select.Value placeholder={placeholder || '选择...'} />
        <Select.Icon className="select-field-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-field-content" position="popper" sideOffset={4}>
          <Select.Viewport className="select-field-viewport">
            {resolved.map((opt) => (
              <Select.Item key={opt.value} value={opt.value} className="select-field-item">
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export default forwardRef(SelectField);
