# @deepseek-ai/dsh-session-folder

English | [中文](README.zh.md)

Session folder registry (`ctx.folderRegistry`) for the DeepSeek Harness: durable folder records that grant **directory access scopes** to their session members. Each folder names one absolute directory root (`path`) and an access level (`permission`: `read` | `write` | `both`); access covers the whole subtree beneath the root. A session may belong to several folders (multi-membership), and folder membership is orthogonal to Workspace membership: a folder is an extra accessible directory, not a replacement for the session's workspace cwd. Consumers see the `Folder` interface; the entity implementation stays package-private.

The web GUI renders folders as leading sections above Workspace groups in the sidebar (see `@deepseek-ai/dsh-client-ui-workspace`); the capability is optional there, so a composition without this plugin reads folders as absent. The wire contract and client runtime service live in `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-host-apiproxy`, and `@deepseek-ai/dsh-client-runtime`.

## Shape

- `ctx.folderRegistry.create(title, path, permission)` — trims and rejects an empty title, rejects a relative `path` (`isAbsolute` check) before resolving it absolute, and defaults `permission` to `both`. Creates a folder record with a generated id, prepends it to durable folder order, and returns the `Folder` view. The generated id is a `FolderId` brand.
- `ctx.folderRegistry.foldersOfSession(sessionId)` — the directory roots (`{ path, permission }`) granted to a session through all its folder memberships. The sandbox-policy service consumes this list to scope the session's `workspace-write` enforcement (`write`/`both` grants become additional writable roots; a `read` grant adds nothing, because reads are permitted in every mode).
- `ctx.folderRegistry.get(id)` / `list()` — cache-served lookups. `list()` is synchronous and follows durable registry order; both reject an unknown id with `FolderUnknownError`.
- `ctx.folderRegistry.rename(id, title)` — trims and rejects an empty title; resolves after durability. Unknown ids reject with `FolderUnknownError`.
- `ctx.folderRegistry.insertBefore(id, before?)` — moves a folder within durable folder order, DOM-insertBefore-like: before the anchor, or appended when the anchor is omitted. A source or anchor absent from the registry rejects with `FolderUnknownError` without writing; a self-anchor or move to the current position resolves without writing. The returned id list is the complete committed order.
- `ctx.folderRegistry.delete(id)` — removes only the folder registration and its durable order entry. Unknown ids reject with `FolderUnknownError`. Sessions that were in the folder are **not** deleted or detached from their Workspace; they simply lose the folder's access scope and return to their Workspace grouping or the ungrouped bucket.
- `ctx.folderRegistry.addSession(id, sessionId)` — prepends `sessionId` to the folder's manual order. Multi-membership is the model: the session may already live in other folders, and that membership is untouched. An unknown folder rejects with `FolderUnknownError`; an unknown session rejects with `FolderUnknownSessionError`. Resolves after durability.
- `ctx.folderRegistry.insertSessionBefore(id, sessionId, before?)` — moves an accounted session within the manual folder order, DOM-insertBefore-like. A session absent from the folder rejects with `FolderMoveInvalidError`; a self-anchor or move to the current position resolves without writing.
- `ctx.folderRegistry.removeSession(id, sessionId)` — removes only the folder membership entry; the session keeps its other memberships and returns to its Workspace grouping or Ungrouped. Unknown folders reject with `FolderUnknownError`; a session absent from the folder resolves without writing.
- `Folder.path` / `Folder.permission` — the folder's directory root and access level, fixed at creation.
- `Folder.sessionIds` — synchronous membership projection in durable manual order.

Folders store a single global object (`{ folders: FolderRecord[] }`) rather than one table per folder, so a single atomic write commits order, membership, and metadata together; a crash mid-write leaves at most one pending mutation, recovered on the next start. `storageDomain` and `sessionPersistence` are required startup dependencies; an unavailable peer leaves the plugin pending. `validateState` fails loud on duplicated folder ids or a session repeated within one folder's account; cross-folder repeats are the legal multi-membership case.

## Model Experience

### Folder records and directory access scopes

#### What the model sees

This package registers no tools, injects no prompts, and writes no session events. Its data reaches the model only through `ctx.sandboxPolicy` (when the deployment mounts both): for a `workspace-write` session, the policy's runtime context lists the writable folder roots — `Additional writable folders: ["/path"]` — so the model knows which directories it may modify. `read`-only folders and `read-only` sessions contribute no text.

#### Token effect

Zero direct tokens. When folder grants exist, the sandbox-policy context fragment adds a handful of tokens proportional to the number of writable folder roots; without grants the rendered policy is byte-identical to a deployment without this plugin.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- Folder reordering and per-folder session reordering are wired through the wire contract and client runtime but are not yet exposed as drag affordances in the sidebar UI; only create, rename, delete, and move-into-folder are user-facing today.
- The header index refreshes at startup and when a folder mutation must resolve an uncached session; concurrent edits from another process are observed after the next refresh or restart.
- The session-folder access scope is enforced by the fs fence and the bash runners through the shared writable-root derivation; a `read`-granted folder is informational only, because reads are permitted in every sandbox mode.