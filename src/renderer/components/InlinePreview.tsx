import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  ExternalLink,
  Eye,
  File,
  FolderOpen,
  Heart,
  Maximize2,
  Music,
  Pipette,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { SAFE_MARKDOWN_COMPONENTS } from '../utils/markdown'
import { getFileMediaUrl, getThumbMediaUrl } from '../utils/mediaUrl'
import {
  formatDuration,
  formatFileSize,
  is3DModelExt,
  isCadExt,
  isMarkdownExt,
  isPdfExt,
  isReadableTextExt
} from '@shared/mediaTypes'
import type { Asset, TextContentResult } from '@shared/types'

const Model3DPreview = React.lazy(() =>
  import('./Model3DPreview').then((m) => ({ default: m.Model3DPreview }))
)
const CadPreview = React.lazy(() =>
  import('./CadPreview').then((m) => ({ default: m.CadPreview }))
)

const ZOOM_STEPS = [0.25, 0.35, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5]
const DBLCLICK_ZOOM_SCALE = 2.25
const EDGE_ZONE_PX = 110
const EDGE_FADE_DELAY_MS = 2000
const WHEEL_NAV_THROTTLE_MS = 140
const ALPHA_CAPABLE_EXTS = new Set(['.png', '.webp', '.psd', '.psb', '.gif', '.avif', '.ico', '.svg', '.tif', '.tiff'])

type AlphaBackdropMode = 'checkerboard' | 'dark' | 'light'

let alphaProbeCanvas: HTMLCanvasElement | null = null

export function detectImageTransparency(img: HTMLImageElement, ext: string): boolean {
  if (!ALPHA_CAPABLE_EXTS.has(ext.toLowerCase())) return false
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return false
  try {
    if (!alphaProbeCanvas) {
      alphaProbeCanvas = document.createElement('canvas')
    }
    const maxSample = 96
    const scale = Math.min(1, maxSample / Math.max(nw, nh))
    const sw = Math.max(1, Math.round(nw * scale))
    const sh = Math.max(1, Math.round(nh * scale))
    alphaProbeCanvas.width = sw
    alphaProbeCanvas.height = sh
    const ctx = alphaProbeCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.clearRect(0, 0, sw, sh)
    ctx.drawImage(img, 0, 0, sw, sh)
    const { data } = ctx.getImageData(0, 0, sw, sh)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 254) return true
    }
    return false
  } catch {
    return false
  }
}

interface TransformState {
  scale: number
  x: number
  y: number
  rotation: number // Unbounded cumulative angle (no % 360!) so every ±90° turn animates smoothly in the exact direction
}

interface ImageControlHandle {
  zoomStep: (dir: 1 | -1) => void
  resetFit: () => void
  rotateCw: () => void
  rotateCcw: () => void
}

// ===================== High-Performance GPU Image Stage =====================
const ImageStage: React.FC<{
  asset: Asset
  fileUrl: string
  wheelMode: 'zoom' | 'navigate'
  alphaBackdrop: AlphaBackdropMode
  eyedropperActive: boolean
  onPickColor: (hex: string, rgb: string) => void
  onAlphaDetected: (hasAlpha: boolean) => void
  onNavigateWheel: (dir: -1 | 1) => void
  onZoomDisplayChange: (scale: number) => void
  controlRef: React.MutableRefObject<ImageControlHandle | null>
}> = ({
  asset,
  fileUrl,
  wheelMode,
  alphaBackdrop,
  eyedropperActive,
  onPickColor,
  onAlphaDetected,
  onNavigateWheel,
  onZoomDisplayChange,
  controlRef
}) => {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const eyedropperCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const tfRef = useRef<TransformState>({ scale: 1, x: 0, y: 0, rotation: 0 })
  const [eyedropperSample, setEyedropperSample] = useState<{
    x: number
    y: number
    hex: string
    rgb: string
  } | null>(null)

  useEffect(() => {
    eyedropperCanvasRef.current = null
    setEyedropperSample(null)
  }, [asset.id])

  const samplePixelAtClientPoint = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage || !img.naturalWidth || !img.naturalHeight) return null
    const rect = img.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null
    }
    try {
      let canvas = eyedropperCanvasRef.current
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return null
        ctx.drawImage(img, 0, 0)
        eyedropperCanvasRef.current = canvas
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null

      // Account for 90-degree cumulative rotation cleanly
      const rot = (((tfRef.current.rotation % 360) + 360) % 360)
      const u = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
      const v = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)))
      let nu = u
      let nv = v
      if (rot === 90) {
        nu = v
        nv = 1 - u
      } else if (rot === 180) {
        nu = 1 - u
        nv = 1 - v
      } else if (rot === 270) {
        nu = 1 - v
        nv = u
      }
      const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(nu * canvas.width)))
      const py = Math.min(canvas.height - 1, Math.max(0, Math.floor(nv * canvas.height)))
      const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
      const stageRect = stage.getBoundingClientRect()
      return {
        x: clientX - stageRect.left,
        y: clientY - stageRect.top,
        hex,
        rgb: `rgb(${r}, ${g}, ${b})`
      }
    } catch {
      return null
    }
  }, [])
  const rafRef = useRef<number | null>(null)
  const wheelModeRef = useRef(wheelMode)
  const onNavRef = useRef(onNavigateWheel)
  wheelModeRef.current = wheelMode
  onNavRef.current = onNavigateWheel

  const dragRef = useRef<{
    active: boolean
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  }>({ active: false, pointerId: -1, startX: 0, startY: 0, originX: 0, originY: 0 })

  const [isDragging, setIsDragging] = useState(false)
  const [canPan, setCanPan] = useState(false)
  const [hasAlpha, setHasAlpha] = useState(false)

  const applyTransform = useCallback(
    (animate: boolean) => {
      const img = imgRef.current
      if (!img) return
      const { scale, x, y, rotation } = tfRef.current
      img.style.transition = animate ? 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'
      img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${rotation}deg)`
      onZoomDisplayChange(scale)
      setCanPan(scale > 1.005)
    },
    [onZoomDisplayChange]
  )

  const scheduleApply = useCallback(
    (animate: boolean) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        applyTransform(animate)
      })
    },
    [applyTransform]
  )

  useEffect(() => {
    tfRef.current = { scale: 1, x: 0, y: 0, rotation: 0 }
    setHasAlpha(false)
    onAlphaDetected(false)
    applyTransform(false)
    // Also probe immediately if image is already synchronously complete from browser cache
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth > 0) {
      const detected = detectImageTransparency(el, asset.ext)
      setHasAlpha(detected)
      onAlphaDetected(detected)
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [asset.id, asset.ext, applyTransform, onAlphaDetected])

  const stepScale = useCallback(
    (dir: 1 | -1, anchorClientX?: number, anchorClientY?: number, animate = false) => {
      const cur = tfRef.current
      let nextScale = cur.scale
      if (dir > 0) {
        const found = ZOOM_STEPS.find((s) => s > cur.scale + 0.01)
        nextScale = found ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
      } else {
        for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
          if (ZOOM_STEPS[i] < cur.scale - 0.01) {
            nextScale = ZOOM_STEPS[i]
            break
          }
        }
      }
      if (Math.abs(nextScale - cur.scale) < 0.001) return

      let nextX = cur.x
      let nextY = cur.y

      if (nextScale <= 1) {
        nextX = 0
        nextY = 0
      } else if (anchorClientX != null && anchorClientY != null && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect()
        const cx = anchorClientX - (rect.left + rect.width / 2)
        const cy = anchorClientY - (rect.top + rect.height / 2)
        const ratio = nextScale / cur.scale
        nextX = cx - (cx - cur.x) * ratio
        nextY = cy - (cy - cur.y) * ratio
      } else {
        const ratio = nextScale / cur.scale
        nextX = cur.x * ratio
        nextY = cur.y * ratio
      }

      tfRef.current = { ...cur, scale: nextScale, x: nextX, y: nextY }
      scheduleApply(animate)
    },
    [scheduleApply]
  )

  const resetFit = useCallback(() => {
    const cur = tfRef.current
    tfRef.current = { ...cur, scale: 1, x: 0, y: 0 }
    applyTransform(true)
  }, [applyTransform])

  const rotateCw = useCallback(() => {
    const cur = tfRef.current
    tfRef.current = { ...cur, rotation: cur.rotation + 90 }
    applyTransform(true)
  }, [applyTransform])

  const rotateCcw = useCallback(() => {
    const cur = tfRef.current
    tfRef.current = { ...cur, rotation: cur.rotation - 90 }
    applyTransform(true)
  }, [applyTransform])

  useEffect(() => {
    controlRef.current = {
      zoomStep: (dir) => stepScale(dir, undefined, undefined, true),
      resetFit,
      rotateCw,
      rotateCcw
    }
    return () => {
      controlRef.current = null
    }
  }, [controlRef, stepScale, resetFit, rotateCw, rotateCcw])

  // Non-passive wheel listener supporting XOR swap between Zoom and Prev/Next navigation via Ctrl
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY === 0) return
      const ctrlHeld = e.ctrlKey || e.metaKey
      const shouldZoom = (wheelModeRef.current === 'zoom') !== ctrlHeld
      if (shouldZoom) {
        const dir: 1 | -1 = e.deltaY < 0 ? 1 : -1
        stepScale(dir, e.clientX, e.clientY, false)
      } else {
        const navDir: -1 | 1 = e.deltaY < 0 ? -1 : 1
        onNavRef.current(navDir)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stepScale])

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const cur = tfRef.current
    const isStandardFit = Math.abs(cur.scale - 1) < 0.02 && Math.abs(cur.x) < 2 && Math.abs(cur.y) < 2

    if (isStandardFit) {
      const rect = stageRef.current?.getBoundingClientRect()
      let nextX = 0
      let nextY = 0
      if (rect) {
        const cx = e.clientX - (rect.left + rect.width / 2)
        const cy = e.clientY - (rect.top + rect.height / 2)
        nextX = cx * (1 - DBLCLICK_ZOOM_SCALE)
        nextY = cy * (1 - DBLCLICK_ZOOM_SCALE)
      }
      tfRef.current = { ...cur, scale: DBLCLICK_ZOOM_SCALE, x: nextX, y: nextY }
      applyTransform(true)
    } else {
      tfRef.current = { ...cur, scale: 1, x: 0, y: 0 }
      applyTransform(true)
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (tfRef.current.scale <= 1.005) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: tfRef.current.x,
      originY: tfRef.current.y
    }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    tfRef.current.x = d.originX + dx
    tfRef.current.y = d.originY + dy
    scheduleApply(false)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    setIsDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const wheelHint =
    wheelMode === 'zoom'
      ? '滚轮分级缩放；Ctrl+滚轮 切换上下张；双击局部放大/还原；放大后拖拽平移'
      : '滚轮切换上下张；Ctrl+滚轮 分级缩放；双击局部放大/还原；放大后拖拽平移'

  return (
    <div
      ref={stageRef}
      onDoubleClick={eyedropperActive ? undefined : handleDoubleClick}
      onPointerDown={(e) => {
        if (eyedropperActive) {
          e.preventDefault()
          const sample = samplePixelAtClientPoint(e.clientX, e.clientY)
          if (sample) onPickColor(sample.hex, sample.rgb)
          return
        }
        handlePointerDown(e)
      }}
      onPointerMove={(e) => {
        if (eyedropperActive) {
          setEyedropperSample(samplePixelAtClientPoint(e.clientX, e.clientY))
          return
        }
        handlePointerMove(e)
      }}
      onPointerUp={eyedropperActive ? undefined : handlePointerUp}
      onPointerCancel={eyedropperActive ? undefined : handlePointerUp}
      onPointerLeave={() => {
        if (eyedropperActive) setEyedropperSample(null)
      }}
      className="w-full h-full flex items-center justify-center overflow-hidden relative select-none"
      style={{
        cursor: eyedropperActive ? 'crosshair' : canPan ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
        touchAction: 'none'
      }}
      title={eyedropperActive ? '取色吸管模式：点击画面任意像素复制 HEX 色值（按 I 或 Esc 退出）' : wheelHint}
    >
      <img
        ref={imgRef}
        data-inline-preview-img="true"
        src={fileUrl}
        alt={asset.fileName}
        crossOrigin="anonymous"
        draggable={false}
        decoding="async"
        onLoad={(e) => {
          eyedropperCanvasRef.current = null
          const detected = detectImageTransparency(e.currentTarget, asset.ext)
          setHasAlpha(detected)
          onAlphaDetected(detected)
        }}
        className={`max-w-[94%] max-h-[92%] w-auto h-auto select-none pointer-events-none ${
          hasAlpha
            ? alphaBackdrop === 'checkerboard'
              ? 'alpha-checkerboard'
              : alphaBackdrop === 'dark'
                ? 'alpha-backdrop-dark'
                : 'alpha-backdrop-light'
            : ''
        }`}
        style={{
          willChange: 'transform',
          transformOrigin: 'center center'
        }}
      />

      {/* Floating Eyedropper Pixel Swatch Readout */}
      {eyedropperActive && eyedropperSample && (
        <div
          className="pointer-events-none absolute z-30 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border shadow-xl text-xs font-mono"
          style={{
            left: `${Math.min(eyedropperSample.x + 18, (stageRef.current?.clientWidth ?? 600) - 180)}px`,
            top: `${Math.max(12, eyedropperSample.y - 44)}px`,
            backgroundColor: 'rgba(16, 18, 26, 0.92)',
            borderColor: 'rgba(255,255,255,0.22)',
            color: '#f8fafc'
          }}
        >
          <span
            className="w-5 h-5 rounded border border-white/40 shrink-0"
            style={{ backgroundColor: eyedropperSample.hex }}
          />
          <div className="leading-tight">
            <div className="font-semibold">{eyedropperSample.hex}</div>
            <div className="text-[0.65rem] text-neutral-300">{eyedropperSample.rgb}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===================== Main Integrated Inline Preview Pane =====================
export const InlinePreview: React.FC = () => {
  const {
    assets,
    totalAssets,
    hasMoreAssets,
    loadingMore,
    loadMoreAssets,
    previewWheelMode,
    previewAssetId,
    setPreviewAssetId,
    selectAsset,
    toggleFavorite,
    refreshAssets,
    showToast
  } = useLibraryStore(
    useShallow((s) => ({
      assets: s.assets,
      totalAssets: s.totalAssets,
      hasMoreAssets: s.hasMoreAssets,
      loadingMore: s.loadingMore,
      loadMoreAssets: s.loadMoreAssets,
      previewWheelMode: s.settings.previewWheelMode,
      previewAssetId: s.previewAssetId,
      setPreviewAssetId: s.setPreviewAssetId,
      selectAsset: s.selectAsset,
      toggleFavorite: s.toggleFavorite,
      refreshAssets: s.refreshAssets,
      showToast: s.showToast
    }))
  )

  const currentIndex = useMemo(
    () => (previewAssetId != null ? assets.findIndex((a) => a.id === previewAssetId) : -1),
    [assets, previewAssetId]
  )
  const asset = currentIndex >= 0 ? assets[currentIndex] : null

  const imageControlRef = useRef<ImageControlHandle | null>(null)
  const stageContainerRef = useRef<HTMLDivElement>(null)
  const videoElRef = useRef<HTMLVideoElement>(null)
  const lastWheelNavRef = useRef(0)

  // Edge floating navigation buttons with 2-second auto-fade
  const [showLeftEdge, setShowLeftEdge] = useState(false)
  const [showRightEdge, setShowRightEdge] = useState(false)
  const leftFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rightFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveringLeftBtnRef = useRef(false)
  const hoveringRightBtnRef = useRef(false)

  const [zoomScale, setZoomScale] = useState(1)
  const [imageHasAlpha, setImageHasAlpha] = useState(false)
  const [alphaBackdrop, setAlphaBackdrop] = useState<AlphaBackdropMode>('checkerboard')
  const [eyedropperActive, setEyedropperActive] = useState(false)
  const [capturingVideoCover, setCapturingVideoCover] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [textData, setTextData] = useState<TextContentResult | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  const [mdRenderMode, setMdRenderMode] = useState<'rendered' | 'raw'>('rendered')

  useEffect(() => {
    return () => {
      if (leftFadeTimerRef.current) clearTimeout(leftFadeTimerRef.current)
      if (rightFadeTimerRef.current) clearTimeout(rightFadeTimerRef.current)
    }
  }, [])

  const revealLeftEdge = useCallback(() => {
    if (leftFadeTimerRef.current) {
      clearTimeout(leftFadeTimerRef.current)
      leftFadeTimerRef.current = null
    }
    setShowLeftEdge(true)
  }, [])

  const scheduleHideLeftEdge = useCallback(() => {
    if (hoveringLeftBtnRef.current) return
    if (leftFadeTimerRef.current) return
    leftFadeTimerRef.current = setTimeout(() => {
      leftFadeTimerRef.current = null
      if (!hoveringLeftBtnRef.current) setShowLeftEdge(false)
    }, EDGE_FADE_DELAY_MS)
  }, [])

  const revealRightEdge = useCallback(() => {
    if (rightFadeTimerRef.current) {
      clearTimeout(rightFadeTimerRef.current)
      rightFadeTimerRef.current = null
    }
    setShowRightEdge(true)
  }, [])

  const scheduleHideRightEdge = useCallback(() => {
    if (hoveringRightBtnRef.current) return
    if (rightFadeTimerRef.current) return
    rightFadeTimerRef.current = setTimeout(() => {
      rightFadeTimerRef.current = null
      if (!hoveringRightBtnRef.current) setShowRightEdge(false)
    }, EDGE_FADE_DELAY_MS)
  }, [])

  const handleStageMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const relX = e.clientX - rect.left
      const nearLeft = relX <= EDGE_ZONE_PX
      const nearRight = rect.width - relX <= EDGE_ZONE_PX

      if (nearLeft) revealLeftEdge()
      else if (showLeftEdge) scheduleHideLeftEdge()

      if (nearRight) revealRightEdge()
      else if (showRightEdge) scheduleHideRightEdge()
    },
    [revealLeftEdge, scheduleHideLeftEdge, revealRightEdge, scheduleHideRightEdge, showLeftEdge, showRightEdge]
  )

  const handleStageMouseLeave = useCallback(() => {
    if (showLeftEdge) scheduleHideLeftEdge()
    if (showRightEdge) scheduleHideRightEdge()
  }, [showLeftEdge, showRightEdge, scheduleHideLeftEdge, scheduleHideRightEdge])

  useEffect(() => {
    setZoomScale(1)
    setVideoError(false)
    setTextData(null)
    setMdRenderMode('rendered')

    if (asset && asset.mediaType === 'text' && isReadableTextExt(asset.ext)) {
      setTextLoading(true)
      window.api.assets
        .readTextContent(asset.id)
        .then((res) => setTextData(res))
        .catch(() => setTextData({ content: '无法读取文本内容。', truncated: false, totalBytes: 0 }))
        .finally(() => setTextLoading(false))
    }
  }, [asset?.id])

  // Auto-prefetch next page when approaching the end of currently loaded assets during inline preview
  useEffect(() => {
    if (currentIndex >= 0 && currentIndex >= assets.length - 5 && hasMoreAssets && !loadingMore) {
      loadMoreAssets().catch(() => undefined)
    }
  }, [currentIndex, assets.length, hasMoreAssets, loadingMore, loadMoreAssets])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      const prev = assets[currentIndex - 1]
      setPreviewAssetId(prev.id)
      selectAsset(prev.id)
    }
  }, [assets, currentIndex, selectAsset, setPreviewAssetId])

  const goNext = useCallback(async () => {
    if (currentIndex >= 0 && currentIndex < assets.length - 1) {
      const next = assets[currentIndex + 1]
      setPreviewAssetId(next.id)
      selectAsset(next.id)
      return
    }
    if (currentIndex >= 0 && currentIndex === assets.length - 1 && hasMoreAssets && !loadingMore) {
      await loadMoreAssets()
      const latest = useLibraryStore.getState().assets
      if (currentIndex < latest.length - 1) {
        const next = latest[currentIndex + 1]
        setPreviewAssetId(next.id)
        selectAsset(next.id)
      }
    }
  }, [assets, currentIndex, hasMoreAssets, loadingMore, loadMoreAssets, selectAsset, setPreviewAssetId])

  const handleThrottledWheelNavigate = useCallback(
    (dir: -1 | 1) => {
      const now = Date.now()
      if (now - lastWheelNavRef.current < WHEEL_NAV_THROTTLE_MS) return
      lastWheelNavRef.current = now
      if (dir < 0) goPrev()
      else goNext()
    },
    [goPrev, goNext]
  )

  // Wheel navigation for non-image/non-model media types (3D/CAD and ImageStage handle wheel directly)
  useEffect(() => {
    const el = stageContainerRef.current
    if (!el || !asset || asset.mediaType === 'image' || asset.mediaType === 'model') return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      const ctrlHeld = e.ctrlKey || e.metaKey
      if (asset.mediaType === 'text') {
        if (!ctrlHeld) return // Let user scroll text/markdown naturally
        e.preventDefault()
        handleThrottledWheelNavigate(e.deltaY < 0 ? -1 : 1)
        return
      }
      const shouldNavigate = (previewWheelMode === 'navigate') !== ctrlHeld
      if (shouldNavigate) {
        e.preventDefault()
        handleThrottledWheelNavigate(e.deltaY < 0 ? -1 : 1)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [asset, previewWheelMode, handleThrottledWheelNavigate])

  useEffect(() => {
    if (!asset) return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (isEditing) return

      if (e.key === 'Escape') {
        if (eyedropperActive) {
          setEyedropperActive(false)
          return
        }
        setPreviewAssetId(null)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        toggleFavorite([asset.id])
      } else if (asset.mediaType === 'image' && e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setEyedropperActive((v) => !v)
      } else if (asset.mediaType === 'image' && (e.key === '+' || e.key === '=')) {
        imageControlRef.current?.zoomStep(1)
      } else if (asset.mediaType === 'image' && e.key === '-') {
        imageControlRef.current?.zoomStep(-1)
      } else if (asset.mediaType === 'image' && e.key === '0') {
        imageControlRef.current?.resetFit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [asset, eyedropperActive, goPrev, goNext, setPreviewAssetId, toggleFavorite])

  const handleCaptureVideoCover = async () => {
    const vid = videoElRef.current
    if (!asset || !vid || capturingVideoCover) return
    if (!vid.videoWidth || !vid.videoHeight) {
      showToast('视频画面尚未加载完成，请稍后再试', 'error')
      return
    }
    setCapturingVideoCover(true)
    try {
      const canvas = document.createElement('canvas')
      const maxDim = 720
      const scale = Math.min(1, maxDim / Math.max(vid.videoWidth, vid.videoHeight))
      canvas.width = Math.max(1, Math.round(vid.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(vid.videoHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas context unavailable')
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/png')
      const saved = await window.api.assets.saveRenderedThumb(asset.id, dataUrl)
      if (saved) {
        showToast('已将当前视频帧设为封面缩略图', 'success')
        await refreshAssets()
      } else {
        showToast('保存封面缩略图失败', 'error')
      }
    } catch {
      showToast('截取视频当前帧失败', 'error')
    } finally {
      setCapturingVideoCover(false)
    }
  }

  if (!asset) return null

  const fileUrl = getFileMediaUrl(asset.id)
  const thumbUrl = getThumbMediaUrl(asset.thumbPath)
  const isFitScale = Math.abs(zoomScale - 1) < 0.02
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < assets.length - 1 || hasMoreAssets

  const renderInlineContent = () => {
    if (asset.mediaType === 'image') {
      return (
        <ImageStage
          asset={asset}
          fileUrl={fileUrl}
          wheelMode={previewWheelMode}
          alphaBackdrop={alphaBackdrop}
          eyedropperActive={eyedropperActive}
          onPickColor={async (hex, rgb) => {
            await window.api.system.copyPath(hex)
            showToast(`已取色并复制 ${hex} (${rgb})`, 'success')
          }}
          onAlphaDetected={setImageHasAlpha}
          onNavigateWheel={handleThrottledWheelNavigate}
          onZoomDisplayChange={setZoomScale}
          controlRef={imageControlRef}
        />
      )
    }

    if (asset.mediaType === 'video') {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-5">
          {videoError ? (
            <div
              className="max-w-md rounded-xl border p-6 text-center space-y-3"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <AlertCircle className="w-10 h-10 mx-auto text-amber-400" />
              <div className="text-sm font-semibold">当前视频编码无法直接在内置播放器解码</div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                该格式 ({asset.ext.toUpperCase()}) 需要系统本地播放器解码。你可以一键使用系统默认播放器打开。
              </p>
              <button
                type="button"
                onClick={() => window.api.system.openExternal(asset.filePath)}
                className="h-9 px-4 rounded-md text-xs font-medium text-white cursor-pointer"
                style={{ backgroundColor: 'var(--accent-solid)' }}
              >
                用系统默认播放器打开
              </button>
            </div>
          ) : (
            <video
              ref={videoElRef}
              key={asset.id}
              src={fileUrl}
              crossOrigin="anonymous"
              controls
              autoPlay
              onError={() => setVideoError(true)}
              className="max-w-full max-h-full rounded-xl shadow-xl bg-black outline-none"
            />
          )}
        </div>
      )
    }

    if (asset.mediaType === 'audio') {
      return (
        <div className="w-full h-full flex items-center justify-center p-6">
          <div
            className="w-full max-w-lg rounded-2xl border p-7 shadow-lg flex flex-col items-center gap-5"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="w-48 h-48 rounded-2xl overflow-hidden shadow-md flex items-center justify-center bg-gradient-to-br from-emerald-500/20 to-sky-500/25 border border-white/10">
              {thumbUrl ? (
                <img src={thumbUrl} alt={asset.fileName} className="w-full h-full object-cover" />
              ) : (
                <Music className="w-16 h-16" style={{ color: 'var(--accent)' }} />
              )}
            </div>
            <div className="text-center space-y-1 max-w-full">
              <div className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {asset.extraMeta?.title || asset.fileName}
              </div>
              {(asset.extraMeta?.artist || asset.extraMeta?.album) && (
                <div className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                  {[asset.extraMeta.artist, asset.extraMeta.album].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                {asset.ext.toUpperCase()}
                {asset.duration != null ? ` · ${formatDuration(asset.duration)}` : ''}
                {asset.extraMeta?.bitrate ? ` · ${Math.round(asset.extraMeta.bitrate / 1000)} kbps` : ''}
              </div>
            </div>
            <audio key={asset.id} src={fileUrl} controls autoPlay className="w-full" />
          </div>
        </div>
      )
    }

    if (asset.mediaType === 'text' && isPdfExt(asset.ext)) {
      return (
        <div className="w-full h-full p-3 flex items-center justify-center">
          <iframe
            key={asset.id}
            src={fileUrl}
            title={asset.fileName}
            className="w-full h-full rounded-lg border bg-white"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        </div>
      )
    }

    if (asset.mediaType === 'text') {
      const isMd = isMarkdownExt(asset.ext)
      return (
        <div className="w-full h-full flex flex-col overflow-hidden">
          {textData?.truncated && (
            <div
              className="px-4 py-1.5 text-xs border-b shrink-0"
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--warning)'
              }}
            >
              该文件体积较大（{formatFileSize(textData.totalBytes)}），当前仅内嵌显示前 512 KB 内容。
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-7 py-6 select-text">
            {textLoading ? (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                正在加载文本内容...
              </div>
            ) : isMd && mdRenderMode === 'rendered' ? (
              <div className="markdown-body max-w-4xl mx-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={SAFE_MARKDOWN_COMPONENTS}>
                  {textData?.content || ''}
                </ReactMarkdown>
              </div>
            ) : (
              <pre
                className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words max-w-5xl mx-auto m-0"
                style={{ color: 'var(--text-primary)' }}
              >
                {textData?.content || ''}
              </pre>
            )}
          </div>
        </div>
      )
    }

    if (asset.mediaType === 'model' && isCadExt(asset.ext)) {
      return (
        <Suspense
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6">
              <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                正在加载 CAD 预览引擎...
              </div>
            </div>
          }
        >
          <CadPreview
            asset={asset}
            wheelMode={previewWheelMode}
            onNavigateWheel={handleThrottledWheelNavigate}
            onMetadataUpdated={refreshAssets}
          />
        </Suspense>
      )
    }

    if (asset.mediaType === 'model' && is3DModelExt(asset.ext)) {
      return (
        <Suspense
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6">
              <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                正在加载 3D 渲染引擎...
              </div>
            </div>
          }
        >
          <Model3DPreview
            asset={asset}
            wheelMode={previewWheelMode}
            onNavigateWheel={handleThrottledWheelNavigate}
            onThumbSaved={refreshAssets}
            onToast={showToast}
          />
        </Suspense>
      )
    }

    return (
      <div className="w-full h-full flex items-center justify-center p-6">
        <div
          className="max-w-md rounded-xl border p-7 text-center space-y-3"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <File className="w-12 h-12 mx-auto" style={{ color: 'var(--text-muted)' }} />
          <div className="text-sm font-semibold break-all">{asset.fileName}</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {formatFileSize(asset.fileSize)}
          </div>
          <button
            type="button"
            onClick={() => window.api.system.openExternal(asset.filePath)}
            className="h-9 px-4 rounded-md text-xs font-medium text-white cursor-pointer"
            style={{ backgroundColor: 'var(--accent-solid)' }}
          >
            用系统默认软件打开
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex-1 min-w-0 h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      {/* Integrated Inline Preview Command Bar */}
      <div
        className="min-h-[48px] px-3.5 py-1.5 border-b flex items-center justify-between gap-3 shrink-0"
        style={{
          backgroundColor: 'var(--bg-canvas)',
          borderColor: 'var(--border-subtle)'
        }}
      >
        {/* Left: Back to Grid + Prev/Next + Filename */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setPreviewAssetId(null)}
            className="h-8 px-3 rounded-md border flex items-center gap-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer shrink-0 transition-colors"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)'
            }}
            title="返回资源列表 (Esc)"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回列表</span>
          </button>

          <div
            className="flex items-center rounded-md border overflow-hidden shrink-0"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <button
              type="button"
              disabled={!hasPrev}
              onClick={goPrev}
              className="h-8 w-8 flex items-center justify-center hover:bg-[var(--bg-hover)] disabled:opacity-35 cursor-pointer"
              title="上一个 (←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span
              className="px-2 text-xs font-mono tabular-nums border-x"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              {currentIndex + 1} / {Math.max(assets.length, totalAssets)}
            </span>
            <button
              type="button"
              disabled={!hasNext}
              onClick={goNext}
              className="h-8 w-8 flex items-center justify-center hover:bg-[var(--bg-hover)] disabled:opacity-35 cursor-pointer"
              title="下一个 (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <span
            className="text-sm font-medium truncate ml-1"
            style={{ color: 'var(--text-primary)' }}
            title={asset.fileName}
          >
            {asset.fileName}
          </span>
        </div>

        {/* Right: Media-specific Controls & System Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {asset.mediaType === 'image' && (
            <button
              type="button"
              onClick={() => setEyedropperActive((v) => !v)}
              className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
              style={{
                backgroundColor: eyedropperActive ? 'var(--bg-active)' : 'var(--bg-surface)',
                borderColor: eyedropperActive ? 'var(--accent)' : 'var(--border-subtle)',
                color: eyedropperActive ? 'var(--accent)' : 'var(--text-secondary)'
              }}
              title="像素吸管取色器 (快捷键 I)"
            >
              <Pipette className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{eyedropperActive ? '取色中' : '取色'}</span>
            </button>
          )}

          {asset.mediaType === 'video' && !videoError && (
            <button
              type="button"
              disabled={capturingVideoCover}
              onClick={handleCaptureVideoCover}
              className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)'
              }}
              title="截取当前播放画面作为视频封面缩略图"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>{capturingVideoCover ? '保存中...' : '设为封面'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => toggleFavorite([asset.id])}
            className="h-8 w-8 rounded-md border flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            style={{
              backgroundColor: asset.isFavorite ? 'rgba(244, 63, 94, 0.14)' : 'var(--bg-surface)',
              borderColor: asset.isFavorite ? 'rgba(244, 63, 94, 0.45)' : 'var(--border-subtle)',
              color: asset.isFavorite ? '#f43f5e' : 'var(--text-muted)'
            }}
            title={asset.isFavorite ? '取消收藏 (F)' : '收藏 (F)'}
          >
            <Heart className={`w-3.5 h-3.5 ${asset.isFavorite ? 'fill-rose-500' : ''}`} />
          </button>

          {asset.mediaType === 'image' && (
            <div
              className="flex items-center gap-0.5 px-1 h-8 rounded-md border mr-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <button
                type="button"
                onClick={() => imageControlRef.current?.zoomStep(-1)}
                className="h-7 w-7 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer"
                title="缩小 (-)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => imageControlRef.current?.resetFit()}
                className="h-7 px-2 rounded text-xs font-mono tabular-nums hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: isFitScale ? 'var(--accent)' : 'var(--text-primary)' }}
                title="还原适应屏幕大小 (0 或双击图片)"
              >
                {isFitScale ? '适应' : `${Math.round(zoomScale * 100)}%`}
              </button>
              <button
                type="button"
                onClick={() => imageControlRef.current?.zoomStep(1)}
                className="h-7 w-7 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer"
                title="放大 (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => imageControlRef.current?.resetFit()}
                className="h-7 w-7 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer"
                title="适应窗口 (0)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--border-subtle)' }} />
              <button
                type="button"
                onClick={() => imageControlRef.current?.rotateCcw()}
                className="h-7 w-7 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer"
                title="逆时针旋转 90°"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => imageControlRef.current?.rotateCw()}
                className="h-7 w-7 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer"
                title="顺时针旋转 90°"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              {imageHasAlpha && (
                <>
                  <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--border-subtle)' }} />
                  <button
                    type="button"
                    onClick={() =>
                      setAlphaBackdrop((m) =>
                        m === 'checkerboard' ? 'dark' : m === 'dark' ? 'light' : 'checkerboard'
                      )
                    }
                    className="h-7 px-2 rounded text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                    style={{ color: 'var(--accent)' }}
                    title="检测到 Alpha 透明通道：点击切换透明底色（棋盘格 / 深色 / 浅色）"
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-[3px] shrink-0 ${
                        alphaBackdrop === 'checkerboard'
                          ? 'alpha-checkerboard'
                          : alphaBackdrop === 'dark'
                            ? 'alpha-backdrop-dark'
                            : 'alpha-backdrop-light'
                      }`}
                      style={{ backgroundSize: '8px 8px', boxShadow: '0 0 0 1px var(--border-strong)' }}
                    />
                    <span>
                      {alphaBackdrop === 'checkerboard' ? '棋盘底' : alphaBackdrop === 'dark' ? '深色底' : '浅色底'}
                    </span>
                  </button>
                </>
              )}
            </div>
          )}

          {asset.mediaType === 'text' && isMarkdownExt(asset.ext) && (
            <div
              className="flex items-center p-0.5 rounded-md border mr-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <button
                type="button"
                onClick={() => setMdRenderMode('rendered')}
                className="px-2.5 h-7 rounded text-xs flex items-center gap-1 cursor-pointer"
                style={{
                  backgroundColor: mdRenderMode === 'rendered' ? 'var(--accent-solid)' : 'transparent',
                  color: mdRenderMode === 'rendered' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                <Eye className="w-3.5 h-3.5" />
                渲染
              </button>
              <button
                type="button"
                onClick={() => setMdRenderMode('raw')}
                className="px-2.5 h-7 rounded text-xs flex items-center gap-1 cursor-pointer"
                style={{
                  backgroundColor: mdRenderMode === 'raw' ? 'var(--accent-solid)' : 'transparent',
                  color: mdRenderMode === 'raw' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                <Code className="w-3.5 h-3.5" />
                源码
              </button>
            </div>
          )}

          {asset.mediaType === 'text' && textData && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(textData.content)
                showToast('已复制文本内容', 'success')
              }}
              className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>复制</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => window.api.system.revealInExplorer(asset.filePath)}
            className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            title="在资源管理器中定位"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">定位</span>
          </button>

          <button
            type="button"
            onClick={() => window.api.system.openExternal(asset.filePath)}
            className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            title="用系统默认软件打开"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">系统打开</span>
          </button>
        </div>
      </div>

      {/* Inline Media Stage with Edge Auto-Fade Prev/Next Floating Controls */}
      <div
        ref={stageContainerRef}
        onMouseMove={handleStageMouseMove}
        onMouseLeave={handleStageMouseLeave}
        className="flex-1 min-h-0 relative overflow-hidden"
      >
        {renderInlineContent()}

        {/* Edge Hover Sensor Strips (ensures edge detection works even over PDF iframes) */}
        {hasPrev && (
          <div
            onMouseEnter={revealLeftEdge}
            onMouseLeave={scheduleHideLeftEdge}
            className="absolute left-0 top-12 bottom-12 w-6 z-20"
          />
        )}
        {hasNext && (
          <div
            onMouseEnter={revealRightEdge}
            onMouseLeave={scheduleHideRightEdge}
            className="absolute right-0 top-12 bottom-12 w-6 z-20"
          />
        )}

        {/* Left Edge Floating Previous Button (fades smoothly after 2s away from edge) */}
        {hasPrev && (
          <button
            type="button"
            onClick={goPrev}
            onMouseEnter={() => {
              hoveringLeftBtnRef.current = true
              revealLeftEdge()
            }}
            onMouseLeave={() => {
              hoveringLeftBtnRef.current = false
              scheduleHideLeftEdge()
            }}
            className={`absolute left-4 top-1/2 -translate-y-1/2 z-30 w-11 h-20 rounded-xl border shadow-xl backdrop-blur-md flex items-center justify-center cursor-pointer transition-all duration-500 hover:scale-105 ${
              showLeftEdge ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            style={{
              backgroundColor: 'rgba(28, 28, 32, 0.72)',
              borderColor: 'rgba(255, 255, 255, 0.16)',
              color: '#ffffff'
            }}
            title="上一个文件 (←)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Right Edge Floating Next Button (fades smoothly after 2s away from edge) */}
        {hasNext && (
          <button
            type="button"
            onClick={goNext}
            onMouseEnter={() => {
              hoveringRightBtnRef.current = true
              revealRightEdge()
            }}
            onMouseLeave={() => {
              hoveringRightBtnRef.current = false
              scheduleHideRightEdge()
            }}
            className={`absolute right-4 top-1/2 -translate-y-1/2 z-30 w-11 h-20 rounded-xl border shadow-xl backdrop-blur-md flex items-center justify-center cursor-pointer transition-all duration-500 hover:scale-105 ${
              showRightEdge ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            style={{
              backgroundColor: 'rgba(28, 28, 32, 0.72)',
              borderColor: 'rgba(255, 255, 255, 0.16)',
              color: '#ffffff'
            }}
            title="下一个文件 (→)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>
  )
}
