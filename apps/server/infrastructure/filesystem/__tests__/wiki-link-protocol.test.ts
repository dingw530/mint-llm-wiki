import { describe, expect, it } from 'vitest';
import {
  createMintWikiLink,
  getWikiPathCandidates,
  normalizeWikiRelativePath,
  parseMintWikiLink,
  resolveWikiMarkdownLink,
} from '../wiki-link-protocol.js';

describe('wikiLinkProtocol', () => {
  it('creates and parses encoded protocol links', () => {
    const href = createMintWikiLink('pages/概念/目标 页面.md', '核心结论');
    expect(href).toBe(
      'mint-wiki://open?path=pages%2F%E6%A6%82%E5%BF%B5%2F%E7%9B%AE%E6%A0%87%20%E9%A1%B5%E9%9D%A2.md#%E6%A0%B8%E5%BF%83%E7%BB%93%E8%AE%BA',
    );
    expect(parseMintWikiLink(href || '')).toEqual({
      path: 'pages/概念/目标 页面.md',
      fragment: '核心结论',
    });
  });

  it('rejects unsafe or unsupported protocol targets', () => {
    expect(parseMintWikiLink('mint-wiki://read?path=pages%2F目标.md')).toBeNull();
    expect(parseMintWikiLink('mint-wiki://open?path=%2Fetc%2Fpasswd')).toBeNull();
    expect(parseMintWikiLink('mint-wiki://open?path=pages%2F..%2Fsecret.md')).toBeNull();
    expect(normalizeWikiRelativePath('../secret.md')).toBeNull();
  });

  it('resolves root-relative and legacy links consistently', () => {
    const source = 'pages/方法论/入口.md';
    expect(
      resolveWikiMarkdownLink(source, 'mint-wiki://open?path=pages%2F概念%2F目标.md')?.path,
    ).toBe('pages/概念/目标.md');
    expect(resolveWikiMarkdownLink(source, 'pages/概念/目标.md')?.path).toBe('pages/概念/目标.md');
    expect(resolveWikiMarkdownLink(source, '../概念/目标.md')?.path).toBe('pages/概念/目标.md');
  });

  it('returns the sanitized filename as a compatibility candidate', () => {
    expect(getWikiPathCandidates('pages/方法论/Loop Engineering 方法.md')).toEqual([
      'pages/方法论/Loop Engineering 方法.md',
      'pages/方法论/Loop-Engineering-方法.md',
    ]);
    expect(getWikiPathCandidates('pages/方法论/目标.md')).toEqual(['pages/方法论/目标.md']);
  });
});
