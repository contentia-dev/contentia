import { describe, expect, it } from 'vitest';

import { compileIgnoreList } from './ignore-list.js';

/** Assert which of `paths` one pattern matches, so each case reads as a small truth table. */
const expectMatches = (pattern: string, matches: string[], misses: string[]) => {
  const isIgnored = compileIgnoreList([pattern]);
  for (const path of matches) expect(isIgnored(path), `${pattern} should match ${path}`).toBe(true);
  for (const path of misses) expect(isIgnored(path), `${pattern} should not match ${path}`).toBe(false);
};

describe('compileIgnoreList', () => {
  it('matches a name at any depth with a leading ** segment', () => {
    expectMatches('**/.keep', ['.keep', 'posts/.keep', 'a/b/c/.keep'], ['posts', 'posts/.keeper', 'posts/keep']);
  });

  it('matches a folder and everything under it with a trailing ** segment', () => {
    expectMatches('drafts/**', ['drafts', 'drafts/a.md', 'drafts/x/y.md'], ['drafts-old/a.md', 'posts/drafts']);
  });

  it('lets a middle ** segment span zero or more segments', () => {
    expectMatches('a/**/b', ['a/b', 'a/x/b', 'a/x/y/b'], ['a/x/c', 'b', 'x/a/b']);
  });

  it('keeps * and ? within one segment, and matches dotfiles with them', () => {
    expectMatches('*.tmp', ['a.tmp', '.tmp'], ['dir/a.tmp', 'a.tmp.md']);
    expectMatches('file?.md', ['file1.md', 'file..md'], ['file.md', 'file12.md', 'file/.md']);
    expectMatches('a**b', ['ab', 'axyb'], ['ax/yb']);
  });

  it('expands {a,b} groups, including empty alternatives and ones that span segments', () => {
    expectMatches('**/*.{tmp,bak}', ['a.tmp', 'x/a.bak'], ['a.md', 'a.tmp.md']);
    expectMatches('{posts,pages}/.keep', ['posts/.keep', 'pages/.keep'], ['blog/.keep']);
    expectMatches('a{,.bak}', ['a', 'a.bak'], ['a.tmp']);
    expectMatches('{a/b,c}', ['a/b', 'c'], ['a', 'b']);
  });

  it('treats escaped characters as literals', () => {
    expectMatches('\\*.md', ['*.md'], ['a.md']);
    expectMatches('\\{a,b\\}', ['{a,b}'], ['a', 'b']);
    expectMatches('\\**', ['*', '*.md'], ['a.md']);
  });

  it('ignores leading, trailing, and repeated slashes in patterns and paths', () => {
    expectMatches('/drafts/', ['drafts', '/drafts/'], ['drafts/a.md']);
    expectMatches('**/.keep', ['/posts/.keep', 'posts//.keep'], []);
  });

  it('matches case-sensitively', () => {
    expectMatches('**/.DS_Store', ['.DS_Store'], ['.ds_store']);
  });

  it('skips blank patterns and # comments', () => {
    const isIgnored = compileIgnoreList(['', '   ', '#posts']);
    expect(isIgnored('posts')).toBe(false);
    expect(isIgnored('#posts')).toBe(false);
    expectMatches('\\#posts', ['#posts'], ['posts']);
  });

  it('matches nothing for an empty list', () => {
    expect(compileIgnoreList([])('.keep')).toBe(false);
  });

  it('matches when any pattern in the list does', () => {
    const isIgnored = compileIgnoreList(['**/.keep', '**/.DS_Store']);
    expect(isIgnored('a/.keep')).toBe(true);
    expect(isIgnored('a/.DS_Store')).toBe(true);
    expect(isIgnored('a/post.md')).toBe(false);
  });

  it.each([
    ['!drafts', 'negation'],
    ['[ab].md', 'character classes'],
    ['@(a|b)', 'extglobs'],
    ['**/*(a)', 'extglobs'],
    ['{a,{b,c}}', "can't be nested"],
    ['{a,b', 'no closing'],
    ['{1..3}', 'at least two'],
    ['{a}', 'at least two'],
    ['{a,b}'.repeat(9), 'more than 256'],
  ])('rejects unsupported pattern %s', (pattern, reason) => {
    expect(() => compileIgnoreList([pattern])).toThrow(reason);
  });

  it('stays fast on patterns that make backtracking regexes blow up', () => {
    // Exponential backtracking would never finish these; the matcher's walk is polynomial.
    const segment = 'a'.repeat(5000);
    expect(compileIgnoreList(['*a'.repeat(40) + 'b'])(segment)).toBe(false);

    const deep = Array.from({ length: 500 }, () => 'a').join('/');
    const globstars = Array.from({ length: 40 }, () => '**/a').join('/') + '/b';
    expect(compileIgnoreList([globstars])(deep)).toBe(false);
  });
});
