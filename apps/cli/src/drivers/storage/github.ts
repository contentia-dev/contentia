import fs from 'node:fs';

import { Octokit } from '@octokit/rest';
import { GithubStorageRepository } from 'contentia/storage-github';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

// App-mode credentials (GitHub App installation token flow)
interface GithubAppOptions {
  readonly mode: 'app';
  readonly appId: string | number;
  readonly privateKey: string;
  readonly installationId: string | number;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultFileExtension: string;
  readonly commitAuthor?: { name: string, email: string };
}

// PAT / OAuth token mode (personal access token or fine-grained token)
interface GithubTokenOptions {
  readonly mode: 'token';
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultFileExtension: string;
  readonly commitAuthor?: { name: string, email: string };
}

type GithubOptions = GithubAppOptions | GithubTokenOptions;

const readBaseFields = (raw: Record<string, unknown>) => {
  const owner = raw.owner;
  const repo = raw.repo;
  const branch = raw.branch;
  if (typeof owner !== 'string' || !owner) throw new Error('github driver: "owner" is required');
  if (typeof repo !== 'string' || !repo) throw new Error('github driver: "repo" is required');
  if (typeof branch !== 'string' || !branch) throw new Error('github driver: "branch" is required');
  const defaultFileExtension = typeof raw.defaultFileExtension === 'string'
    ? raw.defaultFileExtension
    : (typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md');
  const commitAuthor = raw.commitAuthor && typeof raw.commitAuthor === 'object'
    ? (raw.commitAuthor as { name: string, email: string })
    : undefined;
  return { owner, repo, branch, defaultFileExtension, commitAuthor };
};

const readOptions = (raw: Record<string, unknown>): GithubOptions => {
  const token = raw.token ?? process.env.GITHUB_TOKEN;
  const appId = raw.appId ?? process.env.GITHUB_APP_ID;

  // PAT / token path — no App credentials required
  if (typeof token === 'string' && token.length > 0) {
    return { mode: 'token', token, ...readBaseFields(raw) };
  }

  // GitHub App path
  if (typeof appId !== 'string' && typeof appId !== 'number') {
    throw new Error(
      'github driver: provide "token" (PAT/fine-grained token) '
        + 'or GitHub App credentials ("appId", "privateKey"/"privateKeyPath", "installationId")',
    );
  }
  const installationId = raw.installationId ?? process.env.GITHUB_INSTALLATION_ID;
  if (typeof installationId !== 'string' && typeof installationId !== 'number') {
    throw new Error('github driver: "installationId" is required for GitHub App auth');
  }

  // Accept the PEM literally OR via a path (`privateKeyPath`) — the latter is
  // friendlier for shell and JSON configs.
  let privateKey: string | undefined;
  if (typeof raw.privateKey === 'string' && raw.privateKey.length > 0) {
    privateKey = raw.privateKey;
  } else if (typeof raw.privateKeyPath === 'string' && raw.privateKeyPath.length > 0) {
    privateKey = fs.readFileSync(raw.privateKeyPath, 'utf8');
  } else if (process.env.GITHUB_APP_PRIVATE_KEY) {
    privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  }
  if (!privateKey) {
    throw new Error(
      'github driver: provide "privateKey" (PEM string), "privateKeyPath" (file path), '
        + 'or GITHUB_APP_PRIVATE_KEY in the environment',
    );
  }

  return { mode: 'app', appId, privateKey, installationId, ...readBaseFields(raw) };
};

export const githubDriver: StorageDriver = {
  name: 'github',
  packageName: 'contentia',
  version: '*',
  subpath: 'storage-github',
  description: 'GitHub repository (commits per write; PAT or GitHub App auth)',
  build(raw) {
    const options = readOptions(raw);
    const common = {
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      defaultFileExtension: options.defaultFileExtension,
      commitAuthor: options.commitAuthor,
      serializerRegistry: defaultSerializerRegistry,
    };
    // A token gets a pre-configured Octokit; App credentials let the
    // repository mint and refresh installation tokens itself.
    return options.mode === 'token'
      ? new GithubStorageRepository({ ...common, octokit: new Octokit({ auth: options.token }) })
      : new GithubStorageRepository({
        ...common,
        appId: options.appId,
        privateKey: options.privateKey,
        installationId: options.installationId,
      });
  },
};
