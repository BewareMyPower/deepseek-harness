/**
 * folder domain contract. Wire projection of the host-side session-folder
 * entity (@deepseek-ai/dsh-session-folder): a stable id, a user title, and an
 * ordered session account independent of workspace membership. Method
 * signatures are the source of truth, same as the workspace domain.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side folder id brand. Deliberately re-declared here rather than
 * imported from dsh-session-folder: api/ must stay browser-importable with
 * zero host-package dependencies, and the brand string matches, so both sides
 * agree structurally.
 */
export type FolderId = Branded<'FolderId'>

/** One folder row: the record projection every folder.* value carries. */
export interface FolderView {
  folderId: FolderId
  /** Display title (user-chosen at create). */
  title: string
  /**
   * Canonical directory root the folder grants access to; the granted range
   * covers the whole subtree beneath it.
   */
  path: string
  /** Access level granted at `path`: read-only, writable, or both. */
  permission: FolderPermission
  /**
   * Sessions accounted under this folder, in manually owned order (add
   * prepends, insertSessionBefore reorders; activity never does). A session
   * may be accounted by several folders (multi-membership).
   */
  sessionIds: SessionId[]
  /** ISO-8601 creation instant. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

/**
 * Access level a folder grants at its directory root. `write` and `both`
 * both confer read+write in the sandbox (workspace-write mode permits reads);
 * the value records the grantor's intent.
 */
export type FolderPermission = 'read' | 'write' | 'both'

/** Folder-domain unary methods (the map keys folder.* of RpcMethodMap). */
export interface FolderApi {
  /**
   * Lists all folders in the registry's durable display order.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ items: FolderView[] }>>

  /**
   * Creates a folder with the given display title, directory root, and access
   * level, and prepends it to the durable display order. `title` is trimmed
   * and must be non-empty; `path` must be absolute; duplicates are allowed.
   */
  create(request: RpcRequest<{ title: string; path: string; permission: FolderPermission }>):
  Promise<RpcResponse<{ folder: FolderView }>>

  /**
   * Renames a folder. `title` is trimmed and must be non-empty
   * (schema-enforced). An unknown id fails with `folder-not-found`; renaming
   * to the current title is a no-op success (no durable write).
   */
  rename(request: RpcRequest<{ folderId: FolderId; title: string }>):
  Promise<RpcResponse<{ folder: FolderView }>>

  /**
   * Removes one folder registration. The sessions it held are not touched:
   * each returns to its Workspace grouping or the ungrouped bucket. An
   * unknown id fails with `folder-not-found`.
   */
  delete(request: RpcRequest<{ folderId: FolderId }>):
  Promise<RpcResponse<{ deleted: true }>>

  /**
   * Moves one folder within the registry display order,
   * DOM-insertBefore-like. An omitted anchor appends to the end.
   */
  insertBefore(request: RpcRequest<{
    folderId: FolderId
    beforeFolderId?: FolderId
  }>): Promise<RpcResponse<{ folderIds: FolderId[] }>>

  /**
   * Adds one session to a folder, prepending it to the folder's manual order.
   * Multi-membership is allowed, so the session may live in other folders;
   * adding to a folder that already holds it resolves without writing. The
   * session must be known (live or in session persistence), otherwise it
   * fails with `session-not-found`.
   */
  addSession(request: RpcRequest<{ folderId: FolderId; sessionId: SessionId }>):
  Promise<RpcResponse<{ folder: FolderView }>>

  /**
   * Moves an accounted session within its folder's manual order,
   * DOM-insertBefore-like: with `beforeSessionId` the session is inserted
   * before that anchor; omitted appends to the end. An unknown folder fails
   * with `folder-not-found`; a session or anchor not accounted by the folder
   * fails with `folder-move-invalid`. A move to the current position is a
   * no-op success.
   */
  insertSessionBefore(request: RpcRequest<{
    folderId: FolderId
    sessionId: SessionId
    beforeSessionId?: SessionId
  }>): Promise<RpcResponse<{ folder: FolderView }>>

  /**
   * Removes one session from a folder, idempotently. The session log and its
   * Workspace accounting slot are untouched; the session returns to its
   * Workspace grouping or the ungrouped bucket. An unknown folder fails with
   * `folder-not-found`.
   */
  removeSession(request: RpcRequest<{ folderId: FolderId; sessionId: SessionId }>):
  Promise<RpcResponse<{ folder: FolderView }>>
}
