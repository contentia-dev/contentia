import * as vscode from 'vscode';

import { type ConnectionConfig, ConnectionManager } from './connections.js';
import { LaikaContentProvider, SCHEME } from './content-provider.js';
import { ExplorerTree, type Node } from './tree/explorer-tree.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Laika');
  const connections = new ConnectionManager(context.secrets, output);
  const storageTree = new ExplorerTree('storage', connections, output);
  const documentsTree = new ExplorerTree('documents', connections, output);
  const content = new LaikaContentProvider(connections);

  context.subscriptions.push(
    output,
    connections,
    storageTree,
    documentsTree,
    vscode.window.registerTreeDataProvider('laika.storage', storageTree),
    vscode.window.registerTreeDataProvider('laika.documents', documentsTree),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, content),
    vscode.commands.registerCommand('laika.refresh', () => {
      storageTree.refresh();
      documentsTree.refresh();
      content.refreshAll();
    }),
    vscode.commands.registerCommand('laika.restartServers', () => connections.restartLocal()),
    vscode.commands.registerCommand(
      'laika.loadMore',
      (tree: ExplorerTree, node: Extract<Node, { type: 'more' }>) => tree.loadMore(node),
    ),
    vscode.commands.registerCommand('laika.open', async (uri: vscode.Uri) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('laika.copyKey', async (node?: Node) => {
      if (node?.type === 'entry') await vscode.env.clipboard.writeText(node.entry.key);
    }),
    vscode.commands.registerCommand('laika.setAccessToken', async (node?: Node) => {
      const name = node?.type === 'connection'
        ? node.connection.name
        : await vscode.window.showQuickPick(
          connections.all().filter(c => c.config.type === 'remote').map(c => c.name),
          { title: 'Laika: set access token for…' },
        );
      if (!name) return;
      const token = await vscode.window.showInputBox({
        title: `Access token for "${name}"`,
        prompt: 'Sent as a bearer token. Stored in VS Code secret storage, not in settings.',
        password: true,
        ignoreFocusOut: true,
      });
      if (token !== undefined) await connections.setToken(name, token);
    }),
    vscode.commands.registerCommand('laika.addConnection', () => addConnection(connections)),
  );
}

async function addConnection(connections: ConnectionManager): Promise<void> {
  const type = await vscode.window.showQuickPick(
    [
      { label: 'Local folder', description: 'Serve a content folder with laika local serve', value: 'local' as const },
      { label: 'Remote API server', description: 'A deployed Laika Storage/Documents API', value: 'remote' as const },
    ],
    { title: 'Laika: add connection' },
  );
  if (!type) return;

  let config: ConnectionConfig;
  if (type.value === 'local') {
    const [folder] = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      openLabel: 'Serve this folder',
    }) ?? [];
    if (!folder) return;
    const workspace = vscode.workspace.getWorkspaceFolder(folder);
    const root = workspace ? vscode.workspace.asRelativePath(folder, false) : folder.fsPath;
    const name = await vscode.window.showInputBox({ title: 'Connection name', value: root });
    if (!name) return;
    config = { name, type: 'local', backend: 'fs', options: { root } };
  } else {
    const storageUrl = await vscode.window.showInputBox({
      title: 'Storage API URL (leave empty if the server has none)',
      placeHolder: 'https://cms.example.com/api/storage',
    });
    if (storageUrl === undefined) return;
    const documentsUrl = await vscode.window.showInputBox({
      title: 'Documents API URL (leave empty if the server has none)',
      placeHolder: 'https://cms.example.com/api/documents',
    });
    if (documentsUrl === undefined) return;
    if (!storageUrl && !documentsUrl) {
      void vscode.window.showWarningMessage('Laika: a remote connection needs a Storage or Documents API URL.');
      return;
    }
    const name = await vscode.window.showInputBox({
      title: 'Connection name',
      value: new URL(storageUrl || documentsUrl).host,
    });
    if (!name) return;
    config = {
      name,
      type: 'remote',
      ...(storageUrl ? { storageUrl } : {}),
      ...(documentsUrl ? { documentsUrl } : {}),
    };
  }
  await connections.addConnection(config);
  if (config.type === 'remote') await vscode.commands.executeCommand('laika.setAccessToken');
}

export function deactivate(): void {}
