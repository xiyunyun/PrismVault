import React, { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Columns2,
  Filter,
  Grid2x2,
  LayoutDashboard,
  Palette,
  SlidersHorizontal,
  StickyNote,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { flattenGroupTree } from '../utils/mediaUrl'
import { MEDIA_TYPE_LABELS } from '@shared/mediaTypes'
import type { AspectFilter, FileSizeFilter, GridAspectRatio, SortField } from '@shared/types'

const COLOR_PRESETS = [
  { hex: '#ef4444', label: '红' },
  { hex: '#f97316', label: '橙' },
  { hex: '#eab308', label: '黄' },
  { hex: '#22c55e', label: '绿' },
  { hex: '#06b6d4', label: '青' },
  { hex: '#3b82f6', label: '蓝' },
  { hex: '#8b5cf6', label: '紫' },
  { hex: '#ec4899', label: '粉' },
  { hex: '#f5f5f5', label: '白' },
  { hex: '#262626', label: '深黑' }
]

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'modified_at', label: '修改时间' },
  { value: 'created_at', label: '创建时间' },
  { value: 'name', label: '名称' },
  { value: 'file_size', label: '文件大小' }
]

const ASPECT_OPTIONS: GridAspectRatio[] = ['4:3', '1:1', '16:9']

const SMART_VIEW_TITLES = {
  all: '全部素材',
  favorites: '我的收藏',
  ungrouped: '未分类素材',
  recent: '最近添加',
  missing: '离线 / 失效文件',
  hidden: '已隐藏素材'
}

export const TopToolbar: React.FC = () => {
  const {
    smartView,
    mediaTypes,
    extensions,
    aspectFilter,
    sizeFilter,
    hasNoteOnly,
    colorHex,
    filterBarOpen,
    toggleFilterBar,
    toggleExtension,
    setAspectFilter,
    setSizeFilter,
    setHasNoteOnly,
    setColorHex,
    clearAdvancedFilters,
    groupId,
    rootId,
    groups,
    sources,
    stats,
    assets,
    selectedIds,
    openCompare,
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
      extensions: s.extensions,
      aspectFilter: s.aspectFilter,
      sizeFilter: s.sizeFilter,
      hasNoteOnly: s.hasNoteOnly,
      colorHex: s.colorHex,
      filterBarOpen: s.filterBarOpen,
      toggleFilterBar: s.toggleFilterBar,
      toggleExtension: s.toggleExtension,
      setAspectFilter: s.setAspectFilter,
      setSizeFilter: s.setSizeFilter,
      setHasNoteOnly: s.setHasNoteOnly,
      setColorHex: s.setColorHex,
      clearAdvancedFilters: s.clearAdvancedFilters,
      groupId: s.groupId,
      rootId: s.rootId,
      groups: s.groups,
      sources: s.sources,
      stats: s.stats,
      assets: s.assets,
      selectedIds: s.selectedIds,
      openCompare: s.openCompare,
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

  const activeAdvancedCount =
    (extensions.length > 0 ? 1 : 0) +
    (aspectFilter !== 'all' ? 1 : 0) +
    (sizeFilter !== 'all' ? 1 : 0) +
    (hasNoteOnly ? 1 : 0) +
    (colorHex ? 1 : 0)

  const comparableImageIds = useMemo(() => {
    if (selectedIds.length < 2 || selectedIds.length > 4) return []
    const set = new Set(selectedIds)
    const imgs = assets.filter((a) => set.has(a.id) && a.mediaType === 'image')
    return imgs.length >= 2 ? imgs.map((a) => a.id) : []
  }, [selectedIds, assets])

  // Context-aware extension list: if specific media types are selected, show only extensions present under those types
  const availableExtensions = useMemo(() => {
    if (mediaTypes.length > 0 && stats.extensionsByType) {
      const merged = new Map<string, number>()
      for (const mt of mediaTypes) {
        const list = stats.extensionsByType[mt] ?? []
        for (const item of list) {
          merged.set(item.ext, (merged.get(item.ext) ?? 0) + item.count)
        }
      }
      return Array.from(merged.entries())
        .map(([ext, count]) => ({ ext, count }))
        .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
    }
    return stats.extensions ?? []
  }, [mediaTypes, stats.extensions, stats.extensionsByType])

  return (
    <div
      className="prism-glass-toolbar shrink-0 border-b"
      style={{
        borderColor: 'var(--border-subtle)'
      }}
    >
      <div className="min-h-[48px] flex flex-wrap items-center justify-between gap-2.5 px-4 py-1.5">
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
          {extensions.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              {extensions.slice(0, 4).map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => toggleExtension(ext)}
                  className="inline-flex items-center gap-1 text-xs font-mono uppercase px-2 py-0.5 rounded-full border cursor-pointer hover:bg-[var(--bg-hover)]"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)'
                  }}
                  title={`点击取消 ${ext.toUpperCase()} 筛选`}
                >
                  <span>{ext.replace(/^\./, '')}</span>
                  <X className="w-3 h-3" />
                </button>
              ))}
              {extensions.length > 4 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                >
                  +{extensions.length - 4}
                </span>
              )}
            </div>
          )}
          {colorHex && (
            <button
              type="button"
              onClick={() => setColorHex(null)}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border cursor-pointer shrink-0"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              title="点击清除按色筛选"
            >
              <span className="w-2.5 h-2.5 rounded-full border border-black/20" style={{ backgroundColor: colorHex }} />
              <span className="font-mono">{colorHex.toUpperCase()}</span>
              <X className="w-3 h-3" />
            </button>
          )}
          <span className="text-xs shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {totalAssets} 项
          </span>
        </div>

        {/* Right: Compare, Filter Toggle, View Mode, Grid Ratio, Zoom Slider, Sort */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Multi-Image Compare Button (visible when 2~4 images selected) */}
          {comparableImageIds.length >= 2 && (
            <button
              type="button"
              onClick={() => openCompare(comparableImageIds)}
              className="h-8 px-2.5 rounded-md text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer shadow-sm hover:opacity-95 transition-opacity"
              style={{ backgroundColor: 'var(--accent-solid)' }}
              title="进入多图并排 / 卷帘对比模式（快捷键 C）"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>对比 ({comparableImageIds.length})</span>
            </button>
          )}

          {/* Multi-Dimensional Filter Toggle */}
          <button
            type="button"
            onClick={toggleFilterBar}
            className="h-8 px-2.5 rounded-md border text-xs font-medium flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            style={{
              backgroundColor: filterBarOpen || activeAdvancedCount > 0 ? 'var(--bg-active)' : 'var(--bg-surface)',
              borderColor: filterBarOpen || activeAdvancedCount > 0 ? 'var(--accent)' : 'var(--border-subtle)',
              color: filterBarOpen || activeAdvancedCount > 0 ? 'var(--accent)' : 'var(--text-secondary)'
            }}
            title="展开/收起多维筛选与按色找图"
          >
            <Filter className="w-3.5 h-3.5" />
            <span>筛选</span>
            {activeAdvancedCount > 0 && (
              <span
                className="px-1.5 rounded-full text-[0.68rem] font-semibold text-white"
                style={{ backgroundColor: 'var(--accent-solid)' }}
              >
                {activeAdvancedCount}
              </span>
            )}
          </button>
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

      {/* Expandable Multi-Dimensional Filter & Color Search Bar */}
      {filterBarOpen && (
        <div
          className="px-4 py-2.5 border-t space-y-2 text-xs"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--glass-pill)' }}
        >
          {/* Row 1: Color Search + Aspect + Size + Note */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Color Palette Filter */}
            <div className="flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-muted)' }}>按色找图：</span>
              <div className="flex items-center gap-1">
                {COLOR_PRESETS.map((c) => {
                  const selected = colorHex?.toLowerCase() === c.hex.toLowerCase()
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setColorHex(selected ? null : c.hex)}
                      className="w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-115 border"
                      style={{
                        backgroundColor: c.hex,
                        borderColor: selected ? 'var(--text-primary)' : 'rgba(128,128,128,0.35)',
                        boxShadow: selected ? '0 0 0 2px var(--accent)' : undefined
                      }}
                      title={`按${c.label}色系筛选`}
                    />
                  )
                })}
                <label
                  className="w-5 h-5 rounded-full border flex items-center justify-center cursor-pointer overflow-hidden text-[0.65rem]"
                  style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                  title="自定义色板选色"
                >
                  <input
                    type="color"
                    value={colorHex || '#38bdf8'}
                    onChange={(e) => setColorHex(e.target.value)}
                    className="opacity-0 w-0 h-0 absolute"
                  />
                  <span>+</span>
                </label>
              </div>
            </div>

            {/* Aspect Ratio Filter */}
            <div className="flex items-center gap-1">
              <span style={{ color: 'var(--text-muted)' }}>构图：</span>
              {(
                [
                  { id: 'all', label: '全部' },
                  { id: 'landscape', label: '横图' },
                  { id: 'portrait', label: '竖图' },
                  { id: 'square', label: '方图' }
                ] as Array<{ id: AspectFilter; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAspectFilter(opt.id)}
                  className="px-2 h-6 rounded border cursor-pointer transition-colors"
                  style={{
                    backgroundColor: aspectFilter === opt.id ? 'var(--bg-active)' : 'var(--bg-surface)',
                    borderColor: aspectFilter === opt.id ? 'var(--accent)' : 'var(--border-subtle)',
                    color: aspectFilter === opt.id ? 'var(--accent)' : 'var(--text-secondary)'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* File Size Filter */}
            <div className="flex items-center gap-1">
              <span style={{ color: 'var(--text-muted)' }}>体积：</span>
              {(
                [
                  { id: 'all', label: '不限' },
                  { id: 'small', label: '<1MB' },
                  { id: 'medium', label: '1~20MB' },
                  { id: 'large', label: '>20MB' }
                ] as Array<{ id: FileSizeFilter; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSizeFilter(opt.id)}
                  className="px-2 h-6 rounded border cursor-pointer transition-colors"
                  style={{
                    backgroundColor: sizeFilter === opt.id ? 'var(--bg-active)' : 'var(--bg-surface)',
                    borderColor: sizeFilter === opt.id ? 'var(--accent)' : 'var(--border-subtle)',
                    color: sizeFilter === opt.id ? 'var(--accent)' : 'var(--text-secondary)'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Has Note Toggle */}
            <button
              type="button"
              onClick={() => setHasNoteOnly(!hasNoteOnly)}
              className="px-2.5 h-6 rounded border flex items-center gap-1 cursor-pointer transition-colors"
              style={{
                backgroundColor: hasNoteOnly ? 'var(--bg-active)' : 'var(--bg-surface)',
                borderColor: hasNoteOnly ? 'var(--accent)' : 'var(--border-subtle)',
                color: hasNoteOnly ? 'var(--accent)' : 'var(--text-secondary)'
              }}
            >
              <StickyNote className="w-3 h-3" />
              <span>仅看有备注</span>
            </button>

            {activeAdvancedCount > 0 && (
              <button
                type="button"
                onClick={clearAdvancedFilters}
                className="ml-auto px-2 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer font-medium"
                style={{ color: 'var(--accent)' }}
              >
                清除条件
              </button>
            )}
          </div>

          {/* Row 2: Dynamic Extension Chips (filtered to selected media types when active) */}
          {availableExtensions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="mr-1" style={{ color: 'var(--text-muted)' }}>
                {mediaTypes.length === 1 ? `${MEDIA_TYPE_LABELS[mediaTypes[0]]}格式：` : '格式：'}
              </span>
              {availableExtensions.slice(0, 24).map((item) => {
                const active = extensions.includes(item.ext.toLowerCase())
                return (
                  <button
                    key={item.ext}
                    type="button"
                    onClick={() => toggleExtension(item.ext)}
                    className="px-2 h-6 rounded border font-mono uppercase cursor-pointer transition-colors flex items-center gap-1"
                    style={{
                      backgroundColor: active ? 'var(--bg-active)' : 'var(--bg-surface)',
                      borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)'
                    }}
                  >
                    <span>{item.ext.replace('.', '')}</span>
                    <span className="text-[0.65rem] opacity-70">{item.count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
