import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import CodeBlock from '../CodeBlock';

describe('CodeBlock', () => {
  it('keeps hook order when content changes between inline and block code', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<CodeBlock>inline</CodeBlock>);
    });
    await act(async () => {
      root.render(<CodeBlock>{'line one\nline two'}</CodeBlock>);
    });

    expect(container.querySelector('.code-block')).not.toBeNull();
    await act(async () => {
      root.unmount();
    });
  });
});
