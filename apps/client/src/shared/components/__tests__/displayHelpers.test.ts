import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { extractText } from '../CodeBlock';
import { toOption } from '../SelectField';

describe('display helpers', () => {
  it('extracts nested React child text', () => {
    expect(extractText(['a', 2, { props: { children: ['b', { props: { children: 'c' } }] } }] as unknown as ReactNode)).toBe('a2bc');
    expect(extractText(null)).toBe('');
  });

  it('normalizes select options', () => {
    expect(toOption('chat')).toEqual({ value: 'chat', label: 'chat' });
    expect(toOption({ value: 'image', label: 'Images' })).toEqual({ value: 'image', label: 'Images' });
  });
});
