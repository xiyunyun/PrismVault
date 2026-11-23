import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Check,
  ChevronRight,
  Columns2,
  Copy,
  Eye,
  ExternalLink,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Heart,
  Image as ImageIcon,
  Plus,
  SearchX,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { AssetCard } from './AssetCard'
import { AppLogo } from './AppLogo'
import { getFileMediaUrl, GROUP_COLORS } from '../utils/mediaUrl'
import { isPdfExt } from '@shared/mediaTypes'
import type { Asset, GridAspectRatio, GroupNode } from '@shared/types'

const GAP = 16
const PADDING = 18
const CARD_FOOTER_HEIGHT = 56
const OVERSCAN_PX = 700

interface LayoutItem {
  asset: Asset
  x: number
  y: number
  width: number
  height: number
  mediaHeight: number
}

const MAIN_MENU_W = 228
const SUBMENU_W = 220
const SUBMENU_MAX_H = 340
const VIEWPORT_PAD = 10

interface ContextMenuState {
  x: number
  y: number
  asset: Asset
  groupMenuOpen: boolean
  hoveredGroupPath: number[]
  columnAnchorYs: number[]
}

interface QuickCreateGroupState {
  parentId: number | null
  parentPathLabel: string | null
  targetAssetIds: number[]
  name: string
  color: string
}

function getGridRatioValue(ratio: GridAspectRatio): number {
  if (ratio === '1:1') return 1
  if (ratio === '16:9') return 16 / 9
  return 4 / 3
}

function getWaterfallAspectRatio(asset: Asset): number {
  if (
    (asset.mediaType === 'image' || asset.mediaType === 'video' || asset.mediaType === 'model') &&
    asset.width &&
    asset.height &&
    asset.height > 0
  ) {
    const raw = asset.width / asset.height
    return Math.min(Math.max(raw, 0.48), 2.1)
  }
  if (asset.mediaType === 'model') return 4 / 3
  if (asset.mediaType === 'audio') return 1.2
  if (asset.mediaType === 'text') return isPdfExt(asset.ext) ? 0.85 : 0.95
  return 1.25
}

interface AssetCanvasProps {
  hidden?: boolean
}

export const AssetCanvas: React.FC<AssetCanvasProps> = ({ hidden = false }) => {
  const {
    assets,
    sources,
    groups,
    viewMode,
    gridAspectRatio,
    gridFitMode,
    cardSize,
    videoHoverPreview,
    smartView,
    groupId,
    selectedIds,
    totalAssets,
    hasMoreAssets,
    loadingMore,
    loadMoreAssets,
    selectAsset,
    clearSelection,
    setPreviewAssetId,
    toggleFavorite,
    openCompare,
    setInternalDragAssetIds,
    resetFilters,
    playingAudioId,
    setPlayingAudioId,
    refreshAll,
    showToast,
    confirm
  } = useLibraryStore(
    useShallow((s) => ({
      assets: s.assets,
      sources: s.sources,
      groups: s.groups,
      viewMode: s.settings.viewMode,
      gridAspectRatio: s.settings.gridAspectRatio,
      gridFitMode: s.settings.gridFitMode,
      cardSize: s.settings.cardSize,
      videoHoverPreview: s.settings.videoHoverPreview,
      smartView: s.smartView,
      groupId: s.groupId,
      selectedIds: s.selectedIds,
      totalAssets: s.totalAssets,
      hasMoreAssets: s.hasMoreAssets,
      loadingMore: s.loadingMore,
      loadMoreAssets: s.loadMoreAssets,
      selectAsset: s.selectAsset,
      clearSelection: s.clearSelection,
      setPreviewAssetId: s.setPreviewAssetId,
      toggleFavorite: s.toggleFavorite,
      openCompare: s.openCompare,
      setInternalDragAssetIds: s.setInternalDragAssetIds,
      resetFilters: s.resetFilters,
      playingAudioId: s.playingAudioId,
      setPlayingAudioId: s.setPlayingAudioId,
      refreshAll: s.refreshAll,
      showToast: s.showToast,
      confirm: s.confirm
    }))
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const quickGroupInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const savedScrollTopRef = useRef(0)
  const scrollRafRef = useRef<number | null>(null)
  const [viewport, setViewport] = useState({ width: 900, height: 700 })
  const [scrollTop, setScrollTop] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [quickCreateGroup, setQuickCreateGroup] = useState<QuickCreateGroupState | null>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Measure container width & height reactively — outer <main ref={containerRef}> is ALWAYS mounted
  // so ResizeObserver continuously responds when LeftSidebar / RightInspector open, close, or resize!
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) {
        setViewport((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
      }
    }
    update()
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width)
        const h = Math.floor(entry.contentRect.height)
        if (w > 0 && h > 0) {
          setViewport((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
        }
      }
    })
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // Restore exact scrollTop & re-measure when returning from inline preview
  useEffect(() => {
    if (!hidden && containerRef.current) {
      const el = containerRef.current
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setViewport({ width: el.clientWidth, height: el.clientHeight })
      }
      el.scrollTop = savedScrollTopRef.current
      setScrollTop(savedScrollTopRef.current)
    }
  }, [hidden])

  useEffect(() => {
    if (!contextMenu) return
    const onPointerDown = (e: MouseEvent) => {
      if (contextMenuRef.current?.contains(e.target as Node)) return
      setContextMenu(null)
    }
    const onScroll = (e: Event) => {
      // Allow scrolling freely inside any cascading submenu column without dismissing the menu
      if (contextMenuRef.current?.contains(e.target as Node)) return
      setContextMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [Boolean(contextMenu)])

  useEffect(() => {
    if (!quickCreateGroup) return
    const raf = requestAnimationFrame(() => quickGroupInputRef.current?.focus())
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQuickCreateGroup(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [Boolean(quickCreateGroup)])

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('ended', () => {
        useLibraryStore.getState().setPlayingAudioId(null)
      })
    }
    const audio = audioRef.current
    if (playingAudioId == null) {
      audio.pause()
      return
    }
    const targetSrc = getFileMediaUrl(playingAudioId)
    if (audio.src !== targetSrc) {
      audio.src = targetSrc
    }
    audio.play().catch(() => {
      useLibraryStore.getState().setPlayingAudioId(null)
    })
  }, [playingAudioId])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current)
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    }
  }, [])

  const { layoutItems, totalHeight, maxItemHeight } = useMemo(() => {
    const innerWidth = Math.max(220, viewport.width - PADDING * 2)
    const targetColWidth = cardSize
    const cols = Math.max(1, Math.floor((innerWidth + GAP) / (targetColWidth + GAP)))
    const colWidth = (innerWidth - GAP * (cols - 1)) / cols

    if (viewMode === 'waterfall') {
      const colHeights = new Array<number>(cols).fill(PADDING)
      const items: LayoutItem[] = new Array(assets.length)
      let maxHItem = 0

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i]
        let minCol = 0
        for (let c = 1; c < cols; c++) {
          if (colHeights[c] < colHeights[minCol]) minCol = c
        }
        const ratio = getWaterfallAspectRatio(asset)
        const mediaHeight = Math.round(colWidth / ratio)
        const totalCardHeight = mediaHeight + CARD_FOOTER_HEIGHT
        if (totalCardHeight > maxHItem) maxHItem = totalCardHeight
        const x = PADDING + minCol * (colWidth + GAP)
        const y = colHeights[minCol]

        items[i] = { asset, x, y, width: colWidth, height: totalCardHeight, mediaHeight }
        colHeights[minCol] = y + totalCardHeight + GAP
      }

      const maxH = Math.max(...colHeights, viewport.height) + PADDING
      return { layoutItems: items, totalHeight: maxH, maxItemHeight: maxHItem }
    } else {
      const ratio = getGridRatioValue(gridAspectRatio)
      const mediaHeight = Math.round(colWidth / ratio)
      const totalCardHeight = mediaHeight + CARD_FOOTER_HEIGHT
      const items: LayoutItem[] = new Array(assets.length)

      for (let i = 0; i < assets.length; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = PADDING + col * (colWidth + GAP)
        const y = PADDING + row * (totalCardHeight + GAP)
        items[i] = { asset: assets[i], x, y, width: colWidth, height: totalCardHeight, mediaHeight }
      }

      const rows = Math.ceil(assets.length / cols)
      const maxH = Math.max(PADDING * 2 + rows * (totalCardHeight + GAP), viewport.height)
      return { layoutItems: items, totalHeight: maxH, maxItemHeight: totalCardHeight }
    }
  }, [assets, viewport.width, viewport.height, cardSize, viewMode, gridAspectRatio])

  // layoutItems[i].y is monotonically non-decreasing in BOTH waterfall and grid modes -> O(log N + K) binary search!
  const visibleItems = useMemo(() => {
    const n = layoutItems.length
    if (n === 0) return []
    const minY = scrollTop - OVERSCAN_PX
    const maxY = scrollTop + viewport.height + OVERSCAN_PX
    const searchStartY = minY - maxItemHeight

    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (layoutItems[mid].y < searchStartY) lo = mid + 1
      else hi = mid
    }

    const result: LayoutItem[] = []
    for (let i = lo; i < n; i++) {
      const item = layoutItems[i]
      if (item.y > maxY) break
      if (item.y + item.height >= minY) {
        result.push(item)
      }
    }
    return result
  }, [layoutItems, maxItemHeight, scrollTop, viewport.height])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const top = el.scrollTop
    savedScrollTopRef.current = top
    if (el.scrollHeight - top - el.clientHeight < 950) {
      const s = useLibraryStore.getState()
      if (s.hasMoreAssets && !s.loadingMore && !s.loading) {
        s.loadMoreAssets()
      }
    }
    if (scrollRafRef.current != null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      setScrollTop(savedScrollTopRef.current)
    })
  }, [])

  const handleAddSource = async () => {
    const added = await window.api.sources.pickAndAdd()
    if (added) {
      showToast(`已挂载目录「${added.alias}」，正在扫描...`, 'success')
      await refreshAll()
    }
  }

  // Stable card callbacks so React.memo on AssetCard actually skips unchanged cards!
  const handleCardSelect = useCallback(
    (e: React.MouseEvent, asset: Asset) => {
      e.stopPropagation()
      selectAsset(asset.id, {
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey
      })
    },
    [selectAsset]
  )

  const handleCardDoubleClick = useCallback(
    (asset: Asset) => {
      setPreviewAssetId(asset.id)
    },
    [setPreviewAssetId]
  )

  const handleCardDragStart = useCallback(
    (e: React.DragEvent, asset: Asset) => {
      const state = useLibraryStore.getState()
      const curSelected = state.selectedIds
      const idsToDrag = curSelected.includes(asset.id) ? curSelected : [asset.id]
      const idSet = new Set(idsToDrag)
      const filePaths = state.assets.filter((a) => idSet.has(a.id)).map((a) => a.filePath)

      // Track internal drag IDs so LeftSidebar groups can accept drops while Native OS Drag-Out
      // lets the user drag real files directly out into Photoshop / Blender / AutoCAD / WeChat / Explorer!
      setInternalDragAssetIds(idsToDrag)
      const clearDragState = () => {
        setTimeout(() => {
          useLibraryStore.getState().setInternalDragAssetIds([])
        }, 120)
        window.removeEventListener('mouseup', clearDragState, true)
        window.removeEventListener('drop', clearDragState, true)
        window.removeEventListener('dragend', clearDragState, true)
      }
      window.addEventListener('mouseup', clearDragState, true)
      window.addEventListener('drop', clearDragState, true)
      window.addEventListener('dragend', clearDragState, true)

      if (filePaths.length > 0 && typeof window.api.system.startDragOut === 'function') {
        e.preventDefault()
        window.api.system.startDragOut(filePaths, asset.thumbPath)
        return
      }
      e.dataTransfer.setData('application/x-xiyun-assets', JSON.stringify(idsToDrag))
      e.dataTransfer.effectAllowed = 'copy'
    },
    [setInternalDragAssetIds]
  )

  const handleCardToggleFavorite = useCallback(
    (e: React.MouseEvent, asset: Asset) => {
      e.stopPropagation()
      toggleFavorite([asset.id])
    },
    [toggleFavorite]
  )

  const handleOpenContextMenu = useCallback(
    (e: React.MouseEvent, asset: Asset) => {
      e.preventDefault()
      e.stopPropagation()
      const curSelected = useLibraryStore.getState().selectedIds
      if (!curSelected.includes(asset.id)) {
        selectAsset(asset.id)
      }
      const menuH = 340
      const x = Math.max(VIEWPORT_PAD, Math.min(e.clientX, window.innerWidth - MAIN_MENU_W - VIEWPORT_PAD))
      const y = Math.max(VIEWPORT_PAD, Math.min(e.clientY, window.innerHeight - menuH - VIEWPORT_PAD))
      setContextMenu({
        x,
        y,
        asset,
        groupMenuOpen: false,
        hoveredGroupPath: [],
        columnAnchorYs: []
      })
    },
    [selectAsset]
  )

  const handleToggleAudioPlay = useCallback(
    (e: React.MouseEvent, asset: Asset) => {
      e.stopPropagation()
      const curPlaying = useLibraryStore.getState().playingAudioId
      setPlayingAudioId(curPlaying === asset.id ? null : asset.id)
    },
    [setPlayingAudioId]
  )

  const getContextTargetIds = (asset: Asset): number[] => {
    return selectedSet.has(asset.id) && selectedIds.length > 0 ? selectedIds : [asset.id]
  }

  const handleAssignToGroup = async (targetIds: number[], group: GroupNode) => {
    await window.api.groups.assignAssets(targetIds, [group.id])
    showToast(`已将 ${targetIds.length} 项加入「${group.name}」`, 'success')
    setContextMenu(null)
    await refreshAll()
  }

  const handleSubmitQuickCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickCreateGroup || creatingGroup) return
    const trimmed = quickCreateGroup.name.trim()
    if (!trimmed) return
    setCreatingGroup(true)
    try {
      const created = await window.api.groups.create({
        name: trimmed,
        parentId: quickCreateGroup.parentId,
        color: quickCreateGroup.color
      })
      if (quickCreateGroup.targetAssetIds.length > 0) {
        await window.api.groups.assignAssets(quickCreateGroup.targetAssetIds, [created.id])
        showToast(
          `已创建分组「${trimmed}」并加入 ${quickCreateGroup.targetAssetIds.length} 项`,
          'success'
        )
      } else {
        showToast(`已创建分组「${trimmed}」`, 'success')
      }
      setQuickCreateGroup(null)
      await refreshAll()
    } catch {
      showToast('创建分组失败，请重试', 'error')
    } finally {
      setCreatingGroup(false)
    }
  }

  // Compute cascading horizontal group columns when context menu's "添加到分组" is expanded
  const cascadingGroupColumns = useMemo(() => {
    if (!contextMenu || !contextMenu.groupMenuOpen) return []
    const cols: Array<{
      level: number
      parent: GroupNode | null
      parentPathLabel: string | null
      nodes: GroupNode[]
      anchorY: number
    }> = []

    const rootAnchorY = contextMenu.columnAnchorYs[0] ?? contextMenu.y
    cols.push({
      level: 0,
      parent: null,
      parentPathLabel: null,
      nodes: groups,
      anchorY: rootAnchorY
    })

    let currentNodes = groups
    const parentNames: string[] = []
    for (let level = 0; level < contextMenu.hoveredGroupPath.length; level++) {
      const hoveredId = contextMenu.hoveredGroupPath[level]
      const found = currentNodes.find((n) => n.id === hoveredId)
      if (!found || found.children.length === 0) break
      parentNames.push(found.name)
      cols.push({
        level: level + 1,
        parent: found,
        parentPathLabel: parentNames.join(' / '),
        nodes: found.children,
        anchorY: contextMenu.columnAnchorYs[level + 1] ?? cols[cols.length - 1].anchorY
      })
      currentNodes = found.children
    }
    return cols
  }, [contextMenu, groups])

  const contextTargetAssets = useMemo(() => {
    if (!contextMenu) return []
    const ids =
      selectedSet.has(contextMenu.asset.id) && selectedIds.length > 0
        ? selectedIds
        : [contextMenu.asset.id]
    const idSet = new Set(ids)
    return assets.filter((a) => idSet.has(a.id))
  }, [contextMenu, selectedSet, selectedIds, assets])

  return (
    <main
      ref={containerRef}
      onScroll={handleScroll}
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBg === 'true') {
          clearSelection()
        }
      }}
      className={`flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden relative ${hidden ? 'hidden' : ''}`}
    >
      {sources.length === 0 ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
          <div className="mb-5 drop-shadow-lg">
            <AppLogo size={72} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            欢迎使用 PrismVault（棱镜匣）
          </h2>
          <p className="text-sm max-w-lg leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
            挂载你在 D 盘、E 盘、F 盘等任意位置的素材目录，系统将通过<strong>零复制索引</strong>统一管理图片（含 PSD / PSB / TIFF）、视频、音频与文本文档，支持瀑布流 / 等比双视图、一体化内嵌预览、层级分组与 Markdown 备注。
          </p>
          <button
            type="button"
            onClick={handleAddSource}
            className="h-10 px-5 rounded-md text-sm font-medium text-white flex items-center gap-2 shadow hover:opacity-95 cursor-pointer transition-opacity"
            style={{ backgroundColor: 'var(--accent-solid)' }}
          >
            <FolderPlus className="w-4 h-4" />
            <span>挂载第一个本地目录</span>
          </button>
        </div>
      ) : assets.length === 0 ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
          <SearchX className="w-12 h-12 mb-3 opacity-45" style={{ color: 'var(--text-muted)' }} />
          <div className="text-base font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
            {smartView === 'missing'
              ? '没有离线或失效的文件'
              : smartView === 'hidden'
                ? '没有已隐藏的素材'
                : '当前筛选条件下没有找到素材'}
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            {smartView === 'missing'
              ? '所有已索引的本地文件均正常在线。'
              : smartView === 'hidden'
                ? '在列表中右键选择「从库中隐藏」的文件会暂存在这里，随时可以恢复显示。'
                : '试试切换素材类型、更换分组，或清空搜索关键词。'}
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="h-9 px-4 rounded-md text-sm font-medium border hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)'
            }}
          >
            查看全部素材
          </button>
        </div>
      ) : (
        <>
          {smartView === 'missing' && (
            <div
              className="sticky top-0 z-20 px-4 py-2.5 border-b flex items-center justify-between text-xs backdrop-blur-md"
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                borderColor: 'rgba(245, 158, 11, 0.28)',
                color: 'var(--text-primary)'
              }}
            >
              <span>
                这些文件的原始路径暂时不可达（外置硬盘未接入或已被移动/删除）。插回硬盘并点击顶部「同步」可自动恢复。
              </span>
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm({
                    title: '清空离线 / 失效记录',
                    message: '确定要清除所有离线文件的索引记录吗？',
                    detail: '仅清除失效的索引与备注记录，不会影响本地硬盘中的任何文件。',
                    confirmText: '确认清空',
                    variant: 'danger'
                  })
                  if (!ok) return
                  const n = await window.api.assets.removeMissing()
                  showToast(`已清理 ${n} 条失效记录`)
                  await refreshAll()
                }}
                className="h-8 px-3 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-500 cursor-pointer shrink-0 ml-3"
              >
                清空失效记录
              </button>
            </div>
          )}

          {smartView === 'hidden' && (
            <div
              className="sticky top-0 z-20 px-4 py-2.5 border-b flex items-center justify-between text-xs backdrop-blur-md"
              style={{
                backgroundColor: 'var(--bg-active)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)'
              }}
            >
              <span>
                这些文件仅从主素材库中隐藏，硬盘上的原始文件均完好保留。可右键单个取消隐藏，或一键全部恢复显示。
              </span>
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm({
                    title: `恢复全部已隐藏素材（${assets.length} 项）`,
                    message: `确定将当前列表中的 ${assets.length} 个已隐藏素材全部恢复到主库中显示吗？`,
                    confirmText: '全部恢复',
                    variant: 'info'
                  })
                  if (!ok) return
                  await window.api.assets.setStatus(
                    assets.map((a) => a.id),
                    'active'
                  )
                  showToast(`已恢复显示 ${assets.length} 个素材`, 'success')
                  await refreshAll()
                }}
                className="h-8 px-3 rounded-md text-white text-xs font-medium hover:opacity-95 cursor-pointer shrink-0 ml-3"
                style={{ backgroundColor: 'var(--accent-solid)' }}
              >
                全部恢复显示
              </button>
            </div>
          )}

          <div data-canvas-bg="true" className="relative w-full" style={{ height: `${totalHeight}px` }}>
            {visibleItems.map((item) => (
              <div
                key={item.asset.id}
                style={{
                  position: 'absolute',
                  transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
                  width: `${item.width}px`,
                  height: `${item.height}px`
                }}
              >
                <AssetCard
                  asset={item.asset}
                  viewMode={viewMode}
                  gridFitMode={gridFitMode}
                  mediaHeight={item.mediaHeight}
                  selected={selectedSet.has(item.asset.id)}
                  isPlayingAudio={playingAudioId === item.asset.id}
                  videoHoverPreview={videoHoverPreview !== false}
                  onSelect={handleCardSelect}
                  onDoubleClick={handleCardDoubleClick}
                  onContextMenu={handleOpenContextMenu}
                  onDragStart={handleCardDragStart}
                  onToggleAudioPlay={handleToggleAudioPlay}
                  onToggleFavorite={handleCardToggleFavorite}
                />
              </div>
            ))}
          </div>
          {hasMoreAssets && (
            <div className="py-4 flex items-center justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => loadMoreAssets()}
                className="h-8 px-4 rounded-full border text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-60 cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
              >
                {loadingMore
                  ? '正在加载更多素材...'
                  : `已加载 ${assets.length} / ${totalAssets} 项 · 点击或继续下滑加载更多`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Right-click Context Menu + Horizontal Cascading Group Submenus */}
      {contextMenu && (
        <div ref={contextMenuRef} onClick={(e) => e.stopPropagation()}>
          {/* Main Context Menu */}
          <div
            className="fixed z-50 rounded-xl border py-1.5 shadow-2xl text-sm"
            style={{
              width: `${MAIN_MENU_W}px`,
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)'
            }}
          >
            <button
              type="button"
              onMouseEnter={() =>
                contextMenu.groupMenuOpen &&
                setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
              }
              onClick={() => {
                setPreviewAssetId(contextMenu.asset.id)
                setContextMenu(null)
              }}
              className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            >
              <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span>内嵌预览</span>
            </button>

            <button
              type="button"
              onMouseEnter={() =>
                contextMenu.groupMenuOpen &&
                setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
              }
              onClick={() => {
                window.api.system.openExternal(contextMenu.asset.filePath)
                setContextMenu(null)
              }}
              className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            >
              <ExternalLink className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span>用系统默认软件打开</span>
            </button>

            <button
              type="button"
              onMouseEnter={() =>
                contextMenu.groupMenuOpen &&
                setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
              }
              onClick={() => {
                window.api.system.revealInExplorer(contextMenu.asset.filePath)
                setContextMenu(null)
              }}
              className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            >
              <FolderOpen className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span>在资源管理器中显示</span>
            </button>

            <button
              type="button"
              onMouseEnter={() =>
                contextMenu.groupMenuOpen &&
                setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
              }
              onClick={async () => {
                const targetIds = getContextTargetIds(contextMenu.asset)
                const paths = contextTargetAssets.map((a) => a.filePath)
                setContextMenu(null)
                const res = await window.api.system.copyFilesToClipboard(paths, 'file')
                showToast(
                  res.ok ? `已复制 ${targetIds.length} 个文件到剪贴板（可粘贴到微信/资源管理器/软件）` : res.error || '复制文件失败',
                  res.ok ? 'success' : 'error'
                )
              }}
              className="w-full px-3 h-9 flex items-center justify-between hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            >
              <span className="flex items-center gap-2.5">
                <Copy className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <span>复制文件 ({getContextTargetIds(contextMenu.asset).length})</span>
              </span>
              <span className="text-[0.68rem] font-mono" style={{ color: 'var(--text-muted)' }}>
                Ctrl+C
              </span>
            </button>

            {contextMenu.asset.mediaType === 'image' && contextTargetAssets.length === 1 && (
              <button
                type="button"
                onMouseEnter={() =>
                  contextMenu.groupMenuOpen &&
                  setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
                }
                onClick={async () => {
                  const p = contextMenu.asset.filePath
                  setContextMenu(null)
                  const res = await window.api.system.copyFilesToClipboard([p], 'image')
                  showToast(
                    res.ok ? '已复制图片画面到剪贴板（可直接粘贴到 PS/PPT/微信）' : res.error || '复制图片失败',
                    res.ok ? 'success' : 'error'
                  )
                }}
                className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
              >
                <ImageIcon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <span>复制图片画面</span>
              </button>
            )}

            <button
              type="button"
              onMouseEnter={() =>
                contextMenu.groupMenuOpen &&
                setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
              }
              onClick={async () => {
                await window.api.system.copyPath(contextMenu.asset.filePath)
                showToast('已复制文件完整路径', 'success')
                setContextMenu(null)
              }}
              className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            >
              <Copy className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span>复制物理路径</span>
            </button>

            {contextTargetAssets.length >= 2 &&
              contextTargetAssets.length <= 4 &&
              contextTargetAssets.every((a) => a.mediaType === 'image') && (
                <button
                  type="button"
                  onMouseEnter={() =>
                    contextMenu.groupMenuOpen &&
                    setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
                  }
                  onClick={() => {
                    const ids = contextTargetAssets.map((a) => a.id)
                    setContextMenu(null)
                    openCompare(ids)
                  }}
                  className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  <Columns2 className="w-4 h-4" />
                  <span>并排 / 卷帘对比 ({contextTargetAssets.length} 张)</span>
                </button>
              )}

            <button
              type="button"
              onMouseEnter={() =>
                contextMenu.groupMenuOpen &&
                setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
              }
              onClick={async () => {
                const targetIds = getContextTargetIds(contextMenu.asset)
                setContextMenu(null)
                await toggleFavorite(targetIds)
              }}
              className="w-full px-3 h-9 flex items-center justify-between hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            >
              <span className="flex items-center gap-2.5">
                <Heart
                  className={`w-4 h-4 ${
                    contextTargetAssets.length > 0 && contextTargetAssets.every((a) => a.isFavorite)
                      ? 'fill-rose-500 text-rose-500'
                      : ''
                  }`}
                  style={{
                    color:
                      contextTargetAssets.length > 0 && contextTargetAssets.every((a) => a.isFavorite)
                        ? '#f43f5e'
                        : 'var(--text-muted)'
                  }}
                />
                <span>
                  {contextTargetAssets.length > 0 && contextTargetAssets.every((a) => a.isFavorite)
                    ? '取消收藏'
                    : '添加到我的收藏'}
                </span>
              </span>
              <span className="text-[0.68rem] font-mono" style={{ color: 'var(--text-muted)' }}>
                F
              </span>
            </button>

            <div className="my-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

            {/* Cascading Group Trigger */}
            <button
              type="button"
              onMouseEnter={(e) => {
                const topY = e.currentTarget.getBoundingClientRect().top
                setContextMenu((prev) =>
                  prev
                    ? {
                        ...prev,
                        groupMenuOpen: true,
                        columnAnchorYs: [topY, ...prev.columnAnchorYs.slice(1)]
                      }
                    : null
                )
              }}
              onClick={(e) => {
                const topY = e.currentTarget.getBoundingClientRect().top
                setContextMenu((prev) =>
                  prev
                    ? {
                        ...prev,
                        groupMenuOpen: !prev.groupMenuOpen,
                        hoveredGroupPath: [],
                        columnAnchorYs: [topY]
                      }
                    : null
                )
              }}
              className="w-full px-3 h-9 flex items-center justify-between hover:bg-[var(--bg-hover)] cursor-pointer text-left transition-colors"
              style={{
                backgroundColor: contextMenu.groupMenuOpen ? 'var(--bg-active)' : undefined,
                color: contextMenu.groupMenuOpen ? 'var(--text-primary)' : undefined
              }}
            >
              <span className="flex items-center gap-2.5">
                <Tag
                  className="w-4 h-4"
                  style={{ color: contextMenu.groupMenuOpen ? 'var(--accent)' : 'var(--text-muted)' }}
                />
                <span>添加到分组 ({getContextTargetIds(contextMenu.asset).length})</span>
              </span>
              <ChevronRight
                className="w-4 h-4"
                style={{ color: contextMenu.groupMenuOpen ? 'var(--accent)' : 'var(--text-muted)' }}
              />
            </button>

            {groupId != null && (
              <button
                type="button"
                onMouseEnter={() =>
                  contextMenu.groupMenuOpen &&
                  setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
                }
                onClick={async () => {
                  const targetIds = getContextTargetIds(contextMenu.asset)
                  await window.api.groups.unassignAssets(targetIds, [groupId])
                  showToast(`已从当前分组移出 ${targetIds.length} 项`)
                  setContextMenu(null)
                  await refreshAll()
                }}
                className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
              >
                <Tag className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <span>从当前分组移出</span>
              </button>
            )}

            <div className="my-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

            {contextMenu.asset.status === 'hidden' ? (
              <button
                type="button"
                onMouseEnter={() =>
                  contextMenu.groupMenuOpen &&
                  setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
                }
                onClick={async () => {
                  const targetIds = getContextTargetIds(contextMenu.asset)
                  await window.api.assets.setStatus(targetIds, 'active')
                  showToast(`已取消隐藏，恢复显示 ${targetIds.length} 项`, 'success')
                  setContextMenu(null)
                  await refreshAll()
                }}
                className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
                style={{ color: 'var(--accent)' }}
              >
                <Eye className="w-4 h-4" />
                <span>取消隐藏（恢复显示）</span>
              </button>
            ) : (
              <button
                type="button"
                onMouseEnter={() =>
                  contextMenu.groupMenuOpen &&
                  setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
                }
                onClick={async () => {
                  const targetIds = getContextTargetIds(contextMenu.asset)
                  await window.api.assets.setStatus(targetIds, 'hidden')
                  showToast(`已从库中隐藏 ${targetIds.length} 项（可在左侧「已隐藏」恢复）`)
                  setContextMenu(null)
                  await refreshAll()
                }}
                className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
              >
                <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <span>从库中隐藏（保留原文件）</span>
              </button>
            )}

            <button
              type="button"
              onMouseEnter={() =>
                contextMenu.groupMenuOpen &&
                setContextMenu((prev) => (prev ? { ...prev, groupMenuOpen: false, hoveredGroupPath: [] } : null))
              }
              onClick={async () => {
                const targetIds = getContextTargetIds(contextMenu.asset)
                setContextMenu(null)
                const ok = await confirm({
                  title: `移至系统回收站（${targetIds.length} 项）`,
                  message: `确定将选中的 ${targetIds.length} 个本地原文件移至 Windows 回收站吗？`,
                  detail: '此操作会移动硬盘上的实际文件至系统回收站，可从回收站恢复。',
                  confirmText: '移至回收站',
                  variant: 'danger'
                })
                if (!ok) return
                const res = await window.api.assets.moveToTrash(targetIds)
                showToast(`已移至回收站 ${res.trashed} 项`, res.failed.length > 0 ? 'error' : 'info')
                await refreshAll()
              }}
              className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-red-500/15 cursor-pointer text-left"
              style={{ color: 'var(--danger)' }}
            >
              <Trash2 className="w-4 h-4" />
              <span>移至系统回收站...</span>
            </button>
          </div>

          {/* Horizontal Cascading Group Submenu Columns (Supports Arbitrary N-Level Depth + Smooth Independent Scrolling) */}
          {cascadingGroupColumns.length > 0 &&
            (() => {
              const targetIds = getContextTargetIds(contextMenu.asset)
              const openRightByDefault =
                contextMenu.x + MAIN_MENU_W + SUBMENU_W <= window.innerWidth - VIEWPORT_PAD

              return cascadingGroupColumns.map((col, colIdx) => {
                const estHeight = Math.min(
                  SUBMENU_MAX_H,
                  Math.max(104, col.nodes.length * 34 + (col.parent ? 78 : 54))
                )
                const top = Math.max(
                  VIEWPORT_PAD,
                  Math.min(col.anchorY - 6, window.innerHeight - estHeight - VIEWPORT_PAD)
                )

                let left: number
                if (openRightByDefault) {
                  const candidate = contextMenu.x + MAIN_MENU_W - 2 + colIdx * (SUBMENU_W - 2)
                  if (candidate + SUBMENU_W <= window.innerWidth - VIEWPORT_PAD) {
                    left = candidate
                  } else {
                    left = Math.max(
                      VIEWPORT_PAD,
                      contextMenu.x - SUBMENU_W + 2 - Math.max(0, colIdx - 1) * (SUBMENU_W - 2)
                    )
                  }
                } else {
                  const candidate = contextMenu.x - SUBMENU_W + 2 - colIdx * (SUBMENU_W - 2)
                  left = Math.max(
                    VIEWPORT_PAD,
                    Math.min(candidate, window.innerWidth - SUBMENU_W - VIEWPORT_PAD)
                  )
                }

                const hoveredInThisCol = contextMenu.hoveredGroupPath[col.level]

                return (
                  <div
                    key={col.parent ? `col-${col.parent.id}` : 'col-root'}
                    className="fixed rounded-xl border shadow-2xl flex flex-col overflow-hidden"
                    style={{
                      zIndex: 51 + colIdx,
                      width: `${SUBMENU_W}px`,
                      maxHeight: `${SUBMENU_MAX_H}px`,
                      left: `${left}px`,
                      top: `${top}px`,
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-strong)'
                    }}
                  >
                    {/* Column Header for Sub-levels */}
                    {col.parent && (
                      <div
                        className="px-3 py-1.5 border-b flex items-center gap-1.5 text-xs font-semibold shrink-0"
                        style={{
                          borderColor: 'var(--border-subtle)',
                          backgroundColor: 'var(--bg-elevated)',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: col.parent.color }}
                        />
                        <span className="truncate flex-1">{col.parent.name}</span>
                        <span className="text-[0.68rem] font-normal tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {col.nodes.length}
                        </span>
                      </div>
                    )}

                    {/* Independently Scrollable Group Items */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-0.5">
                      {col.nodes.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                          暂无自定义分组
                        </div>
                      ) : (
                        col.nodes.map((node) => {
                          const hasChildren = node.children.length > 0
                          const isHovered = hoveredInThisCol === node.id
                          const isAlreadyAssigned =
                            contextTargetAssets.length > 0 &&
                            contextTargetAssets.every((a) => a.groupIds.includes(node.id))

                          return (
                            <button
                              key={node.id}
                              type="button"
                              onMouseEnter={(e) => {
                                const rowTop = e.currentTarget.getBoundingClientRect().top
                                setContextMenu((prev) => {
                                  if (!prev) return null
                                  const nextPath = [...prev.hoveredGroupPath.slice(0, col.level), node.id]
                                  const nextYs = [...prev.columnAnchorYs.slice(0, col.level + 1), rowTop]
                                  return { ...prev, hoveredGroupPath: nextPath, columnAnchorYs: nextYs }
                                })
                              }}
                              onClick={() => handleAssignToGroup(targetIds, node)}
                              className="w-full h-8 px-2 rounded-lg flex items-center gap-2 text-xs text-left cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                              style={{
                                backgroundColor: isHovered ? 'var(--bg-active)' : undefined,
                                color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)'
                              }}
                              title={
                                hasChildren
                                  ? `点击直接加入「${node.name}」，悬停展开子分组`
                                  : `点击加入「${node.name}」`
                              }
                            >
                              {hasChildren ? (
                                <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: node.color }} />
                              ) : (
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: node.color }}
                                />
                              )}
                              <span className={`flex-1 truncate ${hasChildren ? 'font-medium' : ''}`}>
                                {node.name}
                              </span>
                              {isAlreadyAssigned && (
                                <Check
                                  className="w-3.5 h-3.5 shrink-0"
                                  style={{ color: 'var(--accent)' }}
                                />
                              )}
                              {hasChildren && (
                                <ChevronRight
                                  className="w-3.5 h-3.5 shrink-0"
                                  style={{ color: isHovered ? 'var(--accent)' : 'var(--text-muted)' }}
                                />
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>

                    {/* Sticky Quick-Create Group Action at Bottom of Every Column */}
                    <div
                      className="p-1 border-t shrink-0"
                      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setContextMenu(null)
                          setQuickCreateGroup({
                            parentId: col.parent ? col.parent.id : null,
                            parentPathLabel: col.parentPathLabel,
                            targetAssetIds: targetIds,
                            name: '',
                            color: col.parent
                              ? col.parent.color
                              : GROUP_COLORS[groups.length % GROUP_COLORS.length]
                          })
                        }}
                        className="w-full h-8 px-2 rounded-lg flex items-center gap-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                        style={{ color: 'var(--accent)' }}
                        title={
                          col.parent
                            ? `在「${col.parent.name}」下新建子分组并立即加入所选素材`
                            : '新建一级分组并立即加入所选素材'
                        }
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {col.parent ? '新建子分组并加入' : '新建分组并加入'}
                        </span>
                      </button>
                    </div>
                  </div>
                )
              })
            })()}
        </div>
      )}

      {/* Quick Create Group & Assign Assets Modal */}
      {quickCreateGroup && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
          onClick={() => setQuickCreateGroup(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmitQuickCreateGroup}
            className="w-96 max-w-full rounded-xl border p-5 shadow-2xl space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)'
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {quickCreateGroup.parentId != null ? '新建子分组并加入素材' : '新建分组并加入素材'}
              </h3>
              <button
                type="button"
                onClick={() => setQuickCreateGroup(null)}
                className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {quickCreateGroup.parentPathLabel && (
              <div
                className="px-3 py-2 rounded-lg border text-xs flex items-center gap-2"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
              >
                <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: quickCreateGroup.color }} />
                <span className="truncate">上级分组：{quickCreateGroup.parentPathLabel}</span>
              </div>
            )}

            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                分组名称
              </label>
              <input
                ref={quickGroupInputRef}
                type="text"
                autoFocus
                value={quickCreateGroup.name}
                onChange={(e) => setQuickCreateGroup({ ...quickCreateGroup, name: e.target.value })}
                placeholder="输入新分组名称，回车立即创建并加入..."
                className="w-full h-9 px-3 rounded-lg border text-sm outline-none select-text focus:border-[var(--accent)]"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label className="block text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                标识颜色
              </label>
              <div className="flex flex-wrap gap-2.5">
                {GROUP_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setQuickCreateGroup({ ...quickCreateGroup, color: c })}
                    className="w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: quickCreateGroup.color === c ? '2px solid var(--text-primary)' : 'none',
                      outlineOffset: '2px'
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              创建后将自动把已选中的 <strong style={{ color: 'var(--accent)' }}>{quickCreateGroup.targetAssetIds.length}</strong> 个素材归入该分组。
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setQuickCreateGroup(null)}
                className="h-9 px-4 rounded-md text-sm hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!quickCreateGroup.name.trim() || creatingGroup}
                className="h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-45 cursor-pointer"
                style={{ backgroundColor: 'var(--accent-solid)' }}
              >
                {creatingGroup ? '正在创建...' : '创建并加入'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
