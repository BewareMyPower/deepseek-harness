/**
 * Package-private session-folder entity: the single {@link Folder}
 * implementation. Holds a record snapshot that is swapped after each durable
 * mutation; every write funnels through the registry-owned host `mutate`, so
 * ordering decisions and the one-folder-per-session check happen exactly once,
 * on the serialized write chain. Not re-exported from the package entrypoint —
 * consumers see only the `Folder` interface.
 * @module @deepseek-ai/dsh-session-folder/src/entity
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  FolderMoveInvalidError, FolderSessionConflictError, FolderUnknownError, FolderUnknownSessionError,
} from './error.ts'
import type { FolderDomainState, FolderRecord } from './spec.ts'
import type { Folder, FolderId } from './types.ts'

/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the serialized state mutation and the
 * session-known probe backing add-time validation.
 */
export interface FolderEntityHost {
  /**
   * Run one serialized state mutation and return the folder's updated record.
   * `fn` sees the state current at its chain slot, so membership and
   * one-folder-per-session decisions are race-free against queued writes.
   * @param id - The mutating folder's id.
   * @param fn - Pure transform from current to next state; may throw a
   * business error to abort without writing.
   * @returns the folder's record in the written state.
   */
  mutate(id: FolderId, fn: (state: FolderDomainState) => FolderDomainState): Promise<FolderRecord>

  /**
   * Whether a session is live, header-indexed, or present in session
   * persistence. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never masquerade
   * as an unknown session.
   * @param id - The session to probe.
   * @returns true when the session exists somewhere the host can see.
   */
  sessionKnown(id: SessionId): Promise<boolean>
}

/** ISO timestamp for one durable mutation; creation stamps once at create. */
const stamp = (): string => new Date().toISOString()

/** The single {@link Folder} implementation; constructed only by the registry. */
export class FolderEntity implements Folder {
  private record: FolderRecord

  /**
   * @param host - Registry-owned mutation and session-known machinery.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(
    private readonly host: FolderEntityHost,
    readonly id: FolderId,
    record: FolderRecord,
  ) {
    this.record = record
  }

  get title(): string {
    return this.record.title
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  get sessionIds(): readonly SessionId[] {
    return this.record.sessionIds
  }

  /**
   * Swap in a freshly written record snapshot. Registry-initiated mutations
   * (create/rename/delete/reorder) publish the entity's new state here so the
   * facade never serves a stale snapshot.
   * @param record - The record the registry just committed.
   */
  adopt(record: FolderRecord): void {
    this.record = record
  }

  async setTitle(title: string): Promise<void> {
    this.record = await this.host.mutate(this.id, state => ({
      ...state,
      folders: state.folders.map(record => record.folderId === this.id
        ? { ...record, title, updatedAt: stamp() }
        : record),
    }))
  }

  async addSession(sessionId: SessionId): Promise<void> {
    // Fast path: the settled snapshot already accounts the id — membership
    // itself is decided on the write chain inside `mutate`, never here.
    if (this.record.sessionIds.includes(sessionId)) return
    // The session-known probe is I/O and runs before the chain slot; the
    // one-folder-per-session check still re-runs on the chain so a concurrent
    // assignment cannot interleave between this probe and the write.
    if (!(await this.host.sessionKnown(sessionId))) {
      throw new FolderUnknownSessionError(sessionId)
    }
    this.record = await this.host.mutate(this.id, (state) => {
      const owner = state.folders.find(record => record.sessionIds.includes(sessionId))
      if (owner !== undefined && owner.folderId !== this.id) {
        throw new FolderSessionConflictError(sessionId, owner.folderId)
      }
      return {
        ...state,
        folders: state.folders.map(record => record.folderId === this.id
          ? { ...record, sessionIds: [sessionId, ...record.sessionIds], updatedAt: stamp() }
          : record),
      }
    })
  }

  async insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    this.record = await this.host.mutate(this.id, (state) => {
      const current = state.folders.find(record => record.folderId === this.id)
      if (current === undefined) throw new FolderUnknownError(this.id)
      if (!current.sessionIds.includes(sessionId)) {
        throw new FolderMoveInvalidError(
          `cannot move session '${sessionId}' in folder '${this.id}': the session is not accounted`,
        )
      }
      if (beforeSessionId !== undefined && !current.sessionIds.includes(beforeSessionId)) {
        throw new FolderMoveInvalidError(
          `cannot move session '${sessionId}' before '${beforeSessionId}' in folder '${this.id}': `
          + 'the anchor session is not accounted',
        )
      }
      if (beforeSessionId === sessionId) return state
      const without = current.sessionIds.filter(id => id !== sessionId)
      const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
      const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
      if (sessionIds.every((id, index) => id === current.sessionIds[index])) return state
      return {
        ...state,
        folders: state.folders.map(record => record.folderId === this.id
          ? { ...record, sessionIds, updatedAt: stamp() }
          : record),
      }
    })
  }

  async removeSession(sessionId: SessionId): Promise<void> {
    this.record = await this.host.mutate(this.id, (state) => {
      const current = state.folders.find(record => record.folderId === this.id)
      if (current === undefined) throw new FolderUnknownError(this.id)
      if (!current.sessionIds.includes(sessionId)) return state
      return {
        ...state,
        folders: state.folders.map(record => record.folderId === this.id
          ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId), updatedAt: stamp() }
          : record),
      }
    })
  }
}