/**
 * The session-folder domain declaration: the record schema and the
 * `defineDomain` spec the registry opens. The whole registry is one global
 * value — the ordered folder array — so every mutation is a single durable
 * write with no two-write hazard and no pending-mutation recovery.
 * @module @deepseek-ai/dsh-session-folder/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { FolderId } from './types.ts'

/** Folder id schema at the durable boundary; branding has no runtime representation. */
const folderId = z.string().transform(value => value as FolderId)

/**
 * Durable shape of one folder record. `title` is the user display title;
 * `sessionIds` is the ordered account (array order is display order);
 * timestamps are ISO-8601 strings. Sessions account to at most one folder,
 * enforced by the registry on every mutation, so the array needs no owner.
 */
export const folderRecord = z.object({
  folderId,
  title: z.string(),
  sessionIds: z.array(z.string().transform(SessionId)),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored folder record, inferred from {@link folderRecord}. */
export type FolderRecord = z.infer<typeof folderRecord>

/**
 * Durable registry state: the folders in display order. Array position is the
 * authoritative order; the global is written whole on every mutation, so
 * record and order can never diverge on the medium.
 */
export const folderDomainState = z.object({
  folders: z.array(folderRecord),
})

/** Durable registry state inferred from {@link folderDomainState}. */
export type FolderDomainState = z.infer<typeof folderDomainState>

/**
 * The session-folder domain spec: a single global holding the ordered folder
 * array, no tables. The registry opens this through `ctx.storage.domain`; the
 * spec object is the single source of the domain's identity, version, and
 * schema.
 */
export const folderDomainSpec = defineDomain({
  name: 'session_folder',
  version: 1,
  global: {
    schema: folderDomainState,
    initial: { folders: [] },
  },
  tables: {},
})