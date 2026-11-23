import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Worker } from 'worker_threads'
import sharp from 'sharp'
import type { CadPreviewData } from '@shared/types'
import { isDxfExt } from '@shared/mediaTypes'
import { extractDwgEmbeddedPreviewFast } from './dwgHeaderPreview'

const WORKER_TIMEOUT_MS = 35_000
const MAX_BG_VECTOR_THUMB_BYTES = 12 * 1024 * 1024 // 12 MB cap for background vector thumb generation
const MAX_CACHE_ENTRIES = 3
const MAX_CACHE_BYTES = 80 * 1024 * 1024 // 80 MB total RAM budget for parsed CAD vector batches

function estimateCadDataBytes(data: CadPreviewData): number {
  let bytes = 0
  for (const b of data.batches) {
    bytes += b.segments.byteLength
  }
  bytes += data.texts.length * 160
  if (data.embeddedPreviewDataUrl) {
    bytes += data.embeddedPreviewDataUrl.length * 2
  }
  return bytes
}

interface PendingJob {
  id: number
  filePath: string
  resolve: (data: CadPreviewData) => void
  timer: ReturnType<typeof setTimeout>
}

class CadWorkerPool {
  private worker: Worker | null = null
  private seq = 0
  private activeJob: PendingJob | null = null
  private queue: Array<{ filePath: string; resolve: (data: CadPreviewData) => void }> = []
  private cache = new Map<string, { data: CadPreviewData; bytes: number }>()
  private cacheTotalBytes = 0

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const rawWorkerPath = path.join(__dirname, 'cadWorker.js')
    const unpackedWorkerPath = rawWorkerPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    const workerPath = fs.existsSync(unpackedWorkerPath) ? unpackedWorkerPath : rawWorkerPath
    const w = new Worker(workerPath)

    w.on('message', (msg: { id: number; result: CadPreviewData }) => {
      if (this.activeJob && this.activeJob.id === msg.id) {
        const job = this.activeJob
        this.activeJob = null
        clearTimeout(job.timer)
        job.resolve(msg.result)
        this.pump()
      }
    })

    w.on('error', (err) => {
      this.handleWorkerCrash(`CAD 解析工作线程异常：${err.message}`)
    })

    w.on('exit', (code) => {
      if (this.worker === w) {
        this.worker = null
      }
      if (this.activeJob && code !== 0) {
        this.handleWorkerCrash('CAD 解析工作线程意外退出（文件可能损坏或超出 WASM 内存限制）。')
      }
    })

    this.worker = w
    return w
  }

  private handleWorkerCrash(reason: string): void {
    const failedJob = this.activeJob
    this.activeJob = null
    if (failedJob) {
      clearTimeout(failedJob.timer)
      const fmt = isDxfExt(path.extname(failedJob.filePath)) ? 'dxf' : 'dwg'
      failedJob.resolve({
        ok: false,
        format: fmt,
        layers: [],
        batches: [],
        texts: [],
        bounds: null,
        entityCount: 0,
        segmentCount: 0,
        blockCount: 0,
        embeddedPreviewDataUrl: null,
        error: reason
      })
    }
    if (this.worker) {
      this.worker.terminate().catch(() => undefined)
      this.worker = null
    }
    this.pump()
  }

  private putCache(key: string, data: CadPreviewData): void {
    const bytes = estimateCadDataBytes(data)
    const prev = this.cache.get(key)
    if (prev) {
      this.cacheTotalBytes -= prev.bytes
      this.cache.delete(key)
    }
    // Skip caching single gigantic scenes exceeding total budget so memory frees immediately after preview closes
    if (bytes > MAX_CACHE_BYTES) return

    this.cache.set(key, { data, bytes })
    this.cacheTotalBytes += bytes

    while (this.cache.size > MAX_CACHE_ENTRIES || (this.cacheTotalBytes > MAX_CACHE_BYTES && this.cache.size > 1)) {
      const oldestKey = this.cache.keys().next().value
      if (!oldestKey) break
      const oldest = this.cache.get(oldestKey)
      if (oldest) this.cacheTotalBytes -= oldest.bytes
      this.cache.delete(oldestKey)
    }
  }

  async parse(filePath: string): Promise<CadPreviewData> {
    let cacheKey = ''
    try {
      const st = await fsp.stat(filePath)
      cacheKey = `${path.resolve(filePath).toLowerCase()}::${st.mtimeMs}::${st.size}`
      const hit = this.cache.get(cacheKey)
      if (hit) {
        // Refresh LRU recency
        this.cache.delete(cacheKey)
        this.cache.set(cacheKey, hit)
        return hit.data
      }
    } catch {
      return {
        ok: false,
        format: isDxfExt(path.extname(filePath)) ? 'dxf' : 'dwg',
        layers: [],
        batches: [],
        texts: [],
        bounds: null,
        entityCount: 0,
        segmentCount: 0,
        blockCount: 0,
        embeddedPreviewDataUrl: null,
        error: 'CAD 文件不存在或无法访问。'
      }
    }

    const result = await new Promise<CadPreviewData>((resolve) => {
      this.queue.push({ filePath, resolve })
      this.pump()
    })

    if (result.ok && cacheKey) {
      this.putCache(cacheKey, result)
    }
    return result
  }

  private pump(): void {
    if (this.activeJob || this.queue.length === 0) return
    const next = this.queue.shift()!
    const id = ++this.seq
    const w = this.ensureWorker()

    const timer = setTimeout(() => {
      if (this.activeJob && this.activeJob.id === id) {
        this.handleWorkerCrash('CAD 图纸解析超时（文件过大或实体过于复杂），请尝试切换「内嵌原图」或用系统 CAD 打开。')
      }
    }, WORKER_TIMEOUT_MS)

    this.activeJob = { id, filePath: next.filePath, resolve: next.resolve, timer }
    w.postMessage({ id, filePath: next.filePath })
  }

  dispose(): void {
    if (this.activeJob) {
      clearTimeout(this.activeJob.timer)
      this.activeJob = null
    }
    this.queue = []
    if (this.worker) {
      this.worker.terminate().catch(() => undefined)
      this.worker = null
    }
  }
}

export const cadWorkerPool = new CadWorkerPool()

/**
 * Parses a DWG/DXF file off the main thread and returns Canvas-ready vector batches + layers + embedded preview.
 */
export async function parseCadForPreview(filePath: string): Promise<CadPreviewData> {
  return cadWorkerPool.parse(filePath)
}

/**
 * Lightweight 6-byte header version reader for CAD files during directory scanning.
 */
export async function extractCadHeaderVersion(filePath: string): Promise<string | undefined> {
  if (isDxfExt(path.extname(filePath))) return 'DXF'
  let handle: fsp.FileHandle | null = null
  try {
    handle = await fsp.open(filePath, 'r')
    const buf = Buffer.alloc(6)
    const { bytesRead } = await handle.read(buf, 0, 6, 0)
    if (bytesRead < 6) return undefined
    const magic = buf.toString('ascii')
    const map: Record<string, string> = {
      AC1012: 'R13',
      AC1014: 'R14',
      AC1015: 'AutoCAD 2000',
      AC1018: 'AutoCAD 2004',
      AC1021: 'AutoCAD 2007',
      AC1024: 'AutoCAD 2010',
      AC1027: 'AutoCAD 2013',
      AC1032: 'AutoCAD 2018+'
    }
    return map[magic] ?? magic
  } catch {
    return undefined
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

/**
 * Builds a lightweight rasterized thumbnail WebP from compact CadPreviewData batches
 * (samples up to 14,000 segments so sharp rasterization finishes in < 80 ms).
 */
async function renderBatchesToWebp(data: CadPreviewData, outWebpPath: string): Promise<{ ok: boolean; width?: number; height?: number }> {
  if (!data.bounds || data.batches.length === 0) return { ok: false }
  const { minX, minY, maxX, maxY } = data.bounds
  const w = Math.max(1e-3, maxX - minX)
  const h = Math.max(1e-3, maxY - minY)

  const padX = w * 0.06
  const padY = h * 0.06
  const vw = w + padX * 2
  const vh = h + padY * 2

  const aspect = vw / vh
  let pxW = 480
  let pxH = 360
  if (aspect >= 1) {
    pxW = 480
    pxH = Math.max(180, Math.min(480, Math.round(480 / aspect)))
  } else {
    pxH = 480
    pxW = Math.max(180, Math.min(480, Math.round(480 * aspect)))
  }

  const scale = Math.min((pxW - 20) / vw, (pxH - 20) / vh)
  const offsetX = pxW * 0.5 - ((minX + maxX) * 0.5) * scale
  const offsetY = pxH * 0.5 + ((minY + maxY) * 0.5) * scale

  const totalSegs = Math.max(1, data.segmentCount)
  const stride = Math.max(1, Math.ceil(totalSegs / 14000))

  const pathParts: string[] = []
  for (const batch of data.batches) {
    const segs = batch.segments
    const stroke = batch.color === 'default' || batch.color === '#000000' ? '#e2e8f0' : batch.color
    const cmds: string[] = []
    for (let i = 0; i < segs.length; i += 4 * stride) {
      const sx1 = (segs[i] * scale + offsetX).toFixed(1)
      const sy1 = (-segs[i + 1] * scale + offsetY).toFixed(1)
      const sx2 = (segs[i + 2] * scale + offsetX).toFixed(1)
      const sy2 = (-segs[i + 3] * scale + offsetY).toFixed(1)
      cmds.push(`M${sx1} ${sy1}L${sx2} ${sy2}`)
    }
    if (cmds.length > 0) {
      pathParts.push(`<path d="${cmds.join('')}" stroke="${stroke}" />`)
    }
  }

  if (pathParts.length === 0) return { ok: false }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">
    <rect width="100%" height="100%" fill="#141923" />
    <g fill="none" stroke-width="1.25" stroke-linecap="round">${pathParts.join('')}</g>
  </svg>`

  await sharp(Buffer.from(svg, 'utf8')).webp({ quality: 84 }).toFile(outWebpPath)
  return { ok: fs.existsSync(outWebpPath), width: pxW, height: pxH }
}

/**
 * Generates CAD thumbnail into `thumbs/cad/<assetId>.webp`.
 * Fast-path: for `.dwg`, extracts embedded AutoCAD preview image in < 5ms without launching WASM!
 * Falls back to off-thread vector rasterization for `.dxf` or `.dwg` without embedded preview (<= 12 MB).
 */
export async function renderCadToWebp(
  filePath: string,
  outWebpPath: string
): Promise<{
  ok: boolean
  width?: number | null
  height?: number | null
  meta?: {
    cadVersion?: string
    cadEntityCount?: number
    cadLayerCount?: number
    cadBlockCount?: number
    cadLayers?: string[]
    cadHasEmbeddedPreview?: boolean
  }
}> {
  try {
    fs.mkdirSync(path.dirname(outWebpPath), { recursive: true })
    const isDxf = isDxfExt(path.extname(filePath))

    // 1. Ultra-fast zero-WASM embedded preview path for DWG (keeps folder scanning instant!)
    if (!isDxf) {
      const fastPng = await extractDwgEmbeddedPreviewFast(filePath)
      if (fastPng) {
        const img = sharp(fastPng)
        const info = await img.metadata()
        await img
          .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 84 })
          .toFile(outWebpPath)
        if (fs.existsSync(outWebpPath)) {
          const cadVersion = await extractCadHeaderVersion(filePath)
          return {
            ok: true,
            width: info.width ?? null,
            height: info.height ?? null,
            meta: {
              cadVersion,
              cadHasEmbeddedPreview: true
            }
          }
        }
      }
    }

    // 2. Off-thread Worker vector parse for DXF or DWG lacking embedded preview (guarded by file size)
    const st = await fsp.stat(filePath)
    if (st.size > MAX_BG_VECTOR_THUMB_BYTES) {
      // Huge DWG without embedded preview: thumbnail will be captured on first preview open
      return { ok: false }
    }

    const parsed = await cadWorkerPool.parse(filePath)
    const meta = {
      cadVersion: parsed.version,
      cadEntityCount: parsed.entityCount,
      cadLayerCount: parsed.layers.length,
      cadBlockCount: parsed.blockCount,
      cadLayers: parsed.layers.slice(0, 40).map((l) => l.name),
      cadHasEmbeddedPreview: Boolean(parsed.embeddedPreviewDataUrl)
    }

    if (parsed.ok && parsed.batches.length > 0 && parsed.bounds) {
      const rendered = await renderBatchesToWebp(parsed, outWebpPath)
      if (rendered.ok) {
        return { ok: true, width: rendered.width ?? null, height: rendered.height ?? null, meta }
      }
    }

    if (parsed.embeddedPreviewDataUrl) {
      const b64 = parsed.embeddedPreviewDataUrl.split(',')[1]
      if (b64) {
        const buf = Buffer.from(b64, 'base64')
        const img = sharp(buf)
        const info = await img.metadata()
        await img
          .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 84 })
          .toFile(outWebpPath)
        if (fs.existsSync(outWebpPath)) {
          return { ok: true, width: info.width ?? null, height: info.height ?? null, meta }
        }
      }
    }

    return { ok: false, meta }
  } catch {
    return { ok: false }
  }
}
