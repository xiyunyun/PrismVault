import fsp from 'fs/promises'
import sharp from 'sharp'
import { initializeCanvas, readPsd, type Layer } from 'ag-psd'

// Register pure-JS ImageData allocator for Node/Electron main process (no node-canvas needed)
initializeCanvas(
  () => {
    throw new Error('Canvas not required when useImageData is true')
  },
  (width: number, height: number) =>
    ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4)
    }) as unknown as ImageData
)

const COLOR_MODE_NAMES: Record<number, string> = {
  0: 'Bitmap',
  1: 'Grayscale',
  2: 'Indexed',
  3: 'RGB',
  4: 'CMYK',
  7: 'Multichannel',
  8: 'Duotone',
  9: 'Lab'
}

export interface PsdMetaInfo {
  width: number | null
  height: number | null
  layerCount: number
  layerNames: string[]
  colorMode?: string
  bitsPerChannel?: number
}

function collectLayers(layers: Layer[] | undefined, acc: string[]): number {
  if (!layers || layers.length === 0) return 0
  let count = 0
  for (const layer of layers) {
    count++
    if (layer.name && acc.length < 30) {
      acc.push(layer.name)
    }
    if (layer.children && layer.children.length > 0) {
      count += collectLayers(layer.children, acc)
    }
  }
  return count
}

function toRgba8Buffer(data: Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array): Buffer {
  if (data instanceof Uint8ClampedArray || data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  const out = Buffer.allocUnsafe(data.length)
  if (data instanceof Uint16Array) {
    for (let i = 0; i < data.length; i++) {
      out[i] = data[i] >> 8
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      out[i] = Math.min(255, Math.max(0, Math.round(data[i] * 255)))
    }
  }
  return out
}

const MAX_PSD_FULL_META_BYTES = 120 * 1024 * 1024 // 120MB: above this, read 26-byte header only during scan
const MAX_PSD_RENDER_BYTES = 512 * 1024 * 1024 // 512MB safety ceiling for full in-memory buffer decode

// Serialize heavy PSD buffer allocations so concurrent scanner/thumbnail/preview tasks never spike V8 heap together
let psdQueueChain: Promise<void> = Promise.resolve()
function withPsdLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = psdQueueChain.then(fn, fn)
  psdQueueChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

interface PsdFastHeader {
  width: number | null
  height: number | null
  colorMode?: string
  bitsPerChannel?: number
  fileSize: number
}

/**
 * Reads the standard 26-byte Adobe PSD/PSB header in <0.1ms with near-zero memory:
 * [0..3]: '8BPS', [4..5]: version (1=PSD, 2=PSB), [12..13]: channels,
 * [14..17]: height (UInt32BE), [18..21]: width (UInt32BE), [22..23]: depth, [24..25]: colorMode.
 */
async function readPsdHeaderFast(filePath: string): Promise<PsdFastHeader | null> {
  let handle: fsp.FileHandle | null = null
  try {
    const st = await fsp.stat(filePath)
    if (!st.isFile() || st.size < 26) return null
    handle = await fsp.open(filePath, 'r')
    const hdr = Buffer.allocUnsafe(26)
    const { bytesRead } = await handle.read(hdr, 0, 26, 0)
    if (bytesRead < 26) return null
    if (hdr.toString('ascii', 0, 4) !== '8BPS') return null
    const version = hdr.readUInt16BE(4)
    if (version !== 1 && version !== 2) return null
    const height = hdr.readUInt32BE(14)
    const width = hdr.readUInt32BE(18)
    const depth = hdr.readUInt16BE(22)
    const modeCode = hdr.readUInt16BE(24)
    return {
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      bitsPerChannel: depth > 0 ? depth : undefined,
      colorMode: COLOR_MODE_NAMES[modeCode] ?? String(modeCode),
      fileSize: st.size
    }
  } catch {
    return null
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

export async function extractPsdMetadata(filePath: string): Promise<PsdMetaInfo> {
  const hdr = await readPsdHeaderFast(filePath)
  if (!hdr) {
    return { width: null, height: null, layerCount: 0, layerNames: [] }
  }
  if (hdr.fileSize > MAX_PSD_FULL_META_BYTES) {
    return {
      width: hdr.width,
      height: hdr.height,
      layerCount: 0,
      layerNames: [],
      colorMode: hdr.colorMode,
      bitsPerChannel: hdr.bitsPerChannel
    }
  }
  return withPsdLock(async () => {
    try {
      const buf = await fsp.readFile(filePath)
      const psd = readPsd(buf, {
        skipLayerImageData: true,
        skipCompositeImageData: true,
        skipThumbnail: true
      })
      const layerNames: string[] = []
      const layerCount = collectLayers(psd.children, layerNames)
      return {
        width: psd.width || hdr.width,
        height: psd.height || hdr.height,
        layerCount,
        layerNames,
        colorMode:
          psd.colorMode != null ? COLOR_MODE_NAMES[psd.colorMode] ?? String(psd.colorMode) : hdr.colorMode,
        bitsPerChannel: psd.bitsPerChannel ?? hdr.bitsPerChannel
      }
    } catch {
      return {
        width: hdr.width,
        height: hdr.height,
        layerCount: 0,
        layerNames: [],
        colorMode: hdr.colorMode,
        bitsPerChannel: hdr.bitsPerChannel
      }
    }
  })
}

function collectVisibleImageLayers(layers: Layer[] | undefined, out: Layer[]): void {
  if (!layers) return
  for (const layer of layers) {
    if (layer.hidden) continue
    if (layer.children && layer.children.length > 0) {
      collectVisibleImageLayers(layer.children, out)
    } else if (layer.imageData && layer.imageData.width > 0 && layer.imageData.height > 0) {
      out.push(layer)
    }
  }
}

async function decodePsdPipeline(
  filePath: string,
  maxWidth: number,
  maxHeight: number
): Promise<{ pipeline: sharp.Sharp | null; width: number | null; height: number | null }> {
  const hdr = await readPsdHeaderFast(filePath)
  if (!hdr || hdr.fileSize > MAX_PSD_RENDER_BYTES) {
    return { pipeline: null, width: hdr?.width ?? null, height: hdr?.height ?? null }
  }

  const buf = await fsp.readFile(filePath)

  // Fast path: read embedded composite image only
  const psd = readPsd(buf, {
    skipLayerImageData: true,
    skipThumbnail: true,
    useImageData: true
  })

  if (psd.imageData && psd.imageData.width > 0 && psd.imageData.height > 0) {
    const rawBuf = toRgba8Buffer(psd.imageData.data)
    const pipeline = sharp(rawBuf, {
      raw: {
        width: psd.imageData.width,
        height: psd.imageData.height,
        channels: 4
      }
    }).resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
    return {
      pipeline,
      width: psd.width || psd.imageData.width,
      height: psd.height || psd.imageData.height
    }
  }

  // Fallback path: composite visible layers
  const fullPsd = readPsd(buf, {
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: true
  })
  const canvasW = fullPsd.width
  const canvasH = fullPsd.height
  if (!canvasW || !canvasH) {
    return { pipeline: null, width: null, height: null }
  }

  const visibleLayers: Layer[] = []
  collectVisibleImageLayers(fullPsd.children, visibleLayers)
  if (visibleLayers.length === 0) {
    return { pipeline: null, width: canvasW, height: canvasH }
  }

  const composites: sharp.OverlayOptions[] = []
  for (const layer of visibleLayers) {
    const imgData = layer.imageData!
    const lw = imgData.width
    const lh = imgData.height
    const left = Math.round(layer.left ?? 0)
    const top = Math.round(layer.top ?? 0)

    const cropLeft = Math.max(0, -left)
    const cropTop = Math.max(0, -top)
    const visibleW = Math.min(lw - cropLeft, canvasW - Math.max(0, left))
    const visibleH = Math.min(lh - cropTop, canvasH - Math.max(0, top))
    if (visibleW <= 0 || visibleH <= 0) continue

    let layerPipeline = sharp(toRgba8Buffer(imgData.data), {
      raw: { width: lw, height: lh, channels: 4 }
    })
    if (cropLeft > 0 || cropTop > 0 || visibleW !== lw || visibleH !== lh) {
      layerPipeline = layerPipeline.extract({
        left: cropLeft,
        top: cropTop,
        width: visibleW,
        height: visibleH
      })
    }
    const pngLayer = await layerPipeline.png().toBuffer()
    composites.push({
      input: pngLayer,
      left: Math.max(0, left),
      top: Math.max(0, top)
    })
  }

  if (composites.length === 0) {
    return { pipeline: null, width: canvasW, height: canvasH }
  }

  const compositedBuf = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer()

  const pipeline = sharp(compositedBuf).resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true
  })
  return { pipeline, width: canvasW, height: canvasH }
}

/**
 * Renders a PSD/PSB file into a WebP file (thumbnail or high-res inline preview).
 * Prefers the embedded flattened composite image (fast), and falls back to compositing
 * visible layers if the PSD was saved without Maximize Compatibility.
 */
export async function renderPsdToWebp(
  filePath: string,
  outputPath: string,
  maxWidth: number,
  maxHeight: number,
  quality = 84
): Promise<{ width: number | null; height: number | null; ok: boolean }> {
  return withPsdLock(async () => {
    try {
      const { pipeline, width, height } = await decodePsdPipeline(filePath, maxWidth, maxHeight)
      if (!pipeline) {
        return { width, height, ok: false }
      }
      await pipeline.webp({ quality }).toFile(outputPath)
      return { width, height, ok: true }
    } catch {
      return { width: null, height: null, ok: false }
    }
  })
}

/**
 * Renders a PSD/PSB file directly into a PNG Buffer for copying image pixels to system clipboard.
 */
export async function renderPsdToPngBuffer(filePath: string, maxDim = 2560): Promise<Buffer | null> {
  return withPsdLock(async () => {
    try {
      const { pipeline } = await decodePsdPipeline(filePath, maxDim, maxDim)
      if (!pipeline) return null
      return await pipeline.png().toBuffer()
    } catch {
      return null
    }
  })
}
