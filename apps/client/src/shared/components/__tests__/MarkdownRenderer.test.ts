import { describe, expect, it } from 'vitest';
import { splitMarkdownBlocks } from '../MarkdownRenderer';

describe('splitMarkdownBlocks', () => {
  it('splits independent blocks at blank lines', () => {
    expect(splitMarkdownBlocks('# Title\n\nParagraph')).toEqual(['# Title\n', 'Paragraph']);
  });

  it('keeps a fenced code block together, including blank lines', () => {
    expect(splitMarkdownBlocks('```ts\nconst value = 1;\n\nconsole.log(value);\n```\n\nDone'))
      .toEqual(['```ts\nconst value = 1;\n\nconsole.log(value);\n```', 'Done']);
  });

  it('keeps blank lines inside lists and blockquotes', () => {
    expect(splitMarkdownBlocks('- one\n\n- two')).toEqual(['- one\n\n- two']);
    expect(splitMarkdownBlocks('> note\n\n> more')).toEqual(['> note\n\n> more']);
  });
});
