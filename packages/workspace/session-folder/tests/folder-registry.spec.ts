import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import type { StorageBackend } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FolderRegistry, {
  FolderId,
  FolderMoveInvalidError,
  FolderUnknownError,
  FolderUnknownSessionError,
} from '../src/index.ts'
import type { FolderDomainState } from '../src/index.ts'
import type { FolderPermission } from '../src/types.ts'

const header = (id: string): SessionHeader => ({
  version: 0,
  id: SessionId(id),
  createdAt: 0,
})

interface HarnessOptions {
  pool?: MemoryMediaPool
  sessions?: SessionHeader[]
  liveSessions?: SessionHeader[]
  backend?: StorageBackend
}

/** Boot the real storage/domain/registry composition over controllable header-only peers. */
async function harness(options: HarnessOptions = {}) {
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', options.backend ?? new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)

  let listed = options.sessions ?? []
  const list = vi.fn(async () => listed)
  const load = vi.fn(() => { throw new Error('event bodies must not be loaded') })
  const inspect = vi.fn(() => { throw new Error('event bodies must not be inspected') })
  ctx.provide('sessionPersistence', { list, load, inspect } as never)

  if (options.liveSessions !== undefined) {
    const live = new Map(options.liveSessions.map(meta => [meta.id, { header: meta }]))
    ctx.provide('sessions', {
      get: (id: SessionId) => live.get(id),
      list: () => [...live.values()],
    } as never)
  }

  const changes: DomainChanged[] = []
  ctx.on('domain/changed', (change) => { changes.push(change) })
  const fiber = await ctx.plugin(FolderRegistry)
  changes.length = 0
  return {
    ctx,
    fiber,
    pool,
    registry: ctx.folderRegistry,
    changes,
    list,
    setSessions: (headers: SessionHeader[]) => { listed = headers },
  }
}

function record(
  id: string,
  title: string,
  sessionIds: string[],
  path = '/repo',
  permission: FolderPermission = 'both',
  createdAt = '2026-08-20T00:00:00.000Z',
) {
  return {
    folderId: FolderId(id),
    title,
    path,
    permission,
    sessionIds: sessionIds.map(SessionId),
    createdAt,
    updatedAt: createdAt,
  }
}

/** Seed the domain global before the registry opens (stored-state validation cases). */
function seedState(pool: MemoryMediaPool, state: FolderDomainState): void {
  const medium = pool.media.get('session_folder') ?? {
    tables: new Map(),
    global: null,
  }
  medium.global = state
  pool.media.set('session_folder', medium)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FolderRegistry', () => {
  it('creates a folder with a directory root and access level, trims its title, and prepends it', async () => {
    const h = await harness()
    const a = await h.registry.create('  Alpha  ', '/repo/a', 'read')
    const b = await h.registry.create('Beta', '/repo/b', 'both')
    expect(a.title).toBe('Alpha')
    expect(a.path).toBe('/repo/a')
    expect(a.permission).toBe('read')
    expect(b.path).toBe('/repo/b')
    expect(b.permission).toBe('both')
    expect(h.registry.list().map(folder => folder.id)).toEqual([b.id, a.id])
    expect(h.registry.get(a.id)?.sessionIds).toEqual([])
    await h.fiber.dispose()
  })

  it('rejects a blank title, a relative path, and a blank rename', async () => {
    const h = await harness()
    const folder = await h.registry.create('Alpha', '/repo/a', 'both')
    await expect(h.registry.create('   ', '/repo/a', 'both')).rejects.toThrow('blank title')
    await expect(h.registry.create('Alpha', 'relative/path', 'both')).rejects.toThrow('relative path')
    await expect(h.registry.rename(folder.id, '  ')).rejects.toThrow('blank title')
    await h.fiber.dispose()
  })

  it('renames a folder, no-ops on the same title, and rejects unknown ids', async () => {
    const h = await harness()
    const folder = await h.registry.create('Alpha', '/repo/a', 'both')
    await h.registry.rename(folder.id, 'Beta')
    expect(h.registry.get(folder.id)?.title).toBe('Beta')
    const stamp = h.registry.get(folder.id)?.updatedAt
    await h.registry.rename(folder.id, 'Beta')
    expect(h.registry.get(folder.id)?.updatedAt).toBe(stamp)
    await expect(h.registry.rename(FolderId('missing'), 'Gamma')).rejects.toBeInstanceOf(FolderUnknownError)
    await h.fiber.dispose()
  })

  it('deletes a folder, keeps its sessions, and reports unknown deletes', async () => {
    const h = await harness({ sessions: [header('s1'), header('s2')] })
    const folder = await h.registry.create('Alpha', '/repo/a', 'both')
    await folder.addSession(SessionId('s1'))
    await folder.addSession(SessionId('s2'))
    expect(await h.registry.delete(folder.id)).toBe(true)
    expect(h.registry.get(folder.id)).toBeUndefined()
    expect(h.registry.list()).toEqual([])
    expect(await h.registry.delete(folder.id)).toBe(false)
    await h.fiber.dispose()
  })

  it('reorders folders DOM-insertBefore-like with an omitted anchor appending', async () => {
    const h = await harness()
    const a = await h.registry.create('A', '/repo/a', 'both')
    const b = await h.registry.create('B', '/repo/b', 'both')
    const c = await h.registry.create('C', '/repo/c', 'both')
    const order = await h.registry.insertBefore(c.id, a.id)
    expect(order).toEqual([b.id, c.id, a.id])
    expect(h.registry.list().map(folder => folder.id)).toEqual([b.id, c.id, a.id])
    const appended = await h.registry.insertBefore(a.id)
    expect(appended).toEqual([b.id, c.id, a.id])
    await expect(h.registry.insertBefore(FolderId('missing'))).rejects.toBeInstanceOf(FolderUnknownError)
    await expect(h.registry.insertBefore(a.id, FolderId('missing'))).rejects.toBeInstanceOf(FolderUnknownError)
    await h.fiber.dispose()
  })

  it('adds sessions by prepend, validates existence, and allows multi-membership', async () => {
    const h = await harness({ sessions: [header('s1'), header('s2')] })
    const a = await h.registry.create('A', '/repo/a', 'both')
    const b = await h.registry.create('B', '/repo/b', 'read')
    await a.addSession(SessionId('s1'))
    await a.addSession(SessionId('s2'))
    expect(a.sessionIds).toEqual([SessionId('s2'), SessionId('s1')])
    await a.addSession(SessionId('s1'))
    expect(a.sessionIds).toEqual([SessionId('s2'), SessionId('s1')])
    await b.addSession(SessionId('s1'))
    expect(b.sessionIds).toEqual([SessionId('s1')])
    await expect(a.addSession(SessionId('unknown'))).rejects.toBeInstanceOf(FolderUnknownSessionError)
    await h.fiber.dispose()
  })

  it('accepts a live session as known even when persistence does not list it', async () => {
    const h = await harness({ liveSessions: [header('live')] })
    const folder = await h.registry.create('A', '/repo/a', 'both')
    await folder.addSession(SessionId('live'))
    expect(folder.sessionIds).toEqual([SessionId('live')])
    await h.fiber.dispose()
  })

  it('reorders sessions within a folder and rejects unaccounted ids', async () => {
    const h = await harness({ sessions: [header('s1'), header('s2'), header('s3')] })
    const folder = await h.registry.create('A', '/repo/a', 'both')
    await folder.addSession(SessionId('s1'))
    await folder.addSession(SessionId('s2'))
    await folder.addSession(SessionId('s3'))
    await folder.insertSessionBefore(SessionId('s1'), SessionId('s3'))
    expect(folder.sessionIds).toEqual([SessionId('s1'), SessionId('s3'), SessionId('s2')])
    await expect(folder.insertSessionBefore(SessionId('missing'))).rejects.toBeInstanceOf(FolderMoveInvalidError)
    await expect(folder.insertSessionBefore(SessionId('s1'), SessionId('missing')))
      .rejects.toBeInstanceOf(FolderMoveInvalidError)
    await h.fiber.dispose()
  })

  it('removes sessions idempotently without touching the log', async () => {
    const h = await harness({ sessions: [header('s1')] })
    const folder = await h.registry.create('A', '/repo/a', 'both')
    await folder.addSession(SessionId('s1'))
    await folder.removeSession(SessionId('s1'))
    expect(folder.sessionIds).toEqual([])
    await folder.removeSession(SessionId('s1'))
    expect(folder.sessionIds).toEqual([])
    await h.fiber.dispose()
  })

  it('round-trips folders and membership across a restart on the same medium', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({ pool, sessions: [header('s1')] })
    const folder = await first.registry.create('Persistent', '/repo/p', 'both')
    await folder.addSession(SessionId('s1'))
    await first.registry.insertBefore(folder.id)
    await first.fiber.dispose()

    const second = await harness({ pool })
    const listed = second.registry.list()
    expect(listed.map(folder => folder.title)).toEqual(['Persistent'])
    expect(listed[0]?.sessionIds).toEqual([SessionId('s1')])
    await second.fiber.dispose()
  })

  it('rejects a stored state that repeats a folder id or a within-folder session, and accepts cross-folder sharing', async () => {
    const pool = new MemoryMediaPool()
    seedState(pool, { folders: [record('a', 'A', []), record('a', 'A2', [])] })
    const duplicate = await harness({ pool }).then(() => null, (error: unknown) => error)
    expect(duplicate instanceof Error ? duplicate.message : '').toContain('repeats folder')
    const pool2 = new MemoryMediaPool()
    seedState(pool2, { folders: [record('a', 'A', ['s1', 's1'])] })
    const repeated = await harness({ pool: pool2 }).then(() => null, (error: unknown) => error)
    expect(repeated instanceof Error ? repeated.message : '').toContain('accounts session')
    const pool3 = new MemoryMediaPool()
    seedState(pool3, { folders: [record('a', 'A', ['s1']), record('b', 'B', ['s1'])] })
    const shared = await harness({ pool: pool3 })
    expect(shared.registry.list().map(folder => folder.sessionIds)).toEqual([[SessionId('s1')], [SessionId('s1')]])
    await shared.fiber.dispose()
  })

  it('rolls back the entity cache when a create write fails', async () => {
    const pool = new MemoryMediaPool()
    const h = await harness({ pool })
    pool.failNextWrites = 1
    await expect(h.registry.create('Doomed', '/repo/d', 'both')).rejects.toThrow('injected write failure')
    expect(h.registry.list()).toEqual([])
    await h.fiber.dispose()
  })

  it('serializes concurrent assignments so multi-membership writes do not corrupt state', async () => {
    const h = await harness({ sessions: [header('s1')] })
    const a = await h.registry.create('A', '/repo/a', 'both')
    const b = await h.registry.create('B', '/repo/b', 'read')
    const outcomes = await Promise.allSettled([
      a.addSession(SessionId('s1')),
      b.addSession(SessionId('s1')),
    ])
    expect(outcomes.every(result => result.status === 'fulfilled')).toBe(true)
    expect(a.sessionIds).toEqual([SessionId('s1')])
    expect(b.sessionIds).toEqual([SessionId('s1')])
    await h.fiber.dispose()
  })
})
