#!/usr/bin/env node
// `npx contentia` resolves to this package (the core library), so this shim
// hands the invocation to the real command-line interface in `@contentia/cli`.
//
// 1. If `@contentia/cli` is installed in the current project, run its bin.
// 2. Otherwise download and run the matching version via `npm exec`.
//
// It is intentionally dependency-free so the core package stays runtime-agnostic
// and adds nothing to the install footprint of library consumers.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const self = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CLI = '@contentia/cli';

function findLocalCli() {
  // Walk node_modules upwards from the invoking project, then from this
  // package's own location. No resolver: the CLI's `exports` map hides its
  // package.json from `require.resolve`.
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      const manifestPath = path.join(dir, 'node_modules', ...CLI.split('/'), 'package.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.contentia;
        if (bin) return path.join(path.dirname(manifestPath), bin);
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

const local = findLocalCli();
let result;
if (local) {
  result = spawnSync(process.execPath, [local, ...args], { stdio: 'inherit' });
} else {
  const spec = `${CLI}@${self.version}`;
  process.stderr.write(
    `contentia: ${CLI} is not installed in this project; running ${spec} via npm exec.\n`
      + `contentia: install it with \`pnpm add -D ${CLI}\` (or npm/yarn) to skip this step next time.\n`,
  );
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  result = spawnSync(npm, ['exec', '--yes', `--package=${spec}`, '--', 'contentia', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
if (result.error) {
  process.stderr.write(`contentia: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
