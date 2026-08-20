# Agent Note: 会话文件夹作为可访问目录根与侧边栏分组

状态：已实施

[English](2026-08-20-session-folder-sidebar-grouping.md) | 中文

## 问题

Web GUI 侧边栏只按工作区（Project）归属来分组会话。用户希望按主题自由地把会话分组，而不受会话创建于哪个目录的限制。工作区是宿主端的目录概念；文件夹是用户拥有的覆盖层，不得扰乱工作区记账。「置顶（pinned）」概念不在范围内：文件夹才是分组原语。

文件夹同时是一种访问范围机制：每个文件夹指定一个绝对目录根与一个访问级别（`read` | `write` | `both`），其成员会话可以访问该根（整个子树）。会话的工作区 cwd 仍是主目录；文件夹根是额外的可访问目录，因此一个会话可以同时属于多个文件夹（多归属）。把会话放入文件夹不会使其从工作区分组中隐藏，也不会从工作区解绑；将其移出文件夹只会失去该文件夹的访问范围与分组。

## 决策

### 宿主实体（`@deepseek-ai/dsh-session-folder`）

`FolderRegistry`（`ctx.folderRegistry`）是 `session_folder` 领域（下划线，非连字符——`defineDomain` 拒绝后者）上的持久化实体。它只存储一个全局对象 `{ folders: FolderRecord[] }`，而非每个文件夹一张表，这样一次原子写入即可同时提交顺序、成员与元数据；写入中途崩溃最多留下一个待提交变更，在下次启动时恢复。`storageDomain` 与 `sessionPersistence` 为必需的启动依赖。

多归属是模型本身：`addSession` 前置会话且只校验会话存在；会话已在其他文件夹中时其原有归属不受影响。`validateState` 拒绝重复的文件夹 id 或同一文件夹内重复出现的会话；跨文件夹重复是合法的多归属情形。未知文件夹以 `FolderUnknownError` 拒绝；未知会话以 `FolderUnknownSessionError` 拒绝；在文件夹内移动未归属的会话以 `FolderMoveInvalidError` 拒绝。

| RPC | 行为 |
| --- | --- |
| `folder.list` | 按持久化顺序返回文件夹 |
| `folder.create({ title, path, permission })` | 去除首尾空白并拒绝空标题；拒绝相对路径并解析为绝对路径；`permission` 缺省为 `both`；前置到顺序 |
| `folder.rename({ folderId, title })` | 去除首尾空白并拒绝空标题 |
| `folder.delete({ folderId })` | 仅移除注册；成员会话失去访问范围并回到工作区/未分组，绝不被删除 |
| `folder.insertBefore({ folderId, beforeFolderId? })` | 在持久化顺序内移动文件夹；省略锚点时追加 |
| `folder.addSession({ folderId, sessionId })` | 前置到手动顺序；多归属，不迁移 |
| `folder.insertSessionBefore({ folderId, sessionId, beforeSessionId? })` | 在文件夹顺序内移动已归属的会话 |
| `folder.removeSession({ folderId, sessionId })` | 仅移除归属项 |

宿主帧：`host/folder-changed`、`host/folder-removed`、`host/folder-order-changed`。错误码：`folder-not-found`、`folder-move-invalid`。`folder-session-conflict` 已随「一个会话只属于一个文件夹」不变量的移除而消失。

### 线协议契约（`@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-api-remotes`）

`FolderApi`/`FolderId`/`FolderView` 在 `api/`（浏览器安全、无宿主依赖）中声明，并从连接客户端再导出。`FolderView` 携带目录根与访问级别（`path`、`permission`）。`apiproxy` 的 `folder` 命名空间分派到 `ctx.get('folderRegistry')`，并以守卫包裹，使未装载本插件的组合在没有文件夹处理器时失败。`folderRegistry` 服务存在时才发出宿主帧。

### 客户端运行时（`@deepseek-ai/dsh-client-runtime`）

`FolderRuntime`（`ctx.folders`）把 `FolderManager` 基线投影为 `list` 快照仓库，并暴露 `create`/`rename`/`delete`/`addSession`/`removeSession`/`insertBefore`/`insertSessionBefore`。`useFolders` 是**可选**的全局标准属性（`GlobalStandardProps.useFolders?`），`folders` 在 `SlotRendererHost` 中亦为**可选**，因此未装载文件夹能力的组合会把文件夹视为不存在，既有界面无需任何文件夹接线。

### 沙箱策略（`@deepseek-ai/dsh-sandbox-policy`）

`SandboxExecutionPolicy` 新增 `additionalWritableRoots`，共享的 `writableRoots` 推导（`@deepseek-ai/dsh-sandbox`）将其并入每个 `workspace-write` 允许清单，使 fs 围栏与所有由此助手推导授权的运行器不会漂移。`ctx.sandboxPolicy.resolve({ session })` 读取 `ctx.folderRegistry.foldersOfSession`，将每个 `write`/`both` 文件夹根作为额外可写根纳入（`read` 授权不新增任何内容——每种模式下读取都被允许）。策略的模型上下文在 `workspace-write` 下渲染可写的文件夹列表；`read-only` 会话绝不写入文件夹根。bwrap 与 Landlock 配置会挂载/授予每个额外根；Seatbelt 配置自动通过 `writableRoots` 推导。

### Web UI（`@deepseek-ai/dsh-client-ui-workspace`）

`groupByFoldersAndWorkspaces` 按以下顺序派生区块：文件夹分组（持久化注册顺序）、工作区分组（注册顺序）、最后是未分组桶。多归属意味着会话同时出现在其文件夹与工作区分组中。文件夹分组经由新的 `FolderRowItem` 渲染，其副标题显示目录根与访问级别；工作区行显示会话 cwd。侧边栏头部新增「新建文件夹」按钮，其对话框收集标题、绝对路径与访问级别；每个文件夹行提供重命名与删除对话框；每个会话行提供「移动到文件夹」操作，打开列出各文件夹及「移出文件夹」的选择器。文件夹重排序与文件夹内会话重排序已通过线协议契约与运行时接通，但尚未作为拖拽操作暴露。

## 涉及的面

- `packages/workspace/session-folder`（新建宿主包）
- `packages/host/apiproxy`（`folder.ts`、`folder.schema.ts`、`rpc-map.ts`、`rpc.schema.ts`、`events.ts`、`events.schema.ts`、`api-proxy.ts`、`fetch/handler.ts`、`fetch/client.ts`、`api/index.ts`）
- `packages/api/remotes`、`packages/client/connection`（`FolderId`/`FolderView`/`FolderPermission` 再导出、fixture）
- `packages/client/runtime`（`contract/folders.ts`、`folders/manager.ts`、`folders/service.ts`、`client/index.ts` 接线、`slots.ts`）
- `packages/client/web-react`（`scoped-slots.tsx` 的 `useFolders` 绑定）、`packages/client/ui-slots`（`SlotRendererHost.folders?`）
- `packages/client/ui-workspace`（`tree.ts`、`contract/slots.ts`、`rows/Rows.tsx`、`WorkspaceBrowser.tsx`、`locales.ts`、`client/index.ts`）
- `packages/sandbox/sandbox`（`SandboxExecutionPolicy`、`writableRoots`）、`packages/sandbox/sandbox-policy`（resolve 与模型上下文）、`packages/sandbox/sandbox-local`（bwrap/landlock/seatbelt 配置）
- `packages/bundle/web-app`（注册 `@deepseek-ai/dsh-session-folder`）

## 已知限制

- 文件夹拖拽重排序与文件夹内会话拖拽重排序尚不可由用户操作（线协议与运行时已具备）。
- 文件夹仅限 Web 侧边栏；CLI/ACP 界面不按文件夹分组。
- Windows ACL 运行器（`pwsh-sandbox`）使用自己的授权拼写，尚未消费文件夹根。

## 备选方案

**「一个会话只属于一个文件夹」并搬迁（首个发布的设计）。** `addSession` 会把会话从任何原有文件夹迁出，且把会话放入文件夹会使其从工作区分组中隐藏。已被否决：会话确实需要同时访问多个目录，破坏性的搬迁使第二次分配无法进行；`folder-session-conflict` 线代码与「从工作区隐藏」规则随之一并移除。

**文件夹仅作分组覆盖层。** 文件夹不携带目录根与访问级别。已被否决：需求是文件夹为可访问的目录根，会话可以读写其整个子树；侧边栏分组是这种归属的副产品，而非产品本身。

**文件夹取代工作区成为会话的 cwd。** 每个会话只属于一个文件夹，并以其为主目录。已在切片决策中否决：工作区保持其作为会话主 cwd 与宿主端记账的角色；文件夹根是在其上叠加的额外范围。

**仅在 fs 围栏中强制执行文件夹根。** 策略保持 `{ mode, workspaceRoot }`，每个强制方言各自特殊处理文件夹。已被否决：共享的 `writableRoots` 推导正是为了让 fs 围栏与所有基于运行器的方言不会漂移；新增的 `additionalWritableRoots` 策略字段维持这一单一事实来源。

## 后果

- **收益：** 模型运行时上下文在 `workspace-write` 下列出可写的文件夹根，模型无需新工具即可知道哪些目录可以修改；bash（bwrap/Landlock/Seatbelt）与 fs 围栏共享同一授权推导；侧边栏显示每个文件夹的根与访问级别；一个会话可以同时属于多个文件夹。
- **代价：** `read` 授权仅具告知意义，因为每种沙箱模式都允许读取——读取限制需要更广泛的沙箱重新设计；Landlock 与 bwrap 配置须扩展以消费新策略字段（Seatbelt 配置通过 `writableRoots` 免费获得）；旧的 `folder-session-conflict` 线代码已删除，预发布界面拒绝旧线格式而非兼容过渡。