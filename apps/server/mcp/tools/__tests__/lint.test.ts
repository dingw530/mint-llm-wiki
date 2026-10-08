import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLintTool } from '../lint.js';

interface ToolOutput {
  content: Array<{ text: string }>;
}

const tempDirs: string[] = [];

function createWikiFixture(): string {
  const wikiPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-mcp-lint-'));
  tempDirs.push(wikiPath);
  fs.mkdirSync(path.join(wikiPath, 'pages/topic'), { recursive: true });
  fs.mkdirSync(path.join(wikiPath, 'pages/概念'), { recursive: true });
  fs.writeFileSync(path.join(wikiPath, '_manifest.json'), JSON.stringify({ version: 1, entries: [] }));
  return wikiPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function runLint(wikiPath: string): Promise<ToolOutput> {
  let handler: (() => Promise<ToolOutput>) | undefined;
  const server = {
    registerTool: (_name: string, _config: unknown, callback: () => Promise<ToolOutput>) => {
      handler = callback;
    },
  };
  registerLintTool(server as unknown as McpServer, { wikiPath });
  if (!handler) throw new Error('lint handler was not registered');
  return handler();
}

describe('MCP mint_wiki_lint', () => {
  it('resolves protocol links from the Wiki root', async () => {
    const wikiPath = createWikiFixture();
    fs.writeFileSync(path.join(wikiPath, 'pages/topic/source.md'), '[目标](mint-wiki://open?path=pages%2F概念%2Ftarget.md)');
    fs.writeFileSync(path.join(wikiPath, 'pages/概念/target.md'), '# Target');

    const output = await runLint(wikiPath);
    const payload = JSON.parse(output.content[0].text) as { issues: Array<{ type: string }> };
    expect(payload.issues.some((issue) => issue.type === 'broken_link')).toBe(false);
  });

  it('reports a real missing target without duplicating the source directory', async () => {
    const wikiPath = createWikiFixture();
    fs.writeFileSync(path.join(wikiPath, 'pages/topic/source.md'), '[目标](mint-wiki://open?path=pages%2F概念%2Fmissing.md)');

    const output = await runLint(wikiPath);
    const payload = JSON.parse(output.content[0].text) as { issues: Array<{ type: string; description: string }> };
    const broken = payload.issues.find((issue) => issue.type === 'broken_link');
    expect(broken?.description).toContain('pages/概念/missing.md');
    expect(broken?.description).not.toContain('pages/topic/pages/');
  });

  it('accepts links to filenames sanitized with hyphens', async () => {
    const wikiPath = createWikiFixture();
    fs.writeFileSync(path.join(wikiPath, 'pages/topic/source.md'), '[目标](pages/topic/目标 页面.md)');
    fs.writeFileSync(path.join(wikiPath, 'pages/topic/目标-页面.md'), '# Target');

    const output = await runLint(wikiPath);
    const payload = JSON.parse(output.content[0].text) as { issues: Array<{ type: string }> };
    expect(payload.issues.some((issue) => issue.type === 'broken_link')).toBe(false);
  });
});
