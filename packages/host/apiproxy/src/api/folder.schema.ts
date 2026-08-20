/**
 * folder domain zod schemas (names derived from map keys). The FolderId
 * brand cast lives here (mirroring workspaceIdSchema's cast point).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { FolderView } from './folder.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/**
 * FolderId wire schema. A non-empty string cast to the brand after
 * validation; the brand has no runtime representation.
 */
export const folderIdSchema = z.string().min(1).transform(value => value as FolderView['folderId'])

/** FolderPermission wire schema: one of read, write, both. */
export const folderPermissionSchema = z.enum(['read', 'write', 'both'])

/** FolderView row of every folder.* response. */
export const folderViewSchema = z.object({
  folderId: folderIdSchema,
  title: z.string(),
  path: z.string(),
  permission: folderPermissionSchema,
  sessionIds: z.array(sessionIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<FolderView>>

/** folder.list request payload (empty object literal). */
export const folderListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'folder.list'>>>

/** folder.list response value. */
export const folderListValueSchema = z.object({
  items: z.array(folderViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'folder.list'>>>

/** folder.create request payload: the new display title, directory root, and access level. */
export const folderCreateRequestSchema = z.object({
  title: z.string(),
  path: z.string(),
  permission: folderPermissionSchema,
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'folder.create requires a non-blank title' },
).refine(
  payload => payload.path.startsWith('/'),
  { message: 'folder.create requires an absolute path' },
) satisfies z.ZodType<Wire<RequestPayload<'folder.create'>>>

/** folder.create response value. */
export const folderCreateValueSchema = z.object({
  folder: folderViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'folder.create'>>>

/** folder.rename request payload: the new title must be non-blank. */
export const folderRenameRequestSchema = z.object({
  folderId: folderIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'folder.rename requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'folder.rename'>>>

/** folder.rename response value. */
export const folderRenameValueSchema = z.object({
  folder: folderViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'folder.rename'>>>

/** folder.delete request payload. */
export const folderDeleteRequestSchema = z.object({
  folderId: folderIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'folder.delete'>>>

/** folder.delete response value. */
export const folderDeleteValueSchema = z.object({
  deleted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'folder.delete'>>>

/** folder.insertBefore request payload (anchor omitted = append to end). */
export const folderInsertBeforeRequestSchema = z.object({
  folderId: folderIdSchema,
  beforeFolderId: folderIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'folder.insertBefore'>>>

/** folder.insertBefore response value: the complete durable display order. */
export const folderInsertBeforeValueSchema = z.object({
  folderIds: z.array(folderIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'folder.insertBefore'>>>

/** folder.addSession request payload. */
export const folderAddSessionRequestSchema = z.object({
  folderId: folderIdSchema,
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'folder.addSession'>>>

/** folder.addSession response value. */
export const folderAddSessionValueSchema = z.object({
  folder: folderViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'folder.addSession'>>>

/** folder.insertSessionBefore request payload (anchor omitted = append to end). */
export const folderInsertSessionBeforeRequestSchema = z.object({
  folderId: folderIdSchema,
  sessionId: sessionIdSchema,
  beforeSessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'folder.insertSessionBefore'>>>

/** folder.insertSessionBefore response value. */
export const folderInsertSessionBeforeValueSchema = z.object({
  folder: folderViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'folder.insertSessionBefore'>>>

/** folder.removeSession request payload. */
export const folderRemoveSessionRequestSchema = z.object({
  folderId: folderIdSchema,
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'folder.removeSession'>>>

/** folder.removeSession response value. */
export const folderRemoveSessionValueSchema = z.object({
  folder: folderViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'folder.removeSession'>>>
