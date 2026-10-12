import * as vscode from 'vscode';

import type { Connection, ConnectionManager } from '../connections.js';
import { contentUri } from '../content-provider.js';
import type { Entry, Page } from '../explorer/listing.js';
import { listDocumentsFolder, listStorageFolder } from '../explorer/listing.js';

export type Source = 'storage' | 'documents';

export type Node =
  | { readonly type: 'connection', readonly connection: Connection }
  | { readonly type: 'entry', readonly connection: Connection, readonly entry: Entry }
  | { readonly type: 'more', readonly connection: Connection, readonly folder: string, readonly parent: Node }
  | { readonly type: 'message', readonly text: string, readonly error: boolean };

interface FolderState {
  nodes: Node[];
  nextPage: number | undefined;
}

/**
 * One tree view over every connection that has the given source. Children are
 * listed a page at a time; a "Load more" row fetches the next page and appends
 * it to the cached folder.
 */
export class ExplorerTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private folders = new Map<string, FolderState>();
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly source: Source,
    private readonly connections: ConnectionManager,
    private readonly output: vscode.OutputChannel,
  ) {
    this.subscription = connections.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.folders = new Map();
    this.emitter.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.type) {
      case 'connection': {
        const { connection } = node;
        const item = new vscode.TreeItem(connection.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `${this.source}:${connection.name}`;
        item.iconPath = new vscode.ThemeIcon(connection.config.type === 'local' ? 'server-process' : 'cloud');
        item.contextValue = `connection-${connection.config.type}`;
        item.description = connection.config.type === 'local'
          ? [connection.config.backend ?? 'fs', connection.localUrl].filter(Boolean).join(' · ')
          : this.source === 'storage'
          ? connection.config.storageUrl
          : connection.config.documentsUrl;
        return item;
      }
      case 'entry': {
        const { entry, connection } = node;
        const folder = entry.kind === 'folder';
        const item = new vscode.TreeItem(
          entry.label,
          folder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        item.id = `${this.source}:${connection.name}:${entry.kind}:${
          entry.kind === 'record' ? entry.status : ''
        }:${entry.key}`;
        item.contextValue = entry.kind;
        item.tooltip = entry.key;
        if (folder) {
          item.iconPath = vscode.ThemeIcon.Folder;
        } else {
          item.iconPath = entry.kind === 'record' && !entry.published
            ? new vscode.ThemeIcon('edit')
            : vscode.ThemeIcon.File;
          item.description = entry.kind === 'record' ? `${entry.status} · ${entry.language}` : undefined;
          item.command = {
            command: 'laika.open',
            title: 'Open',
            arguments: [contentUri(connection.name, this.source, entry)],
          };
        }
        return item;
      }
      case 'more': {
        const item = new vscode.TreeItem('Load more…');
        item.iconPath = new vscode.ThemeIcon('ellipsis');
        item.command = { command: 'laika.loadMore', title: 'Load more', arguments: [this, node] };
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(node.text);
        item.iconPath = new vscode.ThemeIcon(node.error ? 'error' : 'info');
        item.tooltip = node.text;
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return this.connections.all()
        .filter(c => this.source === 'storage' ? c.hasStorage : c.hasDocuments)
        .map(connection => ({ type: 'connection', connection }));
    }
    if (node.type === 'connection') return this.folderChildren(node, node.connection, '');
    if (node.type === 'entry' && node.entry.kind === 'folder') {
      return this.folderChildren(node, node.connection, node.entry.key);
    }
    return [];
  }

  /** Fetch the next page of a folder and append it under its parent. */
  async loadMore(node: Extract<Node, { type: 'more' }>): Promise<void> {
    const state = this.folders.get(this.stateKey(node.connection, node.folder));
    if (!state?.nextPage) return;
    try {
      const page = await this.list(node.connection, node.folder, state.nextPage);
      state.nodes = [
        ...state.nodes.filter(n => n !== node),
        ...this.toNodes(node.connection, node.folder, page, node.parent),
      ];
      state.nextPage = page.nextPage;
    } catch (error) {
      void vscode.window.showErrorMessage(`Laika: ${this.describe(error)}`);
    }
    this.emitter.fire(node.parent);
  }

  private async folderChildren(parent: Node, connection: Connection, folder: string): Promise<Node[]> {
    const key = this.stateKey(connection, folder);
    const cached = this.folders.get(key);
    if (cached) return cached.nodes;
    try {
      const page = await this.list(connection, folder, 1);
      const nodes = this.toNodes(connection, folder, page, parent);
      if (nodes.length === 0) nodes.push({ type: 'message', text: 'Empty', error: false });
      this.folders.set(key, { nodes, nextPage: page.nextPage });
      // A local server may have just started; show its URL on the connection row.
      if (parent.type === 'connection') this.emitter.fire(parent);
      return nodes;
    } catch (error) {
      this.output.appendLine(`[${connection.name}] listing "${folder || '/'}" failed: ${this.describe(error)}`);
      return [{ type: 'message', text: this.describe(error), error: true }];
    }
  }

  private toNodes(connection: Connection, folder: string, page: Page, parent: Node): Node[] {
    for (const warning of page.warnings) {
      this.output.appendLine(
        `[${connection.name}] warning (${warning.code}) listing "${folder || '/'}": ${warning.message}`,
      );
    }
    const nodes: Node[] = page.entries.map(entry => ({ type: 'entry', connection, entry }));
    if (page.nextPage) nodes.push({ type: 'more', connection, folder, parent });
    return nodes;
  }

  private async list(connection: Connection, folder: string, page: number): Promise<Page> {
    return this.source === 'storage'
      ? listStorageFolder(await connection.storage(), folder, page)
      : listDocumentsFolder(await connection.documents(), folder || undefined, page);
  }

  private stateKey(connection: Connection, folder: string): string {
    return `${connection.name}\0${folder}`;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
