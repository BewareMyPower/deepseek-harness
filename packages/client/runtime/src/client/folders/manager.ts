/** Folder list baseline, incremental-frame, and unary-action owner. */

import type {
  HostFrame, IApiClient, RpcError, RpcRequest, RpcResult, SessionId, FolderId, FolderPermission, FolderView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import { Notifier } from '../sessions/notifier.ts'

/** Monotone folder-list arrival lifecycle. */
export type FolderListPhase = 'pending' | 'ready'

/** Immutable folder-list snapshot. */
export interface FolderListSnapshot {
  items: readonly FolderView[]
  state: 'idle' | 'loading' | 'error'
  phase: FolderListPhase
  error: RpcError | null
}

/** Folder object cluster driven by one list baseline and changed-frame upserts. */
export class FolderManager {
  private items: FolderView[] = []
  private state: FolderListSnapshot['state'] = 'idle'
  private phase: FolderListPhase = 'pending'
  private error: RpcError | null = null
  private inflight: Promise<void> | null = null
  /**
   * Ids this process has seen removed, kept for the connection's lifetime so
   * a late changed frame or a stale baseline row cannot resurrect a deleted
   * folder. Host ids are never reused (a fresh randomUUID per record).
   */
  private readonly removedIds = new Set<FolderId>()
  private snapshotCache: FolderListSnapshot
  private readonly notifier = new Notifier(() => {
    this.snapshotCache = this.buildSnapshot()
  })

  /** @param api - shared wire client. */
  constructor(private readonly api: IApiClient) {
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Refresh from folder.list. The first successful response establishes Host
   * order; later responses re-establish the durable order so reconnects adopt
   * reorders committed while this client was offline.
   * @returns the shared in-flight refresh.
   */
  refresh(): Promise<void> {
    if (this.inflight !== null) return this.inflight
    this.state = 'loading'
    this.error = null
    this.notifier.markDirty()
    this.inflight = (async () => {
      try {
        const { result } = await this.api.folder.list({})
        if (result.ok) {
          const items = result.value.items.filter(folder => !this.removedIds.has(folder.folderId))
          this.items = items
          this.state = 'idle'
          this.phase = 'ready'
        } else {
          this.state = 'error'
          this.error = result.error
        }
      } catch (error) {
        this.state = 'error'
        const folded = transportError<never>(error)
        /* v8 ignore next -- transportError always returns the failure branch. */
        this.error = folded.ok ? null : folded.error
      } finally {
        this.inflight = null
        this.notifier.markDirty()
      }
    })()
    return this.inflight
  }

  /** Create a folder, then publish its returned snapshot without waiting for the changed frame. */
  async create(
    title: string,
    path: string,
    permission: FolderPermission,
  ): Promise<RpcResult<{ folder: FolderView }>> {
    const { result } = await this.api.folder.create({ title, path, permission })
    if (result.ok) this.upsert(result.value.folder)
    return result
  }

  /** Rename a folder, then publish its returned snapshot. */
  async rename(folderId: FolderId, title: string): Promise<RpcResult<{ folder: FolderView }>> {
    const { result } = await this.api.folder.rename({ folderId, title })
    if (result.ok) this.upsert(result.value.folder)
    return result
  }

  /** Delete a folder and remove its local projection without waiting for the Host frame. */
  async delete(folderId: FolderId): Promise<RpcResult<{ deleted: true }>> {
    const { result } = await this.api.folder.delete({ folderId })
    if (result.ok) this.remove(folderId, true)
    return result
  }

  /** Move a folder within the display order and install the full returned order. */
  async insertBefore(
    folderId: FolderId,
    beforeFolderId?: FolderId,
  ): Promise<RpcResult<{ folderIds: FolderId[] }>> {
    const { result } = await this.api.folder.insertBefore({
      folderId,
      ...beforeFolderId === undefined ? {} : { beforeFolderId },
    })
    if (result.ok) this.installOrder(result.value.folderIds)
    return result
  }

  /** Add a session, then publish the returned folder snapshot. */
  async addSession(folderId: FolderId, sessionId: SessionId): Promise<RpcResult<{ folder: FolderView }>> {
    const { result } = await this.api.folder.addSession({ folderId, sessionId })
    if (result.ok) this.upsert(result.value.folder)
    return result
  }

  /** Move a session within its folder's manual order, then publish the returned snapshot. */
  async insertSessionBefore(
    folderId: FolderId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<RpcResult<{ folder: FolderView }>> {
    const { result } = await this.api.folder.insertSessionBefore({
      folderId, sessionId,
      ...beforeSessionId === undefined ? {} : { beforeSessionId },
    })
    if (result.ok) this.upsert(result.value.folder)
    return result
  }

  /** Remove a session, then publish the returned folder snapshot. */
  async removeSession(folderId: FolderId, sessionId: SessionId): Promise<RpcResult<{ folder: FolderView }>> {
    const { result } = await this.api.folder.removeSession({ folderId, sessionId })
    if (result.ok) this.upsert(result.value.folder)
    return result
  }

  /**
   * Host-frame entry. Non-folder frames are ignored so the runtime can fan one
   * host stream out to both object managers.
   * @param envelope - host stream envelope.
   */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    if (envelope.payload.type === 'host/folder-changed') this.upsert(envelope.payload.folder)
    else if (envelope.payload.type === 'host/folder-removed') this.remove(envelope.payload.folderId)
    else if (envelope.payload.type === 'host/folder-order-changed') {
      this.installOrder(envelope.payload.folderIds)
    }
  }

  /** Re-pull the baseline after each connection generation. */
  handleConnected(): void {
    void this.refresh()
  }

  /**
   * Subscribe to folder snapshot invalidation.
   * @param listener - snapshot invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Read the cached folder snapshot after flushing pending notifications.
   * @returns the cached folder snapshot.
   */
  getSnapshot(): FolderListSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  private buildSnapshot(): FolderListSnapshot {
    return {
      items: [...this.items],
      state: this.state,
      phase: this.phase,
      error: this.error,
    }
  }

  private upsert(view: FolderView): void {
    if (this.removedIds.has(view.folderId)) return
    const index = this.items.findIndex(folder => folder.folderId === view.folderId)
    if (index === -1) {
      this.items = [view, ...this.items]
    } else {
      this.items = this.items.map((folder, position) => position === index ? view : folder)
    }
    this.notifier.markDirty()
  }

  private remove(folderId: FolderId, direct = false): void {
    this.removedIds.add(folderId)
    const items = this.items.filter(folder => folder.folderId !== folderId)
    if (items.length === this.items.length) {
      if (direct) this.notifier.notifyNow()
      return
    }
    this.items = items
    if (direct) this.notifier.notifyNow()
    else this.notifier.markDirty()
  }

  private installOrder(folderIds: readonly FolderId[]): void {
    const rank = new Map(folderIds.map((id, index) => [id, index]))
    const items = [...this.items].sort((left, right) =>
      (rank.get(left.folderId) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.folderId) ?? Number.MAX_SAFE_INTEGER))
    if (items.every((folder, index) => folder === this.items[index])) return
    this.items = items
    this.notifier.markDirty()
  }
}
