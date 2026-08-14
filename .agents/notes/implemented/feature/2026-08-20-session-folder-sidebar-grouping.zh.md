# Agent Note: 会话文件夹作为独立的侧边栏顶层分组

状态：已实施

[English](2026-08-20-session-folder-sidebar-grouping.md) | 中文

## 问题

Web GUI 侧边栏只按工作区（Project）归属来分组会话。用户希望按主题自由地把会话分组，而不受会话创建于哪个目录的限制。工作区是宿主端的目录概念；自由文件夹是用户拥有的覆盖层，不得扰乱工作区记账。「置顶（pinned）」概念不在范围内：文件夹才是分组原语。

文件夹是一种独立的顶层分组：位于工作区分组之上、按持久化注册顺序排列，且一个会话只属于一个文件夹。把会话放入文件夹会使其从工作区分组中隐藏，但不会从工作区解绑，因此将其移出文件夹后会回到工作区分组或未分组桶。

## 决策

### 宿主实体（`@deepseek-ai/dsh-session-folder`）

`FolderRegistry`（`ctx.folderRegistry`）是 `session_folder` 领域（下划线，非连字符——`defineDomain` 拒绝后者）上的持久化实体。它只存储一个全局对象 `{ folders: FolderRecord[] }`，而非每个文件夹一张表，这样一次原子写入即可同时提交顺序、成员与元数据；写入中途崩溃最多留下一个待提交变更，在下次启动时恢复。`storageDomain` 与 `sessionPersistence` 为必需的启动依赖。

「一个会话只能属于一个文件夹」不变量在 `mutateFolder` 中强制：`addSession` 会先把会话从其原有文件夹迁出再前置；对仍属另一文件夹的会话调用 `insertSessionBefore` 会以 `FolderSessionConflictError` 拒绝。未知文件夹以 `FolderUnknownError` 拒绝；未知会话以 `FolderUnknownSessionError` 拒绝。

| RPC | 行为 |
| --- | --- |
| `folder.list` | 按持久化顺序返回文件夹 |
| `folder.create({ title })` | 去除首尾空白并拒绝空标题；允许重名；前置到顺序 |
| `folder.rename({ folderId, title })` | 去除首尾空白并拒绝空标题 |
| `folder.delete({ folderId })` | 仅移除注册；成员会话回到工作区/未分组，绝不被删除 |
| `folder.insertBefore({ folderId, beforeFolderId? })` | 在持久化顺序内移动文件夹；省略锚点时追加 |
| `folder.addSession({ folderId, sessionId })` | 前置到手动顺序，并从任何原有文件夹迁出 |
| `folder.insertSessionBefore({ folderId, sessionId, beforeSessionId? })` | 在文件夹顺序内移动已归属的会话 |
| `folder.removeSession({ folderId, sessionId })` | 仅移除归属项 |

宿主帧：`host/folder-changed`、`host/folder-removed`、`host/folder-order-changed`。错误码：`folder-not-found`、`folder-session-conflict`、`folder-move-invalid`。

### 线协议契约（`@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-api-remotes`）

`FolderApi`/`FolderId`/`FolderView` 在 `api/`（浏览器安全、无宿主依赖）中声明，并从连接客户端再导出。`apiproxy` 的 `folder` 命名空间分派到 `ctx.get('folderRegistry')`，并以守卫包裹，使未装载本插件的组合在没有文件夹处理器时失败。`folderRegistry` 服务存在时才发出宿主帧。

### 客户端运行时（`@deepseek-ai/dsh-client-runtime`）

`FolderRuntime`（`ctx.folders`）把 `FolderManager` 基线投影为 `list` 快照仓库，并暴露 `create`/`rename`/`delete`/`addSession`/`removeSession`/`insertBefore`/`insertSessionBefore`。`useFolders` 是**可选**的全局标准属性（`GlobalStandardProps.useFolders?`），`folders` 在 `SlotRendererHost` 中亦为**可选**，因此未装载文件夹能力的组合会把文件夹视为不存在，既有界面无需任何文件夹接线。

### Web UI（`@deepseek-ai/dsh-client-ui-workspace`）

`groupByFoldersAndWorkspaces` 按以下顺序派生区块：文件夹分组（持久化注册顺序）、不在任何文件夹中的会话的工作区分组（注册顺序）、最后是未分组桶。文件夹分组经由新的 `FolderRowItem` 渲染；属于某文件夹的会话从其工作区分组中隐藏。侧边栏头部新增「新建文件夹」按钮；每个文件夹行提供重命名与删除对话框；每个会话行提供「移动到文件夹」操作，打开列出各文件夹及「移出文件夹」的选择器。文件夹重排序与文件夹内会话重排序已通过线协议契约与运行时接通，但尚未作为拖拽操作暴露。

## 涉及的面

- `packages/workspace/session-folder`（新建宿主包）
- `packages/host/apiproxy`（`folder.ts`、`folder.schema.ts`、`rpc-map.ts`、`rpc.schema.ts`、`events.ts`、`events.schema.ts`、`api-proxy.ts`、`fetch/handler.ts`、`fetch/client.ts`、`api/index.ts`）
- `packages/api/remotes`、`packages/client/connection`（`FolderId`/`FolderView` 再导出、fixture）
- `packages/client/runtime`（`contract/folders.ts`、`folders/manager.ts`、`folders/service.ts`、`client/index.ts` 接线、`slots.ts`）
- `packages/client/web-react`（`scoped-slots.tsx` 的 `useFolders` 绑定）、`packages/client/ui-slots`（`SlotRendererHost.folders?`）
- `packages/client/ui-workspace`（`tree.ts`、`contract/slots.ts`、`rows/Rows.tsx`、`WorkspaceBrowser.tsx`、`locales.ts`、`client/index.ts`）
- `packages/bundle/web-app`（注册 `@deepseek-ai/dsh-session-folder`）

## 已知限制

- 文件夹拖拽重排序与文件夹内会话拖拽重排序尚不可由用户操作（线协议与运行时已具备）。
- 文件夹仅限 Web 侧边栏；CLI/ACP 界面不按文件夹分组。
