import React, { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit2,
  File,
  FileText,
  Film,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Inbox,
  Layers,
  Music,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { GROUP_COLORS } from '../utils/mediaUrl'
import type { GroupNode } from '@shared/types'
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
    groupId,
    setGroupId,
    rootId,
    setRootId,
    groups,
    sources,
    stats,
    scanProgress,
    updateState,
    openSettings,
    refreshAll,
    showToast,
    confirm
  } = useLibraryStore()

  const hasPendingUpdate = Boolean(
    updateState &&
      updateState.release &&
      (updateState.status === 'available' ||
        updateState.status === 'downloading' ||
        updateState.status === 'downloaded')
  )

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null)
  const [groupModal, setGroupModal] = useState<GroupModalState | null>(null)
  const [sourcesExpanded, setSourcesExpanded] = useState(true)
  const groupInputRef = useRef<HTMLInputElement>(null)

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

  const handleDropOnGroup = async (e: React.DragEvent, targetGroup: GroupNode) => {
    e.preventDefault()
    setDragOverGroupId(null)
    const raw = e.dataTransfer.getData('application/x-xiyun-assets')
    if (!raw) return
    try {
      const assetIds = JSON.parse(raw) as number[]
      if (Array.isArray(assetIds) && assetIds.length > 0) {
        await window.api.groups.assignAssets(assetIds, [targetGroup.id])
        showToast(`已将 ${assetIds.length} 项加入「${targetGroup.name}」`, 'success')
        await refreshAll()
      }
    } catch {
      // ignore invalid drag payload
    }
  }

  const renderGroupNode = (node: GroupNode, depth = 0): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isExpanded = expandedGroups.has(node.id)
    const isSelected = groupId === node.id
    const isDragOver = dragOverGroupId === node.id

    return (
      <div key={node.id}>
        <div
          onClick={() => setGroupId(isSelected ? null : node.id)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-xiyun-assets')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              if (dragOverGroupId !== node.id) setDragOverGroupId(node.id)
            }
          }}
          onDragLeave={() => {
            if (dragOverGroupId === node.id) setDragOverGroupId(null)
          }}
          onDrop={(e) => handleDropOnGroup(e, node)}
          className="group relative flex items-center gap-2 h-9 pr-2.5 rounded-md cursor-pointer transition-colors text-sm hover:bg-[var(--bg-hover)]"
          style={{
            paddingLeft: `${10 + depth * 14}px`,
            backgroundColor: isDragOver || isSelected ? 'var(--bg-active)' : undefined,
            outline: isDragOver ? '1.5px dashed var(--accent)' : 'none',
            color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'
          }}
        >
          {isSelected && (
            <span
              className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
              style={{ backgroundColor: 'var(--accent)' }}
            />
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleExpand(node.id)
            }}
            className="w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-[var(--bg-hover)]"
            style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
          <span className="flex-1 truncate font-medium">{node.name}</span>

          {/* Hover actions */}
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

          <span
            className="group-hover:hidden text-xs tabular-nums shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            {node.totalCount}
          </span>
        </div>

        {hasChildren && isExpanded && (
          <div>{node.children.map((child) => renderGroupNode(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <aside
      className="shrink-0 h-full flex flex-col border-r"
      style={{
        width: `${width}px`,
        backgroundColor: 'var(--bg-sidebar)',
        borderColor: 'var(--border-subtle)'
      }}
    >
      {/* Scrollable sidebar body */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5">
        {/* 1. Quick Smart Views */}
        <section className="space-y-1">
          {[
            { id: 'all' as const, label: '全部素材', icon: Layers, count: stats.totalActive },
            { id: 'ungrouped' as const, label: '未分类', icon: Inbox, count: stats.ungroupedCount },
            { id: 'recent' as const, label: '最近添加', icon: Clock, count: stats.recentCount },
            { id: 'missing' as const, label: '离线 / 失效', icon: AlertTriangle, count: stats.missingCount, warn: true }
          ].map((item) => {
            const Icon = item.icon
            const active = smartView === item.id && groupId === null && rootId === null
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSmartView(item.id)}
                className="relative w-full flex items-center gap-2.5 h-9 px-3 rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                style={{
                  backgroundColor: active ? 'var(--bg-active)' : undefined,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
                }}
              >
                {active && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
                <Icon
                  className="w-4 h-4 shrink-0"
                  style={{
                    color: item.warn && item.count > 0 ? 'var(--warning)' : active ? 'var(--accent)' : 'var(--text-muted)'
                  }}
                />
                <span className="flex-1 text-left truncate">{item.label}</span>
                <span
                  className="text-xs tabular-nums px-1.5 py-0.5 rounded"
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

        {/* 2. Media Type Tag Filter */}
        <section>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
              素材类型
            </span>
            {mediaTypes.length > 0 ? (
              <button
                type="button"
                onClick={clearMediaTypes}
                className="text-xs hover:underline cursor-pointer"
                style={{ color: 'var(--accent)' }}
              >
                重置
              </button>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Ctrl 多选
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {MEDIA_TYPE_ITEMS.map(({ type, label, icon: Icon, color }) => {
              const selected = mediaTypes.includes(type)
              const count = stats.byType[type] ?? 0
              return (
                <button
                  key={type}
                  type="button"
                  onClick={(e) => toggleMediaType(type, e.ctrlKey || e.metaKey)}
                  className="flex items-center gap-2 px-2.5 h-8 rounded-md border text-xs font-medium cursor-pointer transition-all hover:bg-[var(--bg-hover)]"
                  style={{
                    backgroundColor: selected ? 'var(--bg-active)' : 'var(--bg-surface)',
                    borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)'
                  }}
                >
                  <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                  <span className="truncate flex-1 text-left">{label}</span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 3. Custom Groups Tree */}
        <section>
          <div className="flex items-center justify-between px-2 mb-1.5">
            <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
              自定义分组
            </span>
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
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
              title="新建自定义分组"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {groups.length === 0 ? (
            <div
              className="px-3 py-3.5 rounded-lg border border-dashed text-center text-xs leading-relaxed"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
            >
              暂无分组，点右上角 + 新建
              <br />
              支持拖拽文件直接归组
            </div>
          ) : (
            <div className="space-y-0.5">{groups.map((node) => renderGroupNode(node, 0))}</div>
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
                      className="group relative flex items-center gap-2 h-9 px-3 rounded-md text-sm cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                      style={{
                        backgroundColor: active ? 'var(--bg-active)' : undefined,
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
                      }}
                      title={src.path}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                          style={{ backgroundColor: 'var(--accent)' }}
                        />
                      )}
                      <Folder
                        className="w-4 h-4 shrink-0"
                        style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
                      />
                      <span className="flex-1 truncate">{src.alias}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.api.sources.scan(src.id)
                          showToast(`正在同步「${src.alias}」...`)
                        }}
                        className="hidden group-hover:flex p-1 rounded hover:bg-[var(--bg-hover)]"
                        title="重新扫描此目录"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
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

      {/* Sticky Footer: Settings Button */}
      <div className="p-2.5 border-t shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
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
