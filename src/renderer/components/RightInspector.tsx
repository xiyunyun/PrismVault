import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  Film,
  FolderOpen,
  Info,
  Music,
  Plus,
  StickyNote,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { flattenGroupTree, getFileMediaUrl, getThumbMediaUrl } from '../utils/mediaUrl'
import {
  formatDateTime,
  formatDuration,
  formatFileSize,
  MEDIA_TYPE_LABELS
} from '@shared/mediaTypes'
import type { Asset } from '@shared/types'

interface RightInspectorProps {
  width: number
}

export const RightInspector: React.FC<RightInspectorProps> = ({ width }) => {
  const {
    assets,
    groups,
    stats,
    selectedIds,
    previewAssetId,
    setPreviewAssetId,
    updateAssetNoteLocal,
    refreshAll,
    showToast,
    confirm
  } = useLibraryStore()

  const selectedAssets = useMemo(() => {
    if (selectedIds.length === 0) return []
    const set = new Set(selectedIds)
    return assets.filter((a) => set.has(a.id))
  }, [assets, selectedIds])

  const singleAsset: Asset | null = selectedAssets.length === 1 ? selectedAssets[0] : null
  const flatGroups = useMemo(() => flattenGroupTree(groups), [groups])
  const groupById = useMemo(() => new Map(flatGroups.map((g) => [g.id, g])), [flatGroups])

  const [noteMode, setNoteMode] = useState<'edit' | 'preview'>('edit')
  const [draftNote, setDraftNote] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [batchNote, setBatchNote] = useState('')

  const activeAssetIdRef = useRef<number | null>(null)
  const pendingNoteRef = useRef<{ id: number; note: string } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPendingNote = async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingNoteRef.current
    if (!pending) return
    pendingNoteRef.current = null
    await window.api.assets.updateNote(pending.id, pending.note)
    updateAssetNoteLocal(pending.id, pending.note)
  }

  useEffect(() => {
    const nextId = singleAsset?.id ?? null
    if (activeAssetIdRef.current !== nextId) {
      flushPendingNote().catch(() => undefined)
      activeAssetIdRef.current = nextId
      setDraftNote(singleAsset?.note ?? '')
      setSaveState('idle')
      setGroupPickerOpen(false)
    }
  }, [singleAsset?.id])

  useEffect(() => {
    return () => {
      flushPendingNote().catch(() => undefined)
    }
  }, [])

  const handleNoteChange = (val: string) => {
    if (!singleAsset) return
    setDraftNote(val)
    setSaveState('saving')
    const id = singleAsset.id
    pendingNoteRef.current = { id, note: val }
    updateAssetNoteLocal(id, val)

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const pending = pendingNoteRef.current
      if (!pending || pending.id !== id) return
      pendingNoteRef.current = null
      try {
        await window.api.assets.updateNote(pending.id, pending.note)
        setSaveState('saved')
      } catch {
        setSaveState('idle')
      }
    }, 350)
  }

  const handleToggleGroupForSingle = async (gid: number) => {
    if (!singleAsset) return
    const has = singleAsset.groupIds.includes(gid)
    if (has) {
      await window.api.groups.unassignAssets([singleAsset.id], [gid])
    } else {
      await window.api.groups.assignAssets([singleAsset.id], [gid])
    }
    await refreshAll()
  }

  // ===================== Empty State =====================
  if (selectedAssets.length === 0) {
    return (
      <aside
        className="shrink-0 h-full border-l flex flex-col p-4 overflow-y-auto"
        style={{
          width: `${width}px`,
          backgroundColor: 'var(--bg-sidebar)',
          borderColor: 'var(--border-subtle)'
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            信息与备注
          </h3>
        </div>

        <div
          className="rounded-lg border p-4 text-center space-y-2 mb-5"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <StickyNote className="w-8 h-8 mx-auto opacity-45" style={{ color: 'var(--text-muted)' }} />
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            未选中素材
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            点击中间任意文件即可查看详细元信息、管理分组，并编写支持 Markdown 的专属备注。
          </p>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
            资源库概览
          </div>
          <div
            className="rounded-lg border p-3.5 space-y-2 text-xs"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>在线素材总数</span>
              <span className="font-mono font-semibold">{stats.totalActive}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>图片 / 视频</span>
              <span className="font-mono">
                {stats.byType.image} / {stats.byType.video}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>音频 / 文本</span>
              <span className="font-mono">
                {stats.byType.audio} / {stats.byType.text}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>未分类</span>
              <span className="font-mono">{stats.ungroupedCount}</span>
            </div>
          </div>

          <div className="pt-1 text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
            快捷键
          </div>
          <div
            className="rounded-lg border p-3.5 space-y-2 text-xs"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-secondary)'
            }}
          >
            <div className="flex justify-between items-center">
              <span>内嵌预览</span>
              <kbd className="px-1.5 py-0.5 rounded bg-black/25 font-mono text-xs">Space / 双击</kbd>
            </div>
            <div className="flex justify-between items-center">
              <span>多选 / 区间选</span>
              <kbd className="px-1.5 py-0.5 rounded bg-black/25 font-mono text-xs">Ctrl / Shift</kbd>
            </div>
            <div className="flex justify-between items-center">
              <span>快速归组</span>
              <kbd className="px-1.5 py-0.5 rounded bg-black/25 font-mono text-xs">拖拽至左侧分组</kbd>
            </div>
            <div className="flex justify-between items-center">
              <span>剪贴板导图</span>
              <kbd className="px-1.5 py-0.5 rounded bg-black/25 font-mono text-xs">Ctrl + V</kbd>
            </div>
          </div>
        </div>
      </aside>
    )
  }

  // ===================== Multi-Selection Batch Panel =====================
  if (selectedAssets.length > 1) {
    const totalSize = selectedAssets.reduce((sum, a) => sum + a.fileSize, 0)
    const ids = selectedAssets.map((a) => a.id)

    return (
      <aside
        className="shrink-0 h-full border-l flex flex-col p-4 overflow-y-auto space-y-5"
        style={{
          width: `${width}px`,
          backgroundColor: 'var(--bg-sidebar)',
          borderColor: 'var(--border-subtle)'
        }}
      >
        <div
          className="rounded-lg border p-4"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            已选中 {selectedAssets.length} 个素材
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            合计大小：{formatFileSize(totalSize)}
          </div>
        </div>

        {/* Batch Group Assignment */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Tag className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span>批量添加到分组</span>
          </div>
          {flatGroups.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              暂无自定义分组，请先在左侧栏创建。
            </div>
          ) : (
            <div
              className="max-h-48 overflow-y-auto rounded-lg border p-1.5 space-y-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              {flatGroups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-2 h-8 px-2 rounded hover:bg-[var(--bg-hover)] text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: `${g.depth * 10}px` }}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="truncate">{g.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await window.api.groups.assignAssets(ids, [g.id])
                        showToast(`已将 ${ids.length} 项加入「${g.name}」`, 'success')
                        await refreshAll()
                      }}
                      className="px-2 py-0.5 rounded text-xs font-medium text-white cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-solid)' }}
                    >
                      加入
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await window.api.groups.unassignAssets(ids, [g.id])
                        showToast(`已从「${g.name}」移出 ${ids.length} 项`)
                        await refreshAll()
                      }}
                      className="px-2 py-0.5 rounded text-xs hover:bg-black/20 cursor-pointer"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      移出
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Batch Append Note */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            <StickyNote className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span>批量追加备注</span>
          </div>
          <textarea
            rows={4}
            value={batchNote}
            onChange={(e) => setBatchNote(e.target.value)}
            placeholder="输入要追加到所有选中文件末尾的备注（支持 Markdown）..."
            className="w-full p-3 rounded-lg border text-sm outline-none resize-y focus:border-[var(--accent)]"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)'
            }}
          />
          <button
            type="button"
            disabled={!batchNote.trim()}
            onClick={async () => {
              await window.api.assets.batchAppendNote(ids, batchNote)
              setBatchNote('')
              showToast(`已为 ${ids.length} 项追加备注`, 'success')
              await refreshAll()
            }}
            className="w-full h-9 rounded-md text-sm font-medium text-white disabled:opacity-45 cursor-pointer"
            style={{ backgroundColor: 'var(--accent-solid)' }}
          >
            应用到选中的 {ids.length} 个文件
          </button>
        </section>

        <section className="pt-3 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={async () => {
              await window.api.assets.setStatus(ids, 'hidden')
              showToast(`已从库中隐藏 ${ids.length} 项`)
              await refreshAll()
            }}
            className="w-full h-9 rounded-md border text-xs flex items-center justify-center gap-2 hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            <EyeOff className="w-4 h-4" />
            <span>从库中批量隐藏（保留原文件）</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: `移至系统回收站（${ids.length} 项）`,
                message: `确定将选中的 ${ids.length} 个本地原文件移至 Windows 回收站吗？`,
                detail: '此操作会移动硬盘上的真实原文件至系统回收站，可从回收站中还原。',
                confirmText: '移至回收站',
                variant: 'danger'
              })
              if (!ok) return
              const res = await window.api.assets.moveToTrash(ids)
              showToast(`已移至回收站 ${res.trashed} 项`)
              await refreshAll()
            }}
            className="w-full h-9 rounded-md border text-xs flex items-center justify-center gap-2 hover:bg-red-500/15 cursor-pointer"
            style={{ borderColor: 'rgba(239, 68, 68, 0.35)', color: 'var(--danger)' }}
          >
            <Trash2 className="w-4 h-4" />
            <span>批量移至系统回收站</span>
          </button>
        </section>
      </aside>
    )
  }

  // ===================== Single Asset Inspector =====================
  const asset = singleAsset!
  const thumbUrl = getThumbMediaUrl(asset.thumbPath)
  const fileUrl = getFileMediaUrl(asset.id)
  const isCurrentlyPreviewing = previewAssetId === asset.id

  const renderMiniPreview = () => {
    if (asset.mediaType === 'image') {
      const src = asset.ext === '.svg' || asset.ext === '.gif' ? fileUrl : thumbUrl || fileUrl
      return <img src={src} alt={asset.fileName} className="w-full h-full object-contain" />
    }
    if (asset.mediaType === 'video') {
      if (thumbUrl) return <img src={thumbUrl} alt={asset.fileName} className="w-full h-full object-contain" />
      return <Film className="w-10 h-10 opacity-60" />
    }
    if (asset.mediaType === 'audio') {
      if (thumbUrl) return <img src={thumbUrl} alt={asset.fileName} className="w-full h-full object-cover" />
      return <Music className="w-10 h-10 text-emerald-400" />
    }
    if (asset.mediaType === 'text') {
      return <FileText className="w-10 h-10 text-amber-400" />
    }
    return <File className="w-10 h-10 opacity-60" />
  }

  const metaRows: Array<{ label: string; value: string; title?: string }> = [
    {
      label: '文件类型',
      value: `${MEDIA_TYPE_LABELS[asset.mediaType]} (${asset.ext.toUpperCase() || '未知'})`
    },
    {
      label: '文件大小',
      value: formatFileSize(asset.fileSize),
      title: `${asset.fileSize.toLocaleString()} 字节`
    },
    { label: '创建时间', value: formatDateTime(asset.createdAt) },
    { label: '修改时间', value: formatDateTime(asset.modifiedAt) }
  ]

  if (asset.width && asset.height) {
    metaRows.push({ label: '分辨率', value: `${asset.width} × ${asset.height}` })
  }
  if (asset.extraMeta?.colorMode) {
    const bits = asset.extraMeta.bitsPerChannel ? ` / ${asset.extraMeta.bitsPerChannel}-bit` : ''
    metaRows.push({ label: '色彩模式', value: `${asset.extraMeta.colorMode}${bits}` })
  }
  if (asset.extraMeta?.layerCount != null && asset.extraMeta.layerCount > 0) {
    metaRows.push({ label: 'PSD 图层数', value: `${asset.extraMeta.layerCount} 层` })
  }
  if (asset.duration != null) {
    metaRows.push({ label: '时长', value: formatDuration(asset.duration) })
  }
  if (asset.extraMeta?.fps) {
    metaRows.push({ label: '帧率', value: `${asset.extraMeta.fps} fps` })
  }
  if (asset.extraMeta?.videoCodec || asset.extraMeta?.audioCodec) {
    const codecs = [asset.extraMeta.videoCodec, asset.extraMeta.audioCodec].filter(Boolean).join(' / ')
    metaRows.push({ label: '编解码', value: codecs })
  }
  if (asset.extraMeta?.bitrate) {
    metaRows.push({ label: '码率', value: `${Math.round(asset.extraMeta.bitrate / 1000)} kbps` })
  }
  if (asset.extraMeta?.sampleRate) {
    metaRows.push({ label: '采样率', value: `${(asset.extraMeta.sampleRate / 1000).toFixed(1)} kHz` })
  }
  if (asset.extraMeta?.artist) {
    metaRows.push({ label: '艺术家', value: asset.extraMeta.artist })
  }
  if (asset.extraMeta?.album) {
    metaRows.push({ label: '专辑', value: asset.extraMeta.album })
  }

  return (
    <aside
      className="shrink-0 h-full border-l flex flex-col overflow-y-auto"
      style={{
        width: `${width}px`,
        backgroundColor: 'var(--bg-sidebar)',
        borderColor: 'var(--border-subtle)'
      }}
    >
      {/* Top Preview & Filename */}
      <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
        {!isCurrentlyPreviewing && (
          <div
            onClick={() => setPreviewAssetId(asset.id)}
            className="h-44 rounded-lg overflow-hidden flex items-center justify-center relative cursor-pointer group border"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)'
            }}
            title="点击在中间窗口打开内嵌预览"
          >
            {renderMiniPreview()}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute inset-0 bg-black/35 flex items-center justify-center">
              <span className="px-3 py-1.5 rounded-md bg-black/75 text-white text-xs flex items-center gap-1.5">
                <Eye className="w-4 h-4" />
                内嵌预览
              </span>
            </div>
          </div>
        )}

        <div
          className="text-sm font-semibold break-all leading-snug select-text"
          style={{ color: 'var(--text-primary)' }}
        >
          {asset.fileName}
        </div>

        {/* Quick action buttons */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => window.api.system.revealInExplorer(asset.filePath)}
            className="h-8 rounded-md border flex items-center justify-center gap-1.5 text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-secondary)'
            }}
            title="在资源管理器中定位原文件"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>定位</span>
          </button>
          <button
            type="button"
            onClick={() => window.api.system.openExternal(asset.filePath)}
            className="h-8 rounded-md border flex items-center justify-center gap-1.5 text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-secondary)'
            }}
            title="用系统默认软件打开"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>打开</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await window.api.system.copyPath(asset.filePath)
              showToast('已复制完整路径', 'success')
            }}
            className="h-8 rounded-md border flex items-center justify-center gap-1.5 text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-secondary)'
            }}
            title="复制物理路径"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>路径</span>
          </button>
        </div>
      </div>

      {/* Markdown Note Section */}
      <div className="p-4 border-b space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StickyNote className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              文件备注
            </span>
            {saveState === 'saving' && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                保存中...
              </span>
            )}
            {saveState === 'saved' && (
              <span className="text-xs flex items-center gap-0.5" style={{ color: 'var(--success)' }}>
                <Check className="w-3 h-3" />
                已保存
              </span>
            )}
          </div>

          <div
            className="flex items-center p-0.5 rounded-md border text-xs"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <button
              type="button"
              onClick={() => setNoteMode('edit')}
              className="px-2 h-6 rounded flex items-center gap-1 cursor-pointer"
              style={{
                backgroundColor: noteMode === 'edit' ? 'var(--accent-solid)' : 'transparent',
                color: noteMode === 'edit' ? '#fff' : 'var(--text-secondary)'
              }}
            >
              <Edit3 className="w-3 h-3" />
              编辑
            </button>
            <button
              type="button"
              onClick={() => setNoteMode('preview')}
              className="px-2 h-6 rounded flex items-center gap-1 cursor-pointer"
              style={{
                backgroundColor: noteMode === 'preview' ? 'var(--accent-solid)' : 'transparent',
                color: noteMode === 'preview' ? '#fff' : 'var(--text-secondary)'
              }}
            >
              <Eye className="w-3 h-3" />
              预览
            </button>
          </div>
        </div>

        {noteMode === 'edit' ? (
          <textarea
            value={draftNote}
            onChange={(e) => handleNoteChange(e.target.value)}
            rows={5}
            placeholder="为该文件添加备注（支持 Markdown，自动保存并支持全局搜索）..."
            className="w-full p-3 rounded-lg border text-sm leading-relaxed outline-none resize-y select-text focus:border-[var(--accent)]"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)'
            }}
          />
        ) : (
          <div
            onClick={() => {
              if (!draftNote.trim()) setNoteMode('edit')
            }}
            className="min-h-[120px] max-h-64 overflow-y-auto p-3 rounded-lg border select-text"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)'
            }}
          >
            {draftNote.trim() ? (
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{draftNote}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-xs italic cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                暂无备注，点击此处开始编辑...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom Groups Section */}
      <div className="p-4 border-b space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              所属分组
            </span>
          </div>
          <button
            type="button"
            onClick={() => setGroupPickerOpen((v) => !v)}
            className="h-7 px-2.5 rounded-md text-xs flex items-center gap-1 hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{groupPickerOpen ? '收起' : '管理'}</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {asset.groupIds.length === 0 ? (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              未归属任何分组
            </span>
          ) : (
            asset.groupIds.map((gid) => {
              const g = groupById.get(gid)
              if (!g) return null
              return (
                <span
                  key={gid}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)'
                  }}
                  title={g.fullPath}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                  <span className="max-w-[150px] truncate">{g.name}</span>
                  <button
                    type="button"
                    onClick={() => handleToggleGroupForSingle(gid)}
                    className="hover:text-[var(--danger)] cursor-pointer ml-0.5"
                    title="移出该分组"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              )
            })
          )}
        </div>

        {groupPickerOpen && (
          <div
            className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border p-1.5 space-y-0.5"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            {flatGroups.length === 0 ? (
              <div className="p-2 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                请先在左侧边栏创建分组
              </div>
            ) : (
              flatGroups.map((g) => {
                const checked = asset.groupIds.includes(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => handleToggleGroupForSingle(g.id)}
                    className="w-full h-8 px-2 rounded flex items-center gap-2 hover:bg-[var(--bg-hover)] cursor-pointer text-xs text-left"
                    style={{ paddingLeft: `${8 + g.depth * 12}px` }}
                  >
                    <span
                      className="w-4 h-4 rounded border flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: checked ? 'var(--accent-solid)' : 'transparent',
                        borderColor: checked ? 'var(--accent-solid)' : 'var(--border-strong)'
                      }}
                    >
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="truncate flex-1">{g.name}</span>
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* File Metadata Section */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            文件信息
          </span>
        </div>

        <div className="space-y-2.5 text-xs">
          {metaRows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-2.5" title={row.title}>
              <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                {row.label}
              </span>
              <span
                className="text-right font-mono break-all select-text"
                style={{ color: 'var(--text-primary)' }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {asset.extraMeta?.layerNames && asset.extraMeta.layerNames.length > 0 && (
          <div className="pt-1">
            <div className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
              图层结构预览（前 {asset.extraMeta.layerNames.length} 项）
            </div>
            <div
              className="max-h-32 overflow-y-auto rounded-lg border p-2 space-y-1 text-xs"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              {asset.extraMeta.layerNames.map((name, idx) => (
                <div key={`${name}-${idx}`} className="truncate font-mono" style={{ color: 'var(--text-secondary)' }}>
                  • {name}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-1">
          <div className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
            本地物理路径（索引原址）
          </div>
          <div
            onClick={async () => {
              await window.api.system.copyPath(asset.filePath)
              showToast('已复制物理路径', 'success')
            }}
            className="p-2.5 rounded-lg border text-xs font-mono break-all cursor-pointer hover:border-[var(--accent)] transition-colors select-text"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-secondary)'
            }}
            title="点击复制完整路径"
          >
            {asset.filePath}
          </div>
        </div>
      </div>
    </aside>
  )
}
