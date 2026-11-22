import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { protocol } from 'electron'
import sharp from 'sharp'
import { getThumbCacheDir } from './db'
import { getAssetById } from './db/repositories'
import { isPsdExt, needsTranscodedImagePreview } from '@shared/mediaTypes'
import { renderPsdToWebp } from './indexer/psd'

export const MEDIA_SCHEME = 'xiyun-media'

const inFlightPreviews = new Map<string, Promise<string | null>>()

function createSafeFileStream(filePath: string, options?: { start?: number; end?: number }): ReadableStream<Uint8Array> {
  const nodeStream = fs.createReadStream(filePath, options)
  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
}

async function ensureHighResPreview(assetId: number, filePath: string, ext: string, modifiedAt: number): Promise<string | null> {
  const cacheName = `preview_${assetId}_${modifiedAt}.webp`
  const cachePath = path.join(getThumbCacheDir(), cacheName)
  if (fs.existsSync(cachePath)) return cachePath

  const existingTask = inFlightPreviews.get(cachePath)
  if (existingTask) return existingTask

  const task = (async (): Promise<string | null> => {
    try {
      fs.mkdirSync(getThumbCacheDir(), { recursive: true })
      if (isPsdExt(ext)) {
        const res = await renderPsdToWebp(filePath, cachePath, 2560, 2560, 90)
        return res.ok && fs.existsSync(cachePath) ? cachePath : null
      }
      // TIFF / TIF high-res decode via sharp
      await sharp(filePath, { failOn: 'none', pages: 1 })
        .rotate()
        .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toFile(cachePath)
      return fs.existsSync(cachePath) ? cachePath : null
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
      const host = url.hostname // 'file' or 'thumb'
      const rawParam = decodeURIComponent(url.pathname.replace(/^\/+/, ''))

      if (host === 'thumb') {
        const safeName = path.basename(rawParam)
        const thumbPath = path.join(getThumbCacheDir(), safeName)
        if (!fs.existsSync(thumbPath)) {
          return new Response('Thumbnail not found', { status: 404 })
        }
        const stat = fs.statSync(thumbPath)
        return new Response(createSafeFileStream(thumbPath), {
          status: 200,
          headers: {
            'Content-Type': 'image/webp',
            'Content-Length': String(stat.size),
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        })
      }

      if (host === 'file') {
        const assetId = Number(rawParam)
        if (!Number.isFinite(assetId)) {
          return new Response('Invalid asset id', { status: 400 })
        }
        const asset = getAssetById(assetId)
        if (!asset || !fs.existsSync(asset.filePath)) {
          return new Response('File not found', { status: 404 })
        }

        // Transparently serve high-res decoded WebP for PSD / PSB / TIFF images
        if (asset.mediaType === 'image' && needsTranscodedImagePreview(asset.ext)) {
          const previewPath = await ensureHighResPreview(asset.id, asset.filePath, asset.ext, asset.modifiedAt)
          if (!previewPath) {
            return new Response('Failed to render image preview', { status: 422 })
          }
          const stat = fs.statSync(previewPath)
          return new Response(createSafeFileStream(previewPath), {
            status: 200,
            headers: {
              'Content-Type': 'image/webp',
              'Content-Length': String(stat.size),
              'Cache-Control': 'public, max-age=3600'
            }
          })
        }

        const stat = fs.statSync(asset.filePath)
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
            'Cache-Control': 'no-cache'
          }
        })
      }

      return new Response('Not found', { status: 404 })
    } catch (err) {
      return new Response(`Internal error: ${String(err)}`, { status: 500 })
    }
  })
}
