import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Maximize2,
  RefreshCw,
  Type,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { Asset, CadPreviewData } from '@shared/types'

type CadBgTheme = 'dark' | 'blueprint' | 'light'

interface CadPreviewProps {
  asset: Asset
  wheelMode: 'zoom' | 'navigate'
  onNavigateWheel: (dir: -1 | 1) => void
  onMetadataUpdated?: () => void
}

const BG_THEMES: Record<CadBgTheme, { label: string; bg: string; defaultStroke: string }> = {
  dark: { label: 'CAD 深黑', bg: '#12161f', defaultStroke: '#e5edf5' },
  blueprint: { label: '工程蓝图', bg: '#0c2340', defaultStroke: '#dbeafe' },
  light: { label: '图纸白底', bg: '#f8fafc', defaultStroke: '#111827' }
}

function resolveThemeStroke(rawColor: string, theme: CadBgTheme): string {
  if (rawColor === 'default') return BG_THEMES[theme].defaultStroke
  if (theme === 'light') {
    const lower = rawColor.toLowerCase()
    if (lower === '#ffffff' || lower === '#e5e7eb' || lower === '#d1d5db') return '#1f2937'
    if (lower === '#facc15') return '#b45309' // Make CAD yellow readable on white paper
    if (lower === '#22d3ee') return '#0284c7'
    if (lower === '#4ade80') return '#15803d'
  } else {
    const lower = rawColor.toLowerCase()
    if (lower === '#000000') return BG_THEMES[theme].defaultStroke
  }
  return rawColor
}

// Module-level clipped segment output (zero per-segment heap allocation in hot draw loop)
let clippedX1 = 0
let clippedY1 = 0
let clippedX2 = 0
let clippedY2 = 0

/**
 * Liang-Barsky 2D segment clipping to viewport [minX, maxX] x [minY, maxY].
 * Guarantees Chromium/Skia Canvas 2D NEVER receives huge off-screen coordinates
 * when zooming deep into large/geodetic CAD drawings (prevents GPU/Skia freeze).
 */
function clipSegmentToViewport(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): boolean {
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return false
  }
  // Fast path: both endpoints already inside viewport
  if (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY && x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) {
    clippedX1 = x1
    clippedY1 = y1
    clippedX2 = x2
    clippedY2 = y2
    return true
  }

  const dx = x2 - x1
  const dy = y2 - y1
  let t0 = 0
  let t1 = 1

  // Left: -dx * t <= x1 - minX
  if (dx === 0) {
    if (x1 < minX || x1 > maxX) return false
  } else {
    const rLeft = (minX - x1) / dx
    const rRight = (maxX - x1) / dx
    if (dx > 0) {
      if (rLeft > t0) t0 = rLeft
      if (rRight < t1) t1 = rRight
    } else {
      if (rRight > t0) t0 = rRight
      if (rLeft < t1) t1 = rLeft
    }
    if (t0 > t1) return false
  }

  // Top/Bottom
  if (dy === 0) {
    if (y1 < minY || y1 > maxY) return false
  } else {
    const rTop = (minY - y1) / dy
    const rBottom = (maxY - y1) / dy
    if (dy > 0) {
      if (rTop > t0) t0 = rTop
      if (rBottom < t1) t1 = rBottom
    } else {
      if (rBottom > t0) t0 = rBottom
      if (rTop < t1) t1 = rTop
    }
    if (t0 > t1) return false
  }

  clippedX1 = x1 + t0 * dx
  clippedY1 = y1 + t0 * dy
  clippedX2 = x1 + t1 * dx
  clippedY2 = y1 + t1 * dy
  return true
}

export const CadPreview: React.FC<CadPreviewProps> = ({
  asset,
  wheelMode,
  onNavigateWheel,
  onMetadataUpdated
}) => {
  const [data, setData] = useState<CadPreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hiddenLayerIndices, setHiddenLayerIndices] = useState<Set<number>>(new Set())
  const [layersOpen, setLayersOpen] = useState(false)
  const [showTexts, setShowTexts] = useState(true)
  const [bgTheme, setBgTheme] = useState<CadBgTheme>('dark')
  const [viewMode, setViewMode] = useState<'vector' | 'embedded'>('vector')
  const [zoomPct, setZoomPct] = useState(100)
  const [isDragging, setIsDragging] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef({ scale: 1, baseScale: 1, offsetX: 0, offsetY: 0 })
  const hasFittedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const interactingRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef({ active: false, pointerId: -1, startX: 0, startY: 0, originX: 0, originY: 0 })
  const thumbCapturedRef = useRef(false)

  const dataRef = useRef<CadPreviewData | null>(null)
  const hiddenRef = useRef<Set<number>>(new Set())
  const themeRef = useRef<CadBgTheme>('dark')
  const showTextsRef = useRef(true)
  const viewModeRef = useRef<'vector' | 'embedded'>('vector')
  const wheelModeRef = useRef(wheelMode)
  const onNavRef = useRef(onNavigateWheel)
  const onMetadataUpdatedRef = useRef(onMetadataUpdated)

  dataRef.current = data
  hiddenRef.current = hiddenLayerIndices
  themeRef.current = bgTheme
  showTextsRef.current = showTexts
  viewModeRef.current = viewMode
  wheelModeRef.current = wheelMode
  onNavRef.current = onNavigateWheel
  onMetadataUpdatedRef.current = onMetadataUpdated

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const curData = dataRef.current
    if (!canvas || !curData || !curData.bounds) return

    const rect = canvas.getBoundingClientRect()
    const cssW = Math.max(1, Math.floor(rect.width))
    const cssH = Math.max(1, Math.floor(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const targetW = Math.floor(cssW * dpr)
    const targetH = Math.floor(cssH * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const frameStart = performance.now()
    const theme = themeRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = BG_THEMES[theme].bg
    ctx.fillRect(0, 0, cssW, cssH)

    const { scale, offsetX, offsetY } = camRef.current
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return

    // Visible world rectangle for fast frustum culling
    const padPx = 4
    const clipMinX = -padPx
    const clipMinY = -padPx
    const clipMaxX = cssW + padPx
    const clipMaxY = cssH + padPx

    const viewMinX = (clipMinX - offsetX) / scale
    const viewMaxX = (clipMaxX - offsetX) / scale
    const viewMinY = -(clipMaxY - offsetY) / scale
    const viewMaxY = -(clipMinY - offsetY) / scale

    // Sub-pixel LOD threshold during rapid interaction (higher quality when settled)
    const minWorldLen = (interactingRef.current ? 0.6 : 0.25) / scale
    const hidden = hiddenRef.current

    // Use 'butt'/'bevel' for 1px CAD hairlines: ~5-10x faster in Skia than tessellating round caps on thousands of segments
    ctx.lineWidth = 1.1
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'bevel'

    for (const batch of curData.batches) {
      if (hidden.has(batch.layerIndex)) continue
      if (
        batch.maxX < viewMinX ||
        batch.minX > viewMaxX ||
        batch.maxY < viewMinY ||
        batch.minY > viewMaxY
      ) {
        continue
      }

      const segs = batch.segments
      ctx.strokeStyle = resolveThemeStroke(batch.color, theme)
      ctx.beginPath()

      let drawnInBatch = 0
      for (let i = 0; i < segs.length; i += 4) {
        const x1 = segs[i]
        const y1 = segs[i + 1]
        const x2 = segs[i + 2]
        const y2 = segs[i + 3]

        // Segment AABB frustum reject in world space
        if (
          (x1 < viewMinX && x2 < viewMinX) ||
          (x1 > viewMaxX && x2 > viewMaxX) ||
          (y1 < viewMinY && y2 < viewMinY) ||
          (y1 > viewMaxY && y2 > viewMaxY)
        ) {
          continue
        }

        // Sub-pixel micro-segment skip when zoomed far out
        if (Math.abs(x2 - x1) + Math.abs(y2 - y1) < minWorldLen) {
          continue
        }

        // Transform to CSS screen coords & clip strictly to viewport to prevent Skia coordinate overflow
        const sx1 = x1 * scale + offsetX
        const sy1 = -y1 * scale + offsetY
        const sx2 = x2 * scale + offsetX
        const sy2 = -y2 * scale + offsetY

        if (!clipSegmentToViewport(sx1, sy1, sx2, sy2, clipMinX, clipMinY, clipMaxX, clipMaxY)) {
          continue
        }

        ctx.moveTo(clippedX1, clippedY1)
        ctx.lineTo(clippedX2, clippedY2)
        drawnInBatch++

        // Flush paths periodically to keep Chromium 2D path builder small & responsive
        if (drawnInBatch >= 4000) {
          ctx.stroke()
          ctx.beginPath()
          drawnInBatch = 0
        }
      }

      if (drawnInBatch > 0) {
        ctx.stroke()
      }
    }

    // Draw crisp CAD text labels with glyph-atlas protection (max 32px raster font + canvas scale for larger text)
    if (showTextsRef.current && curData.texts.length > 0) {
      ctx.textBaseline = 'alphabetic'
      let drawnTexts = 0
      const maxTextsThisFrame = interactingRef.current ? 160 : 600
      const textBudgetMs = interactingRef.current ? 28 : 55
      let lastFont = ''
      let lastFill = ''

      for (const t of curData.texts) {
        if (drawnTexts >= maxTextsThisFrame) break
        if ((drawnTexts & 31) === 31 && performance.now() - frameStart > textBudgetMs) break
        if (hidden.has(t.layerIndex)) continue

        const pxH = t.height * scale
        if (!Number.isFinite(pxH) || pxH < 6 || pxH > 320) continue

        // Generous horizontal margin so left-aligned labels starting slightly left of viewport remain visible
        const textMarginWorld = t.height * 16
        if (
          t.x < viewMinX - textMarginWorld ||
          t.x > viewMaxX ||
          t.y < viewMinY - t.height * 2 ||
          t.y > viewMaxY + t.height * 2
        ) {
          continue
        }

        const sx = t.x * scale + offsetX
        const sy = -t.y * scale + offsetY
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue

        const fill = resolveThemeStroke(t.color, theme)
        if (fill !== lastFill) {
          ctx.fillStyle = fill
          lastFill = fill
        }

        // Quantize raster font size and cap at 32px so Windows DirectWrite/Skia never stalls rasterizing giant 400px CJK glyphs
        const MAX_RASTER_PX = 32
        const rasterPx = pxH <= MAX_RASTER_PX ? Math.max(6, Math.round(pxH / 2) * 2) : MAX_RASTER_PX
        const fontScale = pxH / rasterPx
        const fontStr = `${rasterPx}px "Segoe UI", "Microsoft YaHei UI", sans-serif`
        if (fontStr !== lastFont) {
          ctx.font = fontStr
          lastFont = fontStr
        }

        const rawFirstLine = t.text.split('\n')[0]
        const firstLine = rawFirstLine.length > 120 ? `${rawFirstLine.slice(0, 120)}…` : rawFirstLine
        const needsTransform = Math.abs(t.rotation) > 0.01 || Math.abs(fontScale - 1) > 0.04

        if (needsTransform) {
          ctx.save()
          ctx.translate(sx, sy)
          if (Math.abs(t.rotation) > 0.01) ctx.rotate(-t.rotation)
          if (Math.abs(fontScale - 1) > 0.04) ctx.scale(fontScale, fontScale)
          ctx.fillText(firstLine, 0, 0)
          ctx.restore()
        } else {
          ctx.fillText(firstLine, sx, sy)
        }
        drawnTexts++
      }
    }
  }, [])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      drawCanvas()
    })
  }, [drawCanvas])

  const markInteracting = useCallback(() => {
    interactingRef.current = true
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      interactingRef.current = false
      scheduleDraw()
    }, 140)
  }, [scheduleDraw])

  const fitToView = useCallback(() => {
    const canvas = canvasRef.current
    const curData = dataRef.current
    if (!canvas || !curData || !curData.bounds) return

    const rect = canvas.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return
    const cssW = rect.width
    const cssH = rect.height
    const { minX, minY, maxX, maxY } = curData.bounds
    const bw = Math.max(1e-4, maxX - minX)
    const bh = Math.max(1e-4, maxY - minY)

    const pad = 0.88
    const fitScale = Math.min((cssW * pad) / bw, (cssH * pad) / bh)
    const cx = (minX + maxX) * 0.5
    const cy = (minY + maxY) * 0.5

    camRef.current = {
      scale: fitScale,
      baseScale: fitScale,
      offsetX: cssW * 0.5 - cx * fitScale,
      offsetY: cssH * 0.5 + cy * fitScale
    }
    hasFittedRef.current = true
    setZoomPct(100)
    scheduleDraw()
  }, [scheduleDraw])

  const zoomByFactor = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const canvas = canvasRef.current
      if (!canvas || !dataRef.current?.bounds) return
      if (!hasFittedRef.current) {
        fitToView()
      }
      const cur = camRef.current
      if (!Number.isFinite(cur.baseScale) || cur.baseScale <= 0) return
      const minScale = cur.baseScale * 0.15
      const maxScale = cur.baseScale * 80
      const nextScale = Math.min(maxScale, Math.max(minScale, cur.scale * factor))
      if (!Number.isFinite(nextScale) || Math.abs(nextScale - cur.scale) < 1e-12) return

      const rect = canvas.getBoundingClientRect()
      const anchorX = clientX != null ? clientX - rect.left : rect.width * 0.5
      const anchorY = clientY != null ? clientY - rect.top : rect.height * 0.5
      const ratio = nextScale / cur.scale

      camRef.current = {
        ...cur,
        scale: nextScale,
        offsetX: anchorX - (anchorX - cur.offsetX) * ratio,
        offsetY: anchorY - (anchorY - cur.offsetY) * ratio
      }
      setZoomPct(Math.round((nextScale / cur.baseScale) * 100))
      markInteracting()
      scheduleDraw()
    },
    [fitToView, markInteracting, scheduleDraw]
  )

  // Load CAD geometry off-thread when asset changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    setHiddenLayerIndices(new Set())
    setLayersOpen(false)
    setViewMode('vector')
    hasFittedRef.current = false
    thumbCapturedRef.current = false

    window.api.assets
      .parseCad(asset.id)
      .then((res) => {
        if (cancelled) return
        setData(res)
        if (res.batches.length === 0 && res.embeddedPreviewDataUrl) {
          setViewMode('embedded')
        }
        // Respect initially hidden/frozen layers only if they don't hide everything
        if (res.layers.length > 0) {
          const initiallyHidden = new Set<number>()
          res.layers.forEach((l, idx) => {
            if (!l.visible) initiallyHidden.add(idx)
          })
          if (initiallyHidden.size < res.layers.length) {
            setHiddenLayerIndices(initiallyHidden)
          }
        }
        setLoading(false)
        if (res.ok) onMetadataUpdatedRef.current?.()
      })
      .catch((err) => {
        if (cancelled) return
        setData({
          ok: false,
          format: asset.ext.toLowerCase() === '.dxf' ? 'dxf' : 'dwg',
          layers: [],
          batches: [],
          texts: [],
          bounds: null,
          entityCount: 0,
          segmentCount: 0,
          blockCount: 0,
          embeddedPreviewDataUrl: null,
          error: String(err)
        })
        setLoading(false)
      })

    return () => {
      cancelled = true
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
    }
  }, [asset.id])

  // Initial fit & auto-capture thumbnail if large DWG didn't have one yet
  useEffect(() => {
    if (!data || !data.ok || viewMode !== 'vector' || !data.bounds) return
    const timer = requestAnimationFrame(() => {
      fitToView()
      // Auto-capture canvas into thumbs/cad/<id>.webp if this CAD asset lacked a thumbnail
      if (!asset.thumbPath && !thumbCapturedRef.current) {
        thumbCapturedRef.current = true
        requestAnimationFrame(() => {
          const canvas = canvasRef.current
          if (!canvas || canvas.width < 10 || canvas.height < 10) return
          try {
            const dataUrl = canvas.toDataURL('image/png')
            window.api.assets
              .saveRenderedThumb(asset.id, dataUrl)
              .then(() => onMetadataUpdatedRef.current?.())
              .catch(() => undefined)
          } catch {
            // ignore
          }
        })
      }
    })
    return () => cancelAnimationFrame(timer)
  }, [data, viewMode, fitToView, asset.id])

  // Redraw immediately when layers, theme, or text toggle changes (0 ms!)
  useEffect(() => {
    if (viewMode === 'vector' && data?.ok) {
      scheduleDraw()
    }
  }, [hiddenLayerIndices, bgTheme, showTexts, viewMode, data, scheduleDraw])

  // ResizeObserver keeps canvas sharp when sidebars resize/collapse (stageRef is ALWAYS mounted)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (viewModeRef.current === 'vector' && dataRef.current?.bounds) {
        if (!hasFittedRef.current) fitToView()
        else scheduleDraw()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitToView, scheduleDraw])

  // Smooth wheel zoom / Ctrl+wheel navigation (stageRef is ALWAYS mounted so listener never misses)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      // Allow native scrolling inside floating overlays (e.g. Layer Drawer) without zooming the drawing
      if ((e.target as HTMLElement | null)?.closest?.('[data-cad-overlay="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      const ctrlHeld = e.ctrlKey || e.metaKey
      const shouldNavigate = (wheelModeRef.current === 'navigate') !== ctrlHeld
      if (shouldNavigate) {
        onNavRef.current(e.deltaY < 0 ? -1 : 1)
      } else if (viewModeRef.current === 'vector' && dataRef.current?.ok && dataRef.current.batches.length > 0) {
        // Smooth proportional zoom for both mouse wheels (~1.25x per notch) and precision touchpads
        const clampedDelta = Math.max(-180, Math.min(180, e.deltaY))
        const factor = Math.pow(1.0022, -clampedDelta)
        zoomByFactor(factor, e.clientX, e.clientY)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomByFactor])

  // Keyboard shortcuts (+/- / 0)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (viewModeRef.current !== 'vector' || !dataRef.current?.ok) return
      if (e.key === '+' || e.key === '=') zoomByFactor(1.35)
      else if (e.key === '-') zoomByFactor(1 / 1.35)
      else if (e.key === '0') fitToView()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [zoomByFactor, fitToView])

  const sortedLayers = useMemo(() => {
    if (!data) return []
    return data.layers
      .map((l, idx) => ({ ...l, idx }))
      .sort((a, b) => b.entityCount - a.entityCount || a.name.localeCompare(b.name))
  }, [data])

  const handleToggleLayer = (layerIdx: number) => {
    setHiddenLayerIndices((prev) => {
      const next = new Set(prev)
      if (next.has(layerIdx)) next.delete(layerIdx)
      else next.add(layerIdx)
      return next
    })
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (loading || !data?.ok || viewMode !== 'vector' || (e.button !== 0 && e.button !== 1)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: camRef.current.offsetX,
      originY: camRef.current.offsetY
    }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== e.pointerId) return
    camRef.current = {
      ...camRef.current,
      offsetX: dragRef.current.originX + (e.clientX - dragRef.current.startX),
      offsetY: dragRef.current.originY + (e.clientY - dragRef.current.startY)
    }
    markInteracting()
    scheduleDraw()
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== e.pointerId) return
    dragRef.current.active = false
    dragRef.current.pointerId = -1
    setIsDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const isVectorReady = !loading && Boolean(data?.ok) && viewMode === 'vector' && (data?.batches.length ?? 0) > 0

  return (
    <div className="w-full h-full relative flex flex-col overflow-hidden select-none">
      {/* Unconditionally Mounted Stage so Wheel & ResizeObserver Listeners Always Stay Attached */}
      <div
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          if (isVectorReady) fitToView()
        }}
        className="flex-1 w-full h-full overflow-hidden flex items-center justify-center relative"
        style={{
          backgroundColor:
            !loading && data?.ok
              ? viewMode === 'vector'
                ? BG_THEMES[bgTheme].bg
                : '#18181b'
              : 'var(--bg-canvas)',
          cursor: isVectorReady ? (isDragging ? 'grabbing' : 'grab') : 'default',
          touchAction: 'none'
        }}
      >
        {loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6">
            <RefreshCw className="w-7 h-7 animate-spin" style={{ color: 'var(--accent)' }} />
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              正在后台线程解析 CAD 图纸（{asset.ext.toUpperCase()}）...
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              独立工作线程离线解析，主界面保持流畅可随时切换
            </div>
          </div>
        ) : !data || !data.ok ? (
          <div className="w-full h-full flex items-center justify-center p-6">
            <div
              className="max-w-md rounded-xl border p-6 text-center space-y-3"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <AlertCircle className="w-10 h-10 mx-auto text-amber-400" />
              <div className="text-sm font-semibold">无法直接预览此 CAD 图纸</div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {data?.error || '该图纸可能包含专有加密或不支持的自定义实体。'}
              </p>
              <button
                type="button"
                onClick={() => window.api.system.openExternal(asset.filePath)}
                className="h-9 px-4 rounded-md text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                style={{ backgroundColor: 'var(--accent-solid)' }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>用系统默认 CAD 软件打开</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {viewMode === 'vector' && data.batches.length > 0 ? (
              <canvas ref={canvasRef} className="w-full h-full block" />
            ) : data.embeddedPreviewDataUrl ? (
              <img
                src={data.embeddedPreviewDataUrl}
                alt={asset.fileName}
                draggable={false}
                className="max-w-[92%] max-h-[88%] object-contain rounded shadow-xl"
              />
            ) : (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                当前图层无可显示矢量图元
              </div>
            )}

            {/* Top-left HUD badge */}
            <div className="absolute top-3 left-3 z-20 flex flex-col items-start gap-1.5 pointer-events-none">
              <div
                className="px-2.5 py-1 rounded-md border backdrop-blur-md text-xs font-mono flex items-center gap-2"
                style={{
                  backgroundColor: 'rgba(18, 22, 31, 0.76)',
                  borderColor: 'rgba(255, 255, 255, 0.14)',
                  color: '#e2e8f0'
                }}
              >
                <span className="font-semibold text-sky-400">{data.format.toUpperCase()}</span>
                {data.version && <span>{data.version}</span>}
                <span>· {data.segmentCount.toLocaleString()} 线段</span>
                <span>· {data.layers.length} 图层</span>
                {data.spaceUsed === 'paper' && <span className="text-amber-300">· 图纸空间</span>}
                {data.parseMs != null && <span className="text-slate-400">· {(data.parseMs / 1000).toFixed(1)}s</span>}
              </div>

              {data.unknownEntityCount != null && data.unknownEntityCount > 15 && viewMode === 'vector' && (
                <div
                  className="px-2.5 py-1 rounded-md border backdrop-blur-md text-xs flex items-center gap-1.5"
                  style={{
                    backgroundColor: 'rgba(120, 53, 15, 0.78)',
                    borderColor: 'rgba(251, 191, 36, 0.45)',
                    color: '#fde68a'
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    含 {data.unknownEntityCount} 个专有自定义实体（如天正构件）
                    {data.embeddedPreviewDataUrl ? '，可点下方「内嵌原图」对照' : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Floating Layer Drawer (0ms Instant Toggle!) */}
            {layersOpen && sortedLayers.length > 0 && (
              <div
                data-cad-overlay="true"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 z-30 w-64 max-h-[70%] rounded-xl border shadow-2xl flex flex-col overflow-hidden backdrop-blur-md"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-strong)'
                }}
              >
                <div
                  className="px-3 py-2 border-b flex items-center justify-between text-xs shrink-0"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    图层管理 ({sortedLayers.length - hiddenLayerIndices.size}/{sortedLayers.length})
                  </span>
                  {hiddenLayerIndices.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setHiddenLayerIndices(new Set())}
                      className="hover:underline cursor-pointer"
                      style={{ color: 'var(--accent)' }}
                    >
                      全部显示
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                  {sortedLayers.map((layer) => {
                    const isHidden = hiddenLayerIndices.has(layer.idx)
                    return (
                      <button
                        key={layer.idx}
                        type="button"
                        onClick={() => handleToggleLayer(layer.idx)}
                        className="w-full px-2 py-1.5 rounded-md flex items-center gap-2 text-xs hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                        style={{
                          opacity: isHidden ? 0.45 : 1,
                          color: 'var(--text-primary)'
                        }}
                      >
                        {isHidden ? (
                          <EyeOff className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                        ) : (
                          <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                        )}
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                          style={{ backgroundColor: layer.color }}
                        />
                        <span className="flex-1 text-left truncate font-mono">{layer.name}</span>
                        <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                          {layer.entityCount}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Bottom Floating WinUI CAD Control Bar */}
            <div
              data-cad-overlay="true"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-2.5 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md flex items-center gap-1.5 flex-wrap justify-center max-w-[94%]"
              style={{
                backgroundColor: 'rgba(26, 26, 30, 0.86)',
                borderColor: 'rgba(255, 255, 255, 0.14)',
                color: '#f1f5f9'
              }}
            >
              {viewMode === 'vector' && (
                <>
                  <button
                    type="button"
                    onClick={() => zoomByFactor(1 / 1.4)}
                    className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-white/12 cursor-pointer"
                    title="缩小 (-)"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-12 text-center text-xs font-mono tabular-nums">{zoomPct}%</span>
                  <button
                    type="button"
                    onClick={() => zoomByFactor(1.4)}
                    className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-white/12 cursor-pointer"
                    title="放大 (+)"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={fitToView}
                    className="h-7 px-2 rounded-md flex items-center gap-1 text-xs hover:bg-white/12 cursor-pointer"
                    title="重置适应屏幕 (双击 / 0)"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>适应</span>
                  </button>

                  <div className="w-px h-4 bg-white/15 mx-0.5" />

                  {(['dark', 'blueprint', 'light'] as CadBgTheme[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBgTheme(t)}
                      className="h-7 px-2 rounded-md text-xs flex items-center gap-1 cursor-pointer transition-colors"
                      style={{
                        backgroundColor: bgTheme === t ? 'rgba(96, 205, 255, 0.22)' : 'transparent',
                        color: bgTheme === t ? '#60cdff' : '#cbd5e1'
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-white/30"
                        style={{ backgroundColor: BG_THEMES[t].bg }}
                      />
                      <span>{BG_THEMES[t].label}</span>
                    </button>
                  ))}

                  {data.texts.length > 0 && (
                    <>
                      <div className="w-px h-4 bg-white/15 mx-0.5" />
                      <button
                        type="button"
                        onClick={() => setShowTexts((v) => !v)}
                        className="h-7 px-2 rounded-md text-xs flex items-center gap-1 cursor-pointer transition-colors"
                        style={{
                          backgroundColor: showTexts ? 'rgba(96, 205, 255, 0.18)' : 'transparent',
                          color: showTexts ? '#60cdff' : '#94a3b8'
                        }}
                        title="显示/隐藏图纸文字标注"
                      >
                        <Type className="w-3.5 h-3.5" />
                        <span>文字</span>
                      </button>
                    </>
                  )}

                  {sortedLayers.length > 0 && (
                    <>
                      <div className="w-px h-4 bg-white/15 mx-0.5" />
                      <button
                        type="button"
                        onClick={() => setLayersOpen((v) => !v)}
                        className="h-7 px-2.5 rounded-md text-xs flex items-center gap-1 cursor-pointer transition-colors"
                        style={{
                          backgroundColor: layersOpen ? 'rgba(96, 205, 255, 0.22)' : 'transparent',
                          color: layersOpen ? '#60cdff' : '#e2e8f0'
                        }}
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>图层</span>
                      </button>
                    </>
                  )}
                </>
              )}

              {data.embeddedPreviewDataUrl && (
                <>
                  {viewMode === 'vector' && <div className="w-px h-4 bg-white/15 mx-0.5" />}
                  <button
                    type="button"
                    onClick={() => setViewMode((m) => (m === 'vector' ? 'embedded' : 'vector'))}
                    className="h-7 px-2.5 rounded-md text-xs flex items-center gap-1 cursor-pointer transition-colors"
                    style={{
                      backgroundColor: viewMode === 'embedded' ? 'rgba(251, 191, 36, 0.22)' : 'transparent',
                      color: viewMode === 'embedded' ? '#fbbf24' : '#cbd5e1'
                    }}
                    title="在矢量视图与 AutoCAD 文件内嵌预览图之间切换"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{viewMode === 'embedded' ? '切回矢量视图' : '内嵌原图'}</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
