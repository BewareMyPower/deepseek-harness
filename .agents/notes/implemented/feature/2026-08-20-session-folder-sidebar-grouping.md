# Agent Note: Session Folders as Accessible Directory Roots with Sidebar Grouping

Status: implemented

English | [中文](2026-08-20-session-folder-sidebar-grouping.zh.md)

## Problem

The web GUI sidebar groups sessions only by Workspace (Project) membership. Users want to group same-topic sessions freely, independent of which directory a session was created in. Workspace is a host-side directory concept; a folder is a user-owned overlay that must not disturb Workspace accounting. The "pinned" concept is out of scope: folders are the grouping primitive.

Folders double as an access-scope mechanism: each folder names one absolute directory root and an access level (`read` | `write` | `both`), and the folder's member sessions may access that root (the whole subtree). The session's workspace cwd stays primary; folder roots are additional accessible directories, so a session may belong to several folders at once (multi-membership). Placing a session in a folder does not hide it from its Workspace group or detach it from the Workspace; removing it from a folder only drops that folder's access scope and grouping.

## Decision

### Host entity (`@deepseek-ai/dsh-session-folder`)

`FolderRegistry` (`ctx.folderRegistry`) is a durable entity on the `session_folder` domain (underscore, not hyphen — `defineDomain` rejects the latter). It stores a single global object `{ folders: FolderRecord[] }` rather than one table per folder, so a single atomic write commits order, membership, and metadata together; a crash mid-write leaves at most one pending mutation, recovered on the next start. `storageDomain` and `sessionPersistence` are required startup dependencies.

Multi-membership is the model: `addSession` prepends the session and only gates on the session existing; a session already in another folder is untouched. `validateState` rejects duplicated folder ids and a session repeated within one folder's account; cross-folder repeats are the legal multi-membership case. Unknown folder rejects with `FolderUnknownError`; unknown session with `FolderUnknownSessionError`; moving an unaccounted session within a folder rejects with `FolderMoveInvalidError`.

| RPC | Behavior |
| --- | --- |
| `folder.list` | Returns durable folders in order |
| `folder.create({ title, path, permission })` | Trims and rejects empty title; rejects a relative path and resolves it absolute; `permission` defaults to `both`; prepends to order |
| `folder.rename({ folderId, title })` | Trims and rejects empty title |
| `folder.delete({ folderId })` | Removes the registration; member sessions lose the access scope and return to Workspace/Ungrouped, never deleted |
| `folder.insertBefore({ folderId, beforeFolderId? })` | Moves a folder within durable order; appended when anchor omitted |
| `folder.addSession({ folderId, sessionId })` | Prepends to manual order; multi-membership, no relocation |
| `folder.insertSessionBefore({ folderId, sessionId, beforeSessionId? })` | Moves an accounted session within the folder order |
| `folder.removeSession({ folderId, sessionId })` | Removes only the membership entry |

Host frames: `host/folder-changed`, `host/folder-removed`, `host/folder-order-changed`. Error codes: `folder-not-found`, `folder-move-invalid`. The obsolete `folder-session-conflict` code is gone with the one-folder-per-session invariant.

### Wire contract (`@deepseek-ai/dsh-host-apiproxy`, `@deepseek-ai/dsh-api-remotes`)

`FolderApi`/`FolderId`/`FolderView` are declared in `api/` (browser-safe, no host deps) and re-exported from the connection client. `FolderView` carries the directory root and access level (`path`, `permission`). The `apiproxy` `folder` namespace dispatches to `ctx.get('folderRegistry')`, guarded so a composition without the plugin fails without a folder handler. Host frames are emitted only when the registry service is present.

### Client runtime (`@deepseek-ai/dsh-client-runtime`)

`FolderRuntime` (`ctx.folders`) projects the `FolderManager` baseline into a `list` snapshot store and exposes `create`/`rename`/`delete`/`addSession`/`removeSession`/`insertBefore`/`insertSessionBefore`. `useFolders` is an **optional** global standard prop (`GlobalStandardProps.useFolders?`) and `folders` is **optional** in `SlotRendererHost`, so compositions without the folder capability read folders as absent and existing surfaces need no folder wiring.

### Sandbox policy (`@deepseek-ai/dsh-sandbox-policy`)

`SandboxExecutionPolicy` gains `additionalWritableRoots`, and the shared `writableRoots` derivation (`@deepseek-ai/dsh-sandbox`) folds them into every `workspace-write` allow-list, so the fs fence and every runner that derives its grant from that helper cannot drift. `ctx.sandboxPolicy.resolve({ session })` reads `ctx.folderRegistry.foldersOfSession` and contributes each `write`/`both` folder root as an additional writable root (`read` grants add nothing — reads are permitted in every mode). The policy's model context renders the writable folder list under `workspace-write`; a `read-only` session never writes folder roots. The bwrap and Landlock profiles mount/grant each additional root; the Seatbelt profile derives it from `writableRoots` automatically.

### Web UI (`@deepseek-ai/dsh-client-ui-workspace`)

`groupByFoldersAndWorkspaces` derives sections in order: folder groups (durable registry order), then Workspace groups (registry order), then the ungrouped bucket. Multi-membership means a session appears under **both** its folder and its Workspace group. Folder groups render through a new `FolderRowItem` whose subtitle shows the directory root and its access level; Workspace rows show the session cwd. The sidebar header gains a "New folder" button whose dialog collects title, absolute path, and access level; each folder row offers rename and delete dialogs; each session row offers a "Move to folder" action that opens a picker listing folders plus "Remove from folder". Folder reordering and folder-internal session reordering are wired through the wire contract and runtime but not yet exposed as drag affordances.

## Surfaces touched

- `packages/workspace/session-folder` (new host package)
- `packages/host/apiproxy` (`folder.ts`, `folder.schema.ts`, `rpc-map.ts`, `rpc.schema.ts`, `events.ts`, `events.schema.ts`, `api-proxy.ts`, `fetch/handler.ts`, `fetch/client.ts`, `api/index.ts`)
- `packages/api/remotes`, `packages/client/connection` (`FolderId`/`FolderView`/`FolderPermission` re-export, fixture)
- `packages/client/runtime` (`contract/folders.ts`, `folders/manager.ts`, `folders/service.ts`, `client/index.ts` wiring, `slots.ts`)
- `packages/client/web-react` (`scoped-slots.tsx` `useFolders` bind), `packages/client/ui-slots` (`SlotRendererHost.folders?`)
- `packages/client/ui-workspace` (`tree.ts`, `contract/slots.ts`, `rows/Rows.tsx`, `WorkspaceBrowser.tsx`, `locales.ts`, `client/index.ts`)
- `packages/sandbox/sandbox` (`SandboxExecutionPolicy`, `writableRoots`), `packages/sandbox/sandbox-policy` (resolve + model context), `packages/sandbox/sandbox-local` (bwrap/landlock/seatbelt profiles)
- `packages/bundle/web-app` (registers `@deepseek-ai/dsh-session-folder`)

## Known Limitations

- Folder drag-reorder and folder-internal session drag-reorder are not user-facing yet (wire + runtime are present).
- Folders are web-sidebar only; no CLI/ACP surface groups by folder.
- The Windows ACL runner (`pwsh-sandbox`) keeps its own grant spelling and does not yet consume the folder roots.

## Alternatives considered

**One folder per session with relocation (the first shipped design).** `addSession` moved a session out of any prior folder, and placing a session in a folder hid it from its Workspace group. Rejected: a session legitimately needs several accessible directories at once, and destructive relocation made assigning a second folder impossible; the wire code `folder-session-conflict` and the hide-from-workspace rule were removed with it.

**Folders as a grouping-only overlay.** The folder would carry no directory root and no access level. Rejected: the requirement is that folders are accessible directory roots whose whole subtree the session may read or write; sidebar grouping is the byproduct of that membership, not the product.

**Folders replace the Workspace as the session's cwd.** Each session would belong to exactly one folder that is its primary directory. Rejected in the small-slice decision: the Workspace keeps its role as the session's primary cwd and host-side accounting; folder roots are additional scopes layered on top.

**Enforcing folder roots only in the fs fence.** The policy would stay `{ mode, workspaceRoot }` and each enforcement dialect would special-case folders. Rejected: the shared `writableRoots` derivation exists precisely so the fs fence and every runner-based dialect cannot drift; the new `additionalWritableRoots` policy field keeps that single source of truth.

## Consequences

- **Bought:** the model's runtime context now names the writable folder roots under `workspace-write`, so the model knows which directories it may modify without a new tool; bash (bwrap/Landlock/Seatbelt) and the fs fence share one grant derivation; the sidebar shows each folder's root and access level; a session can be a member of several folders at once.
- **Cost:** a `read`-granted folder is informational only, because every sandbox mode already permits reads — read confinement would need a wider sandbox redesign; the Landlock and bwrap profiles had to grow to consume the new policy field (the Seatbelt profile got it free through `writableRoots`); the old `folder-session-conflict` wire code is deleted, so the pre-release surface rejects old wire formats rather than bridging them.