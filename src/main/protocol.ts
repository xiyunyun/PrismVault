import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { protocol } from 'electron'
import sharp from 'sharp'
import { getThumbCacheDir } from './db'
import { getAssetById, getSourceRootById } from './db/repositories'
import { getMimeType, isPsdExt, needsTranscodedImagePreview, type MediaType } from '@shared/mediaTypes'
import { renderPsdToWebp } from './indexer/psd'

export const MEDIA_SCHEME = 'xiyun-media'

const inFlightPreviews = new Map<string, Promise<string | null>>()
const ALLOWED_THUMB_SUBDIRS = new Set(['models', 'cad'])

interface CachedAssetRoute {
  id: number
  rootId: number
  filePath: string
  ext: string
  mediaType: MediaType
  mimeType: string
  modifiedAt: number
}

const MAX_ASSET_CACHE = 512
const assetRouteCache = new Map<number, CachedAssetRoute>()
const rootPathCache = new Map<number, string | null>()

export function invalidateMediaProtocolCache(): void {
  assetRouteCache.clear()
  rootPathCache.clear()
}

function getCachedAssetRoute(assetId: number, bypassCache = false): CachedAssetRoute | null {
  if (!bypassCache) {
    const hit = assetRouteCache.get(assetId)
    if (hit) {
      // Refresh LRU recency
      assetRouteCache.delete(assetId)
      assetRouteCache.set(assetId, hit)
      return hit
    }
  }
  const asset = getAssetById(assetId)
  if (!asset) {
    assetRouteCache.delete(assetId)
    return null
  }
  const entry: CachedAssetRoute = {
    id: asset.id,
    rootId: asset.rootId,
    filePath: asset.filePath,
    ext: asset.ext,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    modifiedAt: asset.modifiedAt
  }
  if (assetRouteCache.has(assetId)) assetRouteCache.delete(assetId)
  assetRouteCache.set(assetId, entry)
  if (assetRouteCache.size > MAX_ASSET_CACHE) {
    const oldest = assetRouteCache.keys().next().value
    if (oldest !== undefined) assetRouteCache.delete(oldest)
  }
  return entry
}

function getCachedRootPath(rootId: number): string | null {
  if (rootPathCache.has(rootId)) return rootPathCache.get(rootId) ?? null
  const sr = getSourceRootById(rootId)
  const p = sr?.path ? path.resolve(sr.path) : null
  rootPathCache.set(rootId, p)
  return p
}

async function statFileAsync(filePath: string): Promise<fs.Stats | null> {
  try {
    const st = await fsp.stat(filePath)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

function resolveSafeThumbPath(rawParam: string): string | null {
  const normalized = rawParam.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || segments.length > 2) return null
  if (segments.some((s) => s === '.' || s === '..' || s.includes(':'))) return null

  const rootDir = path.resolve(getThumbCacheDir())
  let targetPath: string
  if (segments.length === 1) {
    targetPath = path.resolve(rootDir, segments[0])
  } else {
    if (!ALLOWED_THUMB_SUBDIRS.has(segments[0])) return null
    targetPath = path.resolve(rootDir, segments[0], segments[1])
  }

  if (!targetPath.toLowerCase().startsWith(rootDir.toLowerCase() + path.sep)) return null
  return targetPath
}

function isWithinDir(candidate: string, allowedRoot: string): boolean {
  const c = path.resolve(candidate).toLowerCase()
  const r = path.resolve(allowedRoot).toLowerCase()
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

async function resolveCompanionModelFile(
  assetFilePath: string,
  rootId: number,
  rawRelPath: string
): Promise<{ filePath: string; stat: fs.Stats } | null> {
  const assetDir = path.dirname(path.resolve(assetFilePath))
  const boundaryDir = getCachedRootPath(rootId) ?? assetDir

  const cleaned = rawRelPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned) return null

  // If requesting the exact main model file itself
  const baseRequested = path.basename(cleaned)
  if (cleaned.toLowerCase() === path.basename(assetFilePath).toLowerCase()) {
    const st = await statFileAsync(assetFilePath)
    if (st) return { filePath: assetFilePath, stat: st }
  }

  const candidates: string[] = [
    path.resolve(assetDir, cleaned),
    path.resolve(assetDir, baseRequested),
    path.resolve(assetDir, 'textures', baseRequested),
    path.resolve(assetDir, 'Textures', baseRequested),
    path.resolve(assetDir, '..', 'textures', baseRequested),
    path.resolve(assetDir, '..', 'Textures', baseRequested)
  ]

  for (const cand of candidates) {
    if (!isWithinDir(cand, boundaryDir) && !isWithinDir(cand, assetDir)) continue
    const st = await statFileAsync(cand)
    if (st) return { filePath: cand, stat: st }
  }
  return null
}

function createSafeFileStream(filePath: string, options?: { start?: number; end?: number }): ReadableStream<Uint8Array> {
  const nodeStream = fs.createReadStream(filePath, options)
  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
}

async function ensureHighResPreview(assetId: number, filePath: string, ext: string, modifiedAt: number): Promise<string | null> {
  const cacheName = `preview_${assetId}_${modifiedAt}.webp`
  const cachePath = path.join(getThumbCacheDir(), cacheName)
  if (await statFileAsync(cachePath)) return cachePath

  const existingTask = inFlightPreviews.get(cachePath)
  if (existingTask) return existingTask

  const task = (async (): Promise<string | null> => {
    try {
      await fsp.mkdir(getThumbCacheDir(), { recursive: true })
      if (isPsdExt(ext)) {
        const res = await renderPsdToWebp(filePath, cachePath, 2560, 2560, 90)
        return res.ok && (await statFileAsync(cachePath)) ? cachePath : null
      }
      // TIFF / TIF high-res decode via sharp
      await sharp(filePath, { failOn: 'none', pages: 1 })
        .rotate()
        .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toFile(cachePath)
      return (await statFileAsync(cachePath)) ? cachePath : null
    } catch {
      return null
    } finally {
      inFlightPreviews.delete(cachePath)
    }
  })()

  inFlightPreviews.set(cachePath, task)
  return task
}

/**
 * Registers the zero-copy `xiyun-media://` custom protocol.
 * - `xiyun-media://file/<assetId>`: streams directly from the original disk path with full HTTP Range (206) support.
 *   For browser-incompatible image formats (PSD/PSB/TIFF), transparently serves a cached high-res rendered WebP preview.
 * - `xiyun-media://thumb/<filename>`: serves cached WebP thumbnails.
 */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const host = url.hostname // 'file', 'thumb', or 'asset-<id>'
      const rawParam = decodeURIComponent(url.pathname.replace(/^\/+/, ''))

      if (host === 'thumb') {
        const thumbPath = resolveSafeThumbPath(rawParam)
        if (!thumbPath) {
          return new Response('Thumbnail not found', { status: 404 })
        }
        const stat = await statFileAsync(thumbPath)
        if (!stat) {
          return new Response('Thumbnail not found', { status: 404 })
        }
        return new Response(createSafeFileStream(thumbPath), {
          status: 200,
          headers: {
            'Content-Type': 'image/webp',
            'Content-Length': String(stat.size),
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      if (host.startsWith('asset-')) {
        const assetId = Number(host.slice(6))
        if (!Number.isFinite(assetId)) {
          return new Response('Invalid asset id', { status: 400 })
        }
        let asset = getCachedAssetRoute(assetId)
        if (!asset) {
          return new Response('Asset not found', { status: 404 })
        }
        let resolved = await resolveCompanionModelFile(asset.filePath, asset.rootId, rawParam)
        if (!resolved) {
          // Retry once bypassing cache in case file was recently moved/relinked
          asset = getCachedAssetRoute(assetId, true)
          if (asset) {
            resolved = await resolveCompanionModelFile(asset.filePath, asset.rootId, rawParam)
          }
        }
        if (!resolved) {
          return new Response('Companion file not found', { status: 404 })
        }
        const contentType = getMimeType(path.extname(resolved.filePath))
        return new Response(createSafeFileStream(resolved.filePath), {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(resolved.stat.size),
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      if (host === 'file') {
        const assetId = Number(rawParam)
        if (!Number.isFinite(assetId)) {
          return new Response('Invalid asset id', { status: 400 })
        }
        let asset = getCachedAssetRoute(assetId)
        if (!asset) {
          return new Response('File not found', { status: 404 })
        }
        let stat = await statFileAsync(asset.filePath)
        if (!stat) {
          // Retry once bypassing cache in case file was relinked or moved
          asset = getCachedAssetRoute(assetId, true)
          if (!asset) return new Response('File not found', { status: 404 })
          stat = await statFileAsync(asset.filePath)
          if (!stat) return new Response('File not found', { status: 404 })
        }

        // Transparently serve high-res decoded WebP for PSD / PSB / TIFF images
        if (asset.mediaType === 'image' && needsTranscodedImagePreview(asset.ext)) {
          const previewPath = await ensureHighResPreview(asset.id, asset.filePath, asset.ext, asset.modifiedAt)
          if (!previewPath) {
            return new Response('Failed to render image preview', { status: 422 })
          }
          const previewStat = await statFileAsync(previewPath)
          if (!previewStat) {
            return new Response('Failed to render image preview', { status: 422 })
          }
          return new Response(createSafeFileStream(previewPath), {
            status: 200,
            headers: {
              'Content-Type': 'image/webp',
              'Content-Length': String(previewStat.size),
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*'
            }
          })
        }

        const total = stat.size
        const contentType = asset.mimeType || 'application/octet-stream'
        const rangeHeader = request.headers.get('range')

        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
          if (match) {
            const start = match[1] ? Number(match[1]) : 0
            const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1
            if (start >= total || start > end) {
              return new Response('Requested range not satisfiable', {
                status: 416,
                headers: { 'Content-Range': `bytes */${total}` }
              })
            }
            const chunkSize = end - start + 1
            return new Response(createSafeFileStream(asset.filePath, { start, end }), {
              status: 206,
              headers: {
                'Content-Type': contentType,
                'Content-Length': String(chunkSize),
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache'
              }
            })
          }
        }

        return new Response(createSafeFileStream(asset.filePath), {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(total),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      return new Response('Not found', { status: 404 })
    } catch (err) {
      return new Response(`Internal error: ${String(err)}`, { status: 500 })
    }
  })
}
