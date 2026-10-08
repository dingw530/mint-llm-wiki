import { describe, expect, it } from 'vitest';
import { createMintWikiLink, parseMintWikiLink } from '../wikiLinks';

describe('parseMintWikiLink', () => {
  it.each([
    ['mint-wiki://open?path=pages/intro.md', 'pages/intro.md'],
    ['mint-wiki://open?path=pages/%E7%9F%A5%E8%AF%86.md', 'pages/知识.md'],
  ])('parses valid protocol links', (href, expected) => expect(parseMintWikiLink(href)).toBe(expected));

  it.each(['https://example.com', 'mint-wiki://open?path=/etc/passwd', 'mint-wiki://open?path=../secret.md'])('rejects unsafe links: %s',
    (href) => expect(parseMintWikiLink(href)).toBeNull());

  it('creates canonical protocol links and rejects unknown actions', () => {
    const href = createMintWikiLink('pages/概念/目标 页面.md');
    expect(href).toBe('mint-wiki://open?path=pages%2F%E6%A6%82%E5%BF%B5%2F%E7%9B%AE%E6%A0%87%20%E9%A1%B5%E9%9D%A2.md');
    expect(parseMintWikiLink(href || '')).toBe('pages/概念/目标 页面.md');
    expect(parseMintWikiLink('mint-wiki://read?path=pages%2F目标.md')).toBeNull();
  });
});
