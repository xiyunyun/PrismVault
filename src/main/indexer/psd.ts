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

export async function extractPsdMetadata(filePath: string): Promise<PsdMetaInfo> {
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
      width: psd.width || null,
      height: psd.height || null,
      layerCount,
      layerNames,
      colorMode: psd.colorMode != null ? COLOR_MODE_NAMES[psd.colorMode] ?? String(psd.colorMode) : undefined,
      bitsPerChannel: psd.bitsPerChannel
    }
  } catch {
    return { width: null, height: null, layerCount: 0, layerNames: [] }
  }
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
  try {
    const buf = await fsp.readFile(filePath)

    // Fast path: read embedded composite image only
    const psd = readPsd(buf, {
      skipLayerImageData: true,
      skipThumbnail: true,
      useImageData: true
    })

    if (psd.imageData && psd.imageData.width > 0 && psd.imageData.height > 0) {
      const rawBuf = toRgba8Buffer(psd.imageData.data)
      await sharp(rawBuf, {
        raw: {
          width: psd.imageData.width,
          height: psd.imageData.height,
          channels: 4
        }
      })
        .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(outputPath)

      return { width: psd.width || psd.imageData.width, height: psd.height || psd.imageData.height, ok: true }
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
      return { width: null, height: null, ok: false }
    }

    const visibleLayers: Layer[] = []
    collectVisibleImageLayers(fullPsd.children, visibleLayers)
    if (visibleLayers.length === 0) {
      return { width: canvasW, height: canvasH, ok: false }
    }

    const composites: sharp.OverlayOptions[] = []
    for (const layer of visibleLayers) {
      const imgData = layer.imageData!
      const lw = imgData.width
      const lh = imgData.height
      const left = Math.round(layer.left ?? 0)
      const top = Math.round(layer.top ?? 0)

      // Compute visible crop within canvas bounds
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
      return { width: canvasW, height: canvasH, ok: false }
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

    await sharp(compositedBuf)
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toFile(outputPath)

    return { width: canvasW, height: canvasH, ok: true }
  } catch {
    return { width: null, height: null, ok: false }
  }
}
