// Glob matching for storage ignore lists, without regular expressions.
//
// Every storage backend takes an `ignoreList` of glob patterns (`**/.keep`, `**/.DS_Store`, …) and
// drops matching paths from listings and change notifications. This module supports the subset of
// glob syntax those lists need; the README's "Ignore lists" section documents it.
//
// Matching walks the pattern and the path with a single backtrack point per level (segments, then
// characters within a segment), so a test takes at most O(pattern × path) steps however the
// wildcards are arranged. There is no regex, and no backtracking blow-up for a pattern to trigger.

/** A `**` segment: zero or more whole path segments. */
const GLOBSTAR = Symbol('**');
/** `*`: any run of characters within one segment, including none. */
const ANY_RUN = Symbol('*');
/** `?`: exactly one character within one segment. */
const ANY_CHAR = Symbol('?');

type CharToken = string | typeof ANY_RUN | typeof ANY_CHAR;
/** One pattern segment: a literal name, or the characters and wildcards to match one against. */
type Segment = string | readonly CharToken[];
type CompiledPattern = readonly (Segment | typeof GLOBSTAR)[];

/** The most patterns one ignore-list entry's `{a,b}` groups may expand to. */
const MAX_BRACE_EXPANSION = 256;

/** Tests a storage path against a compiled ignore list. */
export type IgnoreMatcher = (path: string) => boolean;

/**
 * Compile an ignore list into a function that reports whether a path matches any of its patterns.
 *
 * Supports `*`, `?`, `**` segments, `{a,b}` alternatives, and `\` escapes. Wildcards match
 * dotfiles, matching is case-sensitive, and empty path segments (leading, trailing, or repeated
 * `/`) are ignored. Blank patterns and patterns starting with `#` are skipped.
 *
 * @throws Error when a pattern uses syntax this matcher doesn't support: negation (`!pattern`),
 *   character classes (`[abc]`), extglobs (`@(a|b)`), nested or comma-less brace groups (including
 *   ranges like `{1..3}`), or brace groups that expand to more than 256 patterns.
 */
export const compileIgnoreList = (patterns: readonly string[]): IgnoreMatcher => {
  const compiled = patterns.flatMap(compilePattern);
  if (compiled.length === 0) return () => false;
  return path => {
    const parts = path.split('/').filter(part => part.length > 0);
    return compiled.some(pattern => matchSegments(pattern, parts));
  };
};

const invalid = (pattern: string, reason: string): Error =>
  new Error(`Invalid ignore pattern "${pattern}": ${reason}.`);

const compilePattern = (pattern: string): CompiledPattern[] => {
  if (pattern.trim() === '' || pattern.startsWith('#')) return [];
  if (pattern.startsWith('!')) throw invalid(pattern, 'negation ("!pattern") is not supported');
  return expandBraces(pattern).map(alternative => tokenize(pattern, alternative));
};

/**
 * Expand every `{a,b}` group into the patterns it stands for. Escapes are kept as written, so
 * {@link tokenize} still sees which characters were escaped.
 */
const expandBraces = (pattern: string): string[] => {
  // Each piece is the list of strings that position can take: one for literal text, several for
  // a brace group.
  const pieces: string[][] = [];
  let literal = '';
  let total = 1;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      literal += pattern.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== '{') {
      literal += ch;
      i++;
      continue;
    }
    const alternatives: string[] = [];
    let current = '';
    let j = i + 1;
    let closed = false;
    while (j < pattern.length) {
      const inner = pattern[j];
      if (inner === '\\') {
        current += pattern.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (inner === '{') throw invalid(pattern, "brace groups can't be nested");
      if (inner === ',') {
        alternatives.push(current);
        current = '';
      } else if (inner === '}') {
        alternatives.push(current);
        closed = true;
        break;
      } else {
        current += inner;
      }
      j++;
    }
    if (!closed) throw invalid(pattern, '"{" has no closing "}"');
    if (alternatives.length < 2) {
      throw invalid(
        pattern,
        'a brace group needs at least two comma-separated alternatives (ranges like "{1..3}" are not supported)',
      );
    }
    total *= alternatives.length;
    if (total > MAX_BRACE_EXPANSION) {
      throw invalid(pattern, `its brace groups expand to more than ${MAX_BRACE_EXPANSION} patterns`);
    }
    pieces.push([literal], alternatives);
    literal = '';
    i = j + 1;
  }
  pieces.push([literal]);
  return pieces.reduce<string[]>(
    (prefixes, choices) => prefixes.flatMap(prefix => choices.map(choice => prefix + choice)),
    [''],
  );
};

/** Split one brace-free pattern into segments, resolving escapes and wildcards. */
const tokenize = (pattern: string, alternative: string): CompiledPattern => {
  const segments: (Segment | typeof GLOBSTAR)[] = [];
  let tokens: CharToken[] = [];
  let hasWildcard = false;
  let segmentStart = 0;

  const endSegment = (end: number) => {
    const source = alternative.slice(segmentStart, end);
    if (source === '**') {
      if (segments.at(-1) !== GLOBSTAR) segments.push(GLOBSTAR);
    } else if (source !== '') {
      segments.push(hasWildcard ? tokens : tokens.join(''));
    }
    tokens = [];
    hasWildcard = false;
    segmentStart = end + 1;
  };

  for (let i = 0; i < alternative.length; i++) {
    const ch = alternative[i];
    const next = alternative[i + 1];
    if (ch === '\\') {
      // A trailing `\` has nothing to escape and stands for itself.
      tokens.push(next ?? '\\');
      i++;
      continue;
    }
    if (ch === '/') {
      endSegment(i);
      continue;
    }
    if (next === '(' && (ch === '@' || ch === '!' || ch === '+' || ch === '*' || ch === '?')) {
      throw invalid(pattern, `extglobs ("${ch}(...)") are not supported`);
    }
    if (ch === '[') throw invalid(pattern, 'character classes ("[...]") are not supported');
    if (ch === '*') {
      hasWildcard = true;
      if (tokens.at(-1) !== ANY_RUN) tokens.push(ANY_RUN);
    } else if (ch === '?') {
      hasWildcard = true;
      tokens.push(ANY_CHAR);
    } else {
      tokens.push(ch);
    }
  }
  endSegment(alternative.length);
  return segments;
};

/**
 * Whether `parts` matches `pattern`, where each `**` spans zero or more parts and every other
 * segment matches exactly one. On a mismatch, only the most recent `**` is retried one part
 * further on: everything an earlier `**` could absorb, the later one can too.
 */
const matchSegments = (pattern: CompiledPattern, parts: readonly string[]): boolean => {
  let p = 0;
  let i = 0;
  let starP = -1;
  let starI = 0;
  while (i < parts.length) {
    const segment = pattern[p];
    if (segment === GLOBSTAR) {
      starP = p++;
      starI = i;
    } else if (segment !== undefined && matchSegment(segment, parts[i])) {
      p++;
      i++;
    } else if (starP !== -1) {
      p = starP + 1;
      i = ++starI;
    } else {
      return false;
    }
  }
  while (pattern[p] === GLOBSTAR) p++;
  return p === pattern.length;
};

/** The same walk as {@link matchSegments}, one level down: `*` over characters within a segment. */
const matchSegment = (segment: Segment, part: string): boolean => {
  if (typeof segment === 'string') return segment === part;
  let t = 0;
  let i = 0;
  let starT = -1;
  let starI = 0;
  while (i < part.length) {
    const token = segment[t];
    if (token === ANY_RUN) {
      starT = t++;
      starI = i;
    } else if (token !== undefined && (token === ANY_CHAR || token === part[i])) {
      t++;
      i++;
    } else if (starT !== -1) {
      t = starT + 1;
      i = ++starI;
    } else {
      return false;
    }
  }
  while (segment[t] === ANY_RUN) t++;
  return t === segment.length;
};
