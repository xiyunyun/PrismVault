import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'
import { parentPort } from 'worker_threads'
import DxfParser from 'dxf-parser'
import {
  createModule,
  Dwg_File_Type,
  LibreDwg,
  type DwgDatabase,
  type LibreDwgEx
} from '@mlightcad/libredwg-web'
import type { CadBatch, CadLayerInfo, CadPreviewData, CadTextItem } from '@shared/types'
import { decodeDwgThumbBytesToPng, extractPreviewFromDwgBuffer } from './dwgHeaderPreview'

const require = createRequire(import.meta.url)

const MAX_SEGMENTS = 450_000
const MAX_TEXTS = 6_000
const MAX_INSERT_DEPTH = 8

// Standard AutoCAD Color Index (ACI 1..9)
const ACI_PALETTE: Record<number, string> = {
  1: '#ff4d4f',
  2: '#facc15',
  3: '#4ade80',
  4: '#22d3ee',
  5: '#60a5fa',
  6: '#e879f9',
  7: 'default', // Theme-adaptive foreground (white on dark CAD, black on light paper)
  8: '#9ca3af',
  9: '#d1d5db'
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100
  const lNorm = l / 100
  const a = sNorm * Math.min(lNorm, 1 - lNorm)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function aciToColor(colorIndex?: number | null, rgbInt?: number | null): string {
  if (rgbInt != null && rgbInt > 0 && rgbInt <= 0xffffff) {
    return `#${rgbInt.toString(16).padStart(6, '0')}`
  }
  if (colorIndex == null) return 'default'
  const idx = Math.abs(Math.trunc(colorIndex))
  if (idx === 0 || idx === 256 || idx === 7) return 'default'
  if (ACI_PALETTE[idx]) return ACI_PALETTE[idx]
  if (idx >= 10 && idx <= 249) {
    const hue = ((idx - 10) * 15) % 360
    const light = idx % 2 === 0 ? 62 : 48
    return hslToHex(hue, 75, light)
  }
  if (idx >= 250 && idx <= 255) {
    const gray = Math.round(70 + ((idx - 250) / 5) * 175)
    return `#${gray.toString(16).padStart(2, '0').repeat(3)}`
  }
  return 'default'
}

function cleanCadText(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[fFHWCQATp][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%c/gi, 'Ø')
    .replace(/%%d/gi, '°')
    .replace(/%%p/gi, '±')
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim()
}

// 2D affine matrix: x' = a*x + c*y + tx, y' = b*x + d*y + ty
type Mat2D = [number, number, number, number, number, number]
const IDENTITY_MAT: Mat2D = [1, 0, 0, 1, 0, 0]

function mulMat(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ]
}

function makeInsertMat(
  tx: number,
  ty: number,
  rotationRad: number,
  sx: number,
  sy: number,
  baseX: number,
  baseY: number
): Mat2D {
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  // Translate(tx, ty) * Rotate(rot) * Scale(sx, sy) * Translate(-baseX, -baseY)
  const a = cos * sx
  const b = sin * sx
  const c = -sin * sy
  const d = cos * sy
  const ex = tx - (a * baseX + c * baseY)
  const ey = ty - (b * baseX + d * baseY)
  return [a, b, c, d, ex, ey]
}

function applyMatX(m: Mat2D, x: number, y: number): number {
  return m[0] * x + m[2] * y + m[4]
}
function applyMatY(m: Mat2D, x: number, y: number): number {
  return m[1] * x + m[3] * y + m[5]
}

function isFiniteCoord(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e12 && Math.abs(y) < 1e12
}

interface RawSegmentCollector {
  groups: Map<string, { layerIndex: number; color: string; coords: number[] }>
  texts: Array<{ layerIndex: number; color: string; x: number; y: number; height: number; rotation: number; text: string }>
  sampleXs: number[]
  sampleYs: number[]
  totalSegments: number
  layerNames: string[]
  layerNameToIdx: Map<string, number>
  layerColors: string[]
  layerCounts: number[]
  layerVisible: boolean[]
}

function createCollector(): RawSegmentCollector {
  return {
    groups: new Map(),
    texts: [],
    sampleXs: [],
    sampleYs: [],
    totalSegments: 0,
    layerNames: [],
    layerNameToIdx: new Map(),
    layerColors: [],
    layerCounts: [],
    layerVisible: []
  }
}

function ensureLayer(col: RawSegmentCollector, rawName: string | undefined, color = 'default', visible = true): number {
  const name = rawName && rawName.trim() ? rawName.trim() : '0'
  const existing = col.layerNameToIdx.get(name)
  if (existing !== undefined) return existing
  const idx = col.layerNames.length
  col.layerNames.push(name)
  col.layerNameToIdx.set(name, idx)
  col.layerColors.push(color)
  col.layerCounts.push(0)
  col.layerVisible.push(visible)
  return idx
}

function addSeg(
  col: RawSegmentCollector,
  layerIdx: number,
  color: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  m: Mat2D,
  flipX = false
): void {
  if (col.totalSegments >= MAX_SEGMENTS) return
  const ax1 = flipX ? -x1 : x1
  const ax2 = flipX ? -x2 : x2
  const wx1 = applyMatX(m, ax1, y1)
  const wy1 = applyMatY(m, ax1, y1)
  const wx2 = applyMatX(m, ax2, y2)
  const wy2 = applyMatY(m, ax2, y2)
  if (!isFiniteCoord(wx1, wy1) || !isFiniteCoord(wx2, wy2)) return

  const key = `${layerIdx}|${color}`
  let g = col.groups.get(key)
  if (!g) {
    g = { layerIndex: layerIdx, color, coords: [] }
    col.groups.set(key, g)
  }
  g.coords.push(wx1, wy1, wx2, wy2)
  col.totalSegments++

  // Reservoir-style sample midpoints for fast O(N) robust percentile bbox
  if (col.sampleXs.length < 40000 || col.totalSegments % 7 === 0) {
    col.sampleXs.push((wx1 + wx2) * 0.5)
    col.sampleYs.push((wy1 + wy2) * 0.5)
  }
}

function addBulgeArc(
  col: RawSegmentCollector,
  layerIdx: number,
  color: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulge: number,
  m: Mat2D,
  flipX = false
): void {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-5) {
    addSeg(col, layerIdx, color, x1, y1, x2, y2, m, flipX)
    return
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-8) return

  const theta = 4 * Math.atan(bulge)
  const radius = Math.abs(chord / (2 * Math.sin(theta / 2)))
  if (!Number.isFinite(radius) || radius > 1e9) {
    addSeg(col, layerIdx, color, x1, y1, x2, y2, m, flipX)
    return
  }

  const midX = (x1 + x2) * 0.5
  const midY = (y1 + y2) * 0.5
  const sagittaDist = radius * Math.cos(theta / 2)
  const perpX = -dy / chord
  const perpY = dx / chord
  const sign = bulge >= 0 ? 1 : -1
  const cx = midX + perpX * sagittaDist * sign
  const cy = midY + perpY * sagittaDist * sign

  const startAngle = Math.atan2(y1 - cy, x1 - cx)
  const steps = Math.max(4, Math.min(28, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * 32)))
  let px = x1
  let py = y1
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (theta * i) / steps
    const nx = i === steps ? x2 : cx + radius * Math.cos(a)
    const ny = i === steps ? y2 : cy + radius * Math.sin(a)
    addSeg(col, layerIdx, color, px, py, nx, ny, m, flipX)
    px = nx
    py = ny
  }
}

function addPolylineVerts(
  col: RawSegmentCollector,
  layerIdx: number,
  color: string,
  verts: Array<{ x: number; y: number; bulge?: number }>,
  closed: boolean,
  m: Mat2D,
  flipX = false
): void {
  if (!verts || verts.length < 2) return
  for (let i = 0; i < verts.length - 1; i++) {
    const v1 = verts[i]
    const v2 = verts[i + 1]
    if (!v1 || !v2) continue
    addBulgeArc(col, layerIdx, color, v1.x, v1.y, v2.x, v2.y, v1.bulge ?? 0, m, flipX)
  }
  if (closed && verts.length >= 2) {
    const last = verts[verts.length - 1]
    const first = verts[0]
    if (last && first) {
      addBulgeArc(col, layerIdx, color, last.x, last.y, first.x, first.y, last.bulge ?? 0, m, flipX)
    }
  }
}

function addArc(
  col: RawSegmentCollector,
  layerIdx: number,
  color: string,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  m: Mat2D,
  flipX = false,
  isCCW = true
): void {
  if (!Number.isFinite(r) || r <= 0) return
  let sweep = isCCW ? endAngle - startAngle : startAngle - endAngle
  while (sweep <= 0) sweep += Math.PI * 2
  if (sweep > Math.PI * 2 + 1e-4) sweep = Math.PI * 2
  const steps = Math.max(8, Math.min(48, Math.ceil((sweep / (Math.PI * 2)) * 36)))
  const dir = isCCW ? 1 : -1
  let px = cx + r * Math.cos(startAngle)
  let py = cy + r * Math.sin(startAngle)
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + dir * ((sweep * i) / steps)
    const nx = cx + r * Math.cos(a)
    const ny = cy + r * Math.sin(a)
    addSeg(col, layerIdx, color, px, py, nx, ny, m, flipX)
    px = nx
    py = ny
  }
}

function addEllipse(
  col: RawSegmentCollector,
  layerIdx: number,
  color: string,
  cx: number,
  cy: number,
  majX: number,
  majY: number,
  axisRatio: number,
  startParam: number,
  endParam: number,
  m: Mat2D,
  flipX = false
): void {
  const rx = Math.hypot(majX, majY)
  if (!Number.isFinite(rx) || rx <= 0) return
  const ry = rx * (Number.isFinite(axisRatio) && axisRatio > 0 ? axisRatio : 1)
  const rot = Math.atan2(majY, majX)
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)
  let sweep = endParam - startParam
  if (Math.abs(sweep) < 1e-5) sweep = Math.PI * 2
  while (sweep <= 0) sweep += Math.PI * 2
  const steps = Math.max(12, Math.min(48, Math.ceil((sweep / (Math.PI * 2)) * 36)))
  const pt = (t: number) => {
    const lx = rx * Math.cos(t)
    const ly = ry * Math.sin(t)
    return { x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR }
  }
  let prev = pt(startParam)
  for (let i = 1; i <= steps; i++) {
    const cur = pt(startParam + (sweep * i) / steps)
    addSeg(col, layerIdx, color, prev.x, prev.y, cur.x, cur.y, m, flipX)
    prev = cur
  }
}

function evalBSplinePoint(
  t: number,
  degree: number,
  ctrlPts: Array<{ x: number; y: number }>,
  knots: number[],
  weights?: number[]
): { x: number; y: number } | null {
  const n = ctrlPts.length
  if (n === 0 || degree < 1 || knots.length < n + degree + 1) return null
  let k = degree
  for (let i = degree; i < n; i++) {
    if (t >= knots[i] && t <= knots[i + 1]) {
      k = i
      break
    }
  }
  const d: Array<[number, number, number]> = []
  for (let j = 0; j <= degree; j++) {
    const idx = Math.max(0, Math.min(n - 1, k - degree + j))
    const w = weights && weights[idx] != null && weights[idx] > 0 ? weights[idx] : 1
    d.push([ctrlPts[idx].x * w, ctrlPts[idx].y * w, w])
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const ki = k - degree + j
      const denom = knots[ki + degree + 1 - r] - knots[ki]
      const alpha = Math.abs(denom) > 1e-9 ? (t - knots[ki]) / denom : 0
      d[j] = [
        (1 - alpha) * d[j - 1][0] + alpha * d[j][0],
        (1 - alpha) * d[j - 1][1] + alpha * d[j][1],
        (1 - alpha) * d[j - 1][2] + alpha * d[j][2]
      ]
    }
  }
  const res = d[degree]
  if (!res || Math.abs(res[2]) < 1e-9) return null
  return { x: res[0] / res[2], y: res[1] / res[2] }
}

function addSpline(
  col: RawSegmentCollector,
  layerIdx: number,
  color: string,
  ctrlPts: Array<{ x: number; y: number }> | undefined,
  fitPts: Array<{ x: number; y: number }> | undefined,
  degree: number,
  knots: number[] | undefined,
  weights: number[] | undefined,
  m: Mat2D,
  flipX = false
): void {
  if (ctrlPts && ctrlPts.length >= 2 && knots && knots.length >= ctrlPts.length + degree + 1 && degree >= 1) {
    const tMin = knots[degree]
    const tMax = knots[ctrlPts.length]
    if (Number.isFinite(tMin) && Number.isFinite(tMax) && tMax > tMin) {
      const steps = Math.max(16, Math.min(96, ctrlPts.length * 8))
      let prev = evalBSplinePoint(tMin, degree, ctrlPts, knots, weights)
      for (let i = 1; i <= steps; i++) {
        const t = tMin + ((tMax - tMin) * i) / steps
        const cur = evalBSplinePoint(t, degree, ctrlPts, knots, weights)
        if (prev && cur) {
          addSeg(col, layerIdx, color, prev.x, prev.y, cur.x, cur.y, m, flipX)
        }
        prev = cur
      }
      return
    }
  }
  const pts = fitPts && fitPts.length >= 2 ? fitPts : ctrlPts
  if (pts && pts.length >= 2) {
    addPolylineVerts(col, layerIdx, color, pts, false, m, flipX)
  }
}

function resolveEntityColor(
  entity: Record<string, unknown>,
  layerColor: string,
  parentColor: string
): string {
  const colorIndex = typeof entity.colorIndex === 'number' ? entity.colorIndex : undefined
  const rgb = typeof entity.color === 'number' ? entity.color : undefined
  // 0 = ByBlock, 256 = ByLayer
  if (colorIndex === 0) return parentColor
  if (colorIndex === 256 || (colorIndex == null && rgb == null)) return layerColor
  if (colorIndex === 7) return 'default'
  return aciToColor(colorIndex, rgb)
}

function flattenDwgDatabase(db: DwgDatabase): {
  collector: RawSegmentCollector
  entityCount: number
  blockCount: number
  spaceUsed: 'model' | 'paper'
} {
  const col = createCollector()

  // 1. Register all table layers first
  const tableLayers = db.tables?.LAYER?.entries ?? []
  for (const l of tableLayers) {
    ensureLayer(col, l.name, aciToColor(l.colorIndex, l.color), !l.off && !l.frozen)
  }

  // 2. Index ALL blocks into a case-insensitive Map BEFORE expanding any entities
  const blocks = db.tables?.BLOCK_RECORD?.entries ?? []
  const blockMap = new Map<string, (typeof blocks)[number]>()
  let modelSpaceBlock: (typeof blocks)[number] | null = null
  let paperSpaceBlock: (typeof blocks)[number] | null = null

  for (const b of blocks) {
    if (!b.name) continue
    const lower = b.name.toLowerCase()
    blockMap.set(lower, b)
    if (lower === '*model_space') modelSpaceBlock = b
    else if (lower === '*paper_space' && !paperSpaceBlock) paperSpaceBlock = b
  }

  const walkEntity = (
    ent: Record<string, unknown>,
    m: Mat2D,
    parentLayerIdx: number,
    parentColor: string,
    depth: number
  ): void => {
    if (col.totalSegments >= MAX_SEGMENTS) return
    if (ent.isVisible === false) return

    const rawLayer = typeof ent.layer === 'string' ? ent.layer : undefined
    // AutoCAD rule: entities on layer '0' inside a block inherit the INSERT's layer
    const layerIdx =
      depth > 0 && (!rawLayer || rawLayer === '0')
        ? parentLayerIdx
        : ensureLayer(col, rawLayer, 'default', true)

    if (depth === 0) {
      col.layerCounts[layerIdx] = (col.layerCounts[layerIdx] ?? 0) + 1
    }

    const layerColor = col.layerColors[layerIdx] ?? 'default'
    const color = resolveEntityColor(ent, layerColor, parentColor)
    const extDir = ent.extrusionDirection as { z?: number } | undefined
    const flipX = Boolean(extDir && typeof extDir.z === 'number' && extDir.z < -0.5)
    const type = String(ent.type || '').toUpperCase()

    switch (type) {
      case 'LINE': {
        const s = ent.startPoint as { x: number; y: number } | undefined
        const e = ent.endPoint as { x: number; y: number } | undefined
        if (s && e) addSeg(col, layerIdx, color, s.x, s.y, e.x, e.y, m, flipX)
        break
      }
      case 'LWPOLYLINE': {
        const verts = ent.vertices as Array<{ x: number; y: number; bulge?: number }> | undefined
        const flag = Number(ent.flag ?? 0)
        const closed = Boolean((flag & 1) || (flag & 0x200))
        if (verts) addPolylineVerts(col, layerIdx, color, verts, closed, m, flipX)
        break
      }
      case 'POLYLINE2D':
      case 'POLYLINE3D':
      case 'POLYLINE': {
        const verts = ent.vertices as Array<{ x: number; y: number; bulge?: number }> | undefined
        const flag = Number(ent.flag ?? 0)
        const closed = Boolean(flag & 1)
        if (verts) addPolylineVerts(col, layerIdx, color, verts, closed, m, flipX)
        break
      }
      case 'CIRCLE': {
        const c = ent.center as { x: number; y: number } | undefined
        const r = Number(ent.radius ?? 0)
        if (c && r > 0) addArc(col, layerIdx, color, c.x, c.y, r, 0, Math.PI * 2, m, flipX, true)
        break
      }
      case 'ARC': {
        const c = ent.center as { x: number; y: number } | undefined
        const r = Number(ent.radius ?? 0)
        const sa = Number(ent.startAngle ?? 0)
        const ea = Number(ent.endAngle ?? Math.PI * 2)
        if (c && r > 0) addArc(col, layerIdx, color, c.x, c.y, r, sa, ea, m, flipX, true)
        break
      }
      case 'ELLIPSE': {
        const c = ent.center as { x: number; y: number } | undefined
        const maj = ent.majorAxisEndPoint as { x: number; y: number } | undefined
        const ratio = Number(ent.axisRatio ?? 1)
        const sa = Number(ent.startAngle ?? 0)
        const ea = Number(ent.endAngle ?? Math.PI * 2)
        if (c && maj) addEllipse(col, layerIdx, color, c.x, c.y, maj.x, maj.y, ratio, sa, ea, m, flipX)
        break
      }
      case 'SPLINE': {
        const ctrl = ent.controlPoints as Array<{ x: number; y: number }> | undefined
        const fit = ent.fitPoints as Array<{ x: number; y: number }> | undefined
        const deg = Number(ent.degree ?? 3)
        const knots = ent.knots as number[] | undefined
        const weights = ent.weights as number[] | undefined
        addSpline(col, layerIdx, color, ctrl, fit, deg, knots, weights, m, flipX)
        break
      }
      case 'SOLID':
      case 'TRACE': {
        const c1 = ent.corner1 as { x: number; y: number } | undefined
        const c2 = ent.corner2 as { x: number; y: number } | undefined
        const c3 = ent.corner3 as { x: number; y: number } | undefined
        const c4 = (ent.corner4 as { x: number; y: number } | undefined) ?? c3
        if (c1 && c2 && c3 && c4) {
          addPolylineVerts(col, layerIdx, color, [c1, c2, c4, c3], true, m, flipX)
        }
        break
      }
      case '3DFACE': {
        const c1 = ent.corner1 as { x: number; y: number } | undefined
        const c2 = ent.corner2 as { x: number; y: number } | undefined
        const c3 = ent.corner3 as { x: number; y: number } | undefined
        const c4 = (ent.corner4 as { x: number; y: number } | undefined) ?? c3
        if (c1 && c2 && c3 && c4) {
          addPolylineVerts(col, layerIdx, color, [c1, c2, c3, c4], true, m, flipX)
        }
        break
      }
      case 'HATCH': {
        const paths = ent.boundaryPaths as Array<Record<string, unknown>> | undefined
        if (!Array.isArray(paths)) break
        for (const p of paths) {
          if (Array.isArray(p.vertices)) {
            const verts = p.vertices as Array<{ x: number; y: number; bulge?: number }>
            addPolylineVerts(col, layerIdx, color, verts, Boolean(p.isClosed ?? true), m, flipX)
          } else if (Array.isArray(p.edges)) {
            for (const edge of p.edges as Array<Record<string, unknown>>) {
              const et = Number(edge.type)
              if (et === 1 && edge.start && edge.end) {
                const s = edge.start as { x: number; y: number }
                const e = edge.end as { x: number; y: number }
                addSeg(col, layerIdx, color, s.x, s.y, e.x, e.y, m, flipX)
              } else if (et === 2 && edge.center) {
                const c = edge.center as { x: number; y: number }
                addArc(
                  col,
                  layerIdx,
                  color,
                  c.x,
                  c.y,
                  Number(edge.radius ?? 0),
                  Number(edge.startAngle ?? 0),
                  Number(edge.endAngle ?? Math.PI * 2),
                  m,
                  flipX,
                  edge.isCCW !== false
                )
              } else if (et === 3 && edge.center && edge.end) {
                const c = edge.center as { x: number; y: number }
                const maj = edge.end as { x: number; y: number }
                addEllipse(
                  col,
                  layerIdx,
                  color,
                  c.x,
                  c.y,
                  maj.x,
                  maj.y,
                  Number(edge.lengthOfMinorAxis ?? 1),
                  Number(edge.startAngle ?? 0),
                  Number(edge.endAngle ?? Math.PI * 2),
                  m,
                  flipX
                )
              } else if (et === 4) {
                addSpline(
                  col,
                  layerIdx,
                  color,
                  edge.controlPoints as Array<{ x: number; y: number }> | undefined,
                  edge.fitDatum as Array<{ x: number; y: number }> | undefined,
                  Number(edge.degree ?? 3),
                  edge.knots as number[] | undefined,
                  undefined,
                  m,
                  flipX
                )
              }
            }
          }
        }
        break
      }
      case 'LEADER':
      case 'MLINE': {
        const verts = ent.vertices as Array<{ x: number; y: number }> | undefined
        if (verts && verts.length >= 2) {
          addPolylineVerts(col, layerIdx, color, verts, false, m, flipX)
        }
        break
      }
      case 'DIMENSION': {
        const dimBlockName = typeof ent.name === 'string' ? ent.name.toLowerCase() : ''
        const dimBlock = dimBlockName ? blockMap.get(dimBlockName) : undefined
        if (dimBlock && Array.isArray(dimBlock.entities) && depth < MAX_INSERT_DEPTH) {
          for (const child of dimBlock.entities as unknown as Array<Record<string, unknown>>) {
            walkEntity(child, m, layerIdx, color, depth + 1)
          }
        } else {
          // Minimal fallback if anonymous dimension block wasn't saved
          const p1 = ent.subDefinitionPoint1 as { x: number; y: number } | undefined
          const p2 = ent.subDefinitionPoint2 as { x: number; y: number } | undefined
          if (p1 && p2) addSeg(col, layerIdx, color, p1.x, p1.y, p2.x, p2.y, m, flipX)
        }
        break
      }
      case 'INSERT': {
        if (depth >= MAX_INSERT_DEPTH) break
        const bName = typeof ent.name === 'string' ? ent.name.toLowerCase() : ''
        const blk = bName ? blockMap.get(bName) : undefined
        if (!blk || !Array.isArray(blk.entities) || blk.entities.length === 0) break

        const ins = (ent.insertionPoint as { x: number; y: number } | undefined) ?? { x: 0, y: 0 }
        const sx = typeof ent.xScale === 'number' && ent.xScale !== 0 ? ent.xScale : 1
        const sy = typeof ent.yScale === 'number' && ent.yScale !== 0 ? ent.yScale : 1
        const rot = typeof ent.rotation === 'number' ? ent.rotation : 0
        const bp = (blk.basePoint as { x?: number; y?: number } | undefined) ?? { x: 0, y: 0 }

        const cols = Math.max(1, Math.min(20, Number(ent.columnCount ?? 1)))
        const rows = Math.max(1, Math.min(20, Number(ent.rowCount ?? 1)))
        const colSp = Number(ent.columnSpacing ?? 0)
        const rowSp = Number(ent.rowSpacing ?? 0)
        const cosR = Math.cos(rot)
        const sinR = Math.sin(rot)

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const ox = c * colSp * cosR - r * rowSp * sinR
            const oy = c * colSp * sinR + r * rowSp * cosR
            const localMat = makeInsertMat(
              (flipX ? -ins.x : ins.x) + ox,
              ins.y + oy,
              rot,
              flipX ? -sx : sx,
              sy,
              bp.x ?? 0,
              bp.y ?? 0
            )
            const nextMat = mulMat(m, localMat)
            for (const child of blk.entities as unknown as Array<Record<string, unknown>>) {
              walkEntity(child, nextMat, layerIdx, color, depth + 1)
            }
          }
        }
        if (Array.isArray(ent.attribs)) {
          for (const attr of ent.attribs as Array<Record<string, unknown>>) {
            walkEntity(attr, m, layerIdx, color, depth + 1)
          }
        }
        break
      }
      case 'TEXT':
      case 'ATTRIB':
      case 'ATTDEF':
      case 'MTEXT': {
        if (col.texts.length >= MAX_TEXTS) break
        const txt = cleanCadText(String(ent.text ?? ''))
        if (!txt) break
        const pos =
          (ent.insertionPoint as { x: number; y: number } | undefined) ??
          (ent.startPoint as { x: number; y: number } | undefined) ??
          (ent.endPoint as { x: number; y: number } | undefined)
        if (!pos) break
        const px = flipX ? -pos.x : pos.x
        const wx = applyMatX(m, px, pos.y)
        const wy = applyMatY(m, px, pos.y)
        if (!isFiniteCoord(wx, wy)) break
        const rawH = Number(ent.textHeight ?? ent.height ?? 2.5)
        const matScale = Math.hypot(m[0], m[1]) || 1
        let rot = typeof ent.rotation === 'number' ? ent.rotation : 0
        if (type === 'MTEXT' && ent.direction) {
          const dir = ent.direction as { x?: number; y?: number }
          if (dir.x || dir.y) rot = Math.atan2(dir.y ?? 0, dir.x ?? 1)
        }
        const matRot = Math.atan2(m[1], m[0])
        col.texts.push({
          layerIndex: layerIdx,
          color,
          x: wx,
          y: wy,
          height: Math.max(0.1, rawH * matScale),
          rotation: rot + matRot,
          text: txt
        })
        break
      }
      default:
        break
    }
  }

  let rootEntities: Array<Record<string, unknown>> = []
  let spaceUsed: 'model' | 'paper' = 'model'

  if (modelSpaceBlock && Array.isArray(modelSpaceBlock.entities) && modelSpaceBlock.entities.length > 0) {
    rootEntities = modelSpaceBlock.entities as unknown as Array<Record<string, unknown>>
  } else if (Array.isArray(db.entities) && db.entities.length > 0) {
    rootEntities = db.entities as unknown as Array<Record<string, unknown>>
  }

  for (const ent of rootEntities) {
    walkEntity(ent, IDENTITY_MAT, 0, 'default', 0)
  }

  // Fallback to Paper Space if Model Space produced no visible geometry
  if (col.totalSegments === 0 && col.texts.length === 0 && paperSpaceBlock?.entities?.length) {
    spaceUsed = 'paper'
    rootEntities = paperSpaceBlock.entities as unknown as Array<Record<string, unknown>>
    for (const ent of rootEntities) {
      walkEntity(ent, IDENTITY_MAT, 0, 'default', 0)
    }
  }

  return {
    collector: col,
    entityCount: rootEntities.length,
    blockCount: Math.max(0, blocks.length - 2),
    spaceUsed
  }
}

function flattenDxfFallback(text: string): {
  collector: RawSegmentCollector
  entityCount: number
  blockCount: number
} {
  const parser = new DxfParser()
  const dxf = parser.parseSync(text)
  const col = createCollector()
  if (!dxf) return { collector: col, entityCount: 0, blockCount: 0 }

  if (dxf.tables?.layer?.layers) {
    for (const [name, info] of Object.entries(dxf.tables.layer.layers)) {
      ensureLayer(col, name, aciToColor(info.colorIndex, info.color), info.visible !== false)
    }
  }

  const blockMap = new Map<string, { basePoint: { x: number; y: number }; entities: Array<Record<string, unknown>> }>()
  if (dxf.blocks) {
    for (const [name, blk] of Object.entries(dxf.blocks)) {
      const b = blk as unknown as { position?: { x: number; y: number }; entities?: Array<Record<string, unknown>> }
      blockMap.set(name.toLowerCase(), {
        basePoint: b.position ?? { x: 0, y: 0 },
        entities: Array.isArray(b.entities) ? b.entities : []
      })
    }
  }

  const walk = (ent: Record<string, unknown>, m: Mat2D, parentLayerIdx: number, parentColor: string, depth: number) => {
    if (col.totalSegments >= MAX_SEGMENTS) return
    const rawLayer = typeof ent.layer === 'string' ? ent.layer : undefined
    const layerIdx = depth > 0 && (!rawLayer || rawLayer === '0') ? parentLayerIdx : ensureLayer(col, rawLayer)
    if (depth === 0) col.layerCounts[layerIdx] = (col.layerCounts[layerIdx] ?? 0) + 1
    const color = resolveEntityColor(ent, col.layerColors[layerIdx] ?? 'default', parentColor)
    const type = String(ent.type || '').toUpperCase()

    if (type === 'LINE') {
      const v = ent.vertices as Array<{ x: number; y: number }> | undefined
      if (v && v.length >= 2) addSeg(col, layerIdx, color, v[0].x, v[0].y, v[1].x, v[1].y, m)
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const v = ent.vertices as Array<{ x: number; y: number; bulge?: number }> | undefined
      if (v) addPolylineVerts(col, layerIdx, color, v, Boolean(ent.shape), m)
    } else if (type === 'CIRCLE') {
      const c = ent.center as { x: number; y: number } | undefined
      const r = Number(ent.radius ?? 0)
      if (c && r > 0) addArc(col, layerIdx, color, c.x, c.y, r, 0, Math.PI * 2, m)
    } else if (type === 'ARC') {
      const c = ent.center as { x: number; y: number } | undefined
      const r = Number(ent.radius ?? 0)
      if (c && r > 0) addArc(col, layerIdx, color, c.x, c.y, r, Number(ent.startAngle ?? 0), Number(ent.endAngle ?? Math.PI * 2), m)
    } else if (type === 'ELLIPSE') {
      const c = ent.center as { x: number; y: number } | undefined
      const maj = ent.majorAxisEndPoint as { x: number; y: number } | undefined
      if (c && maj) addEllipse(col, layerIdx, color, c.x, c.y, maj.x, maj.y, Number(ent.axisRatio ?? 1), Number(ent.startAngle ?? 0), Number(ent.endAngle ?? Math.PI * 2), m)
    } else if (type === 'SPLINE') {
      addSpline(
        col,
        layerIdx,
        color,
        ent.controlPoints as Array<{ x: number; y: number }> | undefined,
        ent.fitPoints as Array<{ x: number; y: number }> | undefined,
        Number(ent.degreeOfSplineCurve ?? 3),
        ent.knotValues as number[] | undefined,
        undefined,
        m
      )
    } else if (type === 'SOLID') {
      const pts = ent.points as Array<{ x: number; y: number }> | undefined
      if (pts && pts.length >= 3) {
        const quad = pts.length >= 4 ? [pts[0], pts[1], pts[3], pts[2]] : [pts[0], pts[1], pts[2]]
        addPolylineVerts(col, layerIdx, color, quad, true, m)
      }
    } else if (type === 'INSERT' && depth < MAX_INSERT_DEPTH) {
      const blk = blockMap.get(String(ent.name || '').toLowerCase())
      if (blk) {
        const pos = (ent.position as { x: number; y: number } | undefined) ?? { x: 0, y: 0 }
        const rot = ((Number(ent.rotation ?? 0)) * Math.PI) / 180
        const sx = Number(ent.xScale ?? 1) || 1
        const sy = Number(ent.yScale ?? 1) || 1
        const nextMat = mulMat(m, makeInsertMat(pos.x, pos.y, rot, sx, sy, blk.basePoint.x, blk.basePoint.y))
        for (const child of blk.entities) walk(child, nextMat, layerIdx, color, depth + 1)
      }
    } else if ((type === 'TEXT' || type === 'MTEXT') && col.texts.length < MAX_TEXTS) {
      const txt = cleanCadText(String(ent.text ?? ''))
      const pos = (ent.startPoint || ent.position) as { x: number; y: number } | undefined
      if (txt && pos) {
        const wx = applyMatX(m, pos.x, pos.y)
        const wy = applyMatY(m, pos.x, pos.y)
        if (isFiniteCoord(wx, wy)) {
          col.texts.push({
            layerIndex: layerIdx,
            color,
            x: wx,
            y: wy,
            height: Math.max(0.1, Number(ent.textHeight ?? ent.height ?? 2.5)),
            rotation: ((Number(ent.rotation ?? 0)) * Math.PI) / 180,
            text: txt
          })
        }
      }
    }
  }

  const entities = Array.isArray(dxf.entities) ? (dxf.entities as unknown as Array<Record<string, unknown>>) : []
  for (const ent of entities) walk(ent, IDENTITY_MAT, 0, 'default', 0)

  return { collector: col, entityCount: entities.length, blockCount: blockMap.size }
}

/**
 * Computes an outlier-resistant bounding box so a stray point at (0,0) on a geodetic
 * drawing at (500000, 3500000) never shrinks the real drawing into an invisible speck.
 */
function computeRobustBounds(col: RawSegmentCollector): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let fullMinX = Infinity
  let fullMinY = Infinity
  let fullMaxX = -Infinity
  let fullMaxY = -Infinity

  for (const g of col.groups.values()) {
    const c = g.coords
    for (let i = 0; i < c.length; i += 2) {
      const x = c[i]
      const y = c[i + 1]
      if (x < fullMinX) fullMinX = x
      if (y < fullMinY) fullMinY = y
      if (x > fullMaxX) fullMaxX = x
      if (y > fullMaxY) fullMaxY = y
    }
  }

  if (!Number.isFinite(fullMinX)) {
    for (const t of col.texts) {
      if (t.x < fullMinX) fullMinX = t.x
      if (t.y < fullMinY) fullMinY = t.y
      if (t.x > fullMaxX) fullMaxX = t.x
      if (t.y > fullMaxY) fullMaxY = t.y
    }
  }

  if (!Number.isFinite(fullMinX) || !Number.isFinite(fullMaxX)) return null

  const fullW = fullMaxX - fullMinX
  const fullH = fullMaxY - fullMinY

  if (col.sampleXs.length >= 40) {
    const xs = col.sampleXs.slice().sort((a, b) => a - b)
    const ys = col.sampleYs.slice().sort((a, b) => a - b)
    const loIdx = Math.floor(xs.length * 0.015)
    const hiIdx = Math.min(xs.length - 1, Math.ceil(xs.length * 0.985))
    const coreMinX = xs[loIdx]
    const coreMaxX = xs[hiIdx]
    const coreMinY = ys[loIdx]
    const coreMaxY = ys[hiIdx]
    const coreW = coreMaxX - coreMinX
    const coreH = coreMaxY - coreMinY

    if (
      coreW > 0 &&
      coreH > 0 &&
      (fullW > coreW * 5 || fullH > coreH * 5)
    ) {
      const padX = coreW * 0.12
      const padY = coreH * 0.12
      return {
        minX: coreMinX - padX,
        minY: coreMinY - padY,
        maxX: coreMaxX + padX,
        maxY: coreMaxY + padY
      }
    }
  }

  return { minX: fullMinX, minY: fullMinY, maxX: fullMaxX, maxY: fullMaxY }
}

function packScene(col: RawSegmentCollector): {
  batches: CadBatch[]
  texts: CadTextItem[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null
  layers: CadLayerInfo[]
} {
  const rawBounds = computeRobustBounds(col)
  const originX = rawBounds ? (rawBounds.minX + rawBounds.maxX) * 0.5 : 0
  const originY = rawBounds ? (rawBounds.minY + rawBounds.maxY) * 0.5 : 0

  const batches: CadBatch[] = []
  for (const g of col.groups.values()) {
    if (g.coords.length === 0) continue
    const arr = new Float32Array(g.coords.length)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < g.coords.length; i += 2) {
      const lx = g.coords[i] - originX
      const ly = g.coords[i + 1] - originY
      arr[i] = lx
      arr[i + 1] = ly
      if (lx < minX) minX = lx
      if (ly < minY) minY = ly
      if (lx > maxX) maxX = lx
      if (ly > maxY) maxY = ly
    }
    batches.push({
      layerIndex: g.layerIndex,
      color: g.color,
      segments: arr,
      minX,
      minY,
      maxX,
      maxY
    })
  }

  const texts: CadTextItem[] = col.texts.map((t) => ({
    ...t,
    x: t.x - originX,
    y: t.y - originY
  }))

  const bounds = rawBounds
    ? {
        minX: rawBounds.minX - originX,
        minY: rawBounds.minY - originY,
        maxX: rawBounds.maxX - originX,
        maxY: rawBounds.maxY - originY
      }
    : null

  const layers: CadLayerInfo[] = col.layerNames.map((name, idx) => ({
    name,
    color: col.layerColors[idx] === 'default' ? '#e2e8f0' : col.layerColors[idx],
    entityCount: col.layerCounts[idx] ?? 0,
    visible: col.layerVisible[idx] ?? true
  }))

  return { batches, texts, bounds, layers }
}

let libreDwgPromise: Promise<LibreDwgEx> | null = null

async function getLibreDwg(): Promise<LibreDwgEx> {
  if (!libreDwgPromise) {
    libreDwgPromise = (async () => {
      const entryPath = require.resolve('@mlightcad/libredwg-web')
      const pkgRoot = path.resolve(path.dirname(entryPath), '..')
      const rawWasmPath = path.join(pkgRoot, 'wasm', 'libredwg-web.wasm')
      const unpackedWasmPath = rawWasmPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
      const wasmPath = fs.existsSync(unpackedWasmPath) ? unpackedWasmPath : rawWasmPath
      const wasmBinary = fs.readFileSync(wasmPath)
      const rawCreate = createModule as unknown as
        | ((opts?: Record<string, unknown>) => Promise<unknown>)
        | { default?: (opts?: Record<string, unknown>) => Promise<unknown> }
      const createWasmFn = typeof rawCreate === 'function' ? rawCreate : rawCreate?.default
      if (typeof createWasmFn !== 'function') {
        throw new Error('LibreDWG WASM createModule loader not found')
      }
      const wasmInstance = await createWasmFn({ wasmBinary })
      return LibreDwg.createByWasmInstance(wasmInstance as Parameters<typeof LibreDwg.createByWasmInstance>[0])
    })().catch((err) => {
      libreDwgPromise = null
      throw err
    })
  }
  return libreDwgPromise
}

async function handleParseRequest(filePath: string): Promise<CadPreviewData> {
  const startAt = Date.now()
  const ext = path.extname(filePath).toLowerCase()
  const isDxf = ext === '.dxf'
  const format: 'dwg' | 'dxf' = isDxf ? 'dxf' : 'dwg'

  try {
    const rawBuf = await fsp.readFile(filePath)
    let version: string | undefined
    let unknownEntityCount: number | undefined
    let embeddedPreviewPng: Buffer | null = null
    let database: DwgDatabase | null = null

    // Fast zero-WASM embedded preview extraction first for .dwg
    if (!isDxf) {
      embeddedPreviewPng = await extractPreviewFromDwgBuffer(rawBuf).catch(() => null)
    }

    try {
      const libredwg = await getLibreDwg()
      const arrayBuf = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength)
      const ptr = libredwg.dwg_read_data(arrayBuf, isDxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG)
      if (ptr) {
        try {
          try {
            const v = libredwg.dwg_get_version_type(ptr)
            if (v) version = String(v)
          } catch {
            // ignore
          }
          if (!isDxf && !embeddedPreviewPng) {
            try {
              const thumb = libredwg.dwg_bmp(ptr)
              if (thumb && thumb.data && thumb.data.byteLength > 0) {
                embeddedPreviewPng = await decodeDwgThumbBytesToPng(thumb.data, thumb.type)
              }
            } catch {
              // ignore
            }
          }
          const converted = libredwg.convertEx(ptr)
          database = converted.database
          unknownEntityCount = converted.stats?.unknownEntityCount
        } finally {
          try {
            libredwg.dwg_free(ptr)
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // Allow DXF fallback or embedded preview fallback below
    }

    let col: RawSegmentCollector | null = null
    let entityCount = 0
    let blockCount = 0
    let spaceUsed: 'model' | 'paper' = 'model'

    if (database) {
      const flattened = flattenDwgDatabase(database)
      col = flattened.collector
      entityCount = flattened.entityCount
      blockCount = flattened.blockCount
      spaceUsed = flattened.spaceUsed
    }

    if (isDxf && (!col || (col.totalSegments === 0 && col.texts.length === 0))) {
      try {
        const fb = flattenDxfFallback(rawBuf.toString('utf8'))
        col = fb.collector
        entityCount = fb.entityCount
        blockCount = fb.blockCount
      } catch {
        // ignore
      }
    }

    const embeddedPreviewDataUrl = embeddedPreviewPng
      ? `data:image/png;base64,${embeddedPreviewPng.toString('base64')}`
      : null

    if (!col || (col.totalSegments === 0 && col.texts.length === 0)) {
      if (embeddedPreviewDataUrl) {
        return {
          ok: true,
          format,
          version,
          layers: [],
          batches: [],
          texts: [],
          bounds: null,
          entityCount,
          segmentCount: 0,
          blockCount,
          unknownEntityCount,
          spaceUsed,
          parseMs: Date.now() - startAt,
          embeddedPreviewDataUrl
        }
      }
      return {
        ok: false,
        format,
        version,
        layers: [],
        batches: [],
        texts: [],
        bounds: null,
        entityCount: 0,
        segmentCount: 0,
        blockCount: 0,
        unknownEntityCount,
        parseMs: Date.now() - startAt,
        embeddedPreviewDataUrl: null,
        error: '未能从该 CAD 图纸中解析出可绘制图元（可能为空图纸、加密图纸或专有天正自定义实体）。'
      }
    }

    const packed = packScene(col)
    return {
      ok: true,
      format,
      version,
      layers: packed.layers,
      batches: packed.batches,
      texts: packed.texts,
      bounds: packed.bounds,
      entityCount,
      segmentCount: col.totalSegments,
      blockCount,
      unknownEntityCount,
      spaceUsed,
      parseMs: Date.now() - startAt,
      embeddedPreviewDataUrl
    }
  } catch (err) {
    return {
      ok: false,
      format,
      layers: [],
      batches: [],
      texts: [],
      bounds: null,
      entityCount: 0,
      segmentCount: 0,
      blockCount: 0,
      parseMs: Date.now() - startAt,
      embeddedPreviewDataUrl: null,
      error: `解析 CAD 图纸失败：${err instanceof Error ? err.message : String(err)}`
    }
  }
}

if (parentPort) {
  parentPort.on('message', async (msg: { id: number; filePath: string }) => {
    const result = await handleParseRequest(msg.filePath)
    const transferList = result.batches.map((b) => b.segments.buffer as ArrayBuffer)
    parentPort!.postMessage({ id: msg.id, result }, transferList)
  })
}
