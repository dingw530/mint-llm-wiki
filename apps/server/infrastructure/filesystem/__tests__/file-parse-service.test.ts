import { describe, it, expect } from 'vitest';
import { parseFile, isSupportedFile, getFileFormat } from '../file-parse-service.js';

describe('isSupportedFile', () => {
  it('应该支持 .txt 文件', () => {
    expect(isSupportedFile('readme.txt')).toBe(true);
  });

  it('应该支持 .md 文件', () => {
    expect(isSupportedFile('doc.md')).toBe(true);
  });

  it('应该支持 .html 和 .htm 文件', () => {
    expect(isSupportedFile('index.html')).toBe(true);
    expect(isSupportedFile('page.htm')).toBe(true);
  });

  it('应该支持 .pdf 文件', () => {
    expect(isSupportedFile('report.pdf')).toBe(true);
  });

  it('应该不区分大小写', () => {
    expect(isSupportedFile('README.TXT')).toBe(true);
    expect(isSupportedFile('Doc.HTML')).toBe(true);
    expect(isSupportedFile('Doc.HTM')).toBe(true);
    expect(isSupportedFile('Doc.PDF')).toBe(true);
  });

  it('应该拒绝不支持的文件类型', () => {
    expect(isSupportedFile('image.png')).toBe(false);
    expect(isSupportedFile('doc.docx')).toBe(false);
    expect(isSupportedFile('sheet.xlsx')).toBe(false);
    expect(isSupportedFile('file')).toBe(false);
  });
});

describe('getFileFormat', () => {
  it('应该正确识别 txt', () => {
    expect(getFileFormat('note.txt')).toBe('txt');
  });

  it('应该正确识别 md', () => {
    expect(getFileFormat('doc.md')).toBe('md');
  });

  it('应该正确识别 html/htm', () => {
    expect(getFileFormat('index.html')).toBe('html');
    expect(getFileFormat('page.htm')).toBe('html');
  });

  it('应该正确识别 pdf', () => {
    expect(getFileFormat('report.pdf')).toBe('pdf');
  });

  it('不支持的格式应该返回 null', () => {
    expect(getFileFormat('image.png')).toBeNull();
  });
});

describe('parseFile - TXT', () => {
  it('应该正确解析纯文本文件', async () => {
    const result = await parseFile({
      name: 'hello.txt',
      content: Buffer.from('Hello World'),
      size: 11,
    });
    expect(result.format).toBe('txt');
    expect(result.text).toBe('Hello World');
  });

  it('应该解析多行文本', async () => {
    const content = 'Line 1\nLine 2\nLine 3';
    const result = await parseFile({
      name: 'multi.txt',
      content: Buffer.from(content),
      size: content.length,
    });
    expect(result.text).toBe(content.trim());
  });

  it('应该处理空文本', async () => {
    const result = await parseFile({ name: 'empty.txt', content: Buffer.from(''), size: 0 });
    expect(result.text).toBe('');
  });

  it('应该支持 UTF-8 中文', async () => {
    const content = '你好世界';
    const result = await parseFile({
      name: 'chinese.txt',
      content: Buffer.from(content),
      size: Buffer.byteLength(content),
    });
    expect(result.text).toBe(content);
  });
});

describe('parseFile - MD', () => {
  it('应该直接返回 Markdown 内容', async () => {
    const md = '# Title\n\nSome **bold** text\n\n- list item';
    const result = await parseFile({ name: 'doc.md', content: Buffer.from(md), size: md.length });
    expect(result.format).toBe('md');
    expect(result.text).toBe(md);
  });

  it('应该保留 Markdown 格式标记', async () => {
    const md = '## Heading\n\n```js\nconst x = 1;\n```';
    const result = await parseFile({ name: 'code.md', content: Buffer.from(md), size: md.length });
    expect(result.text).toContain('## Heading');
    expect(result.text).toContain('```js');
  });
});

describe('parseFile - HTML', () => {
  it('应该提取纯文本并移除标签', async () => {
    const html = '<html><body><p>Hello World</p></body></html>';
    const result = await parseFile({
      name: 'page.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.format).toBe('html');
    expect(result.text).toContain('Hello World');
  });

  it('应该保留标题层级', async () => {
    const html = '<h1>Title</h1><h2>Section</h2><h3>Sub</h3>';
    const result = await parseFile({
      name: 'doc.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.text).toContain('# Title');
    expect(result.text).toContain('## Section');
    expect(result.text).toContain('### Sub');
  });

  it('应该保留列表结构', async () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>First</li><li>Second</li></ol>';
    const result = await parseFile({
      name: 'list.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.text).toContain('- Item 1');
    expect(result.text).toContain('- Item 2');
    expect(result.text).toContain('1. First');
    expect(result.text).toContain('2. Second');
  });

  it('应该保留链接', async () => {
    const html = '<a href="https://example.com">Example</a>';
    const result = await parseFile({
      name: 'link.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.text).toContain('[Example](https://example.com)');
  });

  it('应该保留强调文本', async () => {
    const html = '<strong>Bold</strong> and <em>italic</em>';
    const result = await parseFile({
      name: 'em.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.text).toContain('**Bold**');
    expect(result.text).toContain('*italic*');
  });

  it('应该保留表格结构', async () => {
    const html =
      '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>';
    const result = await parseFile({
      name: 'table.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.text).toContain('| Name');
    expect(result.text).toContain('| ---');
    expect(result.text).toContain('| Alice');
  });

  it('应该移除 script/style/iframe', async () => {
    const html =
      '<p>Hello</p><script>alert("xss")</script><style>.cls{color:red}</style><iframe src="ads"></iframe><img src="pic.jpg" />';
    const result = await parseFile({
      name: 'clean.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.text).toContain('Hello');
    expect(result.text).not.toContain('script');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('.cls');
    expect(result.text).not.toContain('iframe');
    expect(result.text).not.toContain('pic.jpg');
  });

  it('应该解码 HTML 实体', async () => {
    const html = '<p>&amp; &lt; &gt; &quot;</p>';
    const result = await parseFile({
      name: 'entities.html',
      content: Buffer.from(html),
      size: html.length,
    });
    expect(result.text).toContain('& < > "');
  });
});

describe('parseFile - PDF', () => {
  it('应该拒绝不支持的文件类型', async () => {
    await expect(
      parseFile({ name: 'file.png', content: Buffer.from(''), size: 0 }),
    ).rejects.toThrow('不支持的文件类型');
  });
});

describe('parseFile - 文件类型校验', () => {
  it('应该拒绝不支持的文件类型', async () => {
    await expect(
      parseFile({ name: 'file.docx', content: Buffer.from('test'), size: 4 }),
    ).rejects.toThrow('不支持的文件类型');
  });

  it('应该拒绝无扩展名的文件', async () => {
    await expect(
      parseFile({ name: 'README', content: Buffer.from('test'), size: 4 }),
    ).rejects.toThrow('不支持的文件类型');
  });
});
