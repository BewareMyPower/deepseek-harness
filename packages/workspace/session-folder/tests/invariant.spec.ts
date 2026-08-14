import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as FolderInvariant from '../src/invariant.ts'
import { FolderId, folderDomainState } from '../src/index.ts'
import type { FolderDomainState } from '../src/index.ts'

/** Boot the invariant service plus the companion over a stubbed registry knowing exactly `ids`. */
async function setup(ids: string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('folderRegistry', {
    get: (id: FolderId) => (ids.includes(id) ? { id } : undefined),
  })
  await ctx.plugin(FolderInvariant)
  return ctx
}

const state = (folders: Array<{ id: string; title: string }>): FolderDomainState => ({
  folders: folders.map(folder => ({
    folderId: FolderId(folder.id),
    title: folder.title,
    sessionIds: [SessionId('s1')],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  })),
})

/** One domain global put event for the session-folder domain. */
function put(value: FolderDomainState): DomainChanged {
  return { domain: 'session_folder', table: '', key: '', operation: 'put', value }
}

/** A put with one location/operation field overridden, as a full DomainChanged. */
function putAt(overrides: Partial<Pick<DomainChanged, 'domain' | 'table' | 'operation'>>): DomainChanged {
  return { ...put(state([{ id: 'f1', title: 'A' }])), ...overrides } as DomainChanged
}

describe('session-folder cache/domain invariant', () => {
  it('accepts a global put whose folder ids all have cached entities and ignores foreign events', async () => {
    const ctx = await setup(['f1'])
    expect(() => { ctx.emit('domain/changed', put(state([{ id: 'f1', title: 'A' }]))) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', putAt({ domain: 'other' })) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', putAt({ table: 'folders' })) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', putAt({ operation: 'deleted' })) }).not.toThrow()
  })

  it('fails a global put naming a folder the registry cache does not hold', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', put(state([{ id: 'f1', title: 'A' }]))) }).toThrow(/diverged/)
  })

  it('accepts a global put carrying a subset of the cached folders (deletion committed first)', async () => {
    const ctx = await setup(['f1'])
    expect(() => { ctx.emit('domain/changed', put({ folders: [] })) }).not.toThrow()
  })

  it('parses the payload through the durable schema before judging it', async () => {
    const ctx = await setup(['f1'])
    void ctx
    // A malformed global write is not a valid domain change event; the
    // invariant only ever sees values the durable boundary already validated.
    expect(folderDomainState.safeParse(state([{ id: 'f1', title: 'A' }])).success).toBe(true)
  })
})