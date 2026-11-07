# OpenChamber Issues / MR / Discussions Board — 可行性研究与实施计划

> 目标：把 OpenChamber 的 issue / merge request / discussion board 完整移植到 Git Studio VS Code 插件中，UI 尽量逐像素还原，并保持其 provider 可扩展性；现有 OpenChamber Integration 插件必须**零修改**可用。
>
> 结论：**技术上可行，但不是“复制文件”级别的移植**。需要同时做两条独立工作流：Board UI 移植 + OpenChamber Guest Host 运行时实现。

## 1. 调研结论

### 1.1 Board 本身

OpenChamber 的 board 不是单一组件，而是一个完整页面：

- 入口：`packages/ui/src/components/sourceBoard/SourceBoardView.tsx`（1041 行）
- 动作：`SourceBoardActions.tsx`（722 行）
- 预览：`packages/ui/src/components/references/ReferencePreview.tsx`（988 行）
- 列表 / 搜索 / 分页：`ReferenceBrowser.tsx`、`useReferenceBrowser.ts`
- 数据 hooks：`referenceSources.ts`（668 行）
- 状态：`useSourceBoardStore.ts`（zustand + persist）
- 组件集合：`sourceBoard/*` 约 4.9k 行，`references/*` 约 6.8k 行
- 依赖：`@/components/ui`（104 个文件，约 16k 行）、`lib/source-control`（约 6.7k 行）、`lib/trackers`（约 2.1k 行），以及 OpenChamber 的 project/session/runtime stores、i18n、toast、icon、popover、markdown 渲染等。

Board 功能范围：

- Tab：repository 的 Issues / Change Requests / Discussions；tracker（Linear）tab
- 项目、仓库、remote、tracker container 选择
- 列表：搜索、state / people 过滤、分页、live status、label、checks、vote、draft
- 预览：正文、评论、review threads、discussion answer、labels、reviewers、checks、merge/submit 状态
- 动作：comment、close/reopen、label、reviewer、review、resolve thread、discussion answer、merge/squash/rebase/submit、mark ready、attach to session、worktree、Changes / walkthrough
- 布局：宽屏 list + preview、窄屏 list 变 dropdown、移动端单列；list 可拖拽调宽
- 状态：loading / error / empty / stale / refresh / 键盘快捷键 / i18n

### 1.2 扩展 / Integration 插件架构

OpenChamber 的 Integration 插件不是 VS Code 扩展，而是 OpenChamber 自己的 guest package：

- 清单：`package.json` 的 `openchamber` 字段
- 角色：`contributes.service.provides: ["source-control"]` 或 `["tracker"]`
- 服务：`service/main.js`，由 host 作为子进程启动
- 通信：
  - host → service：`POST http://127.0.0.1:<port>/source-control` 或 `/tracker`
  - service → host：`POST ${OPENCHAMBER_HOST_CALLBACK_URL}/source-control/outbound` 或 `/tracker/outbound`
  - 认证：每次调用一个短期 handle，service 永远看不到用户 token
- 环境变量：`OPENCHAMBER_SERVICE_PORT`、`OPENCHAMBER_SERVICE_TOKEN`、`OPENCHAMBER_HOST_CALLBACK_URL`、`OPENCHAMBER_SERVICE_DATA_DIR`
- 健康检查：`GET /health` → 200
- 契约文档：`packages/sdk/GUEST_SERVICES.md`
- 示例：`packages/sdk/examples/source-control-provider`（Teahouse，Gitea 子集）
- SDK：`@openchamber/sdk@2.6.1` 已发布到 npm，MIT；manifest 解析在 `@openchamber/sdk/schemas`

Host 侧需要负责：

- manifest 解析 / 版本检查 / 权限审批
- service 生命周期（spawn / health / idle stop / crash recovery）
- loopback HTTP 代理
- callback listener 与 outbound handle
- 账号与 token 存储（OpenChamber 存在服务端；Git Studio 应存在 VS Code SecretStorage）
- provider descriptor 注册、repository binding、read cache
- mutation 的 kind / digest / idempotency / 结果分类
- 错误分类：401 写账号失效、4xx 视为确定失败、其他视为 outcome-unknown

### 1.3 关键限制

OpenChamber 文档明确写着：

> VS Code lists no Git hosts from extensions: the guest catalog is unsupported there.

也就是说，**OpenChamber 自己的 VS Code 扩展也不支持这些 Integration 插件**。Git Studio 要满足“零修改集成”，必须自己成为 OpenChamber Guest Host，而不是复用 OpenChamber 的 VS Code 扩展。

### 1.4 许可证

OpenChamber 是 MIT。可以复制、修改、再分发，但需要保留版权与许可声明；建议在 `NOTICE` / `THIRD_PARTY_LICENSES` 中注明来源。

## 2. 可行性分级

| 部分 | 可行性 | 说明 |
| --- | --- | --- |
| Board UI 直接复制 | 中 | 组件可复制，但依赖 OpenChamber 的 app 环境、UI kit、stores、runtime API；必须做适配层 |
| Board UI 完整还原 | 中高 | 复制真实组件 + 同一套 Tailwind token / 图标 / i18n，可做到高保真；需要逐屏对比 |
| 零修改运行 source-control 插件 | 中高 | SDK 与契约公开；host 侧模块可移植；需要实现 spawn/proxy/accounts/mutations |
| 零修改运行 tracker 插件 | 中 | 同上，tracker 契约独立；Linear 内置 tracker 另算 |
| 内置 GitHub/GitLab/Gitea/Forgejo/Gerrit | 低到中 | OpenChamber 内置 provider 约 28k 行，全部移植成本很高；建议分阶段 |
| 完整 OpenChamber 应用 iframe | 高但不符合目标 | 需要跑整个 OpenChamber server，产品耦合大，不建议 |

## 3. 推荐方案

### 3.1 总体架构

```text
Git Studio WebView (React 19 + Vite)
  ├─ board UI（vendor 自 OpenChamber sourceBoard / references / ui）
  ├─ board compat layer（stores、i18n、toast、navigation）
  └─ BoardBridge (postMessage RPC)
        │
Git Studio Extension Host (Node)
  ├─ OpenChamber Guest Host
  │    ├─ manifest parse / approval / install
  │    ├─ guest service spawn + /health + idle stop
  │    ├─ loopback proxy (/source-control, /tracker)
  │    ├─ callback listener (/source-control/outbound, /tracker/outbound)
  │    ├─ account/token store (VS Code SecretStorage)
  │    ├─ provider descriptor registry
  │    └─ mutation executor / idempotency / read cache
  ├─ built-in provider adapters（后续阶段）
  └─ RepoService / Git CLI（已有）
```

### 3.2 UI 移植方式

不要重写 board。以 OpenChamber 源码为唯一事实来源：

- 新建 `src/webview/board/`，按目录 vendor：
  - `sourceBoard/`
  - `references/`
  - `lib/source-control/`
  - `lib/trackers/`
  - 必要的 `components/ui/`、`components/icon/`、`lib/i18n/`
- 用 Vite alias 把 `@/` 指到 vendored 目录。
- 新增 `board/compat/`：
  - `runtime.ts`：实现 `useRuntimeAPIs` 所需的 sourceControl / trackers / projects / sessions 子集
  - `stores.ts`：用轻量 zustand store 替代 OpenChamber 的 `useProjectsStore`、`useUIStore`、`useSessionUIStore`、`useTrackerAuthStore` 等
  - `navigation.ts`：把“打开 session / worktree / changes / walkthrough”映射到 Git Studio 的命令或禁用
  - `i18n.ts`：先英文，保留 key 结构，后续可加中文
  - `theme.css`：把 OpenChamber 的 Tailwind token 映射到 `--vscode-*`，保持深色/浅色一致
- 保留原始文件结构，不把组件改成 Git Studio 风格；这样后续可以从 OpenChamber 上游 cherry-pick。
- UI 验收：在 1440 / 1024 / 390 宽度下，与 OpenChamber 实际页面截图逐屏对比；list 宽度、间距、字号、图标、hover、空态、loading 态都要对齐。

### 3.3 数据层

Board 需要的 API 是 OpenChamber `SourceControlAPI` 的一个子集。Git Studio 侧新增：

- `src/extension/board/bridge.ts`：WebView ↔ Extension Host 的 request/response RPC
- `src/extension/board/sourceControl.ts`：实现 board 用到的 `SourceControlAPI` 子集
- `src/extension/board/trackers.ts`：实现 tracker tab 所需子集
- `src/extension/board/providers/`：provider registry、binding、read cache
- `src/extension/board/guests/`：Guest Host

第一版优先支持：

- `providers()`
- `repositoryContext()`
- `references()` / `referenceDetail()`
- `changeRequestsList()` / `issuesList()`
- `changeRequestContext()` / `issueGet()` / `issueComments()`
- `changeRequestStatus()` / `changeRequestListStatuses()`
- 写操作：comment、close/reopen、label、reviewer、merge/submit、review、discussion comment/state/answer

暂不支持或降级的 OpenChamber 专有能力：

- attach to chat session / new session：Git Studio 没有 chat，按钮隐藏或改为“复制链接 / 打开远程”
- worktree session：映射到 Git Studio 的 worktree 功能（后续）
- walkthrough / Changes：映射到 Git Studio 的 diff 命令，或先只给“打开远程 PR”
- tracker Linear：第二阶段

### 3.4 零修改插件集成

必须按 OpenChamber 契约实现，不能要求插件改代码：

1. 读取 `package.json` 的 `openchamber` manifest，用 `@openchamber/sdk/schemas` 的 `parseManifestJson` 解析。
2. 检查 `apiVersion: 1`、`engines.openchamber`、`contributes.service.provides`。
3. 用户审批 manifest 声明的权限（exec / sockets / service）。
4. 启动 `service/main.js`：
   - 随机 loopback 端口
   - 生成 bearer token
   - 环境变量只给白名单 + `OPENCHAMBER_SERVICE_*` + `OPENCHAMBER_HOST_CALLBACK_URL`
   - 轮询 `/health`
5. 实现 `/source-control` 与 `/tracker` 代理，按 SDK 的 wire 1 发送请求，校验响应 schema。
6. 实现 callback listener：
   - `/source-control/outbound`、`/tracker/outbound`
   - 每次调用 mint 一个 handle，绑定 instance origin、账号 token、允许的方法、deadline
   - 校验 origin、method、body 大小、redirect
7. 账号：
   - `auth.probe` / `auth.verify` 由 service 回答
   - token 存 VS Code SecretStorage
   - basic auth 保存 username
   - 401 只在 proxy 真的看到 401 时写账号失效
8. mutation：
   - 复用 OpenChamber 的 kind / digest / idempotency 语义
   - `mutation.resolveTarget` → `mutation.perform` → `mutation.reconcile`
   - 4xx 确定失败，其他 outcome-unknown
9. 安装来源：
   - 第一版至少支持 folder / zip（OpenChamber 的 folder install）
   - git URL / 更新可以后续做

验收标准：

- 把 `packages/sdk/examples/source-control-provider` 原样复制到 Git Studio 的扩展目录，安装后 board 能列出 fake forge 的 issue/PR，能评论、关闭、merge。
- 安装前后对插件文件做 hash，确认没有任何修改。
- 插件 manifest 声明的 capabilities 决定 board 的 tab、按钮、术语（PR/MR/change），UI 不硬编码 GitHub/GitLab。

## 4. 分阶段计划

### M0 — 技术验证（2–3 天）

- [ ] 统计 board 的完整 import closure，列出必须 vendor 的文件
- [ ] 用 OpenChamber 源码 + mock runtime 单独构建一个 board-only 页面
- [ ] 用 Node harness 启动 `examples/source-control-provider`，证明 SDK 契约可独立运行
- [ ] 确认 `@openchamber/sdk@2.6.1` 在 Git Studio 的 Node/ESM 环境可用
- [ ] 输出 `docs/openchamber-board-closure.md`

验收：board-only 页面能渲染 mock 数据；示例插件能在 harness 中回答 `auth.probe` / `listIssues`。

### M1 — Guest Host（1.5–2.5 周）

- [ ] manifest 解析 / 审批 / 安装（folder + zip）
- [ ] guest service 生命周期与 loopback proxy
- [ ] callback listener + outbound handles
- [ ] SecretStorage 账号与 token
- [ ] source-control extension provider adapter
- [ ] provider registry / descriptor
- [ ] 错误分类、超时、响应大小限制

验收：零修改 Teahouse 插件在 Git Studio 中完成 auth、列 issue/PR、评论、关闭、merge；插件文件 hash 不变。

### M2 — Board UI 外壳（2–3 周）

- [ ] vendor sourceBoard / references / 必要 UI primitives
- [ ] board compat stores / runtime / navigation / i18n / theme
- [ ] WebView ↔ Host RPC
- [ ] repository / project / remote 选择
- [ ] list + preview + filters + search + pagination
- [ ] loading / empty / error / stale 状态
- [ ] 宽屏 / 窄屏 / 移动布局
- [ ] 与 OpenChamber 截图逐屏对比

验收：在 1440 / 1024 / 390 宽度下，board 的布局、间距、字号、图标、颜色与 OpenChamber 对齐；mock provider 和 Teahouse 都能正常展示。

### M3 — 完整读写动作（1.5–2.5 周）

- [ ] comment / reply / review thread / resolve
- [ ] close / reopen / labels / reviewers
- [ ] review verdict / votes / submit requirements
- [ ] merge / squash / rebase / submit / mark ready
- [ ] discussion comment / state / answer
- [ ] mutation idempotency / reconcile / 失败提示
- [ ] refresh / live summaries / status cache

验收：Teahouse fake forge 的每个写操作只到达一次；失败重试不会重复写入；401 正确使账号失效。

### M4 — Tracker 与扩展性（1–2 周）

- [ ] tracker extension provider host
- [ ] tracker tab、container 选择、project mapping
- [ ] Linear-like tracker 的 list / detail / state / comment
- [ ] provider descriptor 驱动的 tab / 术语 / 能力开关
- [ ] 安装 / 启用 / 暂停 / 卸载 / 更新（folder + zip 优先）

验收：零修改 tracker 示例插件可用；board 不出现硬编码 provider 分支。

### M5 — 内置 Provider 与发布（2–4 周，可选/分阶段）

- [ ] 选择第一批内置 provider（建议 GitHub）
- [ ] issue / PR / discussion 读
- [ ] comment / close / label / review / merge 写
- [ ] 认证（PAT / OAuth device flow）
- [ ] 与扩展 provider 共用 descriptor / board / mutation 框架
- [ ] 打包、README、NOTICE、CI、VSIX

验收：GitHub 仓库的 issue / PR / discussion 在 board 中可读可写；扩展 provider 与内置 provider 共存。

> 粗估：M0–M3 约 6–9 周（单人），M4 再加 1–2 周，M5 视内置 provider 数量 2–4 周。UI-only 的可用版本约 3–4 周；零修改插件链路是独立的关键路径。

## 5. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Board UI 依赖 OpenChamber 整个 app | 移植范围失控 | 先做 import closure；vendor 真实组件 + compat 层；不重写 UI |
| Tailwind / 主题 / 字体差异 | 视觉不一致 | 复用 OpenChamber token；截图对比；必要时打包字体 |
| Guest Host 契约复杂 | 零修改插件跑不起来 | 先跑通示例插件；按 SDK schema 校验；逐方法实现 |
| mutation 重试导致重复写入 | 数据错误 | 复用 OpenChamber 的 digest / idempotency / reconcile 语义 |
| OpenChamber 专有动作（chat session / walkthrough） | UI 出现不可用按钮 | capability 驱动隐藏；映射到 Git Studio 命令或禁用 |
| 内置 provider 代码量大 | 工期膨胀 | 先扩展 provider，内置 GitHub 后置；不要一次移植全部 |
| 上游 OpenChamber 演进 | 维护成本 | 保持 vendor 目录结构 + 记录 upstream commit；用 patch 文件管理改动 |
| VS Code WebView 性能 | 大列表卡顿 | 复用虚拟列表；分页；read cache；避免整页重渲染 |

## 6. 待确认问题

1. **内置 provider 的范围**：第一版是否必须包含 GitHub/GitLab/Gitea/Forgejo/Gerrit？还是先只支持零修改扩展插件？
2. **Discussions**：OpenChamber 的扩展 provider 契约目前没有 `discussions` capability；discussion 主要来自内置 GitHub。若第一版要完整 discussion，需要同时做内置 GitHub，或扩展 host 契约（会破坏零修改语义）。
3. **OpenChamber 专有动作**：attach to chat session、new session、worktree session、walkthrough 在 Git Studio 中没有对应物；是隐藏、禁用，还是映射到 Git Studio 的 diff/worktree？
4. **Tracker / Linear**：是否第一版就要 tracker tab？还是先 repository board？
5. **安装来源**：folder / zip 是否足够？是否需要 git URL 安装与自动更新？
6. **UI 保真标准**：是否要求与 OpenChamber 当前版本逐像素一致？如果是，需要固定一个 upstream commit 作为基线。

## 7. 不建议的方案

- **直接复制 `sourceBoard` 目录**：会缺 20+ 个 app 依赖，无法编译。
- **重写一套“类似”的 board**：无法满足 UI 完整还原，也容易丢失 provider 可扩展性。
- **iframe 整个 OpenChamber web app**：需要跑 OpenChamber server，产品耦合、打包体积、认证、生命周期都不可控。
- **要求插件改代码适配 Git Studio**：违反“零修改”目标。

## 8. 参考文件

- `packages/ui/src/components/sourceBoard/SourceBoardView.tsx`
- `packages/ui/src/components/sourceBoard/SourceBoardActions.tsx`
- `packages/ui/src/components/references/ReferencePreview.tsx`
- `packages/ui/src/components/references/referenceSources.ts`
- `packages/ui/src/lib/source-control/providers/registry.ts`
- `packages/ui/src/lib/api/types.ts`（`SourceControlAPI`）
- `packages/sdk/GUEST_SERVICES.md`
- `packages/sdk/examples/source-control-provider`
- `packages/sdk/examples/tracker-provider`
- `packages/web/server/lib/guests/`
- `packages/web/server/lib/source-control/extension-provider.js`
- `packages/web/server/lib/source-control/extension-providers.js`
- `packages/web/server/lib/trackers/extension-tracker.js`
