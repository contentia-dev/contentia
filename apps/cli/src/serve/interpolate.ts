import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves `${…}` references in a parsed config tree. Runs on string values
 * *after* YAML/JSON parsing, so a secret can never inject config structure.
 *
 *   ${env:NAME}            environment variable; unset or empty is an error
 *   ${env:NAME:-fallback}  environment variable, or `fallback` when unset or empty
 *   ${file:/path}          file contents (one trailing newline stripped); relative
 *                          paths resolve against the config file's directory
 *   $${                    a literal `${`
 *
 * This is the whole secret-store integration: Kubernetes Secrets, External
 * Secrets, Vault Agent, the Secrets Store CSI driver and Docker secrets all
 * deliver secrets as env vars or mounted files.
 */
export interface InterpolateOptions {
  /** Directory relative `${file:…}` paths resolve against. */
  readonly baseDir: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readFile?: (absolutePath: string) => string;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const readFileUtf8 = (absolutePath: string): string => fs.readFileSync(absolutePath, 'utf8');

const resolveReference = (reference: string, at: string, options: InterpolateOptions): string => {
  const colon = reference.indexOf(':');
  const kind = colon === -1 ? reference : reference.slice(0, colon);
  const body = colon === -1 ? '' : reference.slice(colon + 1);

  if (kind === 'env') {
    const fallbackAt = body.indexOf(':-');
    const name = fallbackAt === -1 ? body : body.slice(0, fallbackAt);
    if (!ENV_NAME.test(name)) {
      throw new Error(`${at}: "\${env:${body}}" is not a valid environment variable name`);
    }
    const value = (options.env ?? process.env)[name];
    if (value !== undefined && value !== '') return value;
    if (fallbackAt !== -1) return body.slice(fallbackAt + 2);
    throw new Error(`${at}: environment variable ${name} is not set`);
  }

  if (kind === 'file') {
    if (body === '') throw new Error(`${at}: "\${file:}" needs a path`);
    const absolutePath = path.resolve(options.baseDir, body);
    let contents: string;
    try {
      contents = (options.readFile ?? readFileUtf8)(absolutePath);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const reason = code === 'ENOENT' ? 'does not exist' : code === 'EACCES' ? 'is not readable' : String(err);
      throw new Error(`${at}: secret file ${absolutePath} ${reason}`, { cause: err });
    }
    // `echo secret > file` and most editors add a newline that is not part of
    // the secret; strip exactly one so intentional trailing whitespace survives.
    return contents.replace(/\r?\n$/, '');
  }

  throw new Error(`${at}: unknown reference "\${${reference}}" (supported: \${env:…}, \${file:…})`);
};

const interpolateString = (value: string, at: string, options: InterpolateOptions): string => {
  let out = '';
  let i = 0;
  while (i < value.length) {
    if (value.startsWith('$${', i)) {
      out += '${';
      i += 3;
      continue;
    }
    if (value.startsWith('${', i)) {
      const end = value.indexOf('}', i + 2);
      if (end === -1) throw new Error(`${at}: unterminated "\${" in config value`);
      out += resolveReference(value.slice(i + 2, end), at, options);
      i = end + 1;
      continue;
    }
    out += value[i];
    i += 1;
  }
  return out;
};

/**
 * Return a copy of `value` with every `${…}` reference in its string leaves
 * resolved. Keys are left untouched. Errors name the config path
 * (e.g. `storage.options.token`) but never the resolved value.
 */
export const interpolateConfig = (value: unknown, options: InterpolateOptions, at = '(root)'): unknown => {
  if (typeof value === 'string') return interpolateString(value, at, options);
  if (Array.isArray(value)) return value.map((item, index) => interpolateConfig(item, options, `${at}[${index}]`));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map((
        [key, child],
      ) => [key, interpolateConfig(child, options, at === '(root)' ? key : `${at}.${key}`)]),
    );
  }
  return value;
};
