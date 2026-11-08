const vscode = require('vscode');
const { execFileSync } = require('node:child_process');

exports.run = async function () {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  await gitExtension.activate();
  const api = gitExtension.exports.getAPI(1);
  for (let attempt = 0; attempt < 50 && api.repositories.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const repo = api.repositories.find((candidate) => candidate.rootUri.fsPath === process.env.SMOKE_REPO) ?? api.repositories[0];

  const branch = process.env.SMOKE_BRANCH ?? 'feature';
  execFileSync('git', ['checkout', '-q', branch], { cwd: repo.rootUri.fsPath });
  try {
    execFileSync('git', ['branch', '--unset-upstream', branch], { cwd: repo.rootUri.fsPath, stdio: 'pipe' });
  } catch {
    // No upstream configured.
  }

  const original = vscode.window.createQuickPick;
  let captured = [];
  vscode.window.createQuickPick = () => {
    let items = [];
    const quickPick = {
      placeholder: '',
      matchOnDescription: false,
      busy: false,
      selectedItems: [],
      get items() {
        return items;
      },
      set items(value) {
        items = value;
      },
      onDidAccept() {},
      onDidTriggerItemButton() {},
      onDidHide(callback) {
        this.hideCallback = callback;
      },
      show() {
        setTimeout(() => {
          captured = items.map((item) => ({
            label: item.label,
            description: item.description,
            kind: item.kind === vscode.QuickPickItemKind.Separator ? 'separator' : 'item',
            detail: item.detail,
            buttons: (item.buttons ?? []).length,
            remoteValues: item.remoteValues
          }));
          this.hideCallback?.();
        }, 2000);
      },
      hide() {},
      dispose() {}
    };
    return quickPick;
  };

  try {
    await vscode.commands.executeCommand('gitStudio.diffMergeBase', { uri: repo.rootUri });
    console.log('PICKER diffMergeBase:', JSON.stringify(captured, null, 2));

    await vscode.commands.executeCommand('gitStudio.compareWorkingTree', { uri: repo.rootUri });
    console.log('PICKER workingTree:', JSON.stringify(captured, null, 2));
  } finally {
    vscode.window.createQuickPick = original;
  }
};
