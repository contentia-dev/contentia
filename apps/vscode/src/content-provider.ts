import * as vscode from 'vscode';

import { ContentiaTask } from 'contentia/core';

import type { ConnectionManager } from './connections.js';
import type { Entry } from './explorer/listing.js';

export const SCHEME = 'contentia';

type Source = 'storage' | 'documents';

/**
 * Address of a read-only preview. The path is for humans (tab title,
 * breadcrumbs); the query carries the exact connection, key and record kind,
 * since keys and connection names may contain characters a path would mangle.
 */
export const contentUri = (connection: string, source: Source, entry: Entry): vscode.Uri =>
  vscode.Uri.from({
    scheme: SCHEME,
    path: `/${connection}/${source}/${entry.key}.json`,
    query: new URLSearchParams({
      connection,
      source,
      key: entry.key,
      ...(entry.kind === 'record' ? { published: String(entry.published) } : {}),
    }).toString(),
  });

/** Renders storage objects and documents as pretty-printed JSON. */
export class ContentiaContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly connections: ConnectionManager) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const name = params.get('connection') ?? '';
    const key = params.get('key') ?? '';
    const connection = this.connections.get(name);
    if (!connection) throw new Error(`Unknown Contentia connection "${name}"`);

    let value: unknown;
    if (params.get('source') === 'documents') {
      const repo = await connection.documents();
      value = params.get('published') === 'true'
        ? await ContentiaTask.runPromise(repo.getDocument(key))
        : await ContentiaTask.runPromise(repo.getUnpublished(key));
    } else {
      value = await ContentiaTask.runPromise((await connection.storage()).getObject(key));
    }
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  /** Re-fetch open previews, e.g. after a refresh. */
  refreshAll(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === SCHEME) this.emitter.fire(doc.uri);
    }
  }
}
