/**
 * Session folder registry (`ctx.folderRegistry`): durable user-controlled
 * topic folders with ordered session accounts, orthogonal to Workspace
 * membership. The whole registry is one global value written whole on every
 * mutation, so record and order cannot diverge and no pending-mutation
 * recovery is needed.
 * @module @deepseek-ai/dsh-session-folder
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { FolderEntity } from './entity.ts'
import type { FolderEntityHost } from './entity.ts'
import { FolderUnknownError } from './error.ts'
import { folderDomainSpec } from './spec.ts'
import type { FolderDomainState, FolderRecord } from './spec.ts'
import type { Folder, FolderId as FolderIdBrand, FolderPermission } from './types.ts'

export type { Folder } from './types.ts'
export {
  FolderMoveInvalidError, FolderUnknownError, FolderUnknownSessionError,
} from './error.ts'
export { folderDomainSpec, folderDomainState, folderRecord } from './spec.ts'
export type { FolderDomainState, FolderRecord } from './spec.ts'

/** Identifies one folder record (see `src/types.ts` for the brand rationale). */
export type FolderId = FolderIdBrand

/**
 * Brand a string as a {@link FolderId}.
 * @param id - Raw folder id string.
 * @returns the same string, branded at compile time.
 */
export function FolderId(id: string): FolderId {
  return id as FolderId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    folderRegistry: FolderRegistry
  }
}

/**
 * Durable session-folder registry. Startup opens the domain, validates the
 * stored state, and rebuilds the entity cache before the service becomes
 * active. The persistence dependency is mandatory so an unavailable peer can
 * never be mistaken for an empty history when validating a session on add.
 */
export class FolderRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  private global?: DomainGlobal<FolderDomainState>
  private state?: FolderDomainState
  private readonly entities = new Map<FolderId, FolderEntity>()
  private readonly sessionHeaders = new Map<SessionId, SessionHeader>()
  private operationTail: Promise<void> = Promise.resolve()

  private readonly host: FolderEntityHost = {
    mutate: (id, fn) => this.mutateFolder(id, fn),
    sessionKnown: id => this.sessionKnown(id),
  }

  constructor(ctx: Context) {
    super(ctx, 'folderRegistry')
  }

  /** Open the domain, validate stored state, and rebuild the ordered cache. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(folderDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'session-folder.domainClose')
    this.global = domain.global
    this.state = domain.global.get()
    this.validateState(this.state)
    this.rebuildEntities()
  }

  /**
   * Create a folder and prepend it to the durable display order.
   * @param title - Display title; trimmed and required non-empty.
   * @param path - Canonical directory root the folder grants access to; must be
   *   absolute. Access covers the whole subtree beneath it.
   * @param permission - Access level granted at `path`.
   * @returns the created durable folder.
   */
  async create(title: string, path: string, permission: FolderPermission = 'both'): Promise<Folder> {
    const trimmed = title.trim()
    if (trimmed === '') {
      throw new Error('cannot create a session folder with a blank title')
    }
    if (!isAbsolute(path)) {
      throw new Error(`cannot create a session folder at a relative path: '${path}'`)
    }
    const root = resolve(path)
    return await this.enqueueOperation(async () => {
      const state = this.requireState()
      const id = FolderId(randomUUID())
      const now = new Date().toISOString()
      const record: FolderRecord = {
        folderId: id,
        title: trimmed,
        path: root,
        permission,
        sessionIds: [],
        createdAt: now,
        updatedAt: now,
      }
      const entity = new FolderEntity(this.host, id, record)
      const next: FolderDomainState = { folders: [record, ...state.folders] }
      this.validateState(next)
      this.entities.set(id, entity)
      try {
        await this.setState(next)
      } catch (error) {
        this.entities.delete(id)
        throw error
      }
      return entity
    })
  }

  /**
   * Directory roots (path + access level) granted to a session through its
   * folder memberships. Used to scope the session's filesystem sandbox. A
   * session may appear in several folders, so the returned list may hold more
   * than one root.
   * @param sessionId - The session to resolve folders for.
   * @returns the accessible roots granted by folder membership.
   */
  foldersOfSession(sessionId: SessionId): { path: string; permission: FolderPermission }[] {
    const state = this.requireState()
    return state.folders
      .filter(record => record.sessionIds.includes(sessionId))
      .map(record => ({ path: record.path, permission: record.permission }))
  }

  /**
   * Look up a folder by id.
   * @param id - Folder id.
   * @returns the folder, or `undefined` when unknown.
   */
  get(id: FolderId): Folder | undefined {
    return this.entities.get(id)
  }

  /**
   * Synchronous folder projection in durable display order.
   * @returns a fresh ordered array of folder entities.
   */
  list(): Folder[] {
    return this.requireState().folders.map((record) => {
      const entity = this.entities.get(record.folderId)
      if (entity === undefined) {
        throw new Error(`folder registry order references missing folder '${record.folderId}'`)
      }
      return entity
    })
  }

  /**
   * Rename a folder durably.
   * @param id - Folder to rename.
   * @param title - New display title; trimmed and required non-empty.
   * @returns resolution after durability.
   */
  async rename(id: FolderId, title: string): Promise<void> {
    const trimmed = title.trim()
    if (trimmed === '') {
      throw new Error('cannot rename a session folder to a blank title')
    }
    await this.enqueueOperation(async () => {
      const state = this.requireState()
      const current = state.folders.find(record => record.folderId === id)
      if (current === undefined) throw new FolderUnknownError(id)
      if (current.title === trimmed) return
      const next: FolderDomainState = {
        folders: state.folders.map(record => record.folderId === id
          ? { ...record, title: trimmed, updatedAt: new Date().toISOString() }
          : record),
      }
      this.validateState(next)
      await this.setState(next)
      const record = next.folders.find(candidate => candidate.folderId === id)
      if (record !== undefined) this.entities.get(id)?.adopt(record)
    })
  }

  /**
   * Delete one folder registration. Its sessions are not touched — each one
   * simply returns to its Workspace grouping or the ungrouped bucket.
   * @param id - Folder registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: FolderId): Promise<boolean> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.folders.some(record => record.folderId === id)) return false
      const next: FolderDomainState = {
        folders: state.folders.filter(record => record.folderId !== id),
      }
      this.validateState(next)
      this.entities.delete(id)
      try {
        await this.setState(next)
      } catch (error) {
        const record = state.folders.find(candidate => candidate.folderId === id)
        if (record !== undefined) this.entities.set(id, new FolderEntity(this.host, id, record))
        throw error
      }
      return true
    })
  }

  /**
   * Move one folder within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that folder; without one it appends.
   * @param id - Folder to move.
   * @param beforeId - Folder anchor; omitted appends.
   * @returns the complete committed folder order.
   */
  insertBefore(id: FolderId, beforeId?: FolderId): Promise<readonly FolderId[]> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      const ids = state.folders.map(record => record.folderId)
      if (!ids.includes(id)) throw new FolderUnknownError(id)
      if (beforeId !== undefined && !ids.includes(beforeId)) throw new FolderUnknownError(beforeId)
      if (beforeId === id) return ids
      const without = ids.filter(folderId => folderId !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      const ordered = [...without.slice(0, at), id, ...without.slice(at)]
      if (ordered.every((folderId, index) => folderId === ids[index])) return ids
      const byId = new Map(state.folders.map(record => [record.folderId, record]))
      const next: FolderDomainState = {
        folders: ordered.flatMap((folderId) => {
          const record = byId.get(folderId)
          return record === undefined ? [] : [record]
        }),
      }
      this.validateState(next)
      await this.setState(next)
      return ordered
    })
  }

  /**
   * Validate the complete stored state: unique folder ids and no session
   * duplicated within a single folder's account. Multi-membership is allowed,
   * so a session may appear in several folders — only intra-folder repeats are
   * rejected. Violations fail loud; they can only come from a write path that
   * bypassed this registry.
   */
  private validateState(state: FolderDomainState): void {
    const ids = new Set<FolderId>()
    for (const record of state.folders) {
      if (ids.has(record.folderId)) {
        throw new Error(`session-folder domain is inconsistent: folder order repeats folder '${record.folderId}'`)
      }
      ids.add(record.folderId)
      const inFolder = new Set<SessionId>()
      for (const sessionId of record.sessionIds) {
        if (inFolder.has(sessionId)) {
          throw new Error(
            `session-folder domain is inconsistent: folder '${record.folderId}' accounts session '${sessionId}' twice`,
          )
        }
        inFolder.add(sessionId)
      }
    }
  }

  private rebuildEntities(): void {
    this.entities.clear()
    for (const record of this.requireState().folders) {
      this.entities.set(record.folderId, new FolderEntity(this.host, record.folderId, record))
    }
  }

  /** Run one serialized folder mutation and return the folder's written record. */
  private async mutateFolder(
    id: FolderId,
    fn: (state: FolderDomainState) => FolderDomainState,
  ): Promise<FolderRecord> {
    return await this.enqueueOperation(async () => {
      const state = this.requireState()
      const index = state.folders.findIndex(record => record.folderId === id)
      if (index === -1) throw new FolderUnknownError(id)
      const next = fn(state)
      this.validateState(next)
      await this.setState(next)
      const record = next.folders.find(candidate => candidate.folderId === id)
      if (record === undefined) {
        throw new Error(`folder mutation removed folder '${id}' from the registry state`)
      }
      return record
    })
  }

  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never masquerade
   * as an unknown session.
   */
  private async sessionKnown(id: SessionId): Promise<boolean> {
    if (this.ctx.get('sessions')?.get(id) !== undefined) return true
    if (this.sessionHeaders.has(id)) return true
    this.indexHeaders(await this.ctx.sessionPersistence.list())
    return this.sessionHeaders.has(id)
  }

  private indexHeaders(headers: readonly SessionHeader[]): void {
    for (const header of headers) this.sessionHeaders.set(header.id, header)
  }

  private requireState(): FolderDomainState {
    if (this.state === undefined) throw new Error('folder registry is not started yet')
    return this.state
  }

  private async setState(state: FolderDomainState): Promise<void> {
    await (this.global as DomainGlobal<FolderDomainState>).set(state)
    this.state = state
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

export default FolderRegistry
