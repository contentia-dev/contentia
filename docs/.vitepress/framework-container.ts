import type { MarkdownRenderer } from 'vitepress';

import { FRAMEWORKS, isFrameworkId } from './frameworks';

type BlockState = Parameters<Parameters<MarkdownRenderer['block']['ruler']['before']>[2]>[0];
type CoreState = Parameters<Parameters<MarkdownRenderer['core']['ruler']['push']>[1]>[0];

const OPEN = /^:::\s*fw\s+(.+?)\s*$/;
const ANY_OPEN = /^:::\s*\S/;
const CLOSE = /^:::\s*$/;

const lineAt = (state: BlockState, line: number) =>
  state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);

/**
 * `::: fw express fastify` … `:::` renders as `<div class="fw" data-fw="express fastify">`, shown
 * only when the reader picked one of those frameworks (see frameworks.ts). Other `:::` containers
 * (code groups, tips) may nest inside. An unknown framework id fails the build.
 */
export function frameworkContainer(md: MarkdownRenderer): void {
  md.block.ruler.before('fence', 'framework', (state, startLine, endLine, silent) => {
    const open = OPEN.exec(lineAt(state, startLine));
    if (!open) return false;
    const frameworks = open[1]!.split(/\s+/);
    const unknown = frameworks.filter(id => !isFrameworkId(id));
    if (unknown.length) throw new Error(`::: fw lists unknown framework(s): ${unknown.join(', ')}`);
    if (silent) return true;

    // Find the matching `:::`, counting nested containers.
    let depth = 1;
    let line = startLine;
    while (++line < endLine) {
      const text = lineAt(state, line);
      if (ANY_OPEN.test(text)) depth++;
      else if (CLOSE.test(text) && --depth === 0) break;
    }

    const parentType = state.parentType;
    const lineMax = state.lineMax;
    state.parentType = 'container' as typeof state.parentType;
    state.lineMax = line;

    const openToken = state.push('fw_open', 'div', 1);
    openToken.block = true;
    openToken.map = [startLine, line];
    openToken.attrSet('class', 'fw');
    openToken.attrSet('data-fw', frameworks.join(' '));
    state.md.block.tokenize(state, startLine + 1, line);
    state.push('fw_close', 'div', -1).block = true;

    state.parentType = parentType;
    state.lineMax = lineMax;
    state.line = line + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  md.core.ruler.push('framework_runs', frameworkRuns);
}

/**
 * Adjacent `::: fw` containers are alternatives for one step: wrap each run of two or more in
 * `<div class="fw-run">` with a `<FrameworkTabs />` switcher on top. A run must cover every
 * framework, so whatever the reader picked, every switcher has content under it; a gap fails the
 * build. A lone container (a note for some frameworks) gets no switcher.
 */
function frameworkRuns(state: CoreState): void {
  const tokens = state.tokens;
  // Index just past the fw_close that matches the fw_open at `start`.
  const containerEnd = (start: number) => {
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
      if (tokens[i]!.type === 'fw_open') depth++;
      else if (tokens[i]!.type === 'fw_close' && --depth === 0) return i + 1;
    }
    return tokens.length;
  };

  for (let start = 0; start < tokens.length; start++) {
    if (tokens[start]!.type !== 'fw_open') continue;
    const covered = new Set<string>();
    let containers = 0;
    let end = start;
    while (tokens[end]?.type === 'fw_open') {
      tokens[end]!.attrGet('data-fw')!.split(' ').forEach(id => covered.add(id));
      containers++;
      end = containerEnd(end);
    }
    if (containers < 2) {
      start = end - 1;
      continue;
    }
    const missing = FRAMEWORKS.filter(f => !covered.has(f.id)).map(f => f.id);
    if (missing.length) {
      const line = (tokens[start]!.map?.[0] ?? 0) + 1;
      throw new Error(
        `${state.env.relativePath ?? 'a page'}:${line}: the ::: fw run here has no content for ${missing.join(', ')}`,
      );
    }
    const open = new state.Token('html_block', '', 0);
    open.content = '<div class="fw-run"><FrameworkTabs />\n';
    const close = new state.Token('html_block', '', 0);
    close.content = '</div>\n';
    tokens.splice(end, 0, close);
    tokens.splice(start, 0, open);
    start = end + 1;
  }
}
