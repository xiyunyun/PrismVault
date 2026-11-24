import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import sharp from 'sharp'
import {
  ensureThumbSubdirs,
  getCadThumbCacheDir,
  getClipboardDir,
  getDb,
  getDbPath,
  getDefaultThumbCacheDir,
  getModelThumbCacheDir,
  getThumbCacheDir,
  setThumbCacheDir,
  THUMB_SUBDIRS
} from '../db'
import {
  assignAssetsToGroups,
  batchAppendNote,
  convertSourceRootToGroups,
  createGroup,
  createSourceRoot,
  deleteAssetsByIds,
  deleteGroup,
  deleteSourceRoot,
  findDuplicateAssetGroups,
  findOverlappingSourceRoot,
  getAllSettings,
  getAssetById,
  getAssetsMissingThumbs,
  getAssetThumbRefsByRootId,
  getLibraryStats,
  getMissing3DModelThumbs,
  getMissingAssetIds,
  listGroupTree,
  listSourceRoots,
  mergeAssetExtraMeta,
  mergeDuplicateMetadata,
  queryAssets,
  removeMissingAssets,
  reorderGroup,
  restoreAllHiddenAssets,
  setAssetsFavorite,
  setAssetsStatus,
  unassignAssetsFromGroups,
  updateAssetDominantColors,
  updateAssetNote,
  updateAssetThumbAndDims,
  updateGroup,
  updateSettings,
  updateSourceRoot
} from '../db/repositories'
import { indexScanner } from '../indexer/scanner'
import { computeFullFileSha256, FULL_HASH_THRESHOLD_BYTES } from '../indexer/fingerprint'
import { thumbnailQueue } from '../indexer/thumbnailer'
import { extractDominantColors } from '../indexer/colorExtractor'
import { watcherManager } from '../indexer/watcher'
import { resolveFfmpeg } from '../indexer/ffmpeg'
import { parseCadForPreview } from '../indexer/cad'
import { renderPsdToPngBuffer } from '../indexer/psd'
import { decodeTextBuffer, isCadExt, isPsdExt, stripThumbVersion } from '@shared/mediaTypes'
import {
  commitClipboardImport,
  getClipboardStats,
  inspectClipboard,
  inspectImportPaths,
  migrateClipboardDir
} from '../indexer/clipboardImport'
import { inspectEagleLibrary, migrateFromEagle } from '../indexer/eagleMigrator'
import {
  getQuickSearchShortcutStatus,
  hideQuickSearchWindow,
  openAssetInMainWindow,
  resolveEffectiveBackdropStyle,
  syncAutoLaunch,
  syncQuickSearchShortcut,
  syncTrayPresence,
  syncWindowAppearance
} from '../index'
import { invalidateMediaProtocolCache } from '../protocol'
import { cloudUpdater, getAppInfo } from '../updater'
import type {
  AppSettings,
  AssetExtraMeta,
  AssetQueryFilter,
  AssetStatus,
  CacheStats,
  MoveThumbCacheResult,
  TextContentResult
} from '@shared/types'

const MAX_TEXT_READ_BYTES = 512 * 1024 // 512KB
const THUMB_FILE_PATTERN = /^(?:preview_)?\d+(?:_\d+)?\.webp$/i

async function migrateThumbCacheFiles(oldDir: string, newDir: string): Promise<MoveThumbCacheResult> {
  const resolvedOld = path.resolve(oldDir)
  const resolvedNew = path.resolve(newDir)
  ensureThumbSubdirs(resolvedNew)

  let movedCount = 0
  let failedCount = 0

  if (resolvedOld.toLowerCase() !== resolvedNew.toLowerCase() && fs.existsSync(resolvedOld)) {
    const subPaths = ['', ...THUMB_SUBDIRS]
    for (const sub of subPaths) {
      const srcDir = sub ? path.join(resolvedOld, sub) : resolvedOld
      const dstDir = sub ? path.join(resolvedNew, sub) : resolvedNew
      if (!fs.existsSync(srcDir)) continue
      fs.mkdirSync(dstDir, { recursive: true })
      const entries = await fsp.readdir(srcDir).catch(() => [] as string[])
      for (const name of entries) {
        if (!THUMB_FILE_PATTERN.test(name)) continue
        const src = path.join(srcDir, name)
        const dst = path.join(dstDir, name)
        try {
          // Cross-drive safe move: copy first, then unlink old file
          await fsp.copyFile(src, dst)
          await fsp.unlink(src).catch(() => undefined)
          movedCount++
        } catch {
          failedCount++
        }
      }
    }
  }

  return {
    oldDir: resolvedOld,
    newDir: resolvedNew,
    movedCount,
    failedCount
  }
}

function broadcast(channel: string, payload?: unknown): void {
  if (channel === 'event:assets-changed') {
    invalidateMediaProtocolCache()
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function makeFriendlyAlias(dirPath: string): string {
  const normalized = path.resolve(dirPath)
  const base = path.basename(normalized)
  const root = path.parse(normalized).root.replace(/[\\/]+$/, '')
  if (!base) return root || normalized
  return root ? `${base} (${root})` : base
}

function assertNonOverlappingUserRoot(dirPath: string): void {
  const overlap = findOverlappingSourceRoot(dirPath, getClipboardDir())
  if (!overlap || overlap.kind === 'exact') return
  if (overlap.kind === 'inside_existing') {
    throw new Error(`该目录已包含在现有索引源「${overlap.existing.alias}」内，无需重复挂载`)
  }
  throw new Error(
    `该目录包含已挂载的子目录「${overlap.existing.alias}」，请先移除该子目录源再挂载上级目录`
  )
}

async function cleanupThumbsForRefs(refs: Array<{ id: number; thumbPath: string | null }>): Promise<number> {
  if (refs.length === 0) return 0
  const cacheRoot = path.resolve(getThumbCacheDir())
  const cacheRootLowerPrefix = cacheRoot.toLowerCase() + path.sep
  const idSet = new Set<number>()
  const candidateRelPaths = new Set<string>()

  for (const ref of refs) {
    idSet.add(ref.id)
    const cleanRef = stripThumbVersion(ref.thumbPath)
    if (cleanRef) {
      candidateRelPaths.add(cleanRef.replace(/\\/g, '/').replace(/^\/+/, ''))
    }
    candidateRelPaths.add(`${ref.id}.webp`)
    candidateRelPaths.add(`models/${ref.id}.webp`)
    candidateRelPaths.add(`cad/${ref.id}.webp`)
  }

  let removedCount = 0
  for (const rel of candidateRelPaths) {
    const candidate = path.resolve(cacheRoot, rel)
    if (!candidate.toLowerCase().startsWith(cacheRootLowerPrefix)) continue
    try {
      await fsp.unlink(candidate)
      removedCount++
    } catch {
      // ignore missing
    }
  }

  // Remove any high-res transcoded PSD/TIFF preview caches (preview_<assetId>_<mtime>.webp)
  try {
    const rootFiles = await fsp.readdir(cacheRoot)
    for (const f of rootFiles) {
      const m = /^preview_(\d+)_\d+\.webp$/i.exec(f)
      if (m && idSet.has(Number(m[1]))) {
        try {
          await fsp.unlink(path.join(cacheRoot, f))
          removedCount++
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return removedCount
}

async function cleanupThumbsForAssetIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const refs: Array<{ id: number; thumbPath: string | null }> = []
  for (let i = 0; i < ids.length; i += 900) {
    const slice = ids.slice(i, i + 900)
    const placeholders = slice.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT id, thumb_path FROM assets WHERE id IN (${placeholders})`)
      .all(...slice) as Array<{ id: number; thumb_path: string | null }>
    for (const r of rows) {
      refs.push({ id: Number(r.id), thumbPath: r.thumb_path })
    }
  }
  return cleanupThumbsForRefs(refs)
}

export function registerIpcHandlers(): void {
  // Wire backend events to renderer
  indexScanner.onProgress((progress) => broadcast('event:scan-progress', progress))
  indexScanner.onAssetsChanged(() => broadcast('event:assets-changed'))
  thumbnailQueue.onReady((payload) => broadcast('event:thumb-ready', payload))
  thumbnailQueue.onProgress((progress) => broadcast('event:thumb-progress', progress))
  cloudUpdater.onStateChange((state) => broadcast('event:update-state', state))

  // ===================== Sources =====================
  ipcMain.handle('sources:list', () => listSourceRoots())

  ipcMain.handle('sources:pickAndAdd', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: '选择要索引的资源目录',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const dirPath = path.resolve(result.filePaths[0])
    assertNonOverlappingUserRoot(dirPath)
    const root = createSourceRoot(dirPath, makeFriendlyAlias(dirPath))
    // Kick off scan asynchronously so UI updates immediately
    indexScanner.scanSource(root.id).catch(() => undefined)
    broadcast('event:assets-changed')
    return root
  })

  ipcMain.handle('sources:addPath', (_e, dirPath: string, alias?: string) => {
    const resolved = path.resolve(dirPath)
    assertNonOverlappingUserRoot(resolved)
    const root = createSourceRoot(resolved, alias?.trim() || makeFriendlyAlias(resolved))
    indexScanner.scanSource(root.id).catch(() => undefined)
    broadcast('event:assets-changed')
    return root
  })

  ipcMain.handle('sources:remove', async (_e, id: number) => {
    watcherManager.stopWatcher(id)
    const shouldDeleteThumbs = getAllSettings().deleteThumbsOnRemoveSource
    const thumbRefs = shouldDeleteThumbs ? getAssetThumbRefsByRootId(id) : []

    deleteSourceRoot(id)

    const removedThumbs = shouldDeleteThumbs && thumbRefs.length > 0 ? await cleanupThumbsForRefs(thumbRefs) : 0

    broadcast('event:assets-changed')
    return { removedThumbs }
  })

  ipcMain.handle(
    'sources:update',
    (_e, id: number, patch: { alias?: string; watchEnabled?: boolean; ignorePatterns?: string[] }) => {
      const updated = updateSourceRoot(id, patch)
      watcherManager.syncSource(updated)
      return updated
    }
  )

  ipcMain.handle('sources:scan', (_e, id?: number) => {
    indexScanner.scanSource(id).catch(() => undefined)
  })

  ipcMain.handle('sources:convertToGroups', (_e, id: number) => {
    const res = convertSourceRootToGroups(id)
    if (res.ok) {
      broadcast('event:assets-changed')
    }
    return res
  })

  // ===================== Assets =====================
  ipcMain.handle('assets:query', (_e, filter: AssetQueryFilter) => queryAssets(filter))
  ipcMain.handle('assets:getStats', () => getLibraryStats())
  ipcMain.handle('assets:getById', (_e, id: number) => getAssetById(id))

  ipcMain.handle('assets:updateNote', (_e, id: number, note: string) => {
    updateAssetNote(id, note)
  })

  ipcMain.handle('assets:batchAppendNote', (_e, ids: number[], text: string) => {
    batchAppendNote(ids, text)
    broadcast('event:assets-changed')
  })

  ipcMain.handle('assets:setStatus', (_e, ids: number[], status: AssetStatus) => {
    setAssetsStatus(ids, status)
    broadcast('event:assets-changed')
  })

  ipcMain.handle('assets:restoreAllHidden', () => {
    const count = restoreAllHiddenAssets()
    if (count > 0) {
      broadcast('event:assets-changed')
    }
    return count
  })

  ipcMain.handle('assets:removeMissing', async (_e, ids?: number[]) => {
    const targetIds = getMissingAssetIds(ids)
    if (targetIds.length > 0) {
      await cleanupThumbsForAssetIds(targetIds)
    }
    const removed = removeMissingAssets(ids)
    broadcast('event:assets-changed')
    return removed
  })

  ipcMain.handle('assets:moveToTrash', async (_e, ids: number[]) => {
    const trashedIds: number[] = []
    const failed: string[] = []
    for (const id of ids) {
      const asset = getAssetById(id)
      if (!asset) continue
      try {
        if (fs.existsSync(asset.filePath)) {
          await shell.trashItem(asset.filePath)
        }
        trashedIds.push(id)
      } catch {
        failed.push(asset.fileName)
      }
    }
    if (trashedIds.length > 0) {
      await cleanupThumbsForAssetIds(trashedIds)
      deleteAssetsByIds(trashedIds)
      broadcast('event:assets-changed')
    }
    return { trashed: trashedIds.length, failed }
  })

  ipcMain.handle('assets:readTextContent', async (_e, id: number): Promise<TextContentResult> => {
    const asset = getAssetById(id)
    if (!asset || !fs.existsSync(asset.filePath)) {
      return { content: '文件不存在或已离线。', truncated: false, totalBytes: 0 }
    }
    const stat = await fsp.stat(asset.filePath)
    const totalBytes = stat.size
    const truncated = totalBytes > MAX_TEXT_READ_BYTES
    const readSize = Math.min(totalBytes, MAX_TEXT_READ_BYTES)
    const handle = await fsp.open(asset.filePath, 'r')
    try {
      const buf = Buffer.alloc(readSize)
      const { bytesRead } = await handle.read(buf, 0, readSize, 0)
      return {
        content: decodeTextBuffer(buf.subarray(0, bytesRead), truncated),
        truncated,
        totalBytes
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  })

  ipcMain.handle('assets:parseCad', async (_e, id: number) => {
    const asset = getAssetById(id)
    if (!asset || !fs.existsSync(asset.filePath)) {
      return {
        ok: false,
        format: 'dwg' as const,
        layers: [],
        batches: [],
        texts: [],
        bounds: null,
        entityCount: 0,
        segmentCount: 0,
        blockCount: 0,
        embeddedPreviewDataUrl: null,
        error: 'CAD 文件不存在或已离线。'
      }
    }
    const res = await parseCadForPreview(asset.filePath)
    if (res.ok) {
      mergeAssetExtraMeta(asset.id, {
        cadVersion: res.version,
        cadEntityCount: res.entityCount,
        cadLayerCount: res.layers.length,
        cadBlockCount: res.blockCount,
        cadLayers: res.layers.slice(0, 40).map((l) => l.name),
        cadHasEmbeddedPreview: Boolean(res.embeddedPreviewDataUrl)
      })
    }
    return res
  })

  ipcMain.handle(
    'assets:saveRenderedThumb',
    async (_e, id: number, pngDataUrl: string, extraMetaPatch?: Partial<AssetExtraMeta>) => {
      const asset = getAssetById(id)
      if (!asset) return null
      const match = /^data:image\/(?:png|webp|jpeg);base64,(.+)$/i.exec(pngDataUrl || '')
      if (!match) return null

      const buf = Buffer.from(match[1], 'base64')
      if (buf.length < 32) return null

      const isCad = isCadExt(asset.ext)
      const isVideo = asset.mediaType === 'video'
      const targetDir = isVideo ? getThumbCacheDir() : isCad ? getCadThumbCacheDir() : getModelThumbCacheDir()
      const outPath = path.join(targetDir, `${asset.id}.webp`)
      const relPath = isVideo ? `${asset.id}.webp` : `${isCad ? 'cad' : 'models'}/${asset.id}.webp`

      const img = sharp(buf)
      const meta = await img.metadata()
      await img
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84 })
        .toFile(outPath)

      if (!fs.existsSync(outPath)) return null

      const width = meta.width ?? 480
      const height = meta.height ?? 360
      const versionedThumb = `${relPath}?v=${Date.now()}`
      updateAssetThumbAndDims(asset.id, versionedThumb, width, height)
      let dominantColors: string[] | undefined
      if (isVideo) {
        dominantColors = await extractDominantColors(outPath, 5)
        updateAssetDominantColors(asset.id, dominantColors)
      }
      if (extraMetaPatch && Object.keys(extraMetaPatch).length > 0) {
        mergeAssetExtraMeta(asset.id, extraMetaPatch)
      }
      broadcast('event:thumb-ready', { assetId: asset.id, thumbPath: versionedThumb, width, height, dominantColors })
      return versionedThumb
    }
  )

  ipcMain.handle('assets:getMissingModelThumbs', () => getMissing3DModelThumbs())

  ipcMain.handle('assets:setFavorite', (_e, ids: number[], isFavorite: boolean) => {
    setAssetsFavorite(ids, isFavorite)
    broadcast('event:assets-changed')
  })

  ipcMain.handle('assets:findDuplicates', async () => {
    const candidates = findDuplicateAssetGroups()
    if (candidates.length === 0) return []

    type StattedItem = { asset: (typeof candidates)[number]['items'][number]; size: number; mtimeMs: number }
    const groupsToHash: Array<{ fp: string; items: StattedItem[] }> = []
    const verifiedGroups: typeof candidates = []

    for (const group of candidates) {
      const validItems: StattedItem[] = []
      for (const item of group.items) {
        try {
          const st = await fsp.stat(item.filePath)
          if (st.isFile() && st.size > 0) {
            validItems.push({ asset: item, size: st.size, mtimeMs: Math.floor(st.mtimeMs) })
          }
        } catch {
          // Skip offline / deleted files
        }
      }
      if (validItems.length < 2) continue

      const needsFullSha = validItems.some(
        (v) =>
          v.size > FULL_HASH_THRESHOLD_BYTES ||
          v.size !== v.asset.fileSize ||
          Math.abs(v.mtimeMs - v.asset.modifiedAt) > 1000
      )

      if (!needsFullSha) {
        // <= 128KB and unchanged since scan: computeFingerprint already hashed 100% of file bytes
        verifiedGroups.push({
          fingerprint: group.fingerprint,
          fileSize: validItems[0].size,
          count: validItems.length,
          items: validItems.map((v) => v.asset)
        })
      } else {
        groupsToHash.push({ fp: group.fingerprint, items: validItems })
      }
    }

    if (groupsToHash.length > 0) {
      // Flatten items needing full streaming SHA-256 and compute with bounded 4x concurrency
      const flatTasks: Array<{ item: StattedItem; sha256: string | null }> = []
      for (const g of groupsToHash) {
        for (const it of g.items) {
          flatTasks.push({ item: it, sha256: null })
        }
      }

      let cursor = 0
      const workers = Array.from({ length: Math.min(4, flatTasks.length) }, async () => {
        while (true) {
          const idx = cursor++
          if (idx >= flatTasks.length) break
          const entry = flatTasks[idx]
          entry.sha256 = await computeFullFileSha256(entry.item.asset.filePath)
        }
      })
      await Promise.all(workers)

      const shaByAssetId = new Map<number, string>()
      for (const t of flatTasks) {
        if (t.sha256) {
          shaByAssetId.set(t.item.asset.id, t.sha256)
        }
      }

      for (const g of groupsToHash) {
        const subBuckets = new Map<string, StattedItem[]>()
        for (const it of g.items) {
          const sha = shaByAssetId.get(it.asset.id)
          if (!sha) continue
          const exactKey = `${it.size}:sha256:${sha}`
          let bucket = subBuckets.get(exactKey)
          if (!bucket) {
            bucket = [it]
            subBuckets.set(exactKey, bucket)
          } else {
            bucket.push(it)
          }
        }
        for (const [exactKey, bucket] of subBuckets.entries()) {
          if (bucket.length > 1) {
            verifiedGroups.push({
              fingerprint: exactKey,
              fileSize: bucket[0].size,
              count: bucket.length,
              items: bucket.map((b) => b.asset)
            })
          }
        }
      }
    }

    verifiedGroups.sort((a, b) => (b.items.length - 1) * b.fileSize - (a.items.length - 1) * a.fileSize)
    return verifiedGroups
  })

  ipcMain.handle(
    'assets:mergeDuplicates',
    async (_e, keepId: number, removeIds: number[], moveToTrash: boolean) => {
      const validRemove = removeIds.filter((id) => id !== keepId)
      const keepAsset = getAssetById(keepId)
      if (!keepAsset) {
        return { removed: 0, failed: ['未找到要保留的主文件记录'] }
      }

      // Compute physical identity of the kept file so overlapping source roots / symlinks /
      // Windows case-variant paths can NEVER accidentally trash the kept file on disk!
      const keepNormPath = path.resolve(keepAsset.filePath).toLowerCase()
      let keepRealPath: string | null = null
      let keepDevIno: string | null = null
      if (fs.existsSync(keepAsset.filePath)) {
        try {
          keepRealPath = fs.realpathSync(keepAsset.filePath).toLowerCase()
        } catch {
          keepRealPath = null
        }
        try {
          const st = fs.statSync(keepAsset.filePath)
          if (st.ino) keepDevIno = `${st.dev}:${st.ino}`
        } catch {
          keepDevIno = null
        }
      }

      const isSamePhysicalFile = (candidatePath: string): boolean => {
        if (path.resolve(candidatePath).toLowerCase() === keepNormPath) return true
        if (keepRealPath) {
          try {
            if (fs.realpathSync(candidatePath).toLowerCase() === keepRealPath) return true
          } catch {
            // ignore
          }
        }
        if (keepDevIno) {
          try {
            const st = fs.statSync(candidatePath)
            if (st.ino && `${st.dev}:${st.ino}` === keepDevIno) return true
          } catch {
            // ignore
          }
        }
        return false
      }

      mergeDuplicateMetadata(keepId, validRemove)

      const failed: string[] = []
      const removedIds: number[] = []
      for (const rid of validRemove) {
        const asset = getAssetById(rid)
        if (!asset) continue
        if (moveToTrash && fs.existsSync(asset.filePath)) {
          // If this duplicate DB row points to the exact same physical file as keepAsset,
          // only remove the redundant DB record without trashing the physical file!
          if (isSamePhysicalFile(asset.filePath)) {
            removedIds.push(rid)
            continue
          }
          try {
            await shell.trashItem(asset.filePath)
            removedIds.push(rid)
          } catch {
            failed.push(asset.fileName)
          }
        } else {
          removedIds.push(rid)
        }
      }
      if (removedIds.length > 0) {
        await cleanupThumbsForAssetIds(removedIds)
        deleteAssetsByIds(removedIds)
      }
      broadcast('event:assets-changed')
      return { removed: removedIds.length, failed }
    }
  )

  ipcMain.handle('assets:backfillColors', () => thumbnailQueue.backfillMissingColors())

  // ===================== Groups =====================
  ipcMain.handle('groups:listTree', () => listGroupTree())

  ipcMain.handle('groups:create', (_e, data: { name: string; parentId?: number | null; color?: string }) => {
    const created = createGroup(data)
    broadcast('event:assets-changed')
    return created
  })

  ipcMain.handle(
    'groups:update',
    (_e, id: number, patch: { name?: string; parentId?: number | null; color?: string; sortOrder?: number }) => {
      const updated = updateGroup(id, patch)
      broadcast('event:assets-changed')
      return updated
    }
  )

  ipcMain.handle(
    'groups:reorder',
    (_e, id: number, targetParentId: number | null, orderedSiblingIds: number[]) => {
      reorderGroup(id, targetParentId, orderedSiblingIds)
      broadcast('event:assets-changed')
    }
  )

  ipcMain.handle('groups:delete', (_e, id: number) => {
    deleteGroup(id)
    broadcast('event:assets-changed')
  })

  ipcMain.handle('groups:assignAssets', (_e, assetIds: number[], groupIds: number[]) => {
    assignAssetsToGroups(assetIds, groupIds)
    broadcast('event:assets-changed')
  })

  ipcMain.handle('groups:unassignAssets', (_e, assetIds: number[], groupIds: number[]) => {
    unassignAssetsFromGroups(assetIds, groupIds)
    broadcast('event:assets-changed')
  })

  // ===================== Settings & Maintenance =====================
  ipcMain.handle('settings:getAll', () => {
    const current = getAllSettings()
    const effectiveBackdrop = resolveEffectiveBackdropStyle(current.backdropStyle)
    return effectiveBackdrop === current.backdropStyle
      ? current
      : { ...current, backdropStyle: effectiveBackdrop }
  })

  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => {
    const safePatch: Partial<AppSettings> =
      patch.backdropStyle !== undefined
        ? { ...patch, backdropStyle: resolveEffectiveBackdropStyle(patch.backdropStyle) }
        : patch
    const updated = updateSettings(safePatch)
    const effectiveBackdrop = resolveEffectiveBackdropStyle(updated.backdropStyle)
    const normalized =
      effectiveBackdrop === updated.backdropStyle
        ? updated
        : { ...updated, backdropStyle: effectiveBackdrop }

    if (safePatch.theme !== undefined || safePatch.backdropStyle !== undefined) {
      syncWindowAppearance(normalized.theme, normalized.backdropStyle)
    }
    if (safePatch.closeToTray !== undefined) {
      syncTrayPresence(normalized.closeToTray)
    }
    if (safePatch.autoLaunch !== undefined) {
      syncAutoLaunch(normalized.autoLaunch)
    }
    if (safePatch.quickSearchEnabled !== undefined || safePatch.quickSearchShortcut !== undefined) {
      syncQuickSearchShortcut(
        Boolean(normalized.quickSearchEnabled),
        normalized.quickSearchShortcut || 'Alt+Space'
      )
    }
    if (safePatch.ffmpegPath !== undefined) {
      await resolveFfmpeg(true)
    }
    if (safePatch.includeOtherFiles !== undefined) {
      broadcast('event:assets-changed')
    }
    return normalized
  })

  ipcMain.handle('settings:getCacheStats', async (): Promise<CacheStats> => {
    const cacheDir = getThumbCacheDir()
    const dbPath = getDbPath()
    let thumbCount = 0
    let thumbBytes = 0
    const dirsToScan = [cacheDir, ...THUMB_SUBDIRS.map((sub) => path.join(cacheDir, sub))]
    for (const dir of dirsToScan) {
      try {
        const files = await fsp.readdir(dir)
        for (const f of files) {
          if (!THUMB_FILE_PATTERN.test(f)) continue
          try {
            const st = await fsp.stat(path.join(dir, f))
            if (st.isFile()) {
              thumbCount++
              thumbBytes += st.size
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
    let dbBytes = 0
    try {
      dbBytes = (await fsp.stat(dbPath)).size
    } catch {
      // ignore
    }
    return { thumbCount, thumbBytes, dbBytes, cacheDir, dbPath }
  })

  ipcMain.handle('settings:clearThumbCache', async () => {
    thumbnailQueue.clear()
    const cacheDir = getThumbCacheDir()
    const dirsToClear = [cacheDir, ...THUMB_SUBDIRS.map((sub) => path.join(cacheDir, sub))]
    for (const dir of dirsToClear) {
      try {
        const files = await fsp.readdir(dir)
        await Promise.all(
          files
            .filter((f) => THUMB_FILE_PATTERN.test(f))
            .map((f) => fsp.unlink(path.join(dir, f)).catch(() => undefined))
        )
      } catch {
        // ignore
      }
    }
    getDb().prepare('UPDATE assets SET thumb_path = NULL').run()
    broadcast('event:assets-changed')
  })

  ipcMain.handle('settings:pickAndMoveThumbCacheDir', async (): Promise<MoveThumbCacheResult | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: '选择缩略图缓存存放目录（将自动迁移已有缩略图）',
      defaultPath: getThumbCacheDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null

    const chosen = path.resolve(res.filePaths[0])
    const oldDir = path.resolve(getThumbCacheDir())
    if (chosen.toLowerCase() === oldDir.toLowerCase()) return null

    thumbnailQueue.clear()
    const result = await migrateThumbCacheFiles(oldDir, chosen)
    setThumbCacheDir(chosen)
    updateSettings({ thumbCacheDir: chosen })
    broadcast('event:assets-changed')
    return result
  })

  ipcMain.handle('settings:resetThumbCacheDir', async (): Promise<MoveThumbCacheResult | null> => {
    const oldDir = path.resolve(getThumbCacheDir())
    const defaultDir = path.resolve(getDefaultThumbCacheDir())
    if (oldDir.toLowerCase() === defaultDir.toLowerCase()) {
      updateSettings({ thumbCacheDir: '' })
      return null
    }

    thumbnailQueue.clear()
    const result = await migrateThumbCacheFiles(oldDir, defaultDir)
    setThumbCacheDir('')
    updateSettings({ thumbCacheDir: '' })
    broadcast('event:assets-changed')
    return result
  })

  ipcMain.handle('settings:rebuildMissingThumbs', () => {
    const missing = getAssetsMissingThumbs()
    for (const m of missing) {
      thumbnailQueue.enqueue({
        assetId: m.id,
        filePath: m.filePath,
        ext: m.ext,
        mediaType: m.mediaType
      })
    }
    return missing.length
  })

  ipcMain.handle('settings:exportDbBackup', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const dateStr = new Date().toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog(win, {
      title: '导出资源库数据库备份',
      defaultPath: `prismvault-backup-${dateStr}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    })
    if (res.canceled || !res.filePath) return null
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE);')
    await fsp.copyFile(getDbPath(), res.filePath)
    return res.filePath
  })

  ipcMain.handle('settings:pickFfmpegPath', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: '选择 ffmpeg 可执行文件',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Executable', extensions: ['exe'] }]
          : [{ name: 'All Files', extensions: ['*'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  // ===================== System =====================
  ipcMain.handle('system:revealInExplorer', (_e, filePath: string) => {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    } else {
      const dir = path.dirname(filePath)
      if (fs.existsSync(dir)) shell.openPath(dir)
    }
  })

  ipcMain.handle('system:openExternal', async (_e, filePath: string) => {
    if (fs.existsSync(filePath)) {
      await shell.openPath(filePath)
    }
  })

  ipcMain.handle('system:openExternalUrl', async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle('system:copyPath', (_e, filePath: string) => {
    clipboard.writeText(filePath)
  })

  ipcMain.handle(
    'system:copyFilesToClipboard',
    async (_e, filePaths: string[], mode: 'file' | 'image' = 'file'): Promise<{ ok: boolean; error?: string }> => {
      const existing = filePaths.filter((p) => p && fs.existsSync(p))
      if (existing.length === 0) {
        return { ok: false, error: '文件不存在或已离线' }
      }

      if (mode === 'image' && existing.length === 1) {
        const singlePath = existing[0]
        const ext = path.extname(singlePath)
        if (isPsdExt(ext)) {
          const psdPng = await renderPsdToPngBuffer(singlePath, 2560)
          if (psdPng) {
            const img = nativeImage.createFromBuffer(psdPng)
            if (!img.isEmpty()) {
              clipboard.writeImage(img)
              return { ok: true }
            }
          }
          return { ok: false, error: '无法将此 PSD/PSB 文件渲染为剪贴板图像' }
        }

        try {
          const pngBuf = await sharp(singlePath, { failOn: 'none', pages: 1 }).rotate().png().toBuffer()
          const img = nativeImage.createFromBuffer(pngBuf)
          if (!img.isEmpty()) {
            clipboard.writeImage(img)
            return { ok: true }
          }
        } catch {
          // fallback to nativeImage directly
          const img = nativeImage.createFromPath(singlePath)
          if (!img.isEmpty()) {
            clipboard.writeImage(img)
            return { ok: true }
          }
        }
        return { ok: false, error: '无法将此文件转为剪贴板图像' }
      }

      if (process.platform === 'win32') {
        // Stream UTF-8 JSON via stdin to completely bypass Win32's 32,767-char command-line limit
        const psScript = [
          '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
          'Add-Type -AssemblyName System.Windows.Forms',
          '$json = [Console]::In.ReadToEnd()',
          '$paths = ConvertFrom-Json $json',
          'if ($paths -is [string]) { $paths = @($paths) }',
          '$list = New-Object System.Collections.Specialized.StringCollection',
          'foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { [void]$list.Add($p) } }',
          'if ($list.Count -gt 0) { [System.Windows.Forms.Clipboard]::SetFileDropList($list) }'
        ].join('; ')

        return new Promise((resolve) => {
          let settled = false
          const finish = (res: { ok: boolean; error?: string }) => {
            if (settled) return
            settled = true
            resolve(res)
          }

          try {
            const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', psScript], {
              windowsHide: true,
              stdio: ['pipe', 'ignore', 'ignore']
            })
            const timer = setTimeout(() => {
              try {
                child.kill()
              } catch {
                // ignore
              }
              clipboard.writeText(existing.join('\n'))
              finish({ ok: false, error: '复制文件到系统剪贴板超时' })
            }, 10000)

            child.on('error', () => {
              clearTimeout(timer)
              clipboard.writeText(existing.join('\n'))
              finish({ ok: false, error: '复制文件到系统剪贴板失败' })
            })
            child.on('close', (code) => {
              clearTimeout(timer)
              if (code === 0) {
                finish({ ok: true })
              } else {
                clipboard.writeText(existing.join('\n'))
                finish({ ok: false, error: '复制文件到系统剪贴板失败' })
              }
            })

            child.stdin.on('error', () => undefined)
            child.stdin.end(Buffer.from(JSON.stringify(existing), 'utf8'))
          } catch {
            clipboard.writeText(existing.join('\n'))
            finish({ ok: false, error: '复制文件到系统剪贴板失败' })
          }
        })
      }

      clipboard.writeText(existing.join('\n'))
      return { ok: true }
    }
  )

  ipcMain.on('system:startDragOut', (event, filePaths: string[], thumbPath?: string | null) => {
    const notifyDragEnded = () => {
      setTimeout(() => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('event:drag-out-ended')
        }
      }, 160)
    }

    const existing = (Array.isArray(filePaths) ? filePaths : []).filter((p) => p && fs.existsSync(p))
    if (existing.length === 0) {
      notifyDragEnded()
      return
    }

    let iconImg: Electron.NativeImage | null = null
    const cleanThumb = stripThumbVersion(thumbPath)
    if (cleanThumb) {
      const thumbFull = path.join(getThumbCacheDir(), cleanThumb)
      if (fs.existsSync(thumbFull)) {
        try {
          const loaded = nativeImage.createFromBuffer(fs.readFileSync(thumbFull))
          if (!loaded.isEmpty()) {
            iconImg = loaded.resize({ width: 64, height: 64, quality: 'good' })
          }
        } catch {
          iconImg = null
        }
      }
    }
    if (!iconImg || iconImg.isEmpty()) {
      const candidates = [
        path.join(__dirname, '../../resources/icon.png'),
        path.join(process.resourcesPath || '', 'icon.png')
      ]
      const iconPath = candidates.find((p) => p && fs.existsSync(p))
      if (iconPath) {
        try {
          iconImg = nativeImage.createFromBuffer(fs.readFileSync(iconPath)).resize({ width: 48, height: 48 })
        } catch {
          iconImg = nativeImage.createEmpty()
        }
      } else {
        iconImg = nativeImage.createEmpty()
      }
    }

    try {
      event.sender.startDrag({
        file: existing[0],
        files: existing,
        icon: iconImg
      })
    } catch {
      // ignore drag errors
    } finally {
      if (process.platform === 'win32') {
        notifyDragEnded()
      }
    }
  })

  ipcMain.handle('quickSearch:hide', () => {
    hideQuickSearchWindow()
  })

  ipcMain.handle('quickSearch:openAssetInMain', (_e, assetId: number) => {
    openAssetInMainWindow(assetId)
  })

  ipcMain.handle('quickSearch:getShortcutStatus', () => getQuickSearchShortcutStatus())

  ipcMain.handle('system:checkFfmpeg', () => resolveFfmpeg(true))
  ipcMain.handle('system:getAppInfo', () => getAppInfo())

  // ===================== Cloud Updater (GitHub Releases) =====================
  ipcMain.handle('updater:getState', () => cloudUpdater.getState())
  ipcMain.handle('updater:check', (_e, opts?: { silent?: boolean }) => cloudUpdater.checkForUpdates(opts))
  ipcMain.handle('updater:download', (_e, kind?: 'installer' | 'portable') => cloudUpdater.downloadUpdate(kind))
  ipcMain.handle('updater:cancelDownload', () => cloudUpdater.cancelDownload())
  ipcMain.handle('updater:install', () => cloudUpdater.installDownloadedUpdate())
  ipcMain.handle('updater:openReleasesPage', () => cloudUpdater.openReleasesPage())

  // ===================== Clipboard & Drag-Drop Multi-File Import =====================
  ipcMain.handle('clipboard:inspect', () => inspectClipboard())

  ipcMain.handle('clipboard:inspectPaths', (_e, paths: string[]) => inspectImportPaths(paths))

  ipcMain.handle(
    'clipboard:commitImport',
    async (
      _e,
      opts: {
        targetGroupId?: number | null
        filePaths?: string[]
        resolutions?: Record<string, 'replace' | 'skip' | 'keep_both'>
      }
    ) => {
      const res = await commitClipboardImport(opts)
      if (res.ok) {
        broadcast('event:assets-changed')
      }
      return res
    }
  )

  ipcMain.handle('clipboard:getStats', () => getClipboardStats())

  ipcMain.handle('clipboard:pickAndMoveDir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const current = await getClipboardStats()
    const res = await dialog.showOpenDialog(win, {
      title: '选择剪贴板图片存放目录（将自动迁移已有图片）',
      defaultPath: current.dir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const chosen = path.resolve(res.filePaths[0])
    if (chosen.toLowerCase() === current.dir.toLowerCase()) return null

    const result = await migrateClipboardDir(chosen, false)
    broadcast('event:assets-changed')
    return result
  })

  ipcMain.handle('clipboard:resetDir', async () => {
    const current = await getClipboardStats()
    if (!current.isCustom) return null
    const result = await migrateClipboardDir('', true)
    broadcast('event:assets-changed')
    return result
  })

  // ===================== Eagle Lossless Migration =====================
  ipcMain.handle('eagle:pickLibrary', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: '选择 Eagle 资源库目录（如 xxx.library）',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return inspectEagleLibrary(res.filePaths[0])
  })

  ipcMain.handle('eagle:pickTargetDir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: '选择迁移后文件的存放目录（如 E:\\素材库）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return path.resolve(res.filePaths[0])
  })

  ipcMain.handle(
    'eagle:migrate',
    async (_e, opts: { eagleDir: string; targetDir: string; deleteOriginals: boolean }) => {
      const result = await migrateFromEagle(opts, (progress) => {
        broadcast('event:eagle-progress', progress)
      })
      broadcast('event:assets-changed')
      return result
    }
  )
}
