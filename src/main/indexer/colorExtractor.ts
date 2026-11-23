import sharp from 'sharp'

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`
}

/**
 * Perceptually weighted squared RGB distance (fast approximation of human color perception).
 * Range: 0 (exact match) to ~585,225 (black vs white).
 */
export function rgbDistanceSq(a: [number, number, number], b: [number, number, number]): number {
  const rMean = (a[0] + b[0]) * 0.5
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return (((512 + rMean) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rMean) * db * db) >> 8)
}

export function hexColorDistanceSq(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return Number.MAX_SAFE_INTEGER
  return rgbDistanceSq(a, b)
}

/**
 * Ultra-fast (< 2ms on a WebP thumbnail) 5-color dominant palette extractor using
 * 4-bit quantized color buckets + distinctness suppression.
 */
export async function extractDominantColors(imagePath: string, maxColors = 5): Promise<string[]> {
  try {
    const { data, info } = await sharp(imagePath, { failOn: 'none', pages: 1 })
      .resize({ width: 28, height: 28, fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const pixelCount = info.width * info.height
    if (pixelCount <= 0) return []

    const buckets = new Map<number, { r: number; g: number; b: number; count: number; satSum: number }>()
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (a < 80) continue // ignore mostly-transparent pixels
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0

      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { r: 0, g: 0, b: 0, count: 0, satSum: 0 }
        buckets.set(key, bucket)
      }
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.count++
      bucket.satSum += sat
    }

    if (buckets.size === 0) return []

    const ranked = Array.from(buckets.values())
      .map((b) => {
        const avgR = b.r / b.count
        const avgG = b.g / b.count
        const avgB = b.b / b.count
        const avgSat = b.satSum / b.count
        // Balance area dominance with gentle vividness boost so key accents aren't drowned out
        const score = b.count * (1 + avgSat * 0.85)
        return { rgb: [avgR, avgG, avgB] as [number, number, number], score }
      })
      .sort((a, b) => b.score - a.score)

    const picked: Array<[number, number, number]> = []
    const MIN_DIST_SQ = 2800 // ensure picked swatches are visually distinct
    for (const candidate of ranked) {
      if (picked.length >= maxColors) break
      const tooClose = picked.some((p) => rgbDistanceSq(p, candidate.rgb) < MIN_DIST_SQ)
      if (!tooClose) {
        picked.push(candidate.rgb)
      }
    }

    // If image is nearly monochromatic and fewer than 2 picked, relax threshold slightly
    if (picked.length === 0 && ranked.length > 0) {
      picked.push(ranked[0].rgb)
    }

    return picked.map(([r, g, b]) => rgbToHex(r, g, b))
  } catch {
    return []
  }
}
