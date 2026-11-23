import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowLeft,
  Columns2,
  Heart,
  Link2,
  Link2Off,
  RotateCcw,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { getFileMediaUrl, getThumbMediaUrl } from '../utils/mediaUrl'
import { formatFileSize, isPsdExt } from '@shared/mediaTypes'

export const CompareView: React.FC = () => {
  const { assets, compareAssetIds, closeCompare, toggleFavorite } = useLibraryStore(
    useShallow((s) => ({
      assets: s.assets,
      compareAssetIds: s.compareAssetIds,
      closeCompare: s.closeCompare,
      toggleFavorite: s.toggleFavorite
    }))
  )

  const items = useMemo(() => {
    const byId = new Map(assets.map((a) => [a.id, a]))
    return compareAssetIds.map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a))
  }, [assets, compareAssetIds])

  const [mode, setMode] = useState<'side-by-side' | 'curtain'>('side-by-side')
  const [syncView, setSyncView] = useState(true)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [curtainPct, setCurtainPct] = useState(50)

  const draggingPanRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const draggingCurtainRef = useRef(false)
  const curtainStageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (items.length !== 2 && mode === 'curtain') {
      setMode('side-by-side')
    }
  }, [items.length, mode])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeCompare()
      } else if (e.key === '0') {
        e.preventDefault()
        setScale(1)
        setPan({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeCompare])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingCurtainRef.current && curtainStageRef.current) {
        const rect = curtainStageRef.current.getBoundingClientRect()
        const pct = Math.max(2, Math.min(98, ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100))
        setCurtainPct(pct)
        return
      }
      if (draggingPanRef.current) {
        const { startX, startY, origX, origY } = draggingPanRef.current
        setPan({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) })
      }
    }
    const onUp = () => {
      draggingPanRef.current = null
      draggingCurtainRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (items.length < 2) return null

  const getImageUrl = (a: (typeof items)[number]) =>
    isPsdExt(a.ext) ? getThumbMediaUrl(a.thumbPath) || getFileMediaUrl(a.id) : getFileMediaUrl(a.id)

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setScale((prev) => Math.max(0.25, Math.min(8, Number((prev * factor).toFixed(3)))))
  }

  const handleStartPan = (e: React.MouseEvent) => {
    if (e.button !== 0 || scale <= 1.01) return
    e.preventDefault()
    draggingPanRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y }
  }

  const gridColsClass = items.length === 2 ? 'grid-cols-2' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2 grid-rows-2'

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden select-none">
      {/* Compare Header Bar */}
      <div
        className="h-12 shrink-0 px-4 border-b flex items-center justify-between gap-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={closeCompare}
            className="h-8 px-3 rounded-md border flex items-center gap-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回列表</span>
          </button>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            多图对比（{items.length} 张）
          </span>
        </div>

        <div className="flex items-center gap-2">
          {items.length === 2 && (
            <div
              className="flex items-center p-0.5 rounded-md border text-xs"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
            >
              <button
                type="button"
                onClick={() => setMode('side-by-side')}
                className="px-2.5 h-7 rounded flex items-center gap-1.5 cursor-pointer"
                style={{
                  backgroundColor: mode === 'side-by-side' ? 'var(--accent-solid)' : 'transparent',
                  color: mode === 'side-by-side' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span>并排对比</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('curtain')}
                className="px-2.5 h-7 rounded flex items-center gap-1.5 cursor-pointer"
                style={{
                  backgroundColor: mode === 'curtain' ? 'var(--accent-solid)' : 'transparent',
                  color: mode === 'curtain' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>卷帘对比</span>
              </button>
            </div>
          )}

          {mode === 'side-by-side' && (
            <button
              type="button"
              onClick={() => setSyncView((v) => !v)}
              className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 cursor-pointer"
              style={{
                backgroundColor: syncView ? 'var(--bg-active)' : 'var(--bg-surface)',
                borderColor: syncView ? 'var(--accent)' : 'var(--border-subtle)',
                color: syncView ? 'var(--accent)' : 'var(--text-secondary)'
              }}
              title="所有对比窗口同步缩放与拖拽"
            >
              {syncView ? <Link2 className="w-3.5 h-3.5" /> : <Link2Off className="w-3.5 h-3.5" />}
              <span>同步视口</span>
            </button>
          )}

          <div
            className="flex items-center gap-1 h-8 px-1.5 rounded-md border text-xs"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
          >
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.25, Number((s / 1.25).toFixed(3))))}
              className="p-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
              title="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="w-11 text-center font-mono tabular-nums">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(8, Number((s * 1.25).toFixed(3))))}
              className="p-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
              title="放大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setScale(1)
                setPan({ x: 0, y: 0 })
              }}
              className="p-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
              title="重置视图 (0)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Stage */}
      {mode === 'curtain' && items.length === 2 ? (
        <div
          ref={curtainStageRef}
          onWheel={handleWheel}
          onMouseDown={handleStartPan}
          className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center bg-black/25"
          style={{ cursor: scale > 1.01 ? 'grab' : 'default' }}
        >
          {/* Right / Base Image (B) */}
          <img
            src={getImageUrl(items[1])}
            alt={items[1].fileName}
            draggable={false}
            className="max-w-[92%] max-h-[90%] object-contain pointer-events-none"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`
            }}
          />

          {/* Left / Clipped Image (A) */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ clipPath: `inset(0 ${100 - curtainPct}% 0 0)` }}
          >
            <img
              src={getImageUrl(items[0])}
              alt={items[0].fileName}
              draggable={false}
              className="max-w-[92%] max-h-[90%] object-contain"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`
              }}
            />
          </div>

          {/* Draggable Curtain Handle */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation()
              draggingCurtainRef.current = true
            }}
            className="absolute top-0 bottom-0 w-8 -ml-4 cursor-ew-resize flex items-center justify-center z-20"
            style={{ left: `${curtainPct}%` }}
          >
            <div className="w-[2px] h-full bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.65)]" />
            <div className="absolute w-8 h-8 rounded-full bg-black/75 border-2 border-white text-white flex items-center justify-center text-xs shadow-xl">
              ↔
            </div>
          </div>

          {/* Floating Labels */}
          <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs backdrop-blur-sm max-w-[40%] truncate">
            A · {items[0].fileName}
            {items[0].width && items[0].height ? ` (${items[0].width}×${items[0].height})` : ''}
          </div>
          <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs backdrop-blur-sm max-w-[40%] truncate">
            B · {items[1].fileName}
            {items[1].width && items[1].height ? ` (${items[1].width}×${items[1].height})` : ''}
          </div>
        </div>
      ) : (
        <div className={`flex-1 min-h-0 grid ${gridColsClass} gap-2 p-2.5 overflow-hidden`}>
          {items.map((item) => (
            <div
              key={item.id}
              onWheel={handleWheel}
              onMouseDown={handleStartPan}
              className="relative rounded-xl border overflow-hidden flex flex-col bg-black/20"
              style={{
                borderColor: 'var(--border-subtle)',
                cursor: scale > 1.01 ? 'grab' : 'default'
              }}
            >
              <div className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center p-2">
                <img
                  src={getImageUrl(item)}
                  alt={item.fileName}
                  draggable={false}
                  className="max-w-full max-h-full object-contain pointer-events-none"
                  style={
                    syncView
                      ? { transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})` }
                      : undefined
                  }
                />
              </div>

              <div
                className="h-9 px-3 border-t flex items-center justify-between gap-2 text-xs shrink-0"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }} title={item.fileName}>
                  {item.fileName}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                    {formatFileSize(item.fileSize)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFavorite([item.id])
                    }}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                    style={{ color: item.isFavorite ? '#f43f5e' : 'var(--text-muted)' }}
                    title={item.isFavorite ? '取消收藏' : '收藏'}
                  >
                    <Heart className={`w-3.5 h-3.5 ${item.isFavorite ? 'fill-rose-500' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
