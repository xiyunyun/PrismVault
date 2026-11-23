import path from 'path'
import { getDb } from './index'
import type {
  AppSettings,
  Asset,
  AssetExtraMeta,
  AssetQueryFilter,
  AssetQueryResult,
  AssetStatus,
  ConvertSourceToGroupsResult,
  DuplicateGroup,
  GroupFlat,
  GroupNode,
  LibraryStats,
  SourceRoot
} from '@shared/types'
import type { MediaType } from '@shared/mediaTypes'
import { hexColorDistanceSq } from '../indexer/colorExtractor'

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '$RECYCLE.BIN',
  'System Volume Information',
  'Thumbs.db',
  '.DS_Store',
  'desktop.ini'
]

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  backdropStyle: 'aurora',
  backdropMotion: true,
  fontFamily: 'system',
  fontSize: 15,
  viewMode: 'waterfall',
  gridAspectRatio: '4:3',
  gridFitMode: 'cover',
  cardSize: 230,
  ffmpegPath: '',
  thumbCacheDir: '',
  clipboardDir: '',
  clipboardMaxFiles: 10,
  clipboardMaxSizeMB: 30,
  previewWheelMode: 'zoom',
  includeOtherFiles: false,
  autoScanOnStartup: false,
  closeToTray: true,
  autoLaunch: true,
  videoHoverPreview: true,
  quickSearchEnabled: false,
  quickSearchShortcut: 'Alt+Space',
  autoCheckUpdates: true,
  updateMirrorUrl: '',
  deleteThumbsOnRemoveSource: true,
  lastSeenVersion: ''
}

const naturalCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
})

// ===================== Settings =====================

export function getAllSettings(): AppSettings {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    try {
      merged[row.key] = JSON.parse(row.value)
    } catch {
      merged[row.key] = row.value
    }
  }
  return merged as unknown as AppSettings
}

export function shouldIncludeOtherFiles(): boolean {
  const db = getDb()
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'includeOtherFiles'`).get() as
    | { value: string }
    | undefined
  if (!row) return DEFAULT_SETTINGS.includeOtherFiles
  try {
    return Boolean(JSON.parse(row.value))
  } catch {
    return row.value === 'true'
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      stmt.run(k, JSON.stringify(v))
    }
  }
  return getAllSettings()
}

// ===================== Source Roots =====================

interface SourceRootRow {
  id: number
  path: string
  alias: string
  watch_enabled: number
  ignore_patterns: string
  last_scanned_at: number | null
  created_at: number
  asset_count?: number
}

function mapSourceRow(row: SourceRootRow): SourceRoot {
  let patterns = DEFAULT_IGNORE_PATTERNS
  try {
    const parsed = JSON.parse(row.ignore_patterns)
    if (Array.isArray(parsed)) patterns = parsed
  } catch {
    // keep default
  }
  return {
    id: Number(row.id),
    path: row.path,
    alias: row.alias,
    watchEnabled: Boolean(row.watch_enabled),
    ignorePatterns: patterns,
    lastScannedAt: row.last_scanned_at ? Number(row.last_scanned_at) : null,
    createdAt: Number(row.created_at),
    assetCount: Number(row.asset_count ?? 0)
  }
}

export function listSourceRoots(): SourceRoot[] {
  const db = getDb()
  const otherGuard = shouldIncludeOtherFiles() ? '' : ` AND a.media_type != 'other'`
  const rows = db
    .prepare(
      `SELECT sr.*,
        (SELECT COUNT(*) FROM assets a WHERE a.root_id = sr.id AND a.status = 'active'${otherGuard}) AS asset_count
       FROM source_roots sr
       ORDER BY sr.created_at ASC`
    )
    .all() as unknown as SourceRootRow[]
  return rows.map(mapSourceRow)
}

export function getSourceRootById(id: number): SourceRoot | null {
  const db = getDb()
  const otherGuard = shouldIncludeOtherFiles() ? '' : ` AND a.media_type != 'other'`
  const row = db
    .prepare(
      `SELECT sr.*,
        (SELECT COUNT(*) FROM assets a WHERE a.root_id = sr.id AND a.status = 'active'${otherGuard}) AS asset_count
       FROM source_roots sr WHERE sr.id = ?`
    )
    .get(id) as unknown as SourceRootRow | undefined
  return row ? mapSourceRow(row) : null
}

export function createSourceRoot(dirPath: string, alias: string): SourceRoot {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM source_roots WHERE path = ?').get(dirPath) as
    | { id: number }
    | undefined
  if (existing) {
    return getSourceRootById(Number(existing.id))!
  }
  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO source_roots (path, alias, watch_enabled, ignore_patterns, created_at)
       VALUES (?, ?, 0, ?, ?)`
    )
    .run(dirPath, alias, JSON.stringify(DEFAULT_IGNORE_PATTERNS), now)
  return getSourceRootById(Number(result.lastInsertRowid))!
}

export function updateSourceRoot(
  id: number,
  patch: { alias?: string; watchEnabled?: boolean; ignorePatterns?: string[]; lastScannedAt?: number }
): SourceRoot {
  const db = getDb()
  const current = getSourceRootById(id)
  if (!current) throw new Error(`Source root ${id} not found`)

  const alias = patch.alias !== undefined ? patch.alias : current.alias
  const watchEnabled = patch.watchEnabled !== undefined ? (patch.watchEnabled ? 1 : 0) : current.watchEnabled ? 1 : 0
  const ignorePatterns =
    patch.ignorePatterns !== undefined ? JSON.stringify(patch.ignorePatterns) : JSON.stringify(current.ignorePatterns)
  const lastScannedAt = patch.lastScannedAt !== undefined ? patch.lastScannedAt : current.lastScannedAt

  db.prepare(
    `UPDATE source_roots
     SET alias = ?, watch_enabled = ?, ignore_patterns = ?, last_scanned_at = ?
     WHERE id = ?`
  ).run(alias, watchEnabled, ignorePatterns, lastScannedAt, id)

  return getSourceRootById(id)!
}

export function getAssetThumbRefsByRootId(rootId: number): Array<{ id: number; thumbPath: string | null }> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, thumb_path FROM assets WHERE root_id = ?')
    .all(rootId) as Array<{ id: number; thumb_path: string | null }>
  return rows.map((r) => ({ id: Number(r.id), thumbPath: r.thumb_path }))
}

export function deleteSourceRoot(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM source_roots WHERE id = ?').run(id)
}

const AUTO_GROUP_PALETTE = [
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#f97316'
]

/**
 * Converts an indexed source directory's physical folder tree into an N-level custom group hierarchy:
 * Root folder name -> level-1 group; nested subfolders -> level-2..N subgroups;
 * all active assets under that source root are automatically assigned to their folder's group.
 * Idempotent: reuses existing groups with matching (parent_id, name).
 */
export function convertSourceRootToGroups(rootId: number): ConvertSourceToGroupsResult {
  const root = getSourceRootById(rootId)
  if (!root) {
    return {
      ok: false,
      rootGroupId: 0,
      rootGroupName: '',
      createdGroups: 0,
      reusedGroups: 0,
      assignedAssets: 0,
      error: '未找到对应的索引源目录。'
    }
  }

  const db = getDb()
  const resolvedRoot = path.resolve(root.path)
  const rawBase = path.basename(resolvedRoot)
  const rootGroupName = (rawBase && rawBase.trim() ? rawBase.trim() : root.alias.trim()) || '索引目录'

  const otherGuard = shouldIncludeOtherFiles() ? '' : ` AND media_type != 'other'`
  const assets = db
    .prepare(`SELECT id, file_path FROM assets WHERE root_id = ? AND status = 'active'${otherGuard}`)
    .all(rootId) as Array<{ id: number; file_path: string }>

  // Pre-load existing groups into an O(1) lookup map so repeated runs never create duplicates
  const existingGroups = db.prepare('SELECT id, parent_id, name FROM groups').all() as Array<{
    id: number
    parent_id: number | null
    name: string
  }>
  const groupKeyMap = new Map<string, number>()
  const makeKey = (parentId: number | null, name: string) => `${parentId == null ? 'ROOT' : parentId}::${name.trim().toLowerCase()}`
  for (const g of existingGroups) {
    groupKeyMap.set(makeKey(g.parent_id != null ? Number(g.parent_id) : null, g.name), Number(g.id))
  }

  const now = Date.now()
  const insertGroupStmt = db.prepare(
    'INSERT INTO groups (parent_id, name, color, sort_order, created_at) VALUES (?, ?, ?, 0, ?)'
  )
  const assignStmt = db.prepare('INSERT OR IGNORE INTO asset_groups (asset_id, group_id, created_at) VALUES (?, ?, ?)')

  let createdGroups = 0
  let reusedGroups = 0
  let assignedAssets = 0
  let colorIdx = 0
  const touchedGroupIds = new Set<number>()

  const ensureGroupInTx = (parentId: number | null, name: string): number => {
    const cleanName = name.trim() || '未命名文件夹'
    const key = makeKey(parentId, cleanName)
    const hit = groupKeyMap.get(key)
    if (hit !== undefined) {
      if (!touchedGroupIds.has(hit)) {
        touchedGroupIds.add(hit)
        reusedGroups++
      }
      return hit
    }
    const color = AUTO_GROUP_PALETTE[colorIdx++ % AUTO_GROUP_PALETTE.length]
    const res = insertGroupStmt.run(parentId, cleanName, color, now)
    const newId = Number(res.lastInsertRowid)
    groupKeyMap.set(key, newId)
    touchedGroupIds.add(newId)
    createdGroups++
    return newId
  }

  let rootGroupId = 0

  db.exec('BEGIN')
  try {
    rootGroupId = ensureGroupInTx(null, rootGroupName)

    for (const asset of assets) {
      const fileDir = path.dirname(path.resolve(asset.file_path))
      const relDir = path.relative(resolvedRoot, fileDir)

      let targetGroupId = rootGroupId
      if (relDir && relDir !== '.' && !relDir.startsWith('..') && !path.isAbsolute(relDir)) {
        const segments = relDir.split(/[\\/]+/).filter((s) => s.length > 0 && s !== '.')
        for (const seg of segments) {
          targetGroupId = ensureGroupInTx(targetGroupId, seg)
        }
      }

      const r = assignStmt.run(Number(asset.id), targetGroupId, now)
      if (Number(r.changes) > 0) {
        assignedAssets++
      }
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return {
    ok: true,
    rootGroupId,
    rootGroupName,
    createdGroups,
    reusedGroups,
    assignedAssets
  }
}

// ===================== Groups =====================

interface GroupRow {
  id: number
  parent_id: number | null
  name: string
  color: string
  sort_order: number
  created_at: number
  asset_count?: number
}

function mapGroupRow(row: GroupRow): GroupFlat {
  return {
    id: Number(row.id),
    parentId: row.parent_id != null ? Number(row.parent_id) : null,
    name: row.name,
    color: row.color,
    sortOrder: Number(row.sort_order),
    createdAt: Number(row.created_at),
    assetCount: Number(row.asset_count ?? 0)
  }
}

export function listGroupsFlat(): GroupFlat[] {
  const db = getDb()
  const otherGuard = shouldIncludeOtherFiles() ? '' : ` AND a.media_type != 'other'`
  const rows = db
    .prepare(
      `SELECT g.*,
        (SELECT COUNT(*) FROM asset_groups ag
         JOIN assets a ON a.id = ag.asset_id
         WHERE ag.group_id = g.id AND a.status = 'active'${otherGuard}) AS asset_count
       FROM groups g
       ORDER BY g.sort_order ASC, g.created_at ASC`
    )
    .all() as unknown as GroupRow[]
  return rows.map(mapGroupRow)
}

export function listGroupTree(): GroupNode[] {
  const db = getDb()
  const otherGuard = shouldIncludeOtherFiles() ? '' : ` AND a.media_type != 'other'`
  const rows = db
    .prepare(`SELECT * FROM groups ORDER BY sort_order ASC, created_at ASC`)
    .all() as unknown as GroupRow[]

  // Fetch active asset->group edges once to compute both direct assetCount and descendant totalCount
  const edges = db
    .prepare(
      `SELECT ag.group_id, ag.asset_id
       FROM asset_groups ag
       JOIN assets a ON a.id = ag.asset_id
       WHERE a.status = 'active'${otherGuard}`
    )
    .all() as Array<{ group_id: number; asset_id: number }>

  const directAssetsByGroup = new Map<number, Set<number>>()
  for (const e of edges) {
    const gid = Number(e.group_id)
    let set = directAssetsByGroup.get(gid)
    if (!set) {
      set = new Set<number>()
      directAssetsByGroup.set(gid, set)
    }
    set.add(Number(e.asset_id))
  }

  const nodeMap = new Map<number, GroupNode>()
  for (const row of rows) {
    const g = mapGroupRow(row)
    const directCount = directAssetsByGroup.get(g.id)?.size ?? 0
    nodeMap.set(g.id, { ...g, assetCount: directCount, totalCount: directCount, children: [] })
  }

  const roots: GroupNode[] = []
  for (const node of nodeMap.values()) {
    if (node.parentId != null && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  function computeUniqueAssets(node: GroupNode): Set<number> {
    const union = new Set<number>(directAssetsByGroup.get(node.id) ?? [])
    for (const child of node.children) {
      const childSet = computeUniqueAssets(child)
      for (const aid of childSet) union.add(aid)
    }
    node.totalCount = union.size
    return union
  }

  for (const r of roots) {
    computeUniqueAssets(r)
  }

  return roots
}

export function getDescendantGroupIds(groupId: number): number[] {
  const db = getDb()
  const rows = db.prepare('SELECT id, parent_id FROM groups').all() as Array<{
    id: number
    parent_id: number | null
  }>
  const childrenByParent = new Map<number, number[]>()
  for (const g of rows) {
    if (g.parent_id != null) {
      const pid = Number(g.parent_id)
      const list = childrenByParent.get(pid) ?? []
      list.push(Number(g.id))
      childrenByParent.set(pid, list)
    }
  }
  const result: number[] = []
  const stack = [groupId]
  const visited = new Set<number>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (visited.has(cur)) continue
    visited.add(cur)
    result.push(cur)
    const kids = childrenByParent.get(cur)
    if (kids) {
      for (const k of kids) stack.push(k)
    }
  }
  return result
}

export function createGroup(data: { name: string; parentId?: number | null; color?: string }): GroupFlat {
  const db = getDb()
  const now = Date.now()
  const parentId = data.parentId ?? null
  const color = data.color || '#6366f1'
  const res = db
    .prepare('INSERT INTO groups (parent_id, name, color, sort_order, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(parentId, data.name.trim(), color, now)
  const id = Number(res.lastInsertRowid)
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as unknown as GroupRow
  return mapGroupRow({ ...row, asset_count: 0 })
}

export function updateGroup(
  id: number,
  patch: { name?: string; parentId?: number | null; color?: string; sortOrder?: number }
): GroupFlat {
  const db = getDb()
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as unknown as GroupRow | undefined
  if (!row) throw new Error(`Group ${id} not found`)

  // Prevent setting parentId to self or descendant
  let parentId = patch.parentId !== undefined ? patch.parentId : row.parent_id
  if (parentId != null) {
    const descendants = new Set(getDescendantGroupIds(id))
    if (descendants.has(parentId)) {
      parentId = row.parent_id
    }
  }

  const name = patch.name !== undefined ? patch.name.trim() : row.name
  const color = patch.color !== undefined ? patch.color : row.color
  const sortOrder = patch.sortOrder !== undefined ? patch.sortOrder : Number(row.sort_order)

  db.prepare('UPDATE groups SET parent_id = ?, name = ?, color = ?, sort_order = ? WHERE id = ?').run(
    parentId,
    name,
    color,
    sortOrder,
    id
  )
  const otherGuard = shouldIncludeOtherFiles() ? '' : ` AND a.media_type != 'other'`
  const updated = db
    .prepare(
      `SELECT g.*,
        (SELECT COUNT(*) FROM asset_groups ag JOIN assets a ON a.id = ag.asset_id WHERE ag.group_id = g.id AND a.status = 'active'${otherGuard}) AS asset_count
       FROM groups g WHERE g.id = ?`
    )
    .get(id) as unknown as GroupRow
  return mapGroupRow(updated)
}

export function deleteGroup(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM groups WHERE id = ?').run(id)
}

export function reorderGroup(id: number, targetParentId: number | null, orderedSiblingIds: number[]): void {
  const db = getDb()
  const row = db.prepare('SELECT id, parent_id FROM groups WHERE id = ?').get(id) as
    | { id: number; parent_id: number | null }
    | undefined
  if (!row) return

  // Guard against circular hierarchy: targetParentId cannot be self or any descendant of id
  if (targetParentId != null) {
    const descendants = new Set(getDescendantGroupIds(id))
    if (descendants.has(targetParentId)) return
  }

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE groups SET parent_id = ? WHERE id = ?').run(targetParentId, id)
    const updateOrderStmt = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?')
    const seen = new Set<number>()
    let orderIdx = 0
    for (const sid of orderedSiblingIds) {
      if (seen.has(sid)) continue
      seen.add(sid)
      updateOrderStmt.run(orderIdx++, sid)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function assignAssetsToGroups(assetIds: number[], groupIds: number[]): void {
  if (assetIds.length === 0 || groupIds.length === 0) return
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare('INSERT OR IGNORE INTO asset_groups (asset_id, group_id, created_at) VALUES (?, ?, ?)')
  db.exec('BEGIN')
  try {
    for (const aid of assetIds) {
      for (const gid of groupIds) {
        stmt.run(aid, gid, now)
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function unassignAssetsFromGroups(assetIds: number[], groupIds: number[]): void {
  if (assetIds.length === 0 || groupIds.length === 0) return
  const db = getDb()
  const stmt = db.prepare('DELETE FROM asset_groups WHERE asset_id = ? AND group_id = ?')
  db.exec('BEGIN')
  try {
    for (const aid of assetIds) {
      for (const gid of groupIds) {
        stmt.run(aid, gid)
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// ===================== Assets =====================

interface AssetRow {
  id: number
  root_id: number
  file_path: string
  file_name: string
  ext: string
  media_type: MediaType
  mime_type: string
  file_size: number
  created_at: number
  modified_at: number
  fingerprint: string | null
  width: number | null
  height: number | null
  duration: number | null
  extra_meta: string | null
  note: string
  thumb_path: string | null
  text_snippet: string | null
  status: AssetStatus
  indexed_at: number
  is_favorite?: number | null
  dominant_colors?: string | null
  group_ids_csv?: string | null
}

function mapAssetRow(row: AssetRow): Asset {
  let extraMeta: AssetExtraMeta | null = null
  if (row.extra_meta) {
    try {
      extraMeta = JSON.parse(row.extra_meta)
    } catch {
      extraMeta = null
    }
  }
  let dominantColors: string[] = []
  if (row.dominant_colors) {
    try {
      const parsed = JSON.parse(row.dominant_colors)
      if (Array.isArray(parsed)) {
        dominantColors = parsed.filter((c): c is string => typeof c === 'string')
      }
    } catch {
      dominantColors = []
    }
  }
  const groupIds = row.group_ids_csv
    ? row.group_ids_csv
        .split(',')
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
    : []

  return {
    id: Number(row.id),
    rootId: Number(row.root_id),
    filePath: row.file_path,
    fileName: row.file_name,
    ext: row.ext,
    mediaType: row.media_type,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    createdAt: Number(row.created_at),
    modifiedAt: Number(row.modified_at),
    fingerprint: row.fingerprint,
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    duration: row.duration != null ? Number(row.duration) : null,
    extraMeta,
    note: row.note ?? '',
    thumbPath: row.thumb_path,
    textSnippet: row.text_snippet,
    status: row.status,
    indexedAt: Number(row.indexed_at),
    isFavorite: Boolean(row.is_favorite),
    dominantColors,
    groupIds
  }
}

export function getAssetById(id: number): Asset | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT a.*,
        (SELECT GROUP_CONCAT(ag.group_id) FROM asset_groups ag WHERE ag.asset_id = a.id) AS group_ids_csv
       FROM assets a WHERE a.id = ?`
    )
    .get(id) as unknown as AssetRow | undefined
  return row ? mapAssetRow(row) : null
}

export function getAssetByPath(filePath: string): Asset | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT a.*,
        (SELECT GROUP_CONCAT(ag.group_id) FROM asset_groups ag WHERE ag.asset_id = a.id) AS group_ids_csv
       FROM assets a WHERE a.file_path = ?`
    )
    .get(filePath) as unknown as AssetRow | undefined
  return row ? mapAssetRow(row) : null
}

export function queryAssets(filter: AssetQueryFilter): AssetQueryResult {
  const db = getDb()
  const where: string[] = []
  const params: Array<string | number> = []

  // Status filter based on smartView
  if (filter.smartView === 'missing') {
    where.push(`a.status = 'missing'`)
  } else if (filter.smartView === 'hidden') {
    where.push(`a.status = 'hidden'`)
  } else {
    where.push(`a.status = 'active'`)
  }

  if (!shouldIncludeOtherFiles()) {
    where.push(`a.media_type != 'other'`)
  }

  if (filter.smartView === 'favorites') {
    where.push(`a.is_favorite = 1`)
  } else if (filter.smartView === 'ungrouped') {
    where.push(`NOT EXISTS (SELECT 1 FROM asset_groups ag WHERE ag.asset_id = a.id)`)
  } else if (filter.smartView === 'recent') {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    where.push(`a.indexed_at >= ?`)
    params.push(sevenDaysAgo)
  }

  if (filter.mediaTypes && filter.mediaTypes.length > 0) {
    const placeholders = filter.mediaTypes.map(() => '?').join(',')
    where.push(`a.media_type IN (${placeholders})`)
    params.push(...filter.mediaTypes)
  }

  if (filter.extensions && filter.extensions.length > 0) {
    const normalizedExts = filter.extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
    const placeholders = normalizedExts.map(() => '?').join(',')
    where.push(`LOWER(a.ext) IN (${placeholders})`)
    params.push(...normalizedExts)
  }

  if (filter.aspectFilter && filter.aspectFilter !== 'all') {
    if (filter.aspectFilter === 'landscape') {
      where.push(`a.width IS NOT NULL AND a.height IS NOT NULL AND a.height > 0 AND CAST(a.width AS REAL) / a.height > 1.12`)
    } else if (filter.aspectFilter === 'portrait') {
      where.push(`a.width IS NOT NULL AND a.height IS NOT NULL AND a.height > 0 AND CAST(a.width AS REAL) / a.height < 0.89`)
    } else if (filter.aspectFilter === 'square') {
      where.push(`a.width IS NOT NULL AND a.height IS NOT NULL AND a.height > 0 AND CAST(a.width AS REAL) / a.height >= 0.89 AND CAST(a.width AS REAL) / a.height <= 1.12`)
    }
  }

  if (filter.sizeFilter && filter.sizeFilter !== 'all') {
    const MB = 1024 * 1024
    if (filter.sizeFilter === 'small') {
      where.push(`a.file_size < ?`)
      params.push(MB)
    } else if (filter.sizeFilter === 'medium') {
      where.push(`a.file_size >= ? AND a.file_size <= ?`)
      params.push(MB, 20 * MB)
    } else if (filter.sizeFilter === 'large') {
      where.push(`a.file_size > ?`)
      params.push(20 * MB)
    }
  }

  if (filter.hasNoteOnly) {
    where.push(`TRIM(a.note) != ''`)
  }

  if (filter.colorHex && filter.colorHex.trim()) {
    where.push(`a.dominant_colors IS NOT NULL AND a.dominant_colors != '' AND a.dominant_colors != '[]'`)
  }

  if (filter.rootId != null) {
    where.push(`a.root_id = ?`)
    params.push(filter.rootId)
  }

  if (filter.groupId != null) {
    const groupIds = filter.includeSubgroups !== false ? getDescendantGroupIds(filter.groupId) : [filter.groupId]
    const placeholders = groupIds.map(() => '?').join(',')
    where.push(`EXISTS (SELECT 1 FROM asset_groups ag WHERE ag.asset_id = a.id AND ag.group_id IN (${placeholders}))`)
    params.push(...groupIds)
  }

  if (filter.search && filter.search.trim().length > 0) {
    const tokens = filter.search
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
    for (const token of tokens) {
      const escaped = token.replace(/[\\%_]/g, '\\$&')
      const pattern = `%${escaped}%`
      where.push(`(a.file_name LIKE ? ESCAPE '\\' OR a.note LIKE ? ESCAPE '\\' OR a.file_path LIKE ? ESCAPE '\\')`)
      params.push(pattern, pattern, pattern)
    }
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  let orderSql = 'ORDER BY a.modified_at DESC'
  const dir = filter.sortOrder === 'asc' ? 'ASC' : 'DESC'
  if (filter.sortField === 'created_at') {
    orderSql = `ORDER BY a.created_at ${dir}, a.id ${dir}`
  } else if (filter.sortField === 'modified_at') {
    orderSql = `ORDER BY a.modified_at ${dir}, a.id ${dir}`
  } else if (filter.sortField === 'file_size') {
    orderSql = `ORDER BY a.file_size ${dir}, a.id ${dir}`
  } else if (filter.sortField === 'name') {
    orderSql = `ORDER BY a.file_name COLLATE NOCASE ${dir}, a.id ${dir}`
  }

  const targetColor = filter.colorHex?.trim() || null
  const useSqlPagination =
    typeof filter.limit === 'number' && filter.limit > 0 && filter.sortField !== 'name' && !targetColor
  const offset = Math.max(0, Math.floor(filter.offset ?? 0))
  const limit = typeof filter.limit === 'number' && filter.limit > 0 ? Math.floor(filter.limit) : 0

  let total = 0
  let rows: AssetRow[]
  if (useSqlPagination) {
    const countRow = db.prepare(`SELECT COUNT(*) AS c FROM assets a ${whereClause}`).get(...params) as { c: number }
    total = Number(countRow?.c ?? 0)
    rows = db
      .prepare(`SELECT a.* FROM assets a ${whereClause} ${orderSql} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as AssetRow[]
  } else {
    rows = db.prepare(`SELECT a.* FROM assets a ${whereClause} ${orderSql}`).all(...params) as unknown as AssetRow[]
    total = rows.length
  }

  // Batch-load asset->group edges once instead of running an N+1 correlated subquery per asset row
  let groupsByAsset: Map<number, number[]> | null = null
  if (rows.length > 0) {
    const edgeRows = db.prepare('SELECT asset_id, group_id FROM asset_groups').all() as Array<{
      asset_id: number
      group_id: number
    }>
    if (edgeRows.length > 0) {
      groupsByAsset = new Map<number, number[]>()
      for (const e of edgeRows) {
        const aid = Number(e.asset_id)
        const gid = Number(e.group_id)
        let list = groupsByAsset.get(aid)
        if (!list) {
          list = [gid]
          groupsByAsset.set(aid, list)
        } else {
          list.push(gid)
        }
      }
    }
  }

  let items = rows.map((row) => {
    const asset = mapAssetRow(row)
    if (groupsByAsset) {
      const gids = groupsByAsset.get(asset.id)
      if (gids) asset.groupIds = gids
    }
    return asset
  })

  // Apply perceptual color similarity filtering & ranking when colorHex is active
  if (targetColor) {
    const COLOR_THRESHOLD_SQ = 26000
    const scored: Array<{ asset: Asset; dist: number }> = []
    for (const asset of items) {
      if (!asset.dominantColors || asset.dominantColors.length === 0) continue
      let best = Number.MAX_SAFE_INTEGER
      for (let i = 0; i < asset.dominantColors.length; i++) {
        // Weight earlier (more dominant) swatches slightly better
        const d = hexColorDistanceSq(targetColor, asset.dominantColors[i]) + i * 900
        if (d < best) best = d
      }
      if (best <= COLOR_THRESHOLD_SQ) {
        scored.push({ asset, dist: best })
      }
    }
    scored.sort((a, b) => a.dist - b.dist)
    items = scored.map((s) => s.asset)
    total = items.length
  } else if (filter.sortField === 'name') {
    const sign = filter.sortOrder === 'asc' ? 1 : -1
    items.sort((a, b) => naturalCollator.compare(a.fileName, b.fileName) * sign)
  }

  if (!useSqlPagination && limit > 0) {
    items = items.slice(offset, offset + limit)
  }

  const hasMore = limit > 0 ? offset + items.length < total : false
  return { items, total, hasMore }
}

export function getLibraryStats(): LibraryStats {
  const db = getDb()
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const includeOther = shouldIncludeOtherFiles()
  const otherWhere = includeOther ? '' : ` AND media_type != 'other'`
  const otherWhereA = includeOther ? '' : ` AND a.media_type != 'other'`

  // Single aggregated pass for totalActive, favoriteCount, missingCount, hiddenCount, recentCount, and maskedOtherCount
  const summary = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'active'${otherWhere} THEN 1 ELSE 0 END), 0) AS total_active,
         COALESCE(SUM(CASE WHEN status = 'active' AND is_favorite = 1${otherWhere} THEN 1 ELSE 0 END), 0) AS favorite_count,
         COALESCE(SUM(CASE WHEN status = 'missing'${otherWhere} THEN 1 ELSE 0 END), 0) AS missing_count,
         COALESCE(SUM(CASE WHEN status = 'hidden'${otherWhere} THEN 1 ELSE 0 END), 0) AS hidden_count,
         COALESCE(SUM(CASE WHEN status = 'active' AND indexed_at >= ?${otherWhere} THEN 1 ELSE 0 END), 0) AS recent_count,
         COALESCE(SUM(CASE WHEN status = 'active' AND media_type = 'other' THEN 1 ELSE 0 END), 0) AS active_other_count
       FROM assets`
    )
    .get(sevenDaysAgo) as {
    total_active: number
    favorite_count: number
    missing_count: number
    hidden_count: number
    recent_count: number
    active_other_count: number
  }

  const totalActive = Number(summary.total_active ?? 0)
  const favoriteCount = Number(summary.favorite_count ?? 0)
  const missingCount = Number(summary.missing_count ?? 0)
  const hiddenCount = Number(summary.hidden_count ?? 0)
  const recentCount = Number(summary.recent_count ?? 0)
  const maskedOtherCount = includeOther ? 0 : Number(summary.active_other_count ?? 0)

  const ungroupedCount = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM assets a
           WHERE a.status = 'active'${otherWhereA}
           AND NOT EXISTS (SELECT 1 FROM asset_groups ag WHERE ag.asset_id = a.id)`
        )
        .get() as { c: number }
    ).c
  )

  const byType: Record<MediaType, number> = {
    image: 0,
    video: 0,
    audio: 0,
    text: 0,
    model: 0,
    other: 0
  }
  const typeRows = db
    .prepare(`SELECT media_type, COUNT(*) AS c FROM assets WHERE status = 'active'${otherWhere} GROUP BY media_type`)
    .all() as Array<{ media_type: MediaType; c: number }>
  for (const r of typeRows) {
    byType[r.media_type] = Number(r.c)
  }

  const byRoot: Record<number, number> = {}
  const rootRows = db
    .prepare(`SELECT root_id, COUNT(*) AS c FROM assets WHERE status = 'active'${otherWhere} GROUP BY root_id`)
    .all() as Array<{ root_id: number; c: number }>
  for (const r of rootRows) {
    byRoot[Number(r.root_id)] = Number(r.c)
  }

  const extensionsByType: Record<MediaType, Array<{ ext: string; count: number }>> = {
    image: [],
    video: [],
    audio: [],
    text: [],
    model: [],
    other: []
  }
  const extByTypeRows = db
    .prepare(
      `SELECT media_type, LOWER(ext) AS ext, COUNT(*) AS c
       FROM assets
       WHERE status = 'active' AND ext != ''${otherWhere}
       GROUP BY media_type, LOWER(ext)
       ORDER BY c DESC, ext ASC`
    )
    .all() as Array<{ media_type: MediaType; ext: string; c: number }>

  const extTotalMap = new Map<string, number>()
  for (const r of extByTypeRows) {
    const count = Number(r.c)
    if (extensionsByType[r.media_type]) {
      extensionsByType[r.media_type].push({ ext: r.ext, count })
    }
    extTotalMap.set(r.ext, (extTotalMap.get(r.ext) ?? 0) + count)
  }

  const extensions = Array.from(extTotalMap.entries())
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
    .slice(0, 36)

  return {
    totalActive,
    favoriteCount,
    ungroupedCount,
    recentCount,
    missingCount,
    hiddenCount,
    maskedOtherCount,
    byType,
    byRoot,
    extensions,
    extensionsByType
  }
}

export function updateAssetNote(id: number, note: string): void {
  const db = getDb()
  db.prepare('UPDATE assets SET note = ? WHERE id = ?').run(note, id)
}

export function batchAppendNote(ids: number[], text: string): void {
  if (ids.length === 0 || !text.trim()) return
  const db = getDb()
  const getStmt = db.prepare('SELECT note FROM assets WHERE id = ?')
  const setStmt = db.prepare('UPDATE assets SET note = ? WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const id of ids) {
      const row = getStmt.get(id) as { note: string } | undefined
      if (!row) continue
      const existing = row.note?.trim() ?? ''
      const next = existing ? `${existing}\n\n${text.trim()}` : text.trim()
      setStmt.run(next, id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function setAssetsStatus(ids: number[], status: AssetStatus): void {
  if (ids.length === 0) return
  const db = getDb()
  const stmt = db.prepare('UPDATE assets SET status = ? WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const id of ids) {
      stmt.run(status, id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function setAssetsFavorite(ids: number[], isFavorite: boolean): void {
  if (ids.length === 0) return
  const db = getDb()
  const val = isFavorite ? 1 : 0
  const stmt = db.prepare('UPDATE assets SET is_favorite = ? WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const id of ids) {
      stmt.run(val, id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function updateAssetDominantColors(id: number, colors: string[]): void {
  const db = getDb()
  db.prepare('UPDATE assets SET dominant_colors = ? WHERE id = ?').run(JSON.stringify(colors), id)
}

export function getAssetsMissingColors(
  limit = 400
): Array<{ id: number; thumbPath: string | null; filePath: string; mediaType: MediaType }> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, thumb_path, file_path, media_type
       FROM assets
       WHERE status = 'active'
         AND media_type IN ('image', 'video')
         AND (dominant_colors IS NULL OR dominant_colors = '')
       LIMIT ?`
    )
    .all(limit) as Array<{ id: number; thumb_path: string | null; file_path: string; media_type: MediaType }>
  return rows.map((r) => ({
    id: Number(r.id),
    thumbPath: r.thumb_path,
    filePath: r.file_path,
    mediaType: r.media_type
  }))
}

export function findDuplicateAssetGroups(): DuplicateGroup[] {
  const db = getDb()
  const includeOther = shouldIncludeOtherFiles()
  const otherWhere = includeOther ? '' : ` AND media_type != 'other'`
  const otherWhereA = includeOther ? '' : ` AND a.media_type != 'other'`
  const dupFps = db
    .prepare(
      `SELECT fingerprint, COUNT(*) AS c, MAX(file_size) AS fsize
       FROM assets
       WHERE status = 'active'${otherWhere}
         AND fingerprint IS NOT NULL
         AND fingerprint != ''
         AND file_size > 0
       GROUP BY fingerprint
       HAVING COUNT(*) > 1
       ORDER BY (COUNT(*) - 1) * MAX(file_size) DESC
       LIMIT 200`
    )
    .all() as Array<{ fingerprint: string; c: number; fsize: number }>

  if (dupFps.length === 0) return []

  const placeholders = dupFps.map(() => '?').join(',')
  const fpValues = dupFps.map((d) => d.fingerprint)
  const assetRows = db
    .prepare(
      `SELECT a.*,
        (SELECT GROUP_CONCAT(ag.group_id) FROM asset_groups ag WHERE ag.asset_id = a.id) AS group_ids_csv
       FROM assets a
       WHERE a.status = 'active'${otherWhereA} AND a.fingerprint IN (${placeholders})
       ORDER BY a.indexed_at ASC, a.id ASC`
    )
    .all(...fpValues) as unknown as AssetRow[]

  const byFp = new Map<string, Asset[]>()
  for (const row of assetRows) {
    const asset = mapAssetRow(row)
    if (!asset.fingerprint) continue
    let list = byFp.get(asset.fingerprint)
    if (!list) {
      list = []
      byFp.set(asset.fingerprint, list)
    }
    list.push(asset)
  }

  const groups: DuplicateGroup[] = []
  for (const d of dupFps) {
    const items = byFp.get(d.fingerprint) ?? []
    if (items.length > 1) {
      groups.push({
        fingerprint: d.fingerprint,
        fileSize: Number(d.fsize ?? 0),
        count: items.length,
        items
      })
    }
  }
  return groups
}

/**
 * Losslessly merges group memberships, favorite status, and unique Markdown notes
 * from duplicate assets into `keepId` before removing the duplicate records.
 */
export function mergeDuplicateMetadata(keepId: number, removeIds: number[]): void {
  const validRemove = removeIds.filter((id) => id !== keepId)
  if (validRemove.length === 0) return
  const db = getDb()

  const keepAsset = getAssetById(keepId)
  if (!keepAsset) return

  const noteParts: string[] = []
  const seenNotes = new Set<string>()
  const addNote = (n: string) => {
    const trimmed = (n || '').trim()
    if (!trimmed || seenNotes.has(trimmed)) return
    seenNotes.add(trimmed)
    noteParts.push(trimmed)
  }
  addNote(keepAsset.note)

  const mergedGroups = new Set<number>(keepAsset.groupIds)
  let anyFavorite = keepAsset.isFavorite

  for (const rid of validRemove) {
    const dup = getAssetById(rid)
    if (!dup) continue
    addNote(dup.note)
    for (const gid of dup.groupIds) mergedGroups.add(gid)
    if (dup.isFavorite) anyFavorite = true
  }

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE assets SET note = ?, is_favorite = ? WHERE id = ?').run(
      noteParts.join('\n\n---\n\n'),
      anyFavorite ? 1 : 0,
      keepId
    )
    const now = Date.now()
    const insGroup = db.prepare('INSERT OR IGNORE INTO asset_groups (asset_id, group_id, created_at) VALUES (?, ?, ?)')
    for (const gid of mergedGroups) {
      insGroup.run(keepId, gid, now)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function deleteAssetsByIds(ids: number[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const stmt = db.prepare('DELETE FROM assets WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const id of ids) {
      stmt.run(id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function removeMissingAssets(ids?: number[]): number {
  const db = getDb()
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    const res = db
      .prepare(`DELETE FROM assets WHERE status = 'missing' AND id IN (${placeholders})`)
      .run(...ids)
    return Number(res.changes)
  }
  const res = db.prepare(`DELETE FROM assets WHERE status = 'missing'`).run()
  return Number(res.changes)
}

export function updateAssetThumbAndDims(
  id: number,
  thumbPath: string | null,
  width?: number | null,
  height?: number | null
): void {
  const db = getDb()
  if (width !== undefined || height !== undefined) {
    db.prepare(
      `UPDATE assets SET thumb_path = ?, width = COALESCE(?, width), height = COALESCE(?, height) WHERE id = ?`
    ).run(thumbPath, width ?? null, height ?? null, id)
  } else {
    db.prepare('UPDATE assets SET thumb_path = ? WHERE id = ?').run(thumbPath, id)
  }
}

export function getAssetsMissingThumbs(): Array<{ id: number; filePath: string; ext: string; mediaType: MediaType }> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, file_path, ext, media_type FROM assets
       WHERE status = 'active'
       AND media_type IN ('image', 'video', 'audio', 'model')
       AND (thumb_path IS NULL OR thumb_path = '')`
    )
    .all() as Array<{ id: number; file_path: string; ext: string; media_type: MediaType }>
  return rows.map((r) => ({
    id: Number(r.id),
    filePath: r.file_path,
    ext: r.ext,
    mediaType: r.media_type
  }))
}

export function getMissing3DModelThumbs(): Array<{ id: number; filePath: string; fileName: string; ext: string }> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, file_path, file_name, ext FROM assets
       WHERE status = 'active'
       AND media_type = 'model'
       AND LOWER(ext) IN ('.obj', '.fbx', '.glb', '.gltf', '.stl', '.ply')
       AND (thumb_path IS NULL OR thumb_path = '')
       ORDER BY modified_at DESC`
    )
    .all() as Array<{ id: number; file_path: string; file_name: string; ext: string }>
  return rows.map((r) => ({
    id: Number(r.id),
    filePath: r.file_path,
    fileName: r.file_name,
    ext: r.ext
  }))
}

export function mergeAssetExtraMeta(id: number, patch: Partial<AssetExtraMeta>): void {
  const db = getDb()
  const row = db.prepare('SELECT extra_meta FROM assets WHERE id = ?').get(id) as
    | { extra_meta: string | null }
    | undefined
  if (!row) return
  let existing: AssetExtraMeta = {}
  if (row.extra_meta) {
    try {
      existing = JSON.parse(row.extra_meta)
    } catch {
      existing = {}
    }
  }
  const merged = { ...existing, ...patch }
  db.prepare('UPDATE assets SET extra_meta = ? WHERE id = ?').run(JSON.stringify(merged), id)
}
