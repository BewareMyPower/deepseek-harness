# Agent Note: Session Folders as an Independent Top-Level Sidebar Grouping

Status: implemented

English | [中文](2026-08-20-session-folder-sidebar-grouping.zh.md)

## Problem

The web GUI sidebar groups sessions only by Workspace (Project) membership. Users want to group same-topic sessions freely, independent of which directory a session was created in. Workspace is a host-side directory concept; a free-form folder is a user-owned overlay that must not disturb Workspace accounting. The "pinned" concept is out of scope: folders are the grouping primitive.

Folders are an independent top-level grouping: above the Workspace sections, ordered in durable registry order, with one folder per session. Placing a session in a folder hides it from its Workspace group but does not detach it from the Workspace, so removing it from the folder returns it to its Workspace grouping or the ungrouped bucket.

## Decision

### Host entity (`@deepseek-ai/dsh-session-folder`)

`FolderRegistry` (`ctx.folderRegistry`) is a durable entity on the `session_folder` domain (underscore, not hyphen — `defineDomain` rejects the latter). It stores a single global object `{ folders: FolderRecord[] }` rather than one table per folder, so a single atomic write commits order, membership, and metadata together; a crash mid-write leaves at most one pending mutation, recovered on the next start. `storageDomain` and `sessionPersistence` are required startup dependencies.

The one-folder-per-session invariant is enforced in `mutateFolder`: `addSession` relocates a session out of any prior folder before prepending it; `insertSessionBefore` for a session that still lives in another folder rejects with `FolderSessionConflictError`. Unknown folder rejects with `FolderUnknownError`; unknown session with `FolderUnknownSessionError`.

| RPC | Behavior |
| --- | --- |
| `folder.list` | Returns durable folders in order |
| `folder.create({ title })` | Trims and rejects empty title; duplicates allowed; prepends to order |
| `folder.rename({ folderId, title })` | Trims and rejects empty title |
| `folder.delete({ folderId })` | Removes the registration; member sessions return to Workspace/Ungrouped, never deleted |
| `folder.insertBefore({ folderId, beforeFolderId? })` | Moves a folder within durable order; appended when anchor omitted |
| `folder.addSession({ folderId, sessionId })` | Prepends to manual order, relocating from any prior folder |
| `folder.insertSessionBefore({ folderId, sessionId, beforeSessionId? })` | Moves an accounted session within the folder order |
| `folder.removeSession({ folderId, sessionId })` | Removes only the membership entry |

Host frames: `host/folder-changed`, `host/folder-removed`, `host/folder-order-changed`. Error codes: `folder-not-found`, `folder-session-conflict`, `folder-move-invalid`.

### Wire contract (`@deepseek-ai/dsh-host-apiproxy`, `@deepseek-ai/dsh-api-remotes`)

`FolderApi`/`FolderId`/`FolderView` are declared in `api/` (browser-safe, no host deps) and re-exported from the connection client. The `apiproxy` `folder` namespace dispatches to `ctx.get('folderRegistry')`, guarded so a composition without the plugin fails without a folder handler. Host frames are emitted only when the registry service is present.

### Client runtime (`@deepseek-ai/dsh-client-runtime`)

`FolderRuntime` (`ctx.folders`) projects the `FolderManager` baseline into a `list` snapshot store and exposes `create`/`rename`/`delete`/`addSession`/`removeSession`/`insertBefore`/`insertSessionBefore`. `useFolders` is an **optional** global standard prop (`GlobalStandardProps.useFolders?`) and `folders` is **optional** in `SlotRendererHost`, so compositions without the folder capability read folders as absent and existing surfaces need no folder wiring.

### Web UI (`@deepseek-ai/dsh-client-ui-workspace`)

`groupByFoldersAndWorkspaces` derives sections in order: folder groups (durable registry order), then Workspace groups (registry order) of the sessions not in any folder, then the ungrouped bucket. Folder groups render through a new `FolderRowItem`; a session in a folder is hidden from its Workspace group. The sidebar header gains a "New folder" button; each folder row offers rename and delete dialogs; each session row offers a "Move to folder" action that opens a picker listing folders plus "Remove from folder". Folder reordering and folder-internal session reordering are wired through the wire contract and runtime but not yet exposed as drag affordances.

## Surfaces touched

- `packages/workspace/session-folder` (new host package)
- `packages/host/apiproxy` (`folder.ts`, `folder.schema.ts`, `rpc-map.ts`, `rpc.schema.ts`, `events.ts`, `events.schema.ts`, `api-proxy.ts`, `fetch/handler.ts`, `fetch/client.ts`, `api/index.ts`)
- `packages/api/remotes`, `packages/client/connection` (`FolderId`/`FolderView` re-export, fixture)
- `packages/client/runtime` (`contract/folders.ts`, `folders/manager.ts`, `folders/service.ts`, `client/index.ts` wiring, `slots.ts`)
- `packages/client/web-react` (`scoped-slots.tsx` `useFolders` bind), `packages/client/ui-slots` (`SlotRendererHost.folders?`)
- `packages/client/ui-workspace` (`tree.ts`, `contract/slots.ts`, `rows/Rows.tsx`, `WorkspaceBrowser.tsx`, `locales.ts`, `client/index.ts`)
- `packages/bundle/web-app` (registers `@deepseek-ai/dsh-session-folder`)

## Known Limitations

- Folder drag-reorder and folder-internal session drag-reorder are not user-facing yet (wire + runtime are present).
- Folders are web-sidebar only; no CLI/ACP surface groups by folder.
