import React, { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Grid2x2,
  LayoutDashboard,
  SlidersHorizontal
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { flattenGroupTree } from '../utils/mediaUrl'
import { MEDIA_TYPE_LABELS } from '@shared/mediaTypes'
import type { GridAspectRatio, SortField } from '@shared/types'

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'modified_at', label: '修改时间' },
  { value: 'created_at', label: '创建时间' },
  { value: 'name', label: '名称' },
  { value: 'file_size', label: '文件大小' }
]

const ASPECT_OPTIONS: GridAspectRatio[] = ['4:3', '1:1', '16:9']

const SMART_VIEW_TITLES = {
  all: '全部素材',
  ungrouped: '未分类素材',
  recent: '最近添加',
  missing: '离线 / 失效文件',
  hidden: '已隐藏素材'
}

export const TopToolbar: React.FC = () => {
  const {
    smartView,
    mediaTypes,
    groupId,
    rootId,
    groups,
    sources,
    viewMode,
    gridAspectRatio,
    gridFitMode,
    cardSize,
    updateSettings,
    setCardSizeLocal,
    sortField,
    sortOrder,
    setSort,
    totalAssets
  } = useLibraryStore(
    useShallow((s) => ({
      smartView: s.smartView,
      mediaTypes: s.mediaTypes,
      groupId: s.groupId,
      rootId: s.rootId,
      groups: s.groups,
      sources: s.sources,
      viewMode: s.settings.viewMode,
      gridAspectRatio: s.settings.gridAspectRatio,
      gridFitMode: s.settings.gridFitMode,
      cardSize: s.settings.cardSize,
      updateSettings: s.updateSettings,
      setCardSizeLocal: s.setCardSizeLocal,
      sortField: s.sortField,
      sortOrder: s.sortOrder,
      setSort: s.setSort,
      totalAssets: s.totalAssets
    }))
  )

  const cardSizeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (cardSizeSaveTimerRef.current) clearTimeout(cardSizeSaveTimerRef.current)
    }
  }, [])

  const handleCardSizeChange = (val: number) => {
    setCardSizeLocal(val)
    if (cardSizeSaveTimerRef.current) clearTimeout(cardSizeSaveTimerRef.current)
    cardSizeSaveTimerRef.current = setTimeout(() => {
      cardSizeSaveTimerRef.current = null
      updateSettings({ cardSize: val })
    }, 180)
  }

  const flatGroups = useMemo(() => flattenGroupTree(groups), [groups])

  const contextTitle = useMemo(() => {
    if (groupId != null) {
      const found = flatGroups.find((g) => g.id === groupId)
      return found ? found.fullPath : '分组'
    }
    if (rootId != null) {
      const found = sources.find((s) => s.id === rootId)
      return found ? found.alias : '目录源'
    }
    return SMART_VIEW_TITLES[smartView]
  }, [groupId, rootId, smartView, flatGroups, sources])

  return (
    <div
      className="prism-glass-toolbar min-h-[48px] shrink-0 flex flex-wrap items-center justify-between gap-2.5 px-4 py-1.5 border-b"
      style={{
        borderColor: 'var(--border-subtle)'
      }}
    >
      {/* Left: Current Context Title & Count */}
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {contextTitle}
        </h2>
        {mediaTypes.length > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full shrink-0"
            style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
          >
            {mediaTypes.map((t) => MEDIA_TYPE_LABELS[t]).join(' + ')}
          </span>
        )}
        <span className="text-xs shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {totalAssets} 项
        </span>
      </div>

      {/* Right: View Mode, Grid Ratio, Zoom Slider, Sort */}
      <div className="flex items-center flex-wrap gap-2">
        {/* View Mode Segmented Switcher */}
        <div
          className="flex items-center p-0.5 rounded-md border"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <button
            type="button"
            onClick={() => updateSettings({ viewMode: 'waterfall' })}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: viewMode === 'waterfall' ? 'var(--accent-solid)' : 'transparent',
              color: viewMode === 'waterfall' ? 'var(--accent-text)' : 'var(--text-secondary)'
            }}
            title="瀑布流展示（保留原始比例）"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>瀑布流</span>
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ viewMode: 'grid' })}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: viewMode === 'grid' ? 'var(--accent-solid)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--accent-text)' : 'var(--text-secondary)'
            }}
            title="等比网格展示（统一比例卡片）"
          >
            <Grid2x2 className="w-3.5 h-3.5" />
            <span>等比</span>
          </button>
        </div>

        {/* Grid ratio & fit quick toggles */}
        {viewMode === 'grid' && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                const idx = ASPECT_OPTIONS.indexOf(gridAspectRatio)
                const next = ASPECT_OPTIONS[(idx + 1) % ASPECT_OPTIONS.length]
                updateSettings({ gridAspectRatio: next })
              }}
              className="h-8 px-2.5 rounded-md text-xs font-medium border hover:bg-[var(--bg-hover)] cursor-pointer tabular-nums"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)'
              }}
              title="切换等比画布比例 (4:3 / 1:1 / 16:9)"
            >
              {gridAspectRatio}
            </button>
            <button
              type="button"
              onClick={() =>
                updateSettings({ gridFitMode: gridFitMode === 'cover' ? 'contain' : 'cover' })
              }
              className="h-8 px-2.5 rounded-md text-xs font-medium border hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)'
              }}
              title="切换填充方式：裁剪填满 / 完整留白"
            >
              {gridFitMode === 'cover' ? '填满' : '完整'}
            </button>
          </div>
        )}

        {/* Card zoom slider (instant local layout + debounced SQLite persist) */}
        <div
          className="hidden md:flex items-center gap-2 px-2.5 h-8 rounded-md border"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)'
          }}
          title={`卡片宽度: ${cardSize}px`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          <input
            type="range"
            min={150}
            max={360}
            step={10}
            value={cardSize}
            onChange={(e) => handleCardSizeChange(Number(e.target.value))}
            className="w-20 accent-[var(--accent-solid)] cursor-pointer"
          />
        </div>

        {/* Sort control */}
        <div
          className="flex items-center h-8 rounded-md border overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <select
            value={sortField}
            onChange={(e) => setSort(e.target.value as SortField)}
            className="h-full pl-2.5 pr-1.5 text-xs bg-transparent outline-none cursor-pointer"
            style={{ color: 'var(--text-primary)' }}
            title="选择排序依据"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ backgroundColor: 'var(--bg-surface)' }}>
                按{opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSort(sortField, sortOrder === 'asc' ? 'desc' : 'asc')}
            className="h-full px-2.5 border-l hover:bg-[var(--bg-hover)] cursor-pointer flex items-center"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            title={sortOrder === 'asc' ? '当前：升序（点击切换降序）' : '当前：降序（点击切换升序）'}
          >
            {sortOrder === 'asc' ? (
              <ArrowUpNarrowWide className="w-4 h-4" />
            ) : (
              <ArrowDownWideNarrow className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
