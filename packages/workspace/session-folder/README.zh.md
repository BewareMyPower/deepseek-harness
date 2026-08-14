# @deepseek-ai/dsh-session-folder

[English](README.md) | 中文

DeepSeek Harness 的用户会话文件夹注册表（`ctx.folderRegistry`）：通过领域数据表单持久化的文件夹记录、稳定的文件夹顺序，以及「一个会话只能属于一个文件夹」的不变量。文件夹是对会话的、独立于工作区（Project）的顶层分组：一个会话最多属于一个文件夹，将其放入文件夹会从工作区分组中隐藏，但不改变工作区自身的记账。使用者看到 `Folder` 接口；实体实现保持包内私有。

Web GUI 在侧边栏中把文件夹渲染为工作区分组上方的置顶区块（见 `@deepseek-ai/dsh-client-ui-workspace`）；该能力在 UI 中是可选的，因此未装载本插件的组合会把文件夹视为不存在。线协议契约与客户端运行时服务分别位于 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-host-apiproxy` 和 `@deepseek-ai/dsh-client-runtime`。

## 形态

- `ctx.folderRegistry.create(title)` — 去除首尾空白并拒绝空标题；允许重名。创建带生成 id 的文件夹记录，将其前置到持久化文件夹顺序，并返回 `Folder` 视图。生成的 id 为 `FolderId` 品牌类型。
- `ctx.folderRegistry.get(id)` / `list()` — 经由缓存的查询。`list()` 为同步调用并遵循持久化的注册顺序；未知 id 均以 `FolderUnknownError` 拒绝。
- `ctx.folderRegistry.rename(id, title)` — 去除首尾空白并拒绝空标题；返回重命名后的 `Folder` 视图。未知 id 以 `FolderUnknownError` 拒绝。
- `ctx.folderRegistry.insertBefore(id, before?)` — 在持久化文件夹顺序内移动文件夹，类同 DOM 的 insertBefore：置于锚点之前，省略锚点时追加。源或锚点不在注册表中时以 `FolderUnknownError` 拒绝且不写入；自锚点或移动到当前位置则直接成功不写入。返回值为完整提交后的顺序。
- `ctx.folderRegistry.delete(id)` — 仅移除文件夹注册与其持久化顺序项。未知 id 以 `FolderUnknownError` 拒绝。原属该文件夹的会话**不会被删除**，也不会从工作区解绑，它们会回到各自的工作区分组或未分组桶。
- `ctx.folderRegistry.addSession(id, sessionId)` — 将 `sessionId` 前置到文件夹的手动顺序，并 enforce 「一个会话只能属于一个文件夹」不变量：若会话已属于另一个文件夹，则先移除其原有归属。未知文件夹以 `FolderUnknownError` 拒绝；未知会话以 `FolderUnknownSessionError` 拒绝。返回的 `Folder` 视图反映新顺序。
- `ctx.folderRegistry.insertSessionBefore(id, sessionId, before?)` — 在文件夹手动顺序内移动已归属的会话，类同 DOM 的 insertBefore。会话不在文件夹内时以 `FolderUnknownSessionError` 拒绝；自锚点或移动到当前位置则直接成功不写入。若要把属于另一文件夹的会话搬入，会以 `FolderSessionConflictError` 拒绝（请改用 `addSession` 搬迁）。
- `ctx.folderRegistry.removeSession(id, sessionId)` — 仅移除文件夹归属项；会话回到其工作区分组或未分组。未知文件夹以 `FolderUnknownError` 拒绝；会话不在文件夹内时以 `FolderUnknownSessionError` 拒绝。
- `Folder.sessionIds` — 持久化手动顺序下的同步成员投影。

文件夹只存储一个全局对象（`{ folders: FolderRecord[] }`），而非每个文件夹一张表，这样一次原子写入即可同时提交顺序、成员与元数据；写入中途崩溃最多留下一个待提交变更，在下次启动时恢复。`storageDomain` 与 `sessionPersistence` 为必需的启动依赖；不可用的对等方会使插件保持挂起。

## 模型体验

### 文件夹记录与会话归属

#### 模型看到的内容

无。`ctx.folderRegistry` 仅向宿主端与客户端使用者提供文件夹记录：本包不注册任何工具、不注入任何提示、不写入任何会话事件，因此没有任何请求字段会携带本包的数据。

#### Token 影响

每次请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：本包从不触碰请求前缀，因此不会使提供方的缓存复用失效。

## 已知限制与延后工作

- 文件夹重排序与文件夹内会话重排序已通过线协议契约与客户端运行时接通，但尚未作为侧边栏 UI 中的拖拽操作暴露；目前用户可见的仅有创建、重命名、删除与「移入文件夹」。
- 头部索引在启动时刷新，并在文件夹变更需要解析未缓存会话时刷新；另一进程并发的修改需在下一次刷新或重启后才能观察到。
