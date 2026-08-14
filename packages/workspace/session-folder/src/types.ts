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
 * One folder: a user-named, user-arranged container of sessions, orthogonal
 * to Workspace membership. A session accounts to at most one folder; folder
 * membership never touches the session log or its Workspace accounting slot,
 * so removing a session from a folder returns it to its Workspace grouping.
 * Consumers only see this interface; the implementation stays private.
 */
export interface Folder {
  /** Stable record id (generated uuid). */
  readonly id: FolderId

  /** Display title. User-chosen at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Sessions in manually owned order: a new session is prepended at add,
   * explicit reordering goes through `insertSessionBefore`, and activity never
   * reorders. Every id is a session known live or in session persistence at
   * the time it was added.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across folders allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this folder's account. An already accounted id
   * resolves without writing. A new id must be known (live or in session
   * persistence) and must not be accounted by another folder; unknown ids and
   * cross-folder moves reject without writing. Moving a session between
   * folders is `removeSession` on the source then `addSession` here.
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