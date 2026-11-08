import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

function nonce(): string {
  return randomBytes(16).toString('base64');
}

export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.css'));
  const nonceValue = nonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonceValue}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Git History</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonceValue}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function renderSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'sidebar', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'sidebar', 'main.css'));
  const nonceValue = nonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonceValue}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Git Studio</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonceValue}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function renderBoardHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'board', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'board', 'main.css'));
  const nonceValue = nonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonceValue}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Issues and PRs</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonceValue}" src="${scriptUri}"></script>
</body>
</html>`;
}
