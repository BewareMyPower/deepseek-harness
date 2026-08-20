/**
 * The outward folders-service face — what `ctx.folders` exposes to feature
 * packages and the renderer host, and therefore exactly what the test
 * runtime's folders double must implement. Wire-pump entry points
 * (handleHostEnvelope/handleConnected/refresh) stay on the concrete class.
 * Widening this interface is the explicit act of widening what features may
 * do to the folders domain.
 */
import type { FolderId, FolderPermission, FolderView, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { FolderListState } from '../folders/service.ts'
import type { ObservableSnapshot } from './store.ts'

/** The folders-service face injected as `ctx.folders`. */
export interface IFolders {
  /** The useFolders standard feed (read face — writes stay inside the domain). */
  readonly list: ObservableSnapshot<FolderListState>
  /**
   * Create a folder and prepend it to the durable display order.
   * @param title - Display title; trimmed non-empty, duplicates allowed.
   * @param path - Directory root the folder grants access to; absolute,
   *   whole subtree included.
   * @param permission - Access level granted at `path`.
   * @returns the created durable folder.
   */
  create(title: string, path: string, permission: FolderPermission): Promise<FolderView>
  /**
   * Rename a folder.
   * @param folderId - target folder.
   * @param title - the new display title.
   * @returns the renamed folder view.
   */
  rename(folderId: FolderId, title: string): Promise<FolderView>
  /**
   * Delete a folder registration; its sessions return to their Workspace
   * grouping or the ungrouped bucket.
   * @param folderId - target folder.
   */
  delete(folderId: FolderId): Promise<void>
  /**
   * Move a folder within the durable display order.
   * @param folderId - Folder to move.
   * @param beforeFolderId - Anchor folder; omitted appends.
   */
  insertBefore(folderId: FolderId, beforeFolderId?: FolderId): Promise<void>
  /**
   * Add one session to a folder, prepending it to the folder's manual order.
   * @param folderId - target folder.
   * @param sessionId - session to add.
   * @returns the updated folder view.
   */
  addSession(folderId: FolderId, sessionId: SessionId): Promise<FolderView>
  /**
   * Move an accounted session within/into a folder's ordered list.
   * @param folderId - target folder.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the updated folder view.
   */
  insertSessionBefore(folderId: FolderId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<FolderView>
  /**
   * Remove one session from a folder; it returns to its Workspace grouping.
   * @param folderId - target folder.
   * @param sessionId - session to remove.
   * @returns the updated folder view.
   */
  removeSession(folderId: FolderId, sessionId: SessionId): Promise<FolderView>
}
