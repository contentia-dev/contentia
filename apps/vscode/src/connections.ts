import { existsSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';

import type { DocumentsRepository } from 'contentia/documents';
import { DocumentsJsonApiProxyRepository } from 'contentia/documents/jsonapi-proxy';
import type { StorageRepository } from 'contentia/storage';
import { StorageJsonApiProxyRepository } from 'contentia/storage/jsonapi-proxy';

import { resolveCli } from './cli/resolve-cli.js';
import { type RunningServer, startServe } from './cli/serve-process.js';

export interface LocalConnectionConfig {
  readonly name: string;
  readonly type: 'local';
  readonly backend?: string;
  readonly options?: Record<string, unknown>;
}

export interface RemoteConnectionConfig {
  readonly name: string;
  readonly type: 'remote';
  readonly storageUrl?: string;
  readonly documentsUrl?: string;
}

export type ConnectionConfig = LocalConnectionConfig | RemoteConnectionConfig;

/**
 * One configured content source. A local connection runs `contentia local serve`
 * through the workspace's contentia on first use; a remote one talks to a
 * deployed API server. Either way the trees only ever see JSON:API proxy
 * repositories, so local and remote browse through the same code.
 */
export class Connection {
  private server: Promise<RunningServer> | undefined;
  private storageRepository: Promise<StorageRepository> | undefined;
  private documentsRepository: Promise<DocumentsRepository> | undefined;

  constructor(
    readonly config: ConnectionConfig,
    private readonly host: ConnectionHost,
  ) {}

  get name(): string {
    return this.config.name;
  }

  get hasStorage(): boolean {
    return this.config.type === 'local' || Boolean(this.config.storageUrl);
  }

  /** `contentia local serve` only exposes the Storage API today. */
  get hasDocuments(): boolean {
    return this.config.type === 'remote' && Boolean(this.config.documentsUrl);
  }

  /** The bound URL once a local server is up; shown in the tree. */
  localUrl: string | undefined;

  storage(): Promise<StorageRepository> {
    if (!this.storageRepository) {
      this.storageRepository = this.buildStorage();
      // A failed start should be retryable on the next refresh.
      this.storageRepository.catch(() => (this.storageRepository = undefined));
    }
    return this.storageRepository;
  }

  documents(): Promise<DocumentsRepository> {
    const config = this.config;
    if (config.type !== 'remote' || !config.documentsUrl) {
      return Promise.reject(new Error(`Connection "${this.name}" has no documentsUrl`));
    }
    this.documentsRepository ??= this.host.token(this.name).then(authToken =>
      new DocumentsJsonApiProxyRepository({ baseUrl: config.documentsUrl!, authToken })
    );
    return this.documentsRepository;
  }

  private async buildStorage(): Promise<StorageRepository> {
    if (this.config.type === 'remote') {
      if (!this.config.storageUrl) throw new Error(`Connection "${this.name}" has no storageUrl`);
      return new StorageJsonApiProxyRepository({
        baseUrl: this.config.storageUrl,
        authToken: await this.host.token(this.name),
      });
    }
    const server = await this.startServer(this.config);
    return new StorageJsonApiProxyRepository({ baseUrl: server.url, authToken: server.authToken });
  }

  private startServer(config: LocalConnectionConfig): Promise<RunningServer> {
    const backend = config.backend ?? 'fs';
    const cwd = this.host.workspaceFolder() ?? process.cwd();
    const options = { ...config.options };
    // A relative fs root is relative to the workspace, not to wherever VS Code was launched.
    if (backend === 'fs' && typeof options.root === 'string') options.root = path.resolve(cwd, options.root);

    const cli = this.host.cli();
    this.host.log(
      `[${this.name}] starting ${
        [cli.command, ...cli.args].join(' ')
      } local serve --backend ${backend} (${cli.source})`,
    );
    this.server = startServe({
      cli,
      backend,
      backendOptions: options,
      cwd,
      log: line => this.host.log(`[${this.name}] ${line}`),
    });
    return this.server.then(server => {
      this.localUrl = server.url;
      this.host.log(`[${this.name}] serving on ${server.url}`);
      server.onExit(code => {
        this.host.log(`[${this.name}] server exited (code ${code})`);
        this.reset();
        this.host.changed();
      });
      return server;
    });
  }

  /** Forget repositories; the next access rebuilds them (and restarts a local server). */
  reset(): void {
    this.storageRepository = undefined;
    this.documentsRepository = undefined;
    this.localUrl = undefined;
    this.server = undefined;
  }

  dispose(): void {
    const server = this.server;
    this.reset();
    void server?.then(s => s.stop(), () => {});
  }
}

/** What a connection needs from the extension, kept narrow so the class stays easy to follow. */
interface ConnectionHost {
  cli(): ReturnType<typeof resolveCli>;
  workspaceFolder(): string | undefined;
  /** The stored bearer token, if one was set with "Contentia: Set Access Token". */
  token(connectionName: string): Promise<string | undefined>;
  log(line: string): void;
  changed(): void;
}

const tokenKey = (name: string) => `contentia.token.${name}`;

export class ConnectionManager implements vscode.Disposable {
  private connections: Connection[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.emitter];

  /** Fires when the set of connections or a connection's state changes. */
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly output: vscode.OutputChannel,
  ) {
    this.reload();
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('contentia')) {
        this.reload();
        this.emitter.fire();
      }
    }));
  }

  all(): readonly Connection[] {
    return this.connections;
  }

  get(name: string): Connection | undefined {
    return this.connections.find(c => c.name === name);
  }

  restartLocal(): void {
    for (const c of this.connections) if (c.config.type === 'local') c.dispose();
    this.emitter.fire();
  }

  async setToken(name: string, token: string): Promise<void> {
    await this.secrets.store(tokenKey(name), token);
    this.get(name)?.reset();
    this.emitter.fire();
  }

  async addConnection(config: ConnectionConfig): Promise<void> {
    const settings = vscode.workspace.getConfiguration('contentia');
    const existing = settings.get<ConnectionConfig[]>('connections') ?? [];
    await settings.update(
      'connections',
      [...existing.filter(c => c.name !== config.name), config],
      vscode.ConfigurationTarget.Workspace,
    );
  }

  private reload(): void {
    for (const c of this.connections) c.dispose();
    const configs = vscode.workspace.getConfiguration('contentia').get<ConnectionConfig[]>('connections') ?? [];
    const host: ConnectionHost = {
      cli: () =>
        resolveCli({
          settingPath: vscode.workspace.getConfiguration('contentia').get<string>('cli.path') ?? '',
          envPath: process.env.CONTENTIA_CLI_PATH,
          workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
          platform: process.platform,
          exists: existsSync,
        }),
      workspaceFolder: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      token: async name => (await this.secrets.get(tokenKey(name))) || undefined,
      log: line => this.output.appendLine(line),
      changed: () => this.emitter.fire(),
    };
    const seen = new Set<string>();
    this.connections = [];
    for (const config of configs) {
      if (!config?.name || seen.has(config.name)) {
        this.output.appendLine(`Ignoring connection with a missing or duplicate name: ${JSON.stringify(config)}`);
        continue;
      }
      seen.add(config.name);
      this.connections.push(new Connection(config, host));
    }
  }

  dispose(): void {
    for (const c of this.connections) c.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
