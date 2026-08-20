/**
 * Public type vocabulary of the session-folder entity: the `FolderId` brand
 * and the `Folder` consumer interface. Types only — the `FolderId` factory
 * lives in `index.ts` (this file carries no runtime code).
 * @module @deepseek-ai/dsh-session-folder/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Identifies one folder record. A generated uuid, never the title: titles are
 * user-editable and duplicates are allowed, so a reference anchor must stay
 * stable.
 */
export type FolderId = Branded<'FolderId'>

/**
 * Access level a folder grants to its directory root. `read` allows only
 * reads; `write` and `both` both allow reads and writes (the filesystem
 * sandbox's `workspace-write` mode already permits reads, so the two confer
 * identical access — the label is the grantor's intent). The session's own
 * Workspace cwd is always read+write and is not a folder.
 */
export type FolderPermission = 'read' | 'write' | 'both'

/**
 * One folder: a user-named, durable directory root the session may read and/or
 * write, plus the sessions grouped under it. A folder is an access scope, not
 * a Workspace; a session belongs to its Workspace (which sets its primary cwd)
 * and may belong to any number of folders, each granting its own directory
 * root and access level. Folder membership never changes a session's own
 * stored log or its Workspace accounting slot. Consumers only see this
 * interface; the implementation stays private.
 */
export interface Folder {
  /** Stable record id (generated uuid). */
  readonly id: FolderId

  /** Display title. User-chosen at create; duplicates are allowed. */
  readonly title: string

  /**
   * Canonical directory root the folder grants access to. Access covers the
   * whole subtree beneath it (so `/x` implicitly covers `/x/y`, `/x/z`).
   */
  readonly path: string

  /** Access level granted at {@link path}: `read`, `write`, or `both`. */
  readonly permission: FolderPermission

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Sessions in manually owned order: a new session is prepended at add,
   * explicit reordering goes through `insertSessionBefore`, and activity never
   * reorders. Every id is a session known live or in session persistence at
   * the time it was added. The same session may appear in several folders.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across folders allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Record a session in this folder's account. A session already in this
   * folder resolves without writing; a session in another folder is allowed —
   * multi-membership is the model, so adding never relocates. New ids must be
   * known (live or in session persistence); unknown ids reject without writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  addSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this folder's account. Idempotent: an id not on the
   * account resolves without writing. Never touches the session's own stored
   * log or its Workspace accounting slot.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  removeSession(sessionId: SessionId): Promise<void>
}
