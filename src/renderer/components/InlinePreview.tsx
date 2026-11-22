import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  ExternalLink,
  Eye,
  File,
  FolderOpen,
  Maximize2,
  Music,
  RotateCw,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { getFileMediaUrl, getThumbMediaUrl } from '../utils/mediaUrl'
import {
  formatDuration,
  formatFileSize,
  isMarkdownExt,
  isPdfExt,
  isReadableTextExt
} from '@shared/mediaTypes'
import type { Asset, TextContentResult } from '@shared/types'

const ZOOM_STEPS = [0.25, 0.35, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5]
const DBLCLICK_ZOOM_SCALE = 2.25

interface TransformState {
  scale: number
  x: number
  y: number
  rotation: number
}

// ===================== High-Performance GPU Image Stage =====================
const ImageStage: React.FC<{
  asset: Asset
  fileUrl: string
  zoomDisplay: number
  onZoomDisplayChange: (scale: number) => void
  controlRef: React.MutableRefObject<{
    zoomStep: (dir: 1 | -1) => void
    resetFit: () => void
    rotate90: () => void
  } | null>
}> = ({ asset, fileUrl, onZoomDisplayChange, controlRef }) => {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const tfRef = useRef<TransformState>({ scale: 1, x: 0, y: 0, rotation: 0 })
  const rafRef = useRef<number | null>(null)
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

  // Reset when switching images
  useEffect(() => {
    tfRef.current = { scale: 1, x: 0, y: 0, rotation: 0 }
    applyTransform(false)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [asset.id, applyTransform])

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

  const rotate90 = useCallback(() => {
    const cur = tfRef.current
    tfRef.current = { ...cur, rotation: (cur.rotation + 90) % 360 }
    applyTransform(true)
  }, [applyTransform])

  useEffect(() => {
    controlRef.current = {
      zoomStep: (dir) => stepScale(dir, undefined, undefined, true),
      resetFit,
      rotate90
    }
    return () => {
      controlRef.current = null
    }
  }, [controlRef, stepScale, resetFit, rotate90])

  // Non-passive wheel listener for responsive, stepped cursor-anchored zoom
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY === 0) return
      const dir: 1 | -1 = e.deltaY < 0 ? 1 : -1
      stepScale(dir, e.clientX, e.clientY, false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stepScale])

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const cur = tfRef.current
    const isStandardFit = Math.abs(cur.scale - 1) < 0.02 && Math.abs(cur.x) < 2 && Math.abs(cur.y) < 2

    if (isStandardFit) {
      // Local zoom centered around where the user double-clicked
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
      // From ANY non-standard zoom level, double-click smoothly restores fit-to-screen
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

  return (
    <div
      ref={stageRef}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="w-full h-full flex items-center justify-center overflow-hidden relative select-none"
      style={{
        cursor: canPan ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
        touchAction: 'none'
      }}
      title="双击局部放大 / 再次双击还原适应屏幕；滚轮分级缩放；放大后可自由拖拽"
    >
      <img
        ref={imgRef}
        src={fileUrl}
        alt={asset.fileName}
        draggable={false}
        decoding="async"
        className="max-w-[94%] max-h-[92%] object-contain select-none pointer-events-none"
        style={{
          willChange: 'transform',
          transformOrigin: 'center center'
        }}
      />
    </div>
  )
}

// ===================== Main Integrated Inline Preview Pane =====================
export const InlinePreview: React.FC = () => {
  const { assets, previewAssetId, setPreviewAssetId, selectAsset, showToast } = useLibraryStore()

  const currentIndex = useMemo(
    () => (previewAssetId != null ? assets.findIndex((a) => a.id === previewAssetId) : -1),
    [assets, previewAssetId]
  )
  const asset = currentIndex >= 0 ? assets[currentIndex] : null

  const imageControlRef = useRef<{
    zoomStep: (dir: 1 | -1) => void
    resetFit: () => void
    rotate90: () => void
  } | null>(null)

  const [zoomScale, setZoomScale] = useState(1)
  const [videoError, setVideoError] = useState(false)
  const [textData, setTextData] = useState<TextContentResult | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  const [mdRenderMode, setMdRenderMode] = useState<'rendered' | 'raw'>('rendered')

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

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      const prev = assets[currentIndex - 1]
      setPreviewAssetId(prev.id)
      selectAsset(prev.id)
    }
  }, [assets, currentIndex, selectAsset, setPreviewAssetId])

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < assets.length - 1) {
      const next = assets[currentIndex + 1]
      setPreviewAssetId(next.id)
      selectAsset(next.id)
    }
  }, [assets, currentIndex, selectAsset, setPreviewAssetId])

  useEffect(() => {
    if (!asset) return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (isEditing) return

      if (e.key === 'Escape') {
        setPreviewAssetId(null)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key === '+' || e.key === '=') {
        imageControlRef.current?.zoomStep(1)
      } else if (e.key === '-') {
        imageControlRef.current?.zoomStep(-1)
      } else if (e.key === '0') {
        imageControlRef.current?.resetFit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [asset, goPrev, goNext, setPreviewAssetId])

  if (!asset) return null

  const fileUrl = getFileMediaUrl(asset.id)
  const thumbUrl = getThumbMediaUrl(asset.thumbPath)
  const isFitScale = Math.abs(zoomScale - 1) < 0.02

  const renderInlineContent = () => {
    if (asset.mediaType === 'image') {
      return (
        <ImageStage
          asset={asset}
          fileUrl={fileUrl}
          zoomDisplay={zoomScale}
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
              key={asset.id}
              src={fileUrl}
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{textData?.content || ''}</ReactMarkdown>
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
              disabled={currentIndex <= 0}
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
              {currentIndex + 1} / {assets.length}
            </span>
            <button
              type="button"
              disabled={currentIndex >= assets.length - 1}
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
              <button
                type="button"
                onClick={() => imageControlRef.current?.rotate90()}
                className="h-7 w-7 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer"
                title="顺时针旋转 90°"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
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

      {/* Inline Media Stage */}
      <div className="flex-1 min-h-0 relative overflow-hidden">{renderInlineContent()}</div>
    </div>
  )
}
