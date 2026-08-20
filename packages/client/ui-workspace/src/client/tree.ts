/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Unassigned Sessions trail under Ungrouped; only the selected blank Session
 * remains visible.
 */
import {
  indexSubagentDescendants, type PendingInteractionStatus, type SessionId, type SessionListState,
  type SessionSearchResultItem, type SessionSummary, type SubagentDescendantSummary,
  type WorkspaceId, type WorkspaceView, type FolderId, type FolderPermission, type FolderView,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/** Display label for the ungrouped bucket row. */
export const UNGROUPED_LABEL = 'Ungrouped'

/** One top-level session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  updatedAt: number
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id, folder id, or {@link UNGROUPED_KEY}. */
  key: string
  /** Grouping kind: a user folder, a real Workspace, or the ungrouped bucket. */
  kind: 'folder' | 'workspace' | 'ungrouped'
  /** Backing Workspace id; present only for real Workspace groups. */
  workspaceId: WorkspaceId | undefined
  /** Backing Folder id; present only for folder groups. */
  folderId: FolderId | undefined
  cwd: string | undefined
  /** Directory root a folder grants access to; present only for folder groups. */
  folderPath: string | undefined
  /** Access level a folder grants at its root; present only for folder groups. */
  folderPermission: FolderPermission | undefined
  /** Workspace/folder creation time (epoch ms); absent only for the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
}

interface Group {
  key: string
  kind: 'folder' | 'workspace' | 'ungrouped'
  workspaceId: WorkspaceId | undefined
  folderId: FolderId | undefined
  cwd: string | undefined
  /** Directory root a folder grants access to; present only for folder groups. */
  folderPath: string | undefined
  /** Access level a folder grants at its root; present only for folder groups. */
  folderPermission: FolderPermission | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or the ungrouped label.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return UNGROUPED_LABEL
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Ordinary sessions are visible; among blank sessions, only the current one
 * is visible. Subagent children use their parent header catalog; archived
 * sessions are visible nowhere, while their accounting slots remain so
 * unarchiving restores position.
 */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? 'New Session' : session.displayTitle
}

/** Build one group without projecting session lineage into presentation. */
function buildGroup(
  key: string,
  kind: 'folder' | 'workspace' | 'ungrouped',
  workspaceId: WorkspaceId | undefined,
  folderId: FolderId | undefined,
  cwd: string | undefined,
  folderPath: string | undefined,
  folderPermission: FolderPermission | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
  order: 'account' | 'recency',
): Group {
  const sessions = [...members]
  // Real Workspace/folder order comes from sessionIds. Ungrouped falls back
  // to recency until the browser supplies its persisted local order.
  if (order === 'recency') sessions.sort(byRecency)
  return { key, kind, workspaceId, folderId, cwd, folderPath, folderPermission, createdAt, label, sessions }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(members: readonly SessionSummary[], stored: readonly string[]): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const included = new Set<string>()
  const ordered: SessionSummary[] = []
  for (const key of stored) {
    const session = byId.get(key)
    if (session === undefined || included.has(key)) continue
    ordered.push(session)
    included.add(key)
  }
  for (const session of [...members].sort(byRecency)) {
    if (included.has(session.id)) continue
    ordered.push(session)
  }
  return ordered
}

/**
 * Group Sessions by Host Workspace, then the ungrouped bucket. Folder grouping
 * lives in {@link groupByFoldersAndWorkspaces}; this folders-free path backs
 * {@link deriveGroups} for callers (and tests) that group by Workspace alone.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  ungroupedOrder: readonly string[] | undefined,
): Group[] {
  const groups: Group[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    groups.push(buildGroup(
      workspace.workspaceId, 'workspace', workspace.workspaceId, undefined, workspace.path,
      undefined, undefined,
      Date.parse(workspace.createdAt), workspace.title, members, 'account',
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    groups.push(buildGroup(
      UNGROUPED_KEY, 'ungrouped', undefined, undefined, undefined, undefined, undefined, undefined,
      UNGROUPED_LABEL,
      ungroupedOrder === undefined ? stray : orderedUngrouped(stray, ungroupedOrder),
      ungroupedOrder === undefined ? 'recency' : 'account',
    ))
  }
  return groups
}

/**
 * Group Sessions by Folder first, then by Host Workspace, then the ungrouped
 * bucket. Multi-membership is the model: a session in a folder also remains
 * under its Workspace group, so folder membership is an additional access
 * grouping, not a replacement of the session's Workspace placement. Folder
 * groups lead in durable registry order, followed by Workspace groups (also
 * registry order), then the browser-local Ungrouped bucket.
 */
export function groupByFoldersAndWorkspaces(
  list: SessionListState,
  folders: readonly FolderView[],
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  view: TreeView,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const raw: Group[] = []
  const inFolder = new Set<SessionId>()
  for (const folder of folders) {
    const members: SessionSummary[] = []
    for (const id of folder.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      inFolder.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    raw.push(buildGroup(
      folder.folderId, 'folder', undefined, folder.folderId, undefined,
      folder.path, folder.permission,
      Date.parse(folder.createdAt), folder.title, members, 'account',
    ))
  }
  const accounted = new Set<SessionId>(inFolder)
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    raw.push(buildGroup(
      workspace.workspaceId, 'workspace', workspace.workspaceId, undefined, workspace.path,
      undefined, undefined,
      Date.parse(workspace.createdAt), workspace.title, members, 'account',
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    raw.push(buildGroup(
      UNGROUPED_KEY, 'ungrouped', undefined, undefined, undefined, undefined, undefined, undefined,
      UNGROUPED_LABEL,
      view.ungroupedOrder === undefined ? stray : orderedUngrouped(stray, view.ungroupedOrder),
      view.ungroupedOrder === undefined ? 'recency' : 'account',
    ))
  }
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const current = list.current
  const currentGroup = current === undefined
    ? undefined
    : (folders.find(folder => folder.sessionIds.includes(current))?.folderId)
      ?? (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId)
        ?? UNGROUPED_KEY
  return raw.map(g => ({
    key: g.key,
    kind: g.kind,
    workspaceId: g.workspaceId,
    folderId: g.folderId,
    cwd: g.cwd,
    folderPath: g.folderPath,
    folderPermission: g.folderPermission,
    createdAt: g.createdAt,
    label: g.label,
    sessionCount: g.sessions.length,
    expanded: expandedGroups.has(g.key),
    containsCurrent: g.key === currentGroup,
    sessions: expandedGroups.has(g.key) ? g.sessions.map(session => sessionNode(session, descendants)) : [],
  }))
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
): SessionNode {
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: s.running,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    completed: s.completed === true,
    updatedAt: s.updatedAt,
    ...(s.pendingInteraction === undefined ? {} : { pendingInteraction: s.pendingInteraction }),
  }
}

/**
 * Derive the workspace browser groups with every session as a top-level row.
 *
 * Every session falls under its Workspace group (registry order) or the
 * trailing ungrouped bucket. Every group shows; sessions populate under
 * expanded groups in the selected local order. Blank sessions are excluded
 * except for the selected provisional New Session row; archived sessions are
 * excluded everywhere. Folder grouping lives in {@link groupByFoldersAndWorkspaces};
 * this folders-free path backs callers (and tests) that group by Workspace alone.
 * Content search lives outside this derivation (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param view - local expansion arrays.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  view: TreeView,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const current = list.current
  const currentGroup = current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId)
      ?? UNGROUPED_KEY
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      kind: g.kind,
      workspaceId: g.workspaceId,
      folderId: g.folderId,
      cwd: g.cwd,
      folderPath: g.folderPath,
      folderPermission: g.folderPermission,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded ? g.sessions.map(session => sessionNode(session, descendants)) : [],
    })
  }
  return groups
}

/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @returns flat rows in render order.
 */
export function deriveFlat(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const rows: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || !sessionVisible(s, list.current, archived)) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants))
}

/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  n: number
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members never match).
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
  }

  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      return {
        id: summary.id,
        title: sessionTitle(summary),
        workspace: labelOf(summary),
        running: summary.running,
        runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
        ...(summary.pendingInteraction === undefined
          ? {}
          : { pendingInteraction: summary.pendingInteraction }),
        completed: summary.completed === true,
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/**
 * Compact relative time for session rows, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param updatedAt - epoch ms of the session's last activity.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the row's trailing time bucket and magnitude.
 */
export function relativeTime(updatedAt: number, now: number): RelativeTime {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}
