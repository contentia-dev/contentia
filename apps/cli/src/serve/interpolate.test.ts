import { describe, expect, it } from 'vitest';

import { interpolateConfig, type InterpolateOptions } from './interpolate.js';

const files: Record<string, string> = {
  '/run/secrets/token': 'gh-token\n',
  '/run/secrets/key.pem': '-----BEGIN KEY-----\nabc\n-----END KEY-----\n',
  '/etc/contentia/relative.txt': 'relative',
  '/run/secrets/crlf': 'value\r\n',
  '/run/secrets/spaced': 'value  \n\n',
};

const options: InterpolateOptions = {
  baseDir: '/etc/contentia',
  env: { TOKEN: 'from-env', EMPTY: '' },
  readFile: p => {
    const contents = files[p];
    if (contents === undefined) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    return contents;
  },
};

const run = (value: unknown) => interpolateConfig(value, options);

describe('interpolateConfig', () => {
  it('resolves env and file references anywhere in the tree', () => {
    expect(run({
      storage: { options: { token: '${env:TOKEN}', privateKey: '${file:/run/secrets/key.pem}' } },
      list: ['${file:/run/secrets/token}', 42, true, null],
    })).toEqual({
      storage: { options: { token: 'from-env', privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----' } },
      list: ['gh-token', 42, true, null],
    });
  });

  it('embeds references inside longer strings', () => {
    expect(run('postgres://app:${file:/run/secrets/token}@db:5432/${env:TOKEN}')).toBe(
      'postgres://app:gh-token@db:5432/from-env',
    );
  });

  it('uses the fallback for unset or empty variables', () => {
    expect(run('${env:MISSING:-8080}')).toBe('8080');
    expect(run('${env:EMPTY:-x}')).toBe('x');
    expect(run('${env:MISSING:-}')).toBe('');
    expect(run('${env:TOKEN:-unused}')).toBe('from-env');
  });

  it('strips exactly one trailing newline from files', () => {
    expect(run('${file:/run/secrets/crlf}')).toBe('value');
    expect(run('${file:/run/secrets/spaced}')).toBe('value  \n');
  });

  it('resolves relative file paths against the config directory', () => {
    expect(run('${file:relative.txt}')).toBe('relative');
  });

  it('turns $${ into a literal ${ and leaves other dollars alone', () => {
    expect(run('$${env:TOKEN} costs $5')).toBe('${env:TOKEN} costs $5');
  });

  it('does not touch keys', () => {
    expect(run({ '${env:TOKEN}': 'x' })).toEqual({ '${env:TOKEN}': 'x' });
  });

  it('fails closed, naming the setting but not the value', () => {
    expect(() => run({ auth: { secret: '${env:MISSING}' } })).toThrow(
      'auth.secret: environment variable MISSING is not set',
    );
    expect(() => run({ a: ['${env:EMPTY}'] })).toThrow('a[0]: environment variable EMPTY is not set');
    expect(() => run({ k: '${file:/run/secrets/absent}' })).toThrow(
      'k: secret file /run/secrets/absent does not exist',
    );
    expect(() => run({ k: '${vault:secret/x}' })).toThrow('k: unknown reference "${vault:secret/x}"');
    expect(() => run({ k: '${env:NOT-VALID}' })).toThrow('not a valid environment variable name');
    expect(() => run({ k: '${file:}' })).toThrow('needs a path');
    expect(() => run({ k: 'abc ${env:TOKEN' })).toThrow('k: unterminated "${"');
  });
});
