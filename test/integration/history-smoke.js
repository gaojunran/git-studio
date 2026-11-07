const vscode = require('vscode');
exports.run = async function run() {
  const extension = vscode.extensions.getExtension('local.git-studio');
  await extension.activate();
  await vscode.commands.executeCommand('gitStudio.openHistory', vscode.Uri.file('/Volumes/2tb-ssd/nebula/Work/main'));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((candidate) => candidate.label.includes('History'));
  if (!tab) throw new Error('history panel did not open');
  console.log('HISTORY tab', tab.label);
};
