const vscode = require('vscode');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('local.git-studio');
  if (!extension) {
    throw new Error('local.git-studio extension not found');
  }

  await extension.activate();

  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    throw new Error('vscode.git extension not found');
  }
  const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  if (!git?.enabled) {
    throw new Error('vscode.git is not enabled');
  }
  const api = git.getAPI(1);
  for (let attempt = 0; attempt < 60 && api.repositories.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!api.repositories.length) {
    throw new Error('no repositories discovered');
  }

  const repo = (process.env.SMOKE_REPO
    ? api.repositories.find((candidate) => candidate.rootUri.fsPath === process.env.SMOKE_REPO)
    : undefined) ?? api.repositories[0];
  console.log('SMOKE repo:', repo.rootUri.fsPath);

  if (typeof api.toGitUri !== 'function') {
    throw new Error('Git API toGitUri is missing');
  }
  if (typeof repo.checkout !== 'function' || typeof repo.createBranch !== 'function') {
    throw new Error('Git repository write API is missing');
  }
  const headUri = api.toGitUri(vscode.Uri.joinPath(repo.rootUri, 'README.md'), 'HEAD');
  if (!headUri.toString().startsWith('git:')) {
    throw new Error(`unexpected git uri: ${headUri.toString()}`);
  }
  console.log('SMOKE gitUri:', headUri.toString());

  await vscode.commands.executeCommand('gitStudio.openHistory', repo.rootUri);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const historyTab = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find((tab) => tab.label === 'Git History');
  if (!historyTab) {
    throw new Error('history panel did not open');
  }

  const readme = vscode.Uri.joinPath(repo.rootUri, 'README.md');
  const document = await vscode.workspace.openTextDocument(readme);
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  await vscode.commands.executeCommand('gitStudio.toggleAnnotate');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  if (!editor.document.lineCount) {
    throw new Error('document has no lines');
  }

  await vscode.commands.executeCommand('gitStudio.fileHistory', readme);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const fileHistoryTab = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find((tab) => tab.label === 'History: README.md');
  if (!fileHistoryTab) {
    throw new Error('file history panel title was not applied');
  }

  console.log('SMOKE before compare');
  await Promise.race([
    vscode.commands.executeCommand('gitStudio.compareWorkingTree', { uri: repo.rootUri, ref: 'HEAD' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('compare command timed out')), 15000))
  ]);
  console.log('SMOKE after compare');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const diffTab = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find((tab) => tab.input && (tab.input.modified || tab.input.textDiffs));
  if (!diffTab) {
    throw new Error('compare working tree did not open a diff');
  }
  console.log('SMOKE diff tab:', diffTab.label, diffTab.input.constructor?.name, Object.keys(diffTab.input));

  const modified = diffTab.input.modified ?? diffTab.input.textDiffs?.[0]?.modified;
  if (!modified) {
    throw new Error('diff tab has no modified side');
  }
  const modifiedDocument = await vscode.workspace.openTextDocument(modified);
  console.log('SMOKE diff modified:', modified.scheme, modified.fsPath, 'readonly:', modifiedDocument.isReadonly);
  if (modified.scheme !== 'file' || modifiedDocument.isReadonly) {
    throw new Error('diff modified side is not editable');
  }

  const edit = new vscode.WorkspaceEdit();
  edit.insert(modified, new vscode.Position(0, 0), 'X');
  const applied = await vscode.workspace.applyEdit(edit);
  console.log('SMOKE applyEdit:', applied, 'dirty:', vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === modified.toString())?.isDirty);
  if (!applied) {
    throw new Error('diff modified side rejected an edit');
  }

  const runDiff = async (command, arg, labelPrefix) => {
    await vscode.commands.executeCommand(command, arg);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((entry) => entry.label.startsWith(labelPrefix));
    if (!tab) {
      const labels = vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((entry) => entry.label);
      throw new Error(`${command} did not open ${labelPrefix}; tabs: ${JSON.stringify(labels)}`);
    }
    console.log('SMOKE diff:', command, '->', tab.label);
    return tab;
  };

  const cwd = repo.rootUri.fsPath;

  await runDiff('gitStudio.diffRefs', { uri: repo.rootUri, left: 'HEAD~2', right: 'feature' }, 'HEAD~2 ↔ feature');
  await runDiff('gitStudio.diffMergeBase', { uri: repo.rootUri, ref: 'feature' }, 'Changes on main since merge-base');
  await runDiff('gitStudio.diffStash', { uri: repo.rootUri, stash: 'stash@{0}' }, 'stash@{0}');
  await runDiff('gitStudio.diffFileRevisions', { uri: vscode.Uri.joinPath(repo.rootUri, 'a.txt'), left: 'HEAD~2', right: 'HEAD' }, 'a.txt (');
  await runDiff('gitStudio.diffFolder', { uri: vscode.Uri.joinPath(repo.rootUri, 'sub'), ref: 'HEAD' }, 'sub ↔ HEAD');

  const otherDir = path.join(cwd, 'other-worktree');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'other', otherDir, 'HEAD~2'], { cwd, stdio: 'pipe' });
  fs.writeFileSync(path.join(otherDir, 'other.txt'), 'other\n');
  execFileSync('git', ['add', 'other.txt'], { cwd: otherDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-qm', 'other'], { cwd: otherDir, stdio: 'pipe' });
  execFileSync('git', ['worktree', 'remove', '--force', otherDir], { cwd, stdio: 'pipe' });

  const threeDotTab = await runDiff(
    'gitStudio.compareWorkingTree',
    { uri: repo.rootUri, ref: 'other' },
    'Working Tree ↔ merge-base(other)'
  );
  const changedPaths = threeDotTab.input.textDiffs.map((diff) => `${diff.original?.fsPath ?? ''}|${diff.modified?.fsPath ?? ''}`);
  console.log('SMOKE three-dot files:', changedPaths);
  if (changedPaths.some((entry) => entry.includes('other.txt'))) {
    throw new Error('three-dot working tree diff leaked a commit unique to the other branch');
  }

  const refsMergeTab = await runDiff(
    'gitStudio.diffRefsMergeBase',
    { uri: repo.rootUri, left: 'other', right: 'main' },
    'Changes on main since merge-base(other)'
  );
  const refsMergePaths = refsMergeTab.input.textDiffs.map(
    (diff) => `${diff.original?.fsPath ?? ''}|${diff.modified?.fsPath ?? ''}`
  );
  console.log('SMOKE refs-merge-base files:', refsMergePaths);
  if (refsMergePaths.some((entry) => entry.includes('other.txt'))) {
    throw new Error('two-ref merge-base diff leaked a commit unique to the left branch');
  }
  await runDiff('gitStudio.diffUnpushed', { uri: repo.rootUri }, 'Unpushed ↔');

  const runGit = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  runGit('checkout', '-q', '-b', 'solo', 'HEAD');
  fs.writeFileSync(path.join(cwd, 'solo.txt'), 'solo\n');
  runGit('add', 'solo.txt');
  runGit('commit', '-qm', 'solo');
  runGit('checkout', '-q', '--detach', 'HEAD');

  await runDiff('gitStudio.diffMergeBase', { uri: repo.rootUri, ref: 'feature', current: 'refs/heads/solo' }, 'Changes on solo since merge-base');
  await runDiff('gitStudio.diffMergeBase', { uri: repo.rootUri, ref: 'feature' }, 'Changes on solo (detached) since merge-base');

  runGit('branch', 'extra');
  await runDiff(
    'gitStudio.diffMergeBase',
    { uri: repo.rootUri, ref: 'feature', current: 'refs/heads/extra' },
    'Changes on extra since merge-base'
  );

  runGit('branch', '-D', 'solo', 'extra');
  await runDiff('gitStudio.diffMergeBase', { uri: repo.rootUri, ref: 'feature' }, 'Changes on HEAD (');

  console.log('SMOKE OK lines:', document.lineCount, 'tabs:', vscode.window.tabGroups.all.length);
};
