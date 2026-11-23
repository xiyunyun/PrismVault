import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import sharp from 'sharp'
import {
  ensureThumbSubdirs,
  getCadThumbCacheDir,
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
  getAllSettings,
  getAssetById,
  getAssetsMissingThumbs,
  getAssetThumbRefsByRootId,
  getLibraryStats,
  getMissing3DModelThumbs,
  listGroupTree,
  listSourceRoots,
  mergeAssetExtraMeta,
  queryAssets,
  removeMissingAssets,
  setAssetsStatus,
  unassignAssetsFromGroups,
  updateAssetNote,
  updateAssetThumbAndDims,
  updateGroup,
  updateSettings,
  updateSourceRoot
} from '../db/repositories'
import { indexScanner } from '../indexer/scanner'
import { thumbnailQueue } from '../indexer/thumbnailer'
import { watcherManager } from '../indexer/watcher'
import { resolveFfmpeg } from '../indexer/ffmpeg'
import { parseCadForPreview } from '../indexer/cad'
import { isCadExt } from '@shared/mediaTypes'
import {
  commitClipboardImport,
  getClipboardStats,
  inspectClipboard,
  inspectImportPaths,
  migrateClipboardDir
} from '../indexer/clipboardImport'
import { inspectEagleLibrary, migrateFromEagle } from '../indexer/eagleMigrator'
import { resolveEffectiveBackdropStyle, syncAutoLaunch, syncTrayPresence, syncWindowAppearance } from '../index'
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

export function registerIpcHandlers(): void {
  // Wire backend events to renderer
  indexScanner.onProgress((progress) => broadcast('event:scan-progress', progress))
  indexScanner.onAssetsChanged(() => broadcast('event:assets-changed'))
  thumbnailQueue.onReady((payload) => broadcast('event:thumb-ready', payload))
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
    const root = createSourceRoot(dirPath, makeFriendlyAlias(dirPath))
    // Kick off scan asynchronously so UI updates immediately
    indexScanner.scanSource(root.id).catch(() => undefined)
    broadcast('event:assets-changed')
    return root
  })

  ipcMain.handle('sources:addPath', (_e, dirPath: string, alias?: string) => {
    const resolved = path.resolve(dirPath)
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

    let removedThumbs = 0
    if (shouldDeleteThumbs && thumbRefs.length > 0) {
      const cacheRoot = path.resolve(getThumbCacheDir())
      const idSet = new Set<number>(thumbRefs.map((r) => r.id))

      // 1. Delete direct thumbnails (including models/<id>.webp and cad/<id>.webp)
      for (const ref of thumbRefs) {
        if (!ref.thumbPath) continue
        const normalized = ref.thumbPath.replace(/\\/g, '/').replace(/^\/+/, '')
        const candidate = path.resolve(cacheRoot, normalized)
        if (!candidate.toLowerCase().startsWith(cacheRoot.toLowerCase() + path.sep)) continue
        try {
          await fsp.unlink(candidate)
          removedThumbs++
        } catch {
          // ignore already-removed or missing thumb
        }
      }

      // 2. Also remove any high-res transcoded PSD/TIFF preview caches (preview_<assetId>_<mtime>.webp)
      try {
        const rootFiles = await fsp.readdir(cacheRoot)
        for (const f of rootFiles) {
          const m = /^preview_(\d+)_\d+\.webp$/i.exec(f)
          if (m && idSet.has(Number(m[1]))) {
            try {
              await fsp.unlink(path.join(cacheRoot, f))
              removedThumbs++
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
    }

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

  ipcMain.handle('assets:removeMissing', (_e, ids?: number[]) => {
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
    const readSize = Math.min(totalBytes, MAX_TEXT_READ_BYTES)
    const handle = await fsp.open(asset.filePath, 'r')
    try {
      const buf = Buffer.alloc(readSize)
      const { bytesRead } = await handle.read(buf, 0, readSize, 0)
      return {
        content: buf.subarray(0, bytesRead).toString('utf8'),
        truncated: totalBytes > MAX_TEXT_READ_BYTES,
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
      const subDir = isCad ? 'cad' : 'models'
      const targetDir = isCad ? getCadThumbCacheDir() : getModelThumbCacheDir()
      const outPath = path.join(targetDir, `${asset.id}.webp`)
      const relPath = `${subDir}/${asset.id}.webp`

      const img = sharp(buf)
      const meta = await img.metadata()
      await img
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84 })
        .toFile(outPath)

      if (!fs.existsSync(outPath)) return null

      const width = meta.width ?? 480
      const height = meta.height ?? 360
      updateAssetThumbAndDims(asset.id, relPath, width, height)
      if (extraMetaPatch && Object.keys(extraMetaPatch).length > 0) {
        mergeAssetExtraMeta(asset.id, extraMetaPatch)
      }
      broadcast('event:thumb-ready', { assetId: asset.id, thumbPath: relPath, width, height })
      return relPath
    }
  )

  ipcMain.handle('assets:getMissingModelThumbs', () => getMissing3DModelThumbs())

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
    if (safePatch.ffmpegPath !== undefined) {
      await resolveFfmpeg(true)
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
