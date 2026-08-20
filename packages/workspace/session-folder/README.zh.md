# @deepseek-ai/dsh-session-folder

[English](README.md) | 中文

DeepSeek Harness 的会话文件夹注册表（`ctx.folderRegistry`）：持久化的文件夹记录，为其中的会话成员授予**目录访问范围**。每个文件夹指定一个绝对目录根（`path`）与一个访问级别（`permission`：`read` | `write` | `both`）；访问覆盖根目录下的整个子树。一个会话可以同时属于多个文件夹（多归属），且文件夹归属与工作区归属正交：文件夹是额外的可访问目录，而非会话工作区 cwd 的替代品。使用者看到 `Folder` 接口；实体实现保持包内私有。

Web GUI 在侧边栏中把文件夹渲染为工作区分组上方的置顶区块（见 `@deepseek-ai/dsh-client-ui-workspace`）；该能力在 UI 中是可选的，因此未装载本插件的组合会把文件夹视为不存在。线协议契约与客户端运行时服务分别位于 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-host-apiproxy` 和 `@deepseek-ai/dsh-client-runtime`。

## 形态

- `ctx.folderRegistry.create(title, path, permission)` — 去除首尾空白并拒绝空标题；`path` 为相对路径时拒绝（`isAbsolute` 检查），随后解析为绝对路径；`permission` 缺省为 `both`。创建带生成 id 的文件夹记录，将其前置到持久化文件夹顺序，并返回 `Folder` 视图。生成的 id 为 `FolderId` 品牌类型。
- `ctx.folderRegistry.foldersOfSession(sessionId)` — 会话通过其全部文件夹归属获得的目录根（`{ path, permission }`）列表。sandbox-policy 服务消费该列表以划定会话的 `workspace-write` 强制范围（`write`/`both` 授权成为额外可写根；`read` 授权不新增任何内容，因为每种模式下读取都被允许）。
- `ctx.folderRegistry.get(id)` / `list()` — 经由缓存的查询。`list()` 为同步调用并遵循持久化的注册顺序；未知 id 均以 `FolderUnknownError` 拒绝。
- `ctx.folderRegistry.rename(id, title)` — 去除首尾空白并拒绝空标题；持久化后完成。未知 id 以 `FolderUnknownError` 拒绝。
- `ctx.folderRegistry.insertBefore(id, before?)` — 在持久化文件夹顺序内移动文件夹，类同 DOM 的 insertBefore：置于锚点之前，省略锚点时追加。源或锚点不在注册表中时以 `FolderUnknownError` 拒绝且不写入；自锚点或移动到当前位置则直接成功不写入。返回值为完整提交后的顺序。
- `ctx.folderRegistry.delete(id)` — 仅移除文件夹注册与其持久化顺序项。未知 id 以 `FolderUnknownError` 拒绝。原属该文件夹的会话**不会被删除**，也不会从工作区解绑，它们只会失去该文件夹的访问范围，并回到各自的工作区分组或未分组桶。
- `ctx.folderRegistry.addSession(id, sessionId)` — 将 `sessionId` 前置到文件夹的手动顺序。多归属是模型本身：会话可能已在其他文件夹中，其原有归属不受影响。未知文件夹以 `FolderUnknownError` 拒绝；未知会话以 `FolderUnknownSessionError` 拒绝。持久化后完成。
- `ctx.folderRegistry.insertSessionBefore(id, sessionId, before?)` — 在文件夹手动顺序内移动已归属的会话，类同 DOM 的 insertBefore。会话不在该文件夹内时以 `FolderMoveInvalidError` 拒绝；自锚点或移动到当前位置则直接成功不写入。
- `ctx.folderRegistry.removeSession(id, sessionId)` — 仅移除文件夹归属项；会话保留其其他归属，并回到其工作区分组或未分组。未知文件夹以 `FolderUnknownError` 拒绝；会话不在文件夹内时直接成功不写入。
- `Folder.path` / `Folder.permission` — 文件夹的目录根与访问级别，创建时固定。
- `Folder.sessionIds` — 持久化手动顺序下的同步成员投影。

文件夹只存储一个全局对象（`{ folders: FolderRecord[] }`），而非每个文件夹一张表，这样一次原子写入即可同时提交顺序、成员与元数据；写入中途崩溃最多留下一个待提交变更，在下次启动时恢复。`storageDomain` 与 `sessionPersistence` 为必需的启动依赖；不可用的对等方会使插件保持挂起。`validateState` 对重复的文件夹 id 或同一文件夹内重复出现的会话大声失败；跨文件夹重复是合法的多归属情形。

## 模型体验

### 文件夹记录与目录访问范围

#### 模型看到的内容

本包不注册任何工具、不注入任何提示、不写入任何会话事件。其数据仅通过 `ctx.sandboxPolicy`（当部署同时装载两者时）到达模型：对 `workspace-write` 会话，策略的运行时上下文列出可写的文件夹根——`Additional writable folders: ["/path"]`——使模型知道哪些目录可以修改。`read` 只读文件夹与 `read-only` 会话不产生任何文本。

#### Token 影响

直接 token 为零。存在文件夹授权时，sandbox-policy 上下文片段增加与可写文件夹根数量成正比的少量 token；无授权时渲染出的策略与未装载本插件的部署逐字节相同。

#### KV Cache 影响

与实时请求无关：本包从不触碰请求前缀，因此不会使提供方的缓存复用失效。

## 已知限制与延后工作

- 文件夹重排序与文件夹内会话重排序已通过线协议契约与客户端运行时接通，但尚未作为侧边栏 UI 中的拖拽操作暴露；目前用户可见的仅有创建、重命名、删除与「移入文件夹」。
- 头部索引在启动时刷新，并在文件夹变更需要解析未缓存会话时刷新；另一进程并发的修改需在下一次刷新或重启后才能观察到。
- 会话文件夹的访问范围通过共享的可写根推导由 fs 围栏与 bash 运行器强制执行；`read` 授权仅具告知意义，因为每种沙箱模式都允许读取。