import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  AlertTriangle,
  Ban,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  CopyCheck,
  Edit2,
  EyeOff,
  File,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderTree,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Inbox,
  Layers,
  Music,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { GROUP_COLORS } from '../utils/mediaUrl'
import type { GroupNode, SourceRoot } from '@shared/types'
import type { MediaType } from '@shared/mediaTypes'

interface GroupModalState {
  mode: 'create' | 'edit'
  parentId: number | null
  groupId?: number
  name: string
  color: string
}

const MEDIA_TYPE_ITEMS: Array<{
  type: MediaType
  label: string
  icon: React.FC<{ className?: string; style?: React.CSSProperties }>
  color: string
}> = [
  { type: 'image', label: '图片', icon: ImageIcon, color: '#38bdf8' },
  { type: 'video', label: '视频', icon: Film, color: '#a78bfa' },
  { type: 'audio', label: '音频', icon: Music, color: '#34d399' },
  { type: 'text', label: '文本', icon: FileText, color: '#fbbf24' },
  { type: 'model', label: '3D / CAD', icon: Box, color: '#fb923c' },
  { type: 'other', label: '其他', icon: File, color: '#94a3b8' }
]

interface LeftSidebarProps {
  width: number
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ width }) => {
  const {
    smartView,
    setSmartView,
    mediaTypes,
    toggleMediaType,
    clearMediaTypes,
    extensions,
    toggleExtension,
    removeExtensions,
    clearExtensions,
    includeOtherFiles,
    updateSettings,
    groupId,
    setGroupId,
    rootId,
    setRootId,
    groups,
    sources,
    stats,
    scanProgress,
    thumbProgress,
    modelThumbProgress,
    internalDragAssetIds,
    setInternalDragAssetIds,
    updateState,
    deleteThumbsOnRemoveSource,
    openSettings,
    openDuplicates,
    refreshAll,
    showToast,
    confirm
  } = useLibraryStore(
    useShallow((s) => ({
      smartView: s.smartView,
      setSmartView: s.setSmartView,
      mediaTypes: s.mediaTypes,
      toggleMediaType: s.toggleMediaType,
      clearMediaTypes: s.clearMediaTypes,
      extensions: s.extensions,
      toggleExtension: s.toggleExtension,
      removeExtensions: s.removeExtensions,
      clearExtensions: s.clearExtensions,
      includeOtherFiles: s.settings.includeOtherFiles,
      updateSettings: s.updateSettings,
      groupId: s.groupId,
      setGroupId: s.setGroupId,
      rootId: s.rootId,
      setRootId: s.setRootId,
      groups: s.groups,
      sources: s.sources,
      stats: s.stats,
      scanProgress: s.scanProgress,
      thumbProgress: s.thumbProgress,
      modelThumbProgress: s.modelThumbProgress,
      internalDragAssetIds: s.internalDragAssetIds,
      setInternalDragAssetIds: s.setInternalDragAssetIds,
      updateState: s.updateState,
      deleteThumbsOnRemoveSource: s.settings.deleteThumbsOnRemoveSource,
      openSettings: s.openSettings,
      openDuplicates: s.openDuplicates,
      refreshAll: s.refreshAll,
      showToast: s.showToast,
      confirm: s.confirm
    }))
  )

  const hasPendingUpdate = Boolean(
    updateState &&
      updateState.release &&
      (updateState.status === 'available' ||
        updateState.status === 'downloading' ||
        updateState.status === 'downloaded')
  )

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [expandedExtTypes, setExpandedExtTypes] = useState<Set<MediaType>>(new Set())
  const [groupFilterOpen, setGroupFilterOpen] = useState(false)
  const [groupFilterQuery, setGroupFilterQuery] = useState('')
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null)
  const [draggingGroupId, setDraggingGroupId] = useState<number | null>(null)
  const [groupDropIndicator, setGroupDropIndicator] = useState<{
    targetId: number
    pos: 'before' | 'inside' | 'after'
  } | null>(null)
  const [groupModal, setGroupModal] = useState<GroupModalState | null>(null)
  const [sourcesExpanded, setSourcesExpanded] = useState(true)
  const [sourceContextMenu, setSourceContextMenu] = useState<{ x: number; y: number; source: SourceRoot } | null>(
    null
  )
  const groupInputRef = useRef<HTMLInputElement>(null)
  const groupFilterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (groupFilterOpen) {
      requestAnimationFrame(() => groupFilterInputRef.current?.focus())
    }
  }, [groupFilterOpen])

  // Collect all expandable parent group IDs & ancestor path for current selected group
  const { expandableGroupIds, totalGroupCount, selectedAncestorIds } = useMemo(() => {
    const expandable: number[] = []
    let count = 0
    const ancestorSet = new Set<number>()

    const walk = (nodes: GroupNode[], chain: number[]): boolean => {
      let foundInSubtree = false
      for (const n of nodes) {
        count++
        if (n.children.length > 0) expandable.push(n.id)
        const nextChain = [...chain, n.id]
        const childHit = n.children.length > 0 ? walk(n.children, nextChain) : false
        const selfHit = groupId != null && n.id === groupId
        if (selfHit || childHit) {
          for (const id of nextChain) ancestorSet.add(id)
          foundInSubtree = true
        }
      }
      return foundInSubtree
    }

    walk(groups, [])
    return { expandableGroupIds: expandable, totalGroupCount: count, selectedAncestorIds: ancestorSet }
  }, [groups, groupId])

  const allExpanded =
    expandableGroupIds.length > 0 && expandableGroupIds.every((id) => expandedGroups.has(id))

  const handleToggleExpandAll = () => {
    if (allExpanded) {
      setExpandedGroups(new Set())
    } else {
      setExpandedGroups(new Set(expandableGroupIds))
    }
  }

  // Recursive group filter preserving matching branches
  const normalizedFilter = groupFilterQuery.trim().toLowerCase()
  const visibleGroups = useMemo(() => {
    if (!normalizedFilter) return groups
    const filterNodes = (nodes: GroupNode[]): GroupNode[] => {
      const result: GroupNode[] = []
      for (const node of nodes) {
        const selfMatches = node.name.toLowerCase().includes(normalizedFilter)
        const filteredChildren = filterNodes(node.children)
        if (selfMatches || filteredChildren.length > 0) {
          result.push({
            ...node,
            children: selfMatches ? node.children : filteredChildren
          })
        }
      }
      return result
    }
    return filterNodes(groups)
  }, [groups, normalizedFilter])

  const renderHighlightedName = (name: string) => {
    if (!normalizedFilter) return name
    const idx = name.toLowerCase().indexOf(normalizedFilter)
    if (idx === -1) return name
    const before = name.slice(0, idx)
    const match = name.slice(idx, idx + normalizedFilter.length)
    const after = name.slice(idx + normalizedFilter.length)
    return (
      <>
        {before}
        <mark
          className="rounded px-0.5 font-semibold"
          style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
        >
          {match}
        </mark>
        {after}
      </>
    )
  }

  useEffect(() => {
    if (!sourceContextMenu) return
    const close = () => setSourceContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [sourceContextMenu])

  useEffect(() => {
    if (!groupModal) return
    const timer = requestAnimationFrame(() => {
      groupInputRef.current?.focus()
      if (groupModal.mode === 'edit') {
        groupInputRef.current?.select()
      }
    })
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGroupModal(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(timer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [groupModal?.mode, groupModal?.groupId, groupModal?.parentId, Boolean(groupModal)])

  const toggleExpand = (id: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddSource = async () => {
    const added = await window.api.sources.pickAndAdd()
    if (added) {
      showToast(`已挂载目录「${added.alias}」，正在后台索引...`, 'success')
      await refreshAll()
    }
  }

  const handleConvertSourceToGroups = async (src: SourceRoot) => {
    setSourceContextMenu(null)
    const ok = await confirm({
      title: `转换为自定义分组结构`,
      message: `确定将索引目录「${src.alias}」的所有文件夹层级转换为自定义分组结构吗？`,
      detail:
        '将以该目录作为一级主分组，所有子文件夹按原有目录结构自动生成二级、三级……N 级子分组，并将对应素材自动归入各自所属分组（绝不会移动或修改硬盘原文件；已存在的同名分组会自动复用）。',
      confirmText: '立即转换',
      variant: 'info'
    })
    if (!ok) return

    try {
      const res = await window.api.sources.convertToGroups(src.id)
      if (!res.ok) {
        showToast(res.error || '转换自定义分组结构失败', 'error')
        return
      }
      await refreshAll()
      if (res.rootGroupId > 0) {
        setExpandedGroups((prev) => new Set(prev).add(res.rootGroupId))
        setGroupId(res.rootGroupId)
      }
      if (res.createdGroups === 0 && res.assignedAssets === 0) {
        showToast(`「${res.rootGroupName}」的分组结构已是最新状态`, 'info')
      } else {
        showToast(
          `已转换「${res.rootGroupName}」：新建 ${res.createdGroups} 个分组，归类 ${res.assignedAssets} 个素材`,
          'success'
        )
      }
    } catch {
      showToast('转换自定义分组结构时发生异常', 'error')
    }
  }

  const handleRemoveSource = async (src: SourceRoot) => {
    setSourceContextMenu(null)
    const willCleanThumbs = deleteThumbsOnRemoveSource
    const ok = await confirm({
      title: `移除索引目录「${src.alias}」`,
      message: `确定从 PrismVault 中移除索引源「${src.alias}」吗？`,
      detail: willCleanThumbs
        ? '将移除该目录的索引记录、备注与分组关联，并同步清理对应缩略图缓存（可在「设置 → 媒体与缓存」中关闭）；绝不会删除硬盘上的任何原始文件。'
        : '仅移除该目录的索引记录、备注与分组关联，保留已生成的缩略图缓存（可在「设置 → 媒体与缓存」中开启自动清理）；绝不会删除硬盘上的任何原始文件。',
      confirmText: '确认移除',
      variant: 'danger'
    })
    if (!ok) return

    const res = await window.api.sources.remove(src.id)
    if (rootId === src.id) {
      setRootId(null)
    }
    showToast(
      res && res.removedThumbs > 0
        ? `已移除索引目录「${src.alias}」，并清理 ${res.removedThumbs} 个缩略图缓存`
        : `已移除索引目录「${src.alias}」`
    )
    await refreshAll()
  }

  const handleSaveGroupModal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!groupModal || !groupModal.name.trim()) return
    if (groupModal.mode === 'create') {
      await window.api.groups.create({
        name: groupModal.name.trim(),
        parentId: groupModal.parentId,
        color: groupModal.color
      })
      if (groupModal.parentId != null) {
        setExpandedGroups((prev) => new Set(prev).add(groupModal.parentId!))
      }
      showToast(`已创建分组「${groupModal.name.trim()}」`, 'success')
    } else if (groupModal.groupId != null) {
      await window.api.groups.update(groupModal.groupId, {
        name: groupModal.name.trim(),
        color: groupModal.color
      })
      showToast(`已更新分组「${groupModal.name.trim()}」`, 'success')
    }
    setGroupModal(null)
    await refreshAll()
  }

  const handleDeleteGroup = async (node: GroupNode) => {
    const ok = await confirm({
      title: `删除分组「${node.name}」`,
      message: '确定要删除这个自定义分组吗？',
      detail: '仅删除分组及其子分组标签，绝不会删除硬盘上的任何原始素材文件。',
      confirmText: '确认删除',
      variant: 'danger'
    })
    if (!ok) return
    await window.api.groups.delete(node.id)
    if (groupId === node.id) setGroupId(null)
    showToast(`已删除分组「${node.name}」`)
    await refreshAll()
  }

  const isGroupDescendant = (sourceId: number, candidateId: number): boolean => {
    const findNode = (nodes: GroupNode[]): GroupNode | null => {
      for (const n of nodes) {
        if (n.id === sourceId) return n
        const hit = findNode(n.children)
        if (hit) return hit
      }
      return null
    }
    const root = findNode(groups)
    if (!root) return false
    const walk = (n: GroupNode): boolean => {
      if (n.id === candidateId) return true
      return n.children.some(walk)
    }
    return walk(root)
  }

  const getSiblingIdsByParent = (parentId: number | null): number[] => {
    if (parentId == null) return groups.map((g) => g.id)
    const find = (nodes: GroupNode[]): GroupNode | null => {
      for (const n of nodes) {
        if (n.id === parentId) return n
        const hit = find(n.children)
        if (hit) return hit
      }
      return null
    }
    return find(groups)?.children.map((c) => c.id) ?? []
  }

  const handleGroupDragStart = (e: React.DragEvent, node: GroupNode) => {
    e.stopPropagation()
    setDraggingGroupId(node.id)
    e.dataTransfer.setData('application/x-xiyun-group', String(node.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleGroupDragEnd = () => {
    setDraggingGroupId(null)
    setGroupDropIndicator(null)
    setDragOverGroupId(null)
  }

  const handleGroupDragOver = (e: React.DragEvent, targetNode: GroupNode) => {
    const types = Array.from(e.dataTransfer.types || [])
    // 1. Dragging a group to reorder or reparent
    if (draggingGroupId != null || types.includes('application/x-xiyun-group')) {
      const srcId = draggingGroupId
      if (srcId != null && (srcId === targetNode.id || isGroupDescendant(srcId, targetNode.id))) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const ratio = (e.clientY - rect.top) / Math.max(1, rect.height)
      const pos: 'before' | 'inside' | 'after' = ratio < 0.26 ? 'before' : ratio > 0.74 ? 'after' : 'inside'
      if (!groupDropIndicator || groupDropIndicator.targetId !== targetNode.id || groupDropIndicator.pos !== pos) {
        setGroupDropIndicator({ targetId: targetNode.id, pos })
      }
      return
    }

    // 2. Dragging asset card(s) (either standard internal dataTransfer or native OS drag-out tracked via store)
    if (types.includes('application/x-xiyun-assets') || internalDragAssetIds.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      if (dragOverGroupId !== targetNode.id) setDragOverGroupId(targetNode.id)
    }
  }

  const handleDropOnGroup = async (e: React.DragEvent, targetGroup: GroupNode) => {
    e.preventDefault()
    e.stopPropagation()
    const indicator = groupDropIndicator
    setDragOverGroupId(null)
    setGroupDropIndicator(null)

    // 1. Reorder / Reparent group
    const groupRaw = e.dataTransfer.getData('application/x-xiyun-group')
    const movedGroupId = groupRaw ? Number(groupRaw) : draggingGroupId
    setDraggingGroupId(null)

    if (movedGroupId && Number.isFinite(movedGroupId)) {
      if (movedGroupId === targetGroup.id || isGroupDescendant(movedGroupId, targetGroup.id)) return
      const pos = indicator && indicator.targetId === targetGroup.id ? indicator.pos : 'inside'

      if (pos === 'inside') {
        const existingChildren = targetGroup.children.map((c) => c.id).filter((id) => id !== movedGroupId)
        await window.api.groups.reorder(movedGroupId, targetGroup.id, [...existingChildren, movedGroupId])
        setExpandedGroups((prev) => new Set(prev).add(targetGroup.id))
        showToast(`已将分组移入「${targetGroup.name}」`, 'success')
      } else {
        const targetParentId = targetGroup.parentId
        const siblings = getSiblingIdsByParent(targetParentId).filter((id) => id !== movedGroupId)
        const targetIdx = siblings.indexOf(targetGroup.id)
        const insertIdx = targetIdx === -1 ? siblings.length : pos === 'before' ? targetIdx : targetIdx + 1
        siblings.splice(insertIdx, 0, movedGroupId)
        await window.api.groups.reorder(movedGroupId, targetParentId, siblings)
      }
      await refreshAll()
      return
    }

    // 2. Assign dragged assets to target group
    let assetIds: number[] = []
    const raw = e.dataTransfer.getData('application/x-xiyun-assets')
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) assetIds = parsed
      } catch {
        // ignore
      }
    }
    if (assetIds.length === 0 && internalDragAssetIds.length > 0) {
      assetIds = [...internalDragAssetIds]
    }
    if (internalDragAssetIds.length > 0) {
      setInternalDragAssetIds([])
    }
    if (assetIds.length > 0) {
      await window.api.groups.assignAssets(assetIds, [targetGroup.id])
      showToast(`已将 ${assetIds.length} 项加入「${targetGroup.name}」`, 'success')
      await refreshAll()
    }
  }

  const renderGroupRowActions = (node: GroupNode) => (
    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setGroupModal({
            mode: 'create',
            parentId: node.id,
            name: '',
            color: node.color
          })
        }}
        className="p-1 rounded hover:bg-[var(--bg-hover)]"
        title="新建子分组"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setGroupModal({
            mode: 'edit',
            parentId: node.parentId,
            groupId: node.id,
            name: node.name,
            color: node.color
          })
        }}
        className="p-1 rounded hover:bg-[var(--bg-hover)]"
        title="重命名/改色"
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          handleDeleteGroup(node)
        }}
        className="p-1 rounded hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
        title="删除分组"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )

  const renderChildGroupNode = (node: GroupNode, depth: number, rootColor: string): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isExpanded = Boolean(normalizedFilter) || expandedGroups.has(node.id)
    const isSelected = groupId === node.id
    const isBranchActive = selectedAncestorIds.has(node.id)
    const isDragOver = dragOverGroupId === node.id
    const dropPos = groupDropIndicator?.targetId === node.id ? groupDropIndicator.pos : null
    const subDepth = Math.max(0, depth - 1)
    const countTooltip = hasChildren
      ? `${node.name}（本分组 ${node.assetCount} 项 · 含子分组共 ${node.totalCount} 项）`
      : `${node.name}（${node.totalCount} 项）`

    return (
      <div key={node.id} className="relative">
        {dropPos === 'before' && (
          <div className="h-[2px] mx-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
        )}
        <div
          draggable
          onDragStart={(e) => handleGroupDragStart(e, node)}
          onDragEnd={handleGroupDragEnd}
          onClick={() => setGroupId(isSelected ? null : node.id)}
          onDragOver={(e) => handleGroupDragOver(e, node)}
          onDragLeave={() => {
            if (dragOverGroupId === node.id) setDragOverGroupId(null)
            if (groupDropIndicator?.targetId === node.id) setGroupDropIndicator(null)
          }}
          onDrop={(e) => handleDropOnGroup(e, node)}
          title={countTooltip}
          className="group relative flex items-center gap-1.5 h-8 pr-2 rounded-lg cursor-pointer transition-all text-[0.84rem] hover:bg-[var(--bg-hover)]"
          style={{
            paddingLeft: `${8 + subDepth * 13}px`,
            backgroundColor: isDragOver || dropPos === 'inside' || isSelected ? 'var(--bg-active)' : undefined,
            outline: isDragOver || dropPos === 'inside' ? '1.5px dashed var(--accent)' : 'none',
            opacity: draggingGroupId === node.id ? 0.45 : 1,
            color: isSelected
              ? 'var(--text-primary)'
              : isBranchActive
                ? 'var(--text-primary)'
                : 'var(--text-secondary)'
          }}
        >
          {isSelected && (
            <span className="prism-active-bar absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" />
          )}

          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(node.id)
              }}
              className="w-4 h-4 flex items-center justify-center shrink-0 rounded hover:bg-[var(--bg-hover)]"
              style={{ color: isBranchActive ? node.color : 'var(--text-muted)' }}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-4 h-4 flex items-center justify-center shrink-0">
              <span
                className="w-[7px] h-[7px] rounded-full transition-transform group-hover:scale-125"
                style={{
                  backgroundColor: node.color,
                  boxShadow: isSelected ? `0 0 0 3px ${node.color}30` : `0 0 0 2px ${node.color}1e`
                }}
              />
            </span>
          )}

          {hasChildren && (
            <span className="shrink-0 flex items-center" style={{ color: node.color }}>
              {isExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
            </span>
          )}

          <span className={`flex-1 truncate ${isSelected || hasChildren ? 'font-medium' : 'font-normal'}`}>
            {renderHighlightedName(node.name)}
          </span>

          {renderGroupRowActions(node)}

          <span
            className="group-hover:hidden text-[0.72rem] tabular-nums shrink-0 px-1.5 py-0.5 rounded-full"
            style={{
              color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
              opacity: node.totalCount === 0 && !isSelected ? 0.52 : 1,
              backgroundColor: isSelected ? 'var(--glass-pill)' : 'transparent'
            }}
          >
            {node.totalCount}
          </span>
        </div>

        {hasChildren && isExpanded && (
          <div className="relative mt-0.5 space-y-0.5">
            {/* Vertical tree guide line for deeper sub-branches */}
            <span
              className="pointer-events-none absolute top-0.5 bottom-1.5 w-[1px] rounded-full transition-colors"
              style={{
                left: `${15 + subDepth * 13}px`,
                backgroundColor: isBranchActive ? `${rootColor}66` : 'var(--tree-guide)'
              }}
            />
            {node.children.map((child) => renderChildGroupNode(child, depth + 1, rootColor))}
          </div>
        )}
        {dropPos === 'after' && (
          <div className="h-[2px] mx-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
        )}
      </div>
    )
  }

  const renderRootGroupCard = (node: GroupNode): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isExpanded = hasChildren && (Boolean(normalizedFilter) || expandedGroups.has(node.id))
    const isSelected = groupId === node.id
    const isBranchActive = selectedAncestorIds.has(node.id)
    const isDragOver = dragOverGroupId === node.id
    const dropPos = groupDropIndicator?.targetId === node.id ? groupDropIndicator.pos : null
    const countTooltip = hasChildren
      ? `${node.name}（本分组 ${node.assetCount} 项 · 含 ${node.children.length} 个子分组共 ${node.totalCount} 项）`
      : `${node.name}（${node.totalCount} 项）`

    return (
      <div key={node.id} className="relative">
        {dropPos === 'before' && (
          <div className="h-[2px] mb-1 mx-1 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
        )}
        <div
          className={`prism-group-card rounded-xl overflow-hidden ${isExpanded ? 'prism-group-card-expanded' : ''}`}
          style={{
            opacity: draggingGroupId === node.id ? 0.45 : 1,
            borderColor:
              isDragOver || dropPos === 'inside'
                ? 'var(--accent)'
                : isBranchActive && isExpanded
                  ? `${node.color}58`
                  : isSelected
                    ? `${node.color}45`
                    : undefined,
            backgroundImage: isExpanded
              ? `linear-gradient(145deg, ${node.color}16 0%, transparent 48%)`
              : undefined
          }}
        >
          {/* Root Group Header Row */}
          <div
            draggable
            onDragStart={(e) => handleGroupDragStart(e, node)}
            onDragEnd={handleGroupDragEnd}
            onClick={() => setGroupId(isSelected ? null : node.id)}
            onDragOver={(e) => handleGroupDragOver(e, node)}
            onDragLeave={() => {
              if (dragOverGroupId === node.id) setDragOverGroupId(null)
              if (groupDropIndicator?.targetId === node.id) setGroupDropIndicator(null)
            }}
            onDrop={(e) => handleDropOnGroup(e, node)}
            title={`${countTooltip}（支持拖拽调整排序或层级）`}
            className={`group relative flex items-center gap-2 h-9 px-2 cursor-pointer transition-colors hover:bg-[var(--bg-hover)] ${
              isExpanded ? 'border-b' : ''
            }`}
            style={{
              backgroundColor: isDragOver || dropPos === 'inside' || isSelected ? 'var(--bg-active)' : undefined,
              borderColor: isExpanded ? 'var(--border-subtle)' : 'transparent',
              outline: isDragOver || dropPos === 'inside' ? '1.5px dashed var(--accent)' : 'none',
              color: isSelected || isBranchActive ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}
          >
          {isSelected && (
            <span className="prism-active-bar absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" />
          )}

          {/* Expand / Collapse Chevron */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (hasChildren) toggleExpand(node.id)
            }}
            className="w-4 h-4 flex items-center justify-center shrink-0 rounded hover:bg-[var(--bg-hover)]"
            style={{
              visibility: hasChildren ? 'visible' : 'hidden',
              color: isBranchActive ? node.color : 'var(--text-muted)'
            }}
            title={isExpanded ? '折叠子分组' : '展开子分组'}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {/* Tinted Frosted Folder Badge */}
          <span
            className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
            style={{
              backgroundColor: `${node.color}20`,
              border: `1px solid ${node.color}42`,
              color: node.color
            }}
          >
            {isExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
          </span>

          <span className="flex-1 truncate text-sm font-semibold tracking-tight">
            {renderHighlightedName(node.name)}
          </span>

          {renderGroupRowActions(node)}

          <span
            className="group-hover:hidden text-xs tabular-nums shrink-0 px-1.5 py-0.5 rounded-full font-medium"
            style={{
              color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
              backgroundColor: isExpanded ? 'var(--glass-pill)' : 'transparent',
              opacity: node.totalCount === 0 && !isSelected ? 0.55 : 1
            }}
          >
            {node.totalCount}
          </span>
        </div>

        {/* Nested Children Drawer with Crisp Vertical Tree Guide */}
        {isExpanded && (
          <div className="relative py-1.5 pr-1.5 pl-4 space-y-0.5">
            <span
              className="pointer-events-none absolute left-[17px] top-1.5 bottom-2.5 w-[1.5px] rounded-full transition-colors"
              style={{
                background: isBranchActive
                  ? `linear-gradient(180deg, ${node.color}99 0%, ${node.color}28 100%)`
                  : 'var(--tree-guide)'
              }}
            />
            {node.children.map((child) => renderChildGroupNode(child, 1, node.color))}
          </div>
        )}
        </div>
        {dropPos === 'after' && (
          <div className="h-[2px] mt-1 mx-1 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
        )}
      </div>
    )
  }

  return (
    <aside
      className="prism-glass-sidebar shrink-0 h-full flex flex-col border-r"
      style={{
        width: `${width}px`,
        borderColor: 'var(--border-subtle)'
      }}
    >
      {/* Scrollable sidebar body */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5">
        {/* 1. Quick Smart Views */}
        <section className="space-y-1">
          {[
            { id: 'all' as const, label: '全部素材', icon: Layers, count: stats.totalActive },
            { id: 'favorites' as const, label: '我的收藏', icon: Heart, count: stats.favoriteCount, fav: true },
            { id: 'ungrouped' as const, label: '未分类', icon: Inbox, count: stats.ungroupedCount },
            { id: 'recent' as const, label: '最近添加', icon: Clock, count: stats.recentCount },
            { id: 'missing' as const, label: '离线 / 失效', icon: AlertTriangle, count: stats.missingCount, warn: true },
            { id: 'hidden' as const, label: '已隐藏', icon: EyeOff, count: stats.hiddenCount }
          ].map((item) => {
            const Icon = item.icon
            const active = smartView === item.id && groupId === null && rootId === null
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSmartView(item.id)}
                className="relative w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm font-medium cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                style={{
                  backgroundColor: active ? 'var(--bg-active)' : undefined,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
                }}
              >
                {active && (
                  <span className="prism-active-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-full" />
                )}
                <Icon
                  className="w-4 h-4 shrink-0"
                  style={{
                    color: item.warn && item.count > 0
                      ? 'var(--warning)'
                      : item.fav && (active || item.count > 0)
                        ? '#f43f5e'
                        : active
                          ? 'var(--accent)'
                          : 'var(--text-muted)'
                  }}
                />
                <span className="flex-1 text-left truncate">{item.label}</span>
                <span
                  className="text-xs tabular-nums px-1.5 py-0.5 rounded-full"
                  style={{
                    color: item.warn && item.count > 0 ? 'var(--warning)' : 'var(--text-muted)',
                    backgroundColor: item.warn && item.count > 0 ? 'rgba(245, 158, 11, 0.14)' : 'transparent'
                  }}
                >
                  {item.count}
                </span>
              </button>
            )
          })}
        </section>

        {/* 2. Media Type Tag Filter (Crystal Glass Capsules + Dynamic Sub-Formats + Exclude Unrecognized Toggle) */}
        <section>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
              素材类型
            </span>
            {mediaTypes.length > 0 || extensions.length > 0 ? (
              <button
                type="button"
                onClick={clearMediaTypes}
                className="text-xs hover:underline cursor-pointer"
                style={{ color: 'var(--accent)' }}
              >
                重置
              </button>
            ) : (
              <span
                className="text-xs"
                style={{ color: 'var(--text-muted)' }}
                title="点击类型可展开该类下实际拥有的细分格式；按住 Ctrl 可多选类型"
              >
                点选细筛
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {MEDIA_TYPE_ITEMS.map(({ type, label, icon: Icon, color }) => {
              const isOtherBlocked = type === 'other' && !includeOtherFiles
              const selected = !isOtherBlocked && mediaTypes.includes(type)
              const count = stats.byType[type] ?? 0
              const subFormatCount = stats.extensionsByType?.[type]?.length ?? 0

              if (isOtherBlocked) {
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() =>
                      showToast('当前已开启「排除非可识别文件」，关闭下方开关即可恢复显示', 'info')
                    }
                    className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-dashed text-xs font-medium cursor-pointer transition-opacity opacity-60 hover:opacity-85"
                    style={{
                      backgroundColor: 'transparent',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-muted)'
                    }}
                    title={
                      stats.maskedOtherCount > 0
                        ? `已排除非可识别文件（当前已屏蔽 ${stats.maskedOtherCount} 个），关闭下方开关可恢复显示`
                        : '已排除非可识别文件（如 .dll / .exe 等），关闭下方开关可恢复显示'
                    }
                  >
                    <Ban className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="truncate flex-1 text-left line-through">{label}</span>
                    <span className="text-[0.65rem] shrink-0">已屏蔽</span>
                  </button>
                )
              }

              return (
                <button
                  key={type}
                  type="button"
                  onClick={(e) => toggleMediaType(type, e.ctrlKey || e.metaKey)}
                  className="prism-media-pill flex items-center gap-2 px-2.5 h-8 rounded-lg border text-xs font-medium cursor-pointer"
                  style={{
                    backgroundColor: selected ? `${color}22` : undefined,
                    borderColor: selected ? `${color}88` : undefined,
                    boxShadow: selected ? `0 0 14px -3px ${color}55, inset 0 1px 0 rgba(255,255,255,0.28)` : undefined,
                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)'
                  }}
                  title={
                    subFormatCount > 0
                      ? `${label}（包含 ${subFormatCount} 种格式）· 点击展开细分格式，Ctrl 多选`
                      : `${label} · 按住 Ctrl 可多选`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                  <span className="truncate flex-1 text-left">{label}</span>
                  <span
                    className="text-xs tabular-nums"
                    style={{
                      color: selected ? color : 'var(--text-muted)',
                      opacity: count === 0 && !selected ? 0.55 : 1
                    }}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Dynamic Sub-Format Chips for Selected Media Type(s) — ONLY displays extensions actually present in library */}
          {(() => {
            const selectedTypeSections = MEDIA_TYPE_ITEMS.filter(
              (item) =>
                mediaTypes.includes(item.type) &&
                !(item.type === 'other' && !includeOtherFiles) &&
                (stats.extensionsByType?.[item.type]?.length ?? 0) > 0
            )
            if (selectedTypeSections.length === 0) return null

            return (
              <div
                className="mt-2 p-2 rounded-xl border space-y-2"
                style={{
                  backgroundColor: 'var(--group-card-bg)',
                  borderColor: 'var(--group-card-border)'
                }}
              >
                {selectedTypeSections.map(({ type, label, color }) => {
                  const typeExts = stats.extensionsByType?.[type] ?? []
                  const isExpanded = expandedExtTypes.has(type)
                  const MAX_COMPACT = 10
                  const visibleExts = isExpanded ? typeExts : typeExts.slice(0, MAX_COMPACT)
                  const hiddenCount = Math.max(0, typeExts.length - visibleExts.length)
                  const activeExtsInType = typeExts.filter((e) => extensions.includes(e.ext.toLowerCase()))

                  return (
                    <div key={type} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-1 px-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-[0.7rem] font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                            {label}格式
                          </span>
                          <span className="text-[0.65rem] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            ({typeExts.length})
                          </span>
                        </div>
                        {activeExtsInType.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              // Clear only extensions belonging to this media type (or all if single type selected)
                              if (selectedTypeSections.length === 1) {
                                clearExtensions()
                              } else {
                                removeExtensions(activeExtsInType.map((e) => e.ext))
                              }
                            }}
                            className="text-[0.68rem] hover:underline cursor-pointer shrink-0"
                            style={{ color }}
                          >
                            全部
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {visibleExts.map((item) => {
                          const normExt = item.ext.toLowerCase()
                          const active = extensions.includes(normExt)
                          return (
                            <button
                              key={item.ext}
                              type="button"
                              onClick={() => toggleExtension(item.ext)}
                              className="px-1.5 h-6 rounded-md border font-mono text-[0.68rem] uppercase cursor-pointer transition-all flex items-center gap-1 hover:bg-[var(--bg-hover)]"
                              style={{
                                backgroundColor: active ? `${color}26` : 'var(--bg-surface)',
                                borderColor: active ? `${color}99` : 'var(--border-subtle)',
                                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                                boxShadow: active ? `0 0 8px -2px ${color}66` : undefined
                              }}
                              title={`${active ? '取消筛选' : '仅看'} ${item.ext.toUpperCase()}（共 ${item.count} 个）`}
                            >
                              <span className="font-semibold">{item.ext.replace(/^\./, '')}</span>
                              <span
                                className="text-[0.62rem] tabular-nums"
                                style={{ color: active ? color : 'var(--text-muted)' }}
                              >
                                {item.count}
                              </span>
                            </button>
                          )
                        })}

                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedExtTypes((prev) => {
                                const next = new Set(prev)
                                next.add(type)
                                return next
                              })
                            }
                            className="px-1.5 h-6 rounded-md border text-[0.68rem] cursor-pointer hover:bg-[var(--bg-hover)]"
                            style={{
                              backgroundColor: 'transparent',
                              borderColor: 'var(--border-subtle)',
                              color: 'var(--text-muted)'
                            }}
                          >
                            +{hiddenCount} 更多
                          </button>
                        )}
                        {isExpanded && typeExts.length > MAX_COMPACT && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedExtTypes((prev) => {
                                const next = new Set(prev)
                                next.delete(type)
                                return next
                              })
                            }
                            className="px-1.5 h-6 rounded-md border text-[0.68rem] cursor-pointer hover:bg-[var(--bg-hover)]"
                            style={{
                              backgroundColor: 'transparent',
                              borderColor: 'var(--border-subtle)',
                              color: 'var(--text-muted)'
                            }}
                          >
                            收起
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* One-Click Toggle: Exclude All Unrecognized ("other") Files */}
          <button
            type="button"
            onClick={async () => {
              const nextIncludeOther = !includeOtherFiles
              await updateSettings({ includeOtherFiles: nextIncludeOther })
              if (!nextIncludeOther) {
                showToast('已排除所有非可识别文件，仓库仅识别并显示有效素材', 'success')
              } else {
                showToast('已恢复显示「其他」类型文件（如需收录目录中未扫描的此类文件，可重新扫描）', 'info')
              }
            }}
            className="mt-2 w-full flex items-center justify-between gap-2 px-2.5 h-8 rounded-lg border text-xs font-medium cursor-pointer transition-all hover:bg-[var(--bg-hover)]"
            style={{
              backgroundColor: !includeOtherFiles ? 'var(--bg-active)' : 'var(--bg-surface)',
              borderColor: !includeOtherFiles ? 'var(--accent)' : 'var(--border-subtle)',
              color: !includeOtherFiles ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}
            title={
              !includeOtherFiles
                ? '已开启：自动屏蔽 .dll / .exe 等无法识别的「其他」类型文件，不显示在仓库中且扫描/导入时跳过。点击可解除屏蔽。'
                : '点击一键屏蔽所有非可识别文件（如 .dll / .exe 等），仓库仅保留有效素材。'
            }
          >
            <span className="flex items-center gap-1.5 min-w-0">
              {!includeOtherFiles ? (
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
              ) : (
                <ShieldOff className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
              )}
              <span className="truncate">排除非可识别文件</span>
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              {!includeOtherFiles && stats.maskedOtherCount > 0 && (
                <span
                  className="text-[0.65rem] tabular-nums px-1.5 py-0.2 rounded-full"
                  style={{ backgroundColor: 'var(--glass-pill)', color: 'var(--text-muted)' }}
                >
                  已蔽 {stats.maskedOtherCount}
                </span>
              )}
              <span
                className="w-7 h-4 rounded-full relative transition-colors inline-block shrink-0"
                style={{
                  backgroundColor: !includeOtherFiles ? 'var(--accent-solid)' : 'var(--border-strong)'
                }}
              >
                <span
                  className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform"
                  style={{
                    left: !includeOtherFiles ? '14px' : '2px'
                  }}
                />
              </span>
            </span>
          </button>
        </section>

        {/* 3. Custom Groups Tree (Micro-Glass Nested Card Clusters + Drag-to-Reorder) */}
        <section>
          <div
            onDragOver={(e) => {
              if (draggingGroupId != null) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }
            }}
            onDrop={async (e) => {
              if (draggingGroupId == null) return
              e.preventDefault()
              const movedId = draggingGroupId
              setDraggingGroupId(null)
              setGroupDropIndicator(null)
              const rootIds = groups.map((g) => g.id).filter((id) => id !== movedId)
              await window.api.groups.reorder(movedId, null, [movedId, ...rootIds])
              showToast('已将该分组提升为一级主分组', 'success')
              await refreshAll()
            }}
            className="flex items-center justify-between px-2 mb-2 rounded-md transition-colors"
            style={{
              outline: draggingGroupId != null ? '1px dashed var(--accent)' : 'none'
            }}
            title={draggingGroupId != null ? '拖到此处可提升为一级主分组' : undefined}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
                自定义分组
              </span>
              {totalGroupCount > 0 && (
                <span
                  className="text-[0.68rem] tabular-nums px-1.5 py-0.2 rounded-full"
                  style={{ backgroundColor: 'var(--glass-pill)', color: 'var(--text-muted)' }}
                >
                  {totalGroupCount}
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5">
              {groups.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (groupFilterOpen) {
                      setGroupFilterOpen(false)
                      setGroupFilterQuery('')
                    } else {
                      setGroupFilterOpen(true)
                    }
                  }}
                  className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                  style={{
                    color: groupFilterOpen || normalizedFilter ? 'var(--accent)' : 'var(--text-secondary)',
                    backgroundColor: groupFilterOpen || normalizedFilter ? 'var(--bg-active)' : undefined
                  }}
                  title="筛选自定义分组"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              )}

              {expandableGroupIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleExpandAll}
                  className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  title={allExpanded ? '全部折叠分组' : '全部展开分组'}
                >
                  {allExpanded ? (
                    <ChevronsDownUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronsUpDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setGroupModal({
                    mode: 'create',
                    parentId: null,
                    name: '',
                    color: GROUP_COLORS[groups.length % GROUP_COLORS.length]
                  })
                }
                className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                title="新建自定义分组"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mini Group Search Filter Input */}
          {groupFilterOpen && (
            <div className="mb-2 px-0.5">
              <div className="prism-search-box flex items-center gap-1.5 h-7 px-2 rounded-lg border">
                <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <input
                  ref={groupFilterInputRef}
                  type="text"
                  value={groupFilterQuery}
                  onChange={(e) => setGroupFilterQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setGroupFilterQuery('')
                      setGroupFilterOpen(false)
                    }
                  }}
                  placeholder="快速筛选分组名..."
                  className="flex-1 min-w-0 bg-transparent outline-none text-xs placeholder:text-[var(--text-muted)]"
                  style={{ color: 'var(--text-primary)' }}
                />
                {groupFilterQuery && (
                  <button
                    type="button"
                    onClick={() => setGroupFilterQuery('')}
                    className="p-0.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                    title="清空筛选"
                  >
                    <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <div
              className="px-3 py-3.5 rounded-xl border border-dashed text-center text-xs leading-relaxed"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
            >
              暂无分组，点右上角 + 新建
              <br />
              支持拖拽文件直接归组
            </div>
          ) : visibleGroups.length === 0 ? (
            <div
              className="px-3 py-3 rounded-xl border border-dashed text-center text-xs"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
            >
              未找到匹配「{groupFilterQuery}」的分组
            </div>
          ) : (
            <div className="space-y-1.5">{visibleGroups.map((node) => renderRootGroupCard(node))}</div>
          )}
        </section>

        {/* 4. Indexed Source Directories */}
        <section>
          <div className="flex items-center justify-between px-2 mb-1.5">
            <button
              type="button"
              onClick={() => setSourcesExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold tracking-wide cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              {sourcesExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <span>索引源目录</span>
            </button>
            <button
              type="button"
              onClick={handleAddSource}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
              title="添加跨盘符目录源"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {sourcesExpanded && (
            <div className="space-y-0.5">
              {sources.length === 0 ? (
                <button
                  type="button"
                  onClick={handleAddSource}
                  className="w-full px-3 py-2.5 rounded-lg border border-dashed text-xs flex items-center justify-center gap-2 hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  <HardDrive className="w-4 h-4" />
                  <span>添加 D:/ E:/ F:/ 目录</span>
                </button>
              ) : (
                sources.map((src) => {
                  const active = rootId === src.id
                  return (
                    <div
                      key={src.id}
                      onClick={() => setRootId(active ? null : src.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const menuW = 240
                        const menuH = 192
                        const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
                        const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
                        setSourceContextMenu({ x, y, source: src })
                      }}
                      className="group relative flex items-center gap-2 h-9 px-3 rounded-lg text-sm cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                      style={{
                        backgroundColor: active ? 'var(--bg-active)' : undefined,
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
                      }}
                      title={`${src.path}（右键可转分组、扫描或移除）`}
                    >
                      {active && (
                        <span className="prism-active-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-full" />
                      )}
                      <Folder
                        className="w-4 h-4 shrink-0"
                        style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
                      />
                      <span className="flex-1 truncate">{src.alias}</span>
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleConvertSourceToGroups(src)
                          }}
                          className="p-1 rounded hover:bg-[var(--bg-hover)]"
                          style={{ color: 'var(--accent)' }}
                          title="转换为原生自定义分组结构"
                        >
                          <FolderTree className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.api.sources.scan(src.id)
                            showToast(`正在同步「${src.alias}」...`)
                          }}
                          className="p-1 rounded hover:bg-[var(--bg-hover)]"
                          title="重新扫描此目录"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveSource(src)
                          }}
                          className="p-1 rounded hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                          title="移除索引源（不删原文件）"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="group-hover:hidden text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {src.assetCount}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </section>
      </div>

      {/* Scan progress indicator */}
      {scanProgress.running && (
        <div
          className="px-3.5 py-2.5 border-t text-xs"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
        >
          <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--accent)' }}>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span className="truncate">正在索引 {scanProgress.rootName || '...'}</span>
          </div>
          <div className="mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
            已扫描 {scanProgress.scanned} · 新增 {scanProgress.added}
            {scanProgress.relinked > 0 ? ` · 重连 ${scanProgress.relinked}` : ''}
          </div>
        </div>
      )}

      {/* Background Thumbnail & 3D Cover Queue Progress Indicator */}
      {(thumbProgress.running || modelThumbProgress.running) && (
        <div
          className="px-3.5 py-2 border-t text-xs space-y-1.5"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
        >
          {(() => {
            const total =
              (thumbProgress.running ? thumbProgress.total : 0) +
              (modelThumbProgress.running ? modelThumbProgress.total : 0)
            const completed =
              (thumbProgress.running ? thumbProgress.completed : 0) +
              (modelThumbProgress.running ? modelThumbProgress.completed : 0)
            const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
            const label =
              thumbProgress.running && modelThumbProgress.running
                ? '正在后台生成缩略图与 3D 封面'
                : modelThumbProgress.running
                  ? '正在渲染 3D 模型封面'
                  : '正在后台生成缩略图'
            return (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {label}
                  </span>
                  <span className="tabular-nums shrink-0 font-mono" style={{ color: 'var(--accent)' }}>
                    {completed}/{total}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden bg-black/20">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{ width: `${pct}%`, background: 'var(--prism-rail-gradient)' }}
                  />
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Sticky Footer: Duplicate Radar & Settings */}
      <div className="p-2.5 border-t shrink-0 space-y-0.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <button
          type="button"
          onClick={openDuplicates}
          className="w-full h-8 px-3 rounded-md flex items-center gap-2.5 text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          title="跨盘符扫描内容完全相同的重复文件，支持合并分组备注后清理"
        >
          <CopyCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="flex-1 text-left truncate">重复文件清理雷达</span>
        </button>

        <button
          type="button"
          onClick={() => openSettings('sources')}
          className="w-full h-9 px-3 rounded-md flex items-center gap-2.5 text-sm font-medium hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Settings className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left truncate">设置与索引管理</span>
          {hasPendingUpdate && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: updateState?.status === 'downloaded' ? 'var(--success)' : 'var(--accent)'
              }}
              title={`发现新版本 v${updateState?.release?.version}`}
            />
          )}
        </button>
      </div>

      {/* Source Directory Right-Click Context Menu */}
      {sourceContextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-60 rounded-lg border py-1.5 shadow-2xl text-sm"
          style={{
            left: `${sourceContextMenu.x}px`,
            top: `${sourceContextMenu.y}px`,
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-strong)'
          }}
        >
          <button
            type="button"
            onClick={() => handleConvertSourceToGroups(sourceContextMenu.source)}
            className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left font-medium"
            style={{ color: 'var(--accent)' }}
          >
            <FolderTree className="w-4 h-4 shrink-0" />
            <span className="truncate">转换为自定义分组结构</span>
          </button>

          <div className="my-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

          <button
            type="button"
            onClick={() => {
              const s = sourceContextMenu.source
              setSourceContextMenu(null)
              window.api.sources.scan(s.id)
              showToast(`正在同步「${s.alias}」...`)
            }}
            className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            style={{ color: 'var(--text-primary)' }}
          >
            <RefreshCw className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span>重新扫描此目录</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const s = sourceContextMenu.source
              setSourceContextMenu(null)
              window.api.system.openExternal(s.path)
            }}
            className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-[var(--bg-hover)] cursor-pointer text-left"
            style={{ color: 'var(--text-primary)' }}
          >
            <FolderOpen className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span>在资源管理器中打开</span>
          </button>

          <div className="my-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

          <button
            type="button"
            onClick={() => handleRemoveSource(sourceContextMenu.source)}
            className="w-full px-3 h-9 flex items-center gap-2.5 hover:bg-red-500/15 cursor-pointer text-left font-medium"
            style={{ color: 'var(--danger)' }}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>移除此索引源（不删原文件）</span>
          </button>
        </div>
      )}

      {/* Create / Edit Group Mini Dialog */}
      {groupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
          onClick={() => setGroupModal(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveGroupModal}
            className="w-96 rounded-xl border p-5 shadow-2xl space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)'
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {groupModal.mode === 'create'
                  ? groupModal.parentId != null
                    ? '新建子分组'
                    : '新建自定义分组'
                  : '编辑分组'}
              </h3>
              <button
                type="button"
                onClick={() => setGroupModal(null)}
                className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                分组名称
              </label>
              <input
                ref={groupInputRef}
                type="text"
                autoFocus
                value={groupModal.name}
                onChange={(e) => setGroupModal({ ...groupModal, name: e.target.value })}
                placeholder="例如：参考图、剪辑BGM、项目文档..."
                className="w-full h-9 px-3 rounded-md border text-sm outline-none select-text focus:border-[var(--accent)]"
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
                    onClick={() => setGroupModal({ ...groupModal, color: c })}
                    className="w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: groupModal.color === c ? '2px solid var(--text-primary)' : 'none',
                      outlineOffset: '2px'
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setGroupModal(null)}
                className="h-9 px-4 rounded-md text-sm hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!groupModal.name.trim()}
                className="h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-50 cursor-pointer"
                style={{ backgroundColor: 'var(--accent-solid)' }}
              >
                确定
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}
