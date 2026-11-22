import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Eye,
  ExternalLink,
  EyeOff,
  FolderOpen,
  FolderPlus,
  SearchX,
  Tag,
  Trash2
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { AssetCard } from './AssetCard'
import { AppLogo } from './AppLogo'
import { flattenGroupTree, getFileMediaUrl } from '../utils/mediaUrl'
import { isPdfExt } from '@shared/mediaTypes'
import type { Asset, GridAspectRatio } from '@shared/types'

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

interface ContextMenuState {
  x: number
  y: number
  asset: Asset
  showGroupSubmenu: boolean
}

function getGridRatioValue(ratio: GridAspectRatio): number {
  if (ratio === '1:1') return 1
  if (ratio === '16:9') return 16 / 9
  return 4 / 3
}

function getWaterfallAspectRatio(asset: Asset): number {
  if ((asset.mediaType === 'image' || asset.mediaType === 'video') && asset.width && asset.height && asset.height > 0) {
    const raw = asset.width / asset.height
    return Math.min(Math.max(raw, 0.48), 2.1)
  }
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
    settings,
    smartView,
    groupId,
    selectedIds,
    selectAsset,
    clearSelection,
    setPreviewAssetId,
    resetFilters,
    playingAudioId,
    setPlayingAudioId,
    refreshAll,
    showToast,
    confirm
  } = useLibraryStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const savedScrollTopRef = useRef(0)
  const [viewport, setViewport] = useState({ width: 900, height: 700 })
  const [scrollTop, setScrollTop] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const flatGroups = useMemo(() => flattenGroupTree(groups), [groups])

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
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

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
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    }
  }, [])

  const { layoutItems, totalHeight } = useMemo(() => {
    const innerWidth = Math.max(220, viewport.width - PADDING * 2)
    const targetColWidth = settings.cardSize
    const cols = Math.max(1, Math.floor((innerWidth + GAP) / (targetColWidth + GAP)))
    const colWidth = (innerWidth - GAP * (cols - 1)) / cols

    if (settings.viewMode === 'waterfall') {
      const colHeights = new Array<number>(cols).fill(PADDING)
      const items: LayoutItem[] = new Array(assets.length)

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i]
        let minCol = 0
        for (let c = 1; c < cols; c++) {
          if (colHeights[c] < colHeights[minCol]) minCol = c
        }
        const ratio = getWaterfallAspectRatio(asset)
        const mediaHeight = Math.round(colWidth / ratio)
        const totalCardHeight = mediaHeight + CARD_FOOTER_HEIGHT
        const x = PADDING + minCol * (colWidth + GAP)
        const y = colHeights[minCol]

        items[i] = { asset, x, y, width: colWidth, height: totalCardHeight, mediaHeight }
        colHeights[minCol] = y + totalCardHeight + GAP
      }

      const maxH = Math.max(...colHeights, viewport.height) + PADDING
      return { layoutItems: items, totalHeight: maxH }
    } else {
      const ratio = getGridRatioValue(settings.gridAspectRatio)
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
      return { layoutItems: items, totalHeight: maxH }
    }
  }, [assets, viewport.width, viewport.height, settings.cardSize, settings.viewMode, settings.gridAspectRatio])

  const visibleItems = useMemo(() => {
    const minY = scrollTop - OVERSCAN_PX
    const maxY = scrollTop + viewport.height + OVERSCAN_PX
    return layoutItems.filter((item) => item.y + item.height >= minY && item.y <= maxY)
  }, [layoutItems, scrollTop, viewport.height])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    savedScrollTopRef.current = top
    setScrollTop(top)
  }, [])

  const handleAddSource = async () => {
    const added = await window.api.sources.pickAndAdd()
    if (added) {
      showToast(`已挂载目录「${added.alias}」，正在扫描...`, 'success')
      await refreshAll()
    }
  }

  const handleDragStart = (e: React.DragEvent, asset: Asset) => {
    const idsToDrag = selectedSet.has(asset.id) ? selectedIds : [asset.id]
    e.dataTransfer.setData('application/x-xiyun-assets', JSON.stringify(idsToDrag))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleOpenContextMenu = (e: React.MouseEvent, asset: Asset) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selectedSet.has(asset.id)) {
      selectAsset(asset.id)
    }
    const menuW = 230
    const menuH = 310
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
    setContextMenu({ x, y, asset, showGroupSubmenu: false })
  }

  const getContextTargetIds = (asset: Asset): number[] => {
    return selectedSet.has(asset.id) && selectedIds.length > 0 ? selectedIds : [asset.id]
  }

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
      style={{ backgroundColor: 'var(--bg-canvas)' }}
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
            {smartView === 'missing' ? '没有离线或失效的文件' : '当前筛选条件下没有找到素材'}
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            {smartView === 'missing'
              ? '所有已索引的本地文件均正常在线。'
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
                  viewMode={settings.viewMode}
                  gridFitMode={settings.gridFitMode}
                  mediaHeight={item.mediaHeight}
                  selected={selectedSet.has(item.asset.id)}
                  isPlayingAudio={playingAudioId === item.asset.id}
                  onSelect={(e) => {
                    e.stopPropagation()
                    selectAsset(item.asset.id, {
                      ctrl: e.ctrlKey || e.metaKey,
                      shift: e.shiftKey
                    })
                  }}
                  onDoubleClick={() => setPreviewAssetId(item.asset.id)}
                  onContextMenu={(e) => handleOpenContextMenu(e, item.asset)}
                  onDragStart={(e) => handleDragStart(e, item.asset)}
                  onToggleAudioPlay={(e) => {
                    e.stopPropagation()
                    setPlayingAudioId(playingAudioId === item.asset.id ? null : item.asset.id)
                  }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 rounded-lg border py-1.5 shadow-2xl text-sm"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-strong)'
          }}
        >
          <button
            type="button"
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

          <div className="my-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setContextMenu((prev) => (prev ? { ...prev, showGroupSubmenu: !prev.showGroupSubmenu } : null))
              }
              className="w-full px-3 h-9 flex items-center justify-between hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            >
              <span className="flex items-center gap-2.5">
                <Tag className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <span>添加到分组 ({getContextTargetIds(contextMenu.asset).length})</span>
              </span>
              <span style={{ color: 'var(--text-muted)' }}>▸</span>
            </button>

            {contextMenu.showGroupSubmenu && (
              <div
                className="max-h-48 overflow-y-auto px-1.5 py-1 border-t"
                style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
              >
                {flatGroups.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    请先在左侧栏创建分组
                  </div>
                ) : (
                  flatGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={async () => {
                        const targetIds = getContextTargetIds(contextMenu.asset)
                        await window.api.groups.assignAssets(targetIds, [g.id])
                        showToast(`已将 ${targetIds.length} 项加入「${g.name}」`, 'success')
                        setContextMenu(null)
                        await refreshAll()
                      }}
                      className="w-full h-8 px-2 rounded flex items-center gap-2 hover:bg-[var(--bg-hover)] cursor-pointer text-left truncate text-xs"
                      style={{ paddingLeft: `${8 + g.depth * 10}px` }}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                      <span className="truncate">{g.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {groupId != null && (
            <button
              type="button"
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

          <button
            type="button"
            onClick={async () => {
              const targetIds = getContextTargetIds(contextMenu.asset)
              await window.api.assets.setStatus(targetIds, 'hidden')
              showToast(`已从库中隐藏 ${targetIds.length} 项（未删除原文件）`)
              setContextMenu(null)
              await refreshAll()
            }}
            className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
          >
            <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <span>从库中隐藏（保留原文件）</span>
          </button>

          <button
            type="button"
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
      )}
    </main>
  )
}
