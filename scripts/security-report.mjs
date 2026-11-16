#!/usr/bin/env node
/**
 * Local security report. Runs every installed scanner in parallel and prints
 * one summary: dependency advisories, static-analysis findings, secrets in git
 * history, and the repo's OpenSSF Scorecard score.
 *
 * Usage (from repo root):
 *   pnpm security           # summary table
 *   pnpm security --json    # the same numbers as JSON
 *
 * pnpm audit always runs. Each other scanner is skipped when its binary is not
 * on PATH (same rule as the trufflehog step in .husky/pre-push):
 *   brew install osv-scanner semgrep gitleaks scorecard
 *
 * Scorecard grades the repository as published on GitHub (branch protection,
 * workflows, reviews), so local changes don't move it until they are pushed.
 * It needs a GitHub token: GITHUB_AUTH_TOKEN, or a `gh auth login` session.
 *
 * Informational only: exits 0 whatever it finds. The blocking gate is
 * `pnpm security:gate`, run by .husky/pre-push.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REPO = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).repository.replace(/^https:\/\//, '');
// Display order; scanners use either moderate (advisories) or medium (semgrep).
const SEVERITIES = ['critical', 'high', 'moderate', 'medium', 'low', 'unscored', 'leaks'];

/** Runs a command and never rejects; scanners exit non-zero when they find something. */
function run(cmd, args, env = {}) {
  return new Promise(done => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', err => done({ missing: err.code === 'ENOENT', stdout, stderr: String(err) }));
    child.on('close', () => done({ missing: false, stdout, stderr }));
  });
}

function parse(result, tool) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    const tail = result.stderr.trim().split('\n').slice(-2).join(' ');
    throw new Error(`${tool} printed no JSON${tail ? `: ${tail}` : ''}`);
  }
}

const skip = reason => ({ skipped: reason });
const notInstalled = tool => skip(`${tool} not installed (brew install ${tool})`);

async function pnpmAudit(prodOnly) {
  const result = await run('pnpm', ['audit', '--json', ...(prodOnly ? ['--prod'] : [])]);
  const { critical, high, moderate, low } = parse(result, 'pnpm audit').metadata.vulnerabilities;
  return { counts: { critical, high, moderate, low } };
}

/** OSV groups aliases (GHSA + CVE of one flaw) together; count groups, bucketed by CVSS. */
async function osvScanner() {
  const result = await run('osv-scanner', ['scan', 'source', '--recursive', '--format', 'json', '.']);
  if (result.missing) return notInstalled('osv-scanner');
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, unscored: 0 };
  for (const source of parse(result, 'osv-scanner').results ?? []) {
    for (const pkg of source.packages ?? []) {
      for (const group of pkg.groups ?? []) {
        const cvss = Number(group.max_severity);
        const bucket = !cvss
          ? 'unscored'
          : cvss >= 9
          ? 'critical'
          : cvss >= 7
          ? 'high'
          : cvss >= 4
          ? 'moderate'
          : 'low';
        counts[bucket]++;
      }
    }
  }
  return { counts };
}

async function semgrep() {
  const configs = ['p/default', 'p/typescript', 'p/nodejsscan'].flatMap(c => ['--config', c]);
  const excludes = ['examples', '*.test.ts', '*.test.mts'].flatMap(e => ['--exclude', e]);
  const result = await run('semgrep', ['scan', ...configs, ...excludes, '--metrics=off', '--json', '--quiet', '.']);
  if (result.missing) return notInstalled('semgrep');
  // Older rules use ERROR/WARNING/INFO, newer ones CRITICAL..LOW; fold both into three levels.
  const level = { CRITICAL: 'high', HIGH: 'high', ERROR: 'high', MEDIUM: 'medium', WARNING: 'medium' };
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of parse(result, 'semgrep').results) counts[level[finding.extra.severity] ?? 'low']++;
  return { counts };
}

async function gitleaks() {
  const dir = mkdtempSync(join(tmpdir(), 'contentia-gitleaks-'));
  const reportPath = join(dir, 'report.json');
  try {
    const args = ['git', '--no-banner', '--redact', '--report-format', 'json', '--report-path', reportPath, '.'];
    const result = await run('gitleaks', args);
    if (result.missing) return notInstalled('gitleaks');
    return { counts: { leaks: JSON.parse(readFileSync(reportPath, 'utf8')).length } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function scorecard() {
  const token = process.env.GITHUB_AUTH_TOKEN || (await run('gh', ['auth', 'token'])).stdout.trim();
  if (!token) return skip('no GitHub token (set GITHUB_AUTH_TOKEN or run gh auth login)');
  const result = await run('scorecard', [`--repo=${REPO}`, '--format=json'], { GITHUB_AUTH_TOKEN: token });
  if (result.missing) return notInstalled('scorecard');
  const report = parse(result, 'scorecard');
  // -1 means the check didn't apply (e.g. no releases yet), so it isn't a weakness.
  const weakest = report.checks
    .filter(check => check.score >= 0 && check.score < 10)
    .sort((a, b) => a.score - b.score)
    .map(check => ({ name: check.name, score: check.score, reason: check.reason }));
  return { score: report.score, weakest };
}

async function safely(scan) {
  try {
    return await scan();
  } catch (err) {
    return { error: err.message };
  }
}

const scans = [
  { area: 'Dependencies', tool: 'pnpm audit (all)', key: 'pnpmAuditAll', scan: () => pnpmAudit(false) },
  { area: '', tool: 'pnpm audit (prod)', key: 'pnpmAuditProd', scan: () => pnpmAudit(true) },
  { area: '', tool: 'osv-scanner', key: 'osvScanner', scan: osvScanner },
  { area: 'Code', tool: 'semgrep', key: 'semgrep', scan: semgrep },
  { area: 'Secrets', tool: 'gitleaks (history)', key: 'gitleaks', scan: gitleaks },
  { area: 'Repository', tool: 'OpenSSF Scorecard', key: 'scorecard', scan: scorecard },
];

const results = await Promise.all(scans.map(s => safely(s.scan)));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries(scans.map((s, i) => [s.key, results[i]])), null, 2));
} else {
  const describe = result => {
    if (result.skipped) return `skipped: ${result.skipped}`;
    if (result.error) return `error: ${result.error}`;
    if ('score' in result) return `${result.score} / 10  (scores what is pushed to GitHub)`;
    return Object.entries(result.counts)
      .sort(([a], [b]) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b))
      .map(([name, n]) => `${n} ${name}`)
      .join(' · ');
  };

  console.log('\nContentia security report\n');
  scans.forEach((s, i) => {
    console.log(`  ${s.area.padEnd(13)} ${s.tool.padEnd(20)} ${describe(results[i])}`);
    for (const check of results[i].weakest?.slice(0, 6) ?? []) {
      console.log(`  ${''.padEnd(13)} ${''.padEnd(20)}   ${String(check.score).padStart(2)}  ${check.name}`);
    }
  });
  console.log('');
}
