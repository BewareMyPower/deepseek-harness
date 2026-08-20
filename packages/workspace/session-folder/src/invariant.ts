/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-folder`.
 * @module @deepseek-ai/dsh-session-folder/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { FolderId, folderDomainState } from '@deepseek-ai/dsh-session-folder'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-folder'

/** Cordis companion plugin name. */
export const name = 'session-folder-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relationship: the registry's entity cache mirrors the session-folder
 * domain's durable global. Every `domain/changed` for the `session-folder`
 * global must name only folder ids the cache already holds an entity for (the
 * registry caches before the durable write and removes on delete, whether for
 * create rollback or an explicit folder deletion); a written id with no cached
 * entity proves a write that bypassed `ctx.folderRegistry`.
 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'session_folder' || change.table !== '') return
      if (change.operation !== 'put') return
      const state = folderDomainState.parse(change.value)
      for (const record of state.folders) {
        if (ctx.folderRegistry.get(FolderId(record.folderId)) === undefined) {
          fail(
            `session-folder global write named folder '${record.folderId}' but the registry cache `
            + 'holds no entity for it — the cache and the domain have diverged',
          )
        }
      }
    })
  },
  { inject: ['folderRegistry'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
