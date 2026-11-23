import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { shell } from 'electron'
import { getDb } from '../db'
import {
  assignAssetsToGroups,
  createGroup,
  createSourceRoot,
  updateSourceRoot
} from '../db/repositories'
import { classifyExtension, getMimeType, normalizeExt } from '@shared/mediaTypes'
import type {
  EagleInspectResult,
  EagleMigrationProgress,
  EagleMigrationResult
} from '@shared/types'
import { computeFingerprint } from './fingerprint'
import { extractAssetMetadata } from './metadata'
import { thumbnailQueue } from './thumbnailer'

interface EagleFolderMeta {
  id: string
  name: string
  description?: string
  iconColor?: string
  children?: EagleFolderMeta[]
}

interface EagleLibraryMeta {
  folders?: EagleFolderMeta[]
}

interface EagleItemMeta {
  id?: string
  name?: string
  ext?: string
  size?: number
  width?: number
  height?: number
  folders?: string[]
  tags?: string[]
  annotation?: string
  url?: string
  isDeleted?: boolean
  btime?: number
  mtime?: number
  modificationTime?: number
}

const EAGLE_COLOR_MAP: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#f59e0b',
  green: '#10b981',
  aqua: '#06b6d4',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899'
}

const FALLBACK_COLORS = [
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#f97316'
]

function countEagleFolders(folders: EagleFolderMeta[] | undefined): number {
  if (!folders || folders.length === 0) return 0
  let total = 0
  for (const f of folders) {
    total += 1 + countEagleFolders(f.children)
  }
  return total
}

function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned || '未命名'
}

function makeUniqueFilePath(dir: string, fileName: string): string {
  const parsed = path.parse(fileName)
  let candidate = path.join(dir, fileName)
  let n = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name} (${n})${parsed.ext}`)
    n++
  }
  return candidate
}

/**
 * Finds the true original media file inside an Eagle `<id>.info` directory,
 * strictly excluding `metadata.json` and Eagle's `*_thumbnail.*` files.
 */
async function findOriginalFileInInfoDir(infoDir: string, meta: EagleItemMeta): Promise<string | null> {
  const ext = meta.ext ? normalizeExt(meta.ext) : ''

  // Fast path: exact name + ext
  if (meta.name && ext) {
    const exact = path.join(infoDir, `${meta.name}${ext}`)
    if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
      return exact
    }
  }

  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(infoDir, { withFileTypes: true })
  } catch {
    return null
  }

  const candidates = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => {
      const lower = name.toLowerCase()
      if (lower === 'metadata.json') return false
      // Strictly skip Eagle-generated thumbnails (e.g., foo_thumbnail.png / foo_thumbnail.jpg)
      const stem = path.parse(lower).name
      if (stem.endsWith('_thumbnail')) return false
      return true
    })

  if (candidates.length === 0) return null

  if (ext) {
    const matchingExt = candidates.find((name) => normalizeExt(path.extname(name)) === ext)
    if (matchingExt) return path.join(infoDir, matchingExt)
  }

  return path.join(infoDir, candidates[0])
}

function buildNoteFromEagleMeta(meta: EagleItemMeta): string {
  const parts: string[] = []
  if (meta.annotation && meta.annotation.trim()) {
    parts.push(meta.annotation.trim())
  }
  if (Array.isArray(meta.tags) && meta.tags.length > 0) {
    const cleanTags = meta.tags.map((t) => String(t).trim()).filter(Boolean)
    if (cleanTags.length > 0) {
      parts.push(`标签：${cleanTags.map((t) => `#${t}`).join(' ')}`)
    }
  }
  if (meta.url && meta.url.trim()) {
    parts.push(`来源：${meta.url.trim()}`)
  }
  return parts.join('\n\n')
}

export async function inspectEagleLibrary(eagleDir: string): Promise<EagleInspectResult> {
  const resolved = path.resolve(eagleDir)
  const metaPath = path.join(resolved, 'metadata.json')
  const imagesDir = path.join(resolved, 'images')
  const libraryName = path.basename(resolved).replace(/\.library$/i, '') || path.basename(resolved)

  if (!fs.existsSync(metaPath) || !fs.existsSync(imagesDir)) {
    return {
      valid: false,
      libraryPath: resolved,
      libraryName,
      folderCount: 0,
      itemCount: 0,
      error: '所选目录不是有效的 Eagle 资源库（缺少 metadata.json 或 images 目录）'
    }
  }

  try {
    const rawMeta = await fsp.readFile(metaPath, 'utf8')
    const libMeta = JSON.parse(rawMeta) as EagleLibraryMeta
    const folderCount = countEagleFolders(libMeta.folders)

    const entries = await fsp.readdir(imagesDir, { withFileTypes: true })
    const itemCount = entries.filter((e) => e.isDirectory() && e.name.toLowerCase().endsWith('.info')).length

    return {
      valid: true,
      libraryPath: resolved,
      libraryName,
      folderCount,
      itemCount
    }
  } catch (err) {
    return {
      valid: false,
      libraryPath: resolved,
      libraryName,
      folderCount: 0,
      itemCount: 0,
      error: `读取 Eagle 元数据失败：${String(err)}`
    }
  }
}

export async function migrateFromEagle(
  opts: { eagleDir: string; targetDir: string; deleteOriginals: boolean },
  onProgress: (progress: EagleMigrationProgress) => void
): Promise<EagleMigrationResult> {
  const eagleDir = path.resolve(opts.eagleDir)
  const targetDir = path.resolve(opts.targetDir)
  const metaPath = path.join(eagleDir, 'metadata.json')
  const imagesDir = path.join(eagleDir, 'images')

  if (!fs.existsSync(metaPath) || !fs.existsSync(imagesDir)) {
    throw new Error('无效的 Eagle 资源库目录')
  }

  fs.mkdirSync(targetDir, { recursive: true })

  // 1. Parse Eagle folder hierarchy & recreate exact nested groups in SQLite
  const libMeta = JSON.parse(await fsp.readFile(metaPath, 'utf8')) as EagleLibraryMeta
  const db = getDb()

  const folderMap = new Map<string, { groupId: number; pathSegments: string[] }>()
  let groupsCreated = 0
  let colorCounter = 0

  const findOrCreateGroup = (name: string, parentId: number | null, color: string): number => {
    const existing =
      parentId == null
        ? (db.prepare('SELECT id FROM groups WHERE parent_id IS NULL AND name = ?').get(name) as
            | { id: number }
            | undefined)
        : (db.prepare('SELECT id FROM groups WHERE parent_id = ? AND name = ?').get(parentId, name) as
            | { id: number }
            | undefined)

    if (existing) {
      return Number(existing.id)
    }
    const created = createGroup({ name, parentId, color })
    groupsCreated++
    return created.id
  }

  const walkFolders = (folders: EagleFolderMeta[] | undefined, parentId: number | null, parentSegments: string[]) => {
    if (!folders || folders.length === 0) return
    for (const folder of folders) {
      const folderName = (folder.name || '未命名分组').trim()
      const color =
        (folder.iconColor && EAGLE_COLOR_MAP[folder.iconColor.toLowerCase()]) ||
        FALLBACK_COLORS[colorCounter++ % FALLBACK_COLORS.length]
      const groupId = findOrCreateGroup(folderName, parentId, color)
      const segments = [...parentSegments, sanitizeSegment(folderName)]
      folderMap.set(folder.id, { groupId, pathSegments: segments })
      if (folder.children && folder.children.length > 0) {
        walkFolders(folder.children, groupId, segments)
      }
    }
  }

  // Create/reuse ONE top-level Eagle parent group named after the library so imported folders stay cleanly organized
  const eagleLibraryName = path.basename(eagleDir).replace(/\.library$/i, '').trim() || 'Eagle 素材库'
  const eagleRootGroupId = findOrCreateGroup(eagleLibraryName, null, '#0ea5e9')

  walkFolders(libMeta.folders, eagleRootGroupId, [])

  // 2. Register target directory as an indexed source_root
  const driveRoot = path.parse(targetDir).root.replace(/[\\/]+$/, '')
  const baseAlias = path.basename(targetDir) || driveRoot
  const rootAlias = driveRoot && baseAlias !== driveRoot ? `${baseAlias} (${driveRoot})` : baseAlias
  const sourceRoot = createSourceRoot(targetDir, rootAlias)

  // 3. Enumerate all *.info item folders
  const entries = await fsp.readdir(imagesDir, { withFileTypes: true })
  const infoDirs = entries.filter((e) => e.isDirectory() && e.name.toLowerCase().endsWith('.info'))

  const progress: EagleMigrationProgress = {
    running: true,
    total: infoDirs.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0
  }
  onProgress({ ...progress })

  let deletedOriginals = 0
  let lastEmitAt = Date.now()

  const insertStmt = db.prepare(
    `INSERT INTO assets (
      root_id, file_path, file_name, ext, media_type, mime_type,
      file_size, created_at, modified_at, fingerprint,
      width, height, duration, extra_meta, note, thumb_path, text_snippet, status, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?)`
  )

  for (const entry of infoDirs) {
    const infoDir = path.join(imagesDir, entry.name)
    const itemMetaPath = path.join(infoDir, 'metadata.json')

    try {
      if (!fs.existsSync(itemMetaPath)) {
        progress.skipped++
        progress.processed++
        continue
      }

      const itemMeta = JSON.parse(await fsp.readFile(itemMetaPath, 'utf8')) as EagleItemMeta

      // Skip items deleted into Eagle trash
      if (itemMeta.isDeleted) {
        progress.skipped++
        progress.processed++
        continue
      }

      const originalFile = await findOriginalFileInInfoDir(infoDir, itemMeta)
      if (!originalFile) {
        progress.skipped++
        progress.processed++
        continue
      }

      const srcStat = await fsp.stat(originalFile)
      const ext = normalizeExt(itemMeta.ext || path.extname(originalFile))
      const rawName = itemMeta.name ? `${sanitizeSegment(itemMeta.name)}${ext}` : sanitizeSegment(path.basename(originalFile))

      // Resolve all matching groups in our app (preserving multi-folder & nested hierarchy!)
      const eagleFolderIds = Array.isArray(itemMeta.folders) ? itemMeta.folders : []
      const matchedGroups: Array<{ groupId: number; pathSegments: string[] }> = []
      for (const fid of eagleFolderIds) {
        const mapped = folderMap.get(fid)
        if (mapped) matchedGroups.push(mapped)
      }

      // Organize physical target path cleanly by primary folder hierarchy (zero file duplication)
      const destSubDir =
        matchedGroups.length > 0
          ? path.join(targetDir, ...matchedGroups[0].pathSegments)
          : path.join(targetDir, '未分类')

      fs.mkdirSync(destSubDir, { recursive: true })
      const destFilePath = makeUniqueFilePath(destSubDir, rawName)

      // Copy original file (never Eagle's _thumbnail!) and verify integrity
      await fsp.copyFile(originalFile, destFilePath)
      const dstStat = await fsp.stat(destFilePath)
      if (dstStat.size !== srcStat.size) {
        await fsp.unlink(destFilePath).catch(() => undefined)
        progress.failed++
        progress.processed++
        continue
      }

      // Preserve original timestamps
      const mtimeMs = itemMeta.mtime || itemMeta.modificationTime || Math.floor(srcStat.mtimeMs)
      const ctimeMs = itemMeta.btime || Math.floor(srcStat.birthtimeMs || mtimeMs)
      const mtimeDate = new Date(mtimeMs)
      await fsp.utimes(destFilePath, mtimeDate, mtimeDate).catch(() => undefined)

      // Index into SQLite
      const destFileName = path.basename(destFilePath)
      const mediaType = classifyExtension(ext)
      const mimeType = getMimeType(ext)
      const fp = await computeFingerprint(destFilePath, dstStat.size)
      const note = buildNoteFromEagleMeta(itemMeta)

      // Fast path for standard images when Eagle already knows dimensions; extract full meta for video/audio/text/PSD
      let width: number | null = typeof itemMeta.width === 'number' && itemMeta.width > 0 ? itemMeta.width : null
      let height: number | null = typeof itemMeta.height === 'number' && itemMeta.height > 0 ? itemMeta.height : null
      let duration: number | null = null
      let extraMetaJson: string | null = null
      let textSnippet: string | null = null

      if (mediaType !== 'image' || width == null || height == null || ext === '.psd' || ext === '.psb') {
        const extracted = await extractAssetMetadata(destFilePath, ext, mediaType)
        width = extracted.width ?? width
        height = extracted.height ?? height
        duration = extracted.duration
        extraMetaJson = extracted.extraMeta ? JSON.stringify(extracted.extraMeta) : null
        textSnippet = extracted.textSnippet
      }

      const insertRes = insertStmt.run(
        sourceRoot.id,
        destFilePath,
        destFileName,
        ext,
        mediaType,
        mimeType,
        dstStat.size,
        ctimeMs,
        mtimeMs,
        fp,
        width,
        height,
        duration,
        extraMetaJson,
        note,
        textSnippet,
        Date.now()
      )
      const assetId = Number(insertRes.lastInsertRowid)

      if (matchedGroups.length > 0) {
        assignAssetsToGroups(
          [assetId],
          matchedGroups.map((g) => g.groupId)
        )
      } else {
        // Place uncategorized Eagle items directly under the top-level Eagle library group
        assignAssetsToGroups([assetId], [eagleRootGroupId])
      }

      // Generate OUR OWN lightweight WebP thumbnail asynchronously
      thumbnailQueue.enqueue({
        assetId,
        filePath: destFilePath,
        ext,
        mediaType,
        duration
      })

      // Optionally remove original Eagle item folder (safely via Windows Recycle Bin AFTER copy verification)
      if (opts.deleteOriginals) {
        try {
          await shell.trashItem(infoDir)
          deletedOriginals++
        } catch {
          // Keep going safely if OS lock prevents trashing one folder
        }
      }

      progress.imported++
      progress.processed++
      progress.currentFile = destFileName
    } catch {
      progress.failed++
      progress.processed++
    }

    const now = Date.now()
    if (now - lastEmitAt >= 120 || progress.processed === progress.total) {
      lastEmitAt = now
      onProgress({ ...progress })
    }
  }

  updateSourceRoot(sourceRoot.id, { lastScannedAt: Date.now() })
  progress.running = false
  progress.currentFile = undefined
  onProgress({ ...progress })

  return {
    imported: progress.imported,
    skipped: progress.skipped,
    failed: progress.failed,
    groupsCreated,
    deletedOriginals,
    targetDir,
    rootId: sourceRoot.id
  }
}
