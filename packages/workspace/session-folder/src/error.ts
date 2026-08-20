/**
 * Business errors of the session-folder registry, named after their stable
 * wire codes. Storage/durability failures stay plain errors and never use
 * these classes — only the domain's own rejections do.
 * @module @deepseek-ai/dsh-session-folder/src/error
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { FolderId } from './types.ts'

/** A folder operation named a folder absent from the registry. */
export class FolderUnknownError extends Error {
  /**
   * @param folderId - The unknown folder id.
   */
  constructor(readonly folderId: FolderId) {
    super(`cannot resolve folder '${folderId}': the registry holds no such folder`)
    this.name = 'FolderUnknownError'
  }
}

/** A session reorder named a session or anchor absent from the folder's account. */
export class FolderMoveInvalidError extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message: string) {
    super(message)
    this.name = 'FolderMoveInvalidError'
  }
}

/** A session assignment named a session neither live nor in session persistence. */
export class FolderUnknownSessionError extends Error {
  /**
   * @param sessionId - The unknown session id.
   */
  constructor(readonly sessionId: SessionId) {
    super(`cannot assign session '${sessionId}' to a folder: live sessions and session persistence hold no such session`)
    this.name = 'FolderUnknownSessionError'
  }
}
