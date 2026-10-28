import { describe, expect, it } from 'vitest';

import { isContentiaSource, isVirtualId, parseContentiaId, toSource, toVirtualId } from './protocol.js';

describe('isContentiaSource', () => {
  it('returns true for contentia: prefixed strings', () => {
    expect(isContentiaSource('contentia:doc/posts/hello')).toBe(true);
    expect(isContentiaSource('contentia:store/config')).toBe(true);
    expect(isContentiaSource('contentia:')).toBe(true);
  });

  it('returns false for virtual ids (NUL-prefixed)', () => {
    expect(isContentiaSource('\0contentia:doc/posts/hello')).toBe(false);
  });

  it('returns false for regular module specifiers', () => {
    expect(isContentiaSource('./module')).toBe(false);
    expect(isContentiaSource('some-package')).toBe(false);
    expect(isContentiaSource('')).toBe(false);
  });
});

describe('isVirtualId', () => {
  it('returns true for NUL-prefixed contentia virtual ids', () => {
    expect(isVirtualId('\0contentia:doc/posts/hello')).toBe(true);
    expect(isVirtualId('\0contentia:store/config')).toBe(true);
  });

  it('returns false for plain contentia: sources (no NUL)', () => {
    expect(isVirtualId('contentia:doc/posts/hello')).toBe(false);
  });

  it('returns false for regular module specifiers', () => {
    expect(isVirtualId('./module')).toBe(false);
    expect(isVirtualId('some-package')).toBe(false);
  });
});

describe('parseContentiaId', () => {
  describe('happy path — canonical namespaces', () => {
    it('parses doc namespace', () => {
      expect(parseContentiaId('contentia:doc/posts/hello')).toEqual({ namespace: 'doc', key: 'posts/hello' });
    });

    it('parses store namespace', () => {
      expect(parseContentiaId('contentia:store/config')).toEqual({ namespace: 'store', key: 'config' });
    });
  });

  describe('happy path — namespace aliases', () => {
    it('normalises docs → doc', () => {
      expect(parseContentiaId('contentia:docs/posts/hello')).toEqual({ namespace: 'doc', key: 'posts/hello' });
    });

    it('normalises document → doc', () => {
      expect(parseContentiaId('contentia:document/slug')).toEqual({ namespace: 'doc', key: 'slug' });
    });

    it('normalises documents → doc', () => {
      expect(parseContentiaId('contentia:documents/a/b')).toEqual({ namespace: 'doc', key: 'a/b' });
    });

    it('normalises storage → store', () => {
      expect(parseContentiaId('contentia:storage/config')).toEqual({ namespace: 'store', key: 'config' });
    });
  });

  describe('happy path — virtual id input', () => {
    it('parses NUL-prefixed virtual ids', () => {
      expect(parseContentiaId('\0contentia:doc/posts/hello')).toEqual({ namespace: 'doc', key: 'posts/hello' });
    });

    it('parses virtual store ids', () => {
      expect(parseContentiaId('\0contentia:store/config')).toEqual({ namespace: 'store', key: 'config' });
    });
  });

  describe('error paths', () => {
    it('throws when there is no slash', () => {
      expect(() => parseContentiaId('contentia:doc')).toThrow(/expected "contentia:<namespace>\/<key>"/);
    });

    it('throws for an unknown namespace', () => {
      expect(() => parseContentiaId('contentia:invalid/key')).toThrow(/Invalid contentia namespace "invalid"/);
    });

    it('throws when the key after the slash is empty', () => {
      expect(() => parseContentiaId('contentia:doc/')).toThrow(/missing key after "doc\/"/);
    });

    it('throws for unknown namespace in virtual id', () => {
      expect(() => parseContentiaId('\0contentia:invalid/key')).toThrow(/Invalid contentia namespace "invalid"/);
    });
  });
});

describe('toSource', () => {
  it('renders doc namespace', () => {
    expect(toSource({ namespace: 'doc', key: 'posts/hello' })).toBe('contentia:doc/posts/hello');
  });

  it('renders store namespace', () => {
    expect(toSource({ namespace: 'store', key: 'config' })).toBe('contentia:store/config');
  });

  it('round-trips through parseContentiaId', () => {
    const id = { namespace: 'doc' as const, key: 'a/b/c' };
    expect(parseContentiaId(toSource(id))).toEqual(id);
  });
});

describe('toVirtualId', () => {
  it('renders doc namespace with NUL prefix', () => {
    expect(toVirtualId({ namespace: 'doc', key: 'posts/hello' })).toBe('\0contentia:doc/posts/hello');
  });

  it('renders store namespace with NUL prefix', () => {
    expect(toVirtualId({ namespace: 'store', key: 'config' })).toBe('\0contentia:store/config');
  });

  it('round-trips through parseContentiaId', () => {
    const id = { namespace: 'store' as const, key: 'x/y' };
    expect(parseContentiaId(toVirtualId(id))).toEqual(id);
  });
});
