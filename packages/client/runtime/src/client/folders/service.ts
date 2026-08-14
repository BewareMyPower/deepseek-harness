/** FolderRuntime projects the Folder object manager for UI consumers. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  IApiClient, RpcError, SessionId, FolderId, FolderView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '../contract/store.ts'
import { createSnapshotStore } from '../contract/store.ts'
import type { IFolders } from '../contract/folders.ts'
import { FolderManager, type FolderListPhase } from './manager.ts'

/** Folder list plus its readiness lifecycle. */
export interface FolderListState {
  items: readonly FolderView[]
  state: 'idle' | 'loading' | 'error'
  phase: FolderListPhase
  error: RpcError | null
}

/** Real Folder object layer and Host actions. */
export class FolderRuntime implements IFolders {
  /** UI-facing immutable projection; the manager remains wire truth. */
  readonly list: SnapshotStore<FolderListState>
  /** Folder baseline and frame owner. */
  private readonly manager: FolderManager

  /**
   * @param ctx - client root context.
   * @param api - shared wire client.
   */
  constructor(ctx: Context, api: IApiClient) {
    this.manager = new FolderManager(api)
    this.list = createSnapshotStore<FolderListState>({
      items: [], state: 'idle', phase: 'pending', error: null,
    })
    this.manager.subscribe(() => { this.project() })
    ctx.reflect.provide('folders', this, undefined)
  }

  /**
   * Create a folder.
   * @param title - display title; trimmed non-empty, duplicates allowed.
   * @returns the created durable folder.
   */
  async create(title: string): Promise<FolderView> {
    const result = await this.manager.create(title)
    if (!result.ok) throw new Error(`folder create failed: ${result.error.code}: ${result.error.message}`)
    return result.value.folder
  }

  /**
   * Rename a folder.
   * @param folderId - target folder.
   * @param title - new display title.
   * @returns the renamed folder view.
   */
  async rename(folderId: FolderId, title: string): Promise<FolderView> {
    const result = await this.manager.rename(folderId, title)
    if (!result.ok) throw new Error(`folder rename failed: ${result.error.code}: ${result.error.message}`)
    return result.value.folder
  }

  /**
   * Delete a folder registration. Its sessions return to their Workspace
   * grouping or the ungrouped bucket.
   * @param folderId - target folder.
   */
  async delete(folderId: FolderId): Promise<void> {
    const result = await this.manager.delete(folderId)
    if (!result.ok) throw new Error(`folder delete failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Move a folder within the durable display order.
   * @param folderId - Folder to move.
   * @param beforeFolderId - Anchor folder; omitted appends.
   */
  async insertBefore(folderId: FolderId, beforeFolderId?: FolderId): Promise<void> {
    const result = await this.manager.insertBefore(folderId, beforeFolderId)
    if (!result.ok) throw new Error(`folder reorder failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Add one session to a folder, prepending it to the folder's manual order.
   * @param folderId - target folder.
   * @param sessionId - session to add.
   * @returns the updated folder view.
   */
  async addSession(folderId: FolderId, sessionId: SessionId): Promise<FolderView> {
    const result = await this.manager.addSession(folderId, sessionId)
    if (!result.ok) throw new Error(`folder add session failed: ${result.error.code}: ${result.error.message}`)
    return result.value.folder
  }

  /**
   * Move a session within its folder's manual order.
   * @param folderId - owning folder.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the updated folder view.
   */
  async insertSessionBefore(
    folderId: FolderId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<FolderView> {
    const result = await this.manager.insertSessionBefore(folderId, sessionId, beforeSessionId)
    if (!result.ok) throw new Error(`folder move failed: ${result.error.code}: ${result.error.message}`)
    return result.value.folder
  }

  /**
   * Remove one session from a folder.
   * @param folderId - target folder.
   * @param sessionId - session to remove.
   * @returns the updated folder view.
   */
  async removeSession(folderId: FolderId, sessionId: SessionId): Promise<FolderView> {
    const result = await this.manager.removeSession(folderId, sessionId)
    if (!result.ok) throw new Error(`folder remove session failed: ${result.error.code}: ${result.error.message}`)
    return result.value.folder
  }

  /**
   * Refresh the folder baseline, reusing an in-flight pull.
   * @returns completion of the current or newly started folder baseline pull.
   */
  refresh(): Promise<void> {
    return this.manager.refresh()
  }

  /**
   * Route a Host stream envelope into the Folder object layer.
   * @param envelope - validated Host stream envelope.
   */
  handleHostEnvelope(envelope: Parameters<FolderManager['handleHostEnvelope']>[0]): void {
    this.manager.handleHostEnvelope(envelope)
  }

  /** Rebuild the Folder baseline after connection. */
  handleConnected(): void {
    this.manager.handleConnected()
  }

  private project(): void {
    const folder = this.manager.getSnapshot()
    this.list.set({
      items: folder.items,
      state: folder.state,
      phase: folder.phase,
      error: folder.error,
    })
  }
}