# Git Studio — TODO

> 当前版本：`0.9.8`
> 定位：IntelliJ Log 风格的 Git 历史工作台。History 用 WebView，其余尽量复用 VS Code 原生 UI。

## 已完成（基线）

- [x] History 面板：多 ref 提交图、虚拟滚动、增量分页、SVG 图层
- [x] 过滤：message（普通 / 正则 / 大小写）、author、path、日期、ref 多选、first-parent、no-merges、date/topo
- [x] 提交详情：完整 message、author/committer、parents、文件列表与 ±stats
- [x] merge commit 在 parent 1 / parent 2 之间切换 diff 基准
- [x] 打开提交的原生多文件 diff；任意两个 commit 对比
- [x] `git log --follow` 文件历史
- [x] 全文件 blame 注解 + hover（可配置模板、`-w`）
- [x] 提交操作：建分支、建 tag、detached checkout、与工作区对比、打开远程提交、复制 subject/hash
- [x] 历史改写：reset（soft/mixed/hard）、revert、cherry-pick
- [x] 交互式 rebase：reorder / pick / reword / edit / squash / fixup / drop，含 Continue / Skip / Abort
- [x] 最近一次改写的 Undo（每仓库 journal 20 条）
- [x] 写操作安全：串行、目标 OID 复核、HEAD 复核、进行中操作阻断、冲突横幅
- [x] diff 命令集：working tree ↔ merge base、two refs、two refs ↔ merge base、current branch ↔ merge base、stash、file at two revisions、folder、unpushed
- [x] ref 选择器：立即弹出、加载后填充、分组限量、Show all、基准分支推断、主干独立列表

## P0 — 下一步大实现候选

按建议优先级排列。一次只做一个，做完再进入下一个。

### 0. OpenChamber Issues / MR / Discussions Board 移植

完整方案见 [`docs/openchamber-board-plan.md`](docs/openchamber-board-plan.md)。

- [x] 第一版 Board：GitHub 内置 provider（issue / PR / discussion 读，comment / close / merge 写）
- [x] 第一版 Guest Host：folder 安装、manifest 解析、service spawn、loopback 代理、outbound callback、SecretStorage token
- [x] 零修改验证：Teahouse 示例插件在真实 VS Code 中启动并列出 issue/PR
- [x] Guest Host 写操作：comment / close / merge（resolveTarget → perform → reconcile）
- [ ] Guest Host 写操作：review / labels / reviewers
- [ ] Board UI 与 OpenChamber 逐像素对齐
- [ ] Tracker / Linear tab
- [ ] git URL / zip 安装与更新
- [ ] 内置 provider 扩展：GitLab / Gitea / Forgejo / Gerrit

### 1. Stash 工作台

- [ ] History 面板增加 Stash 视图（或独立面板）：列表、message、时间、关联分支
- [ ] 选中 stash 查看详情：文件列表、原生多文件 diff
- [ ] Apply / Pop / Drop，带确认与冲突处理
- [ ] 从当前工作区创建 stash（可选：include untracked / staged only）
- [ ] 与 `WriteCoordinator` 串行，写后刷新
- [ ] 验收：真实仓库中 apply/pop/drop 均正确；冲突时给出明确状态，不破坏工作区

### 2. Reflog 安全网

- [ ] Reflog 视图：`HEAD` 与指定分支的 reflog，显示操作、时间、OID
- [ ] 选中 reflog 条目查看该时刻的提交详情
- [ ] 与当前 HEAD 对比、与任意 ref 对比
- [ ] Restore：`reset --hard <entry>`（二次确认）或“在新分支上恢复”
- [ ] Undo 面板接入 reflog，而不是只依赖内存 journal
- [ ] 验收：误 reset / 误 rebase 后能从 reflog 恢复；reload window 后记录仍可用

### 3. Worktree 工作台

- [ ] Worktree 列表：路径、分支、HEAD、dirty 状态
- [ ] 在当前窗口打开 worktree；新建窗口打开
- [ ] 从 commit / branch 创建 worktree（路径选择）
- [ ] Remove / Prune，带 dirty 检查与确认
- [ ] 验收：创建、打开、删除 worktree 后主仓库状态不受影响

### 4. 目录历史 / 多路径历史

- [ ] 文件夹右键 `Folder History`，等价 `git log -- <dir>`
- [ ] 多选文件/目录时合并为一个 path 过滤条件
- [ ] 历史面板标题显示路径范围
- [ ] 验收：目录内文件改名、删除、子目录嵌套均能正确过滤

## P1 — 体验完善

- [ ] 交互式 rebase 支持多行 reword（当前是单行输入框）
- [ ] rebase 保留 merge commit（`--rebase-merges`），替代当前“压平 merge”
- [ ] rebase 对话框支持拖拽排序（当前是 ↑/↓）
- [ ] Undo 更安全：优先 `reset --keep`，或在确认框中列出将被丢弃的已跟踪文件
- [ ] rebase 停在 edit/冲突时 reload window，仍能恢复本次操作的 undo 记录（journal 落盘）
- [ ] 复杂历史 lane folding：把没有可见节点的分支折叠成一条灰色摘要
- [ ] 提交详情中的文件支持“打开该版本文件”“复制路径”“在文件历史中查看”
- [ ] History 面板键盘导航（↑/↓、Enter、Esc）与无障碍标签
- [ ] “Open on Remote” 支持自建 GitLab / Gitea / Azure DevOps，允许配置 URL 模板
- [ ] blame 支持 `.git-blame-ignore-revs`、`-M -C`、查看上一版本 blame

## P2 — 深度能力

- [ ] Compare with Reflog Entry…
- [ ] Compare Tag with Previous Tag…
- [ ] Compare Incoming Commits（`HEAD..@{upstream}`），与现有 Unpushed 对称
- [ ] Compare Against Remote Tracking Branch，支持选择方向
- [ ] 多仓库：每个仓库一个 History 面板，或在同一面板内快速切换
- [ ] 提交图导出（SVG / PNG）与 patch 导出/应用
- [ ] 历史搜索增强：按 hash 前缀、按文件内容（可选，代价高）
- [ ] 性能：profile `all` 模式下的 log 解析与 layout；只有实测瓶颈才考虑 worker / Rust
- [ ] CI：GitHub Actions 跑 typecheck / vitest / build / VSIX；Marketplace 发布与 changelog

## 技术债与一致性问题

- [ ] **主干定义不统一**：ref 选择器已收窄为 `main` / `master`（或 remote HEAD），但 `history/defaultRefs.ts` 的 `primary` 模式仍包含 `develop`、`dev`、`trunk`、`release`。需要统一，或明确“历史默认 refs”和“基准分支主干”是两套不同概念并写清。
- [ ] `gitStudio.history.defaultRefs` 的配置说明仍写着 `main/master/develop`，与当前选择器行为不一致。
- [ ] 冒烟测试脚本目前只在 `.tmp/it`，未纳入仓库；考虑移到 `test/integration` 并提供 `npm run test:integration`。
- [ ] `WriteCoordinator` 无法与 VS Code 内置 Git 按钮共享锁；需要明确边界，或在执行前再次检测 operation / HEAD。
- [ ] 大仓库 `loadRefs` 冷启动仍需 1s+；当前用“先弹窗后填充”掩盖，后续可考虑缓存 refs 或增量刷新。
- [ ] `BaseInference` 的 `contained` 仍通过 `for-each-ref --merged` 计算，仅用于 UI 标记；确认它不会随候选集变化产生误导。
- [ ] `baseBranch` 的“本地分支严格领先当前分支视为子分支”是启发式，远程子分支仍可能被选中；需要在文档中保留这个边界说明。

## 非目标（明确不做）

- 不做 staging / commit / discard：继续复用 VS Code 内置 Source Control。
- 不做 diff / merge 渲染：继续复用原生 diff editor 与 3-way merge。
- 不做自定义 SCM Provider。
- v1 不引入 Rust；只有实测瓶颈（解析或 layout ≥40% 关键路径且优化后仍 ≥2×）才重新评估。

## 验证清单（每个实现收尾）

- [ ] `npm run typecheck` = 0
- [ ] `npx vitest run` 全绿
- [ ] `npm run build` 成功
- [ ] 真实 VS Code Extension Host 冒烟（workspace trust 关闭）
- [ ] 在真实大仓库验证（至少 `Work/main` 或 `wxapplib`）
- [ ] 涉及写操作时，在临时仓库验证成功 / 冲突 / abort 三条路径
- [ ] `npm run install:local` 覆盖安装，用户只需 Reload Window
