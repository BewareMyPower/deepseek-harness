# @deepseek-ai/dsh-session-folder

English | [中文](README.zh.md)

User session folder registry (`ctx.folderRegistry`) for the DeepSeek Harness: durable folder records, stable folder order, and a one-folder-per-session invariant stored through the domain data form. Folders are an independent top-level grouping of sessions, orthogonal to Workspace (Project) membership: a session may sit in at most one folder, and placing it in a folder hides it from its Workspace group without changing the Workspace's own accounting. Consumers see the `Folder` interface; the entity implementation stays package-private.

The web GUI renders folders as leading sections above Workspace groups in the sidebar (see `@deepseek-ai/dsh-client-ui-workspace`); the capability is optional there, so a composition without this plugin reads folders as absent. The wire contract and client runtime service live in `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-host-apiproxy`, and `@deepseek-ai/dsh-client-runtime`.

## Shape

- `ctx.folderRegistry.create(title)` — trims and rejects an empty title; duplicates are allowed. Creates a folder record with a generated id, prepends it to durable folder order, and returns the `Folder` view. The generated id is a `FolderId` brand.
- `ctx.folderRegistry.get(id)` / `list()` — cache-served lookups. `list()` is synchronous and follows durable registry order; both reject an unknown id with `FolderUnknownError`.
- `ctx.folderRegistry.rename(id, title)` — trims and rejects an empty title; returns the renamed `Folder` view. Unknown ids reject with `FolderUnknownError`.
- `ctx.folderRegistry.insertBefore(id, before?)` — moves a folder within durable folder order, DOM-insertBefore-like: before the anchor, or appended when the anchor is omitted. A source or anchor absent from the registry rejects with `FolderUnknownError` without writing; a self-anchor or move to the current position resolves without writing. The returned id list is the complete committed order.
- `ctx.folderRegistry.delete(id)` — removes only the folder registration and its durable order entry. Unknown ids reject with `FolderUnknownError`. Sessions that were in the folder are **not** deleted or detached from their Workspace; they return to their Workspace grouping or the ungrouped bucket.
- `ctx.folderRegistry.addSession(id, sessionId)` — prepends `sessionId` to the folder's manual order and enforces the one-folder-per-session invariant: if the session already belongs to another folder, that membership is removed first. An unknown folder rejects with `FolderUnknownError`; an unknown session rejects with `FolderUnknownSessionError`. The returned `Folder` view reflects the new order.
- `ctx.folderRegistry.insertSessionBefore(id, sessionId, before?)` — moves an accounted session within the manual folder order, DOM-insertBefore-like. A session absent from the folder rejects with `FolderUnknownSessionError`; a self-anchor or move to the current position resolves without writing. Adding a session that lives in another folder is rejected with `FolderSessionConflictError` (use `addSession` to relocate it).
- `ctx.folderRegistry.removeSession(id, sessionId)` — removes only the folder membership entry; the session returns to its Workspace grouping or Ungrouped. Unknown folders reject with `FolderUnknownError`; a session absent from the folder rejects with `FolderUnknownSessionError`.
- `Folder.sessionIds` — synchronous membership projection in durable manual order.

Folders store a single global object (`{ folders: FolderRecord[] }`) rather than one table per folder, so a single atomic write commits order, membership, and metadata together; a crash mid-write leaves at most one pending mutation, recovered on the next start. `storageDomain` and `sessionPersistence` are required startup dependencies; an unavailable peer leaves the plugin pending.

## Model Experience

### Folder records and session membership

#### What the model sees

Nothing. `ctx.folderRegistry` serves folder records to host-side and client consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Folder reordering and per-folder session reordering are wired through the wire contract and client runtime but are not yet exposed as drag affordances in the sidebar UI; only create, rename, delete, and move-into-folder are user-facing today.
- The header index refreshes at startup and when a folder mutation must resolve an uncached session; concurrent edits from another process are observed after the next refresh or restart.
