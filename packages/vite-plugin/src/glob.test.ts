import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ContentiaRepositories, createFsStorage, createRepositories } from './backend.js';
import { rewriteContentiaGlobs } from './glob.js';

let tmpDir: string;

/** Write a JSON storage object to `content/<key>.json` under the temp root. */
async function writeObject(key: string, content: unknown): Promise<void> {
  const file = path.join(tmpDir, 'content', `${key}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(content), 'utf8');
}

function repos(): ContentiaRepositories {
  return createRepositories(createFsStorage({ dir: path.join(tmpDir, 'content') }));
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contentia-glob-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('rewriteContentiaGlobs: eager form', () => {
  it('inlines a static import per matched key and builds a map keyed by source id', async () => {
    await writeObject('posts/a', { title: 'A' });
    await writeObject('posts/b', { title: 'B' });
    const code = `const posts = import.meta.glob('contentia:store/posts/*', { eager: true });`;
    const out = await rewriteContentiaGlobs(code, repos());
    expect(out).not.toBeNull();
    expect(out?.code).not.toContain('import.meta.glob');
    expect(out?.code).toContain('import * as __contentiaGlob0 from "contentia:store/posts/a"');
    expect(out?.code).toContain('import * as __contentiaGlob1 from "contentia:store/posts/b"');
    expect(out?.code).toContain('"contentia:store/posts/a": __contentiaGlob0');
    expect(out?.code).toContain('"contentia:store/posts/b": __contentiaGlob1');
  });
});

describe('rewriteContentiaGlobs: dynamic-import form', () => {
  it('builds a thunk map with no top-level imports when eager is omitted', async () => {
    await writeObject('posts/a', { title: 'A' });
    const code = `const posts = import.meta.glob('contentia:store/posts/*');`;
    const out = await rewriteContentiaGlobs(code, repos());
    expect(out).not.toBeNull();
    expect(out?.code).not.toContain('import.meta.glob');
    expect(out?.code).not.toMatch(/^import /m);
    expect(out?.code).toContain('"contentia:store/posts/a": () => import("contentia:store/posts/a")');
  });
});

describe('rewriteContentiaGlobs: { import: field } option', () => {
  it('imports only the named field instead of the whole module, eagerly', async () => {
    await writeObject('posts/a', { title: 'A', body: 'ignored' });
    const code = `const posts = import.meta.glob('contentia:store/posts/*', { import: 'title', eager: true });`;
    const out = await rewriteContentiaGlobs(code, repos());
    expect(out?.code).toContain('import { title as __contentiaGlob0 } from "contentia:store/posts/a"');
  });

  it('threads the named field through the dynamic-import thunk', async () => {
    await writeObject('posts/a', { title: 'A', body: 'ignored' });
    const code = `const posts = import.meta.glob('contentia:store/posts/*', { import: 'title' });`;
    const out = await rewriteContentiaGlobs(code, repos());
    expect(out?.code).toContain(
      '() => import("contentia:store/posts/a").then(m => m["title"])',
    );
  });
});

describe('rewriteContentiaGlobs: string/comment occurrences', () => {
  it('does not mistake a contentia glob spelled inside a string or comment for a real call', async () => {
    await writeObject('posts/a', { title: 'A' });
    const code = [
      `const s = "import.meta.glob('contentia:store/posts/*')";`,
      `// import.meta.glob('contentia:store/posts/*')`,
      `/* import.meta.glob('contentia:store/posts/*') */`,
    ].join('\n');
    expect(await rewriteContentiaGlobs(code, repos())).toBeNull();
  });

  it('rewrites only the real call and leaves a look-alike string literal untouched', async () => {
    await writeObject('posts/a', { title: 'A' });
    const code = [
      `const s = "import.meta.glob('contentia:store/posts/*')";`,
      `const real = import.meta.glob('contentia:store/posts/*');`,
    ].join('\n');
    const out = await rewriteContentiaGlobs(code, repos());
    expect(out).not.toBeNull();
    expect(out?.code).toContain(`const s = "import.meta.glob('contentia:store/posts/*')";`);
    expect(out?.code).toContain('() => import("contentia:store/posts/a")');
  });
});

describe('rewriteContentiaGlobs: .tsx fallback scan', () => {
  it('locates the call via the masked-scan fallback when JSX makes es-module-lexer throw', async () => {
    await writeObject('posts/a', { title: 'A' });
    // The JSX element (and the `x < y` comparison) is invalid input for
    // es-module-lexer, forcing parseContentiaGlobs onto the comment/string-masked
    // token scanner. The real call must still be found and rewritten.
    const code = [
      `export function Card({ x, y }) {`,
      `  return <div className="card">{x < y ? 'a' : 'b'}</div>;`,
      `}`,
      `const posts = import.meta.glob('contentia:store/posts/*');`,
    ].join('\n');
    const out = await rewriteContentiaGlobs(code, repos());
    expect(out).not.toBeNull();
    expect(out?.code).not.toContain('import.meta.glob');
    expect(out?.code).toContain('() => import("contentia:store/posts/a")');
    expect(out?.code).toContain(`<div className="card">`);
  });

  it('keeps masking string/comment look-alikes when the fallback scanner is in play', async () => {
    await writeObject('posts/a', { title: 'A' });
    const code = [
      `export const El = () => <p>hello</p>;`,
      `const s = "import.meta.glob('contentia:store/posts/*')";`,
      `// import.meta.glob('contentia:store/posts/*')`,
    ].join('\n');
    expect(await rewriteContentiaGlobs(code, repos())).toBeNull();
  });
});

describe('rewriteContentiaGlobs: non-contentia globs', () => {
  it('leaves an ordinary filesystem glob untouched', async () => {
    expect(await rewriteContentiaGlobs(`import.meta.glob('./pages/*.js')`, repos())).toBeNull();
  });
});
