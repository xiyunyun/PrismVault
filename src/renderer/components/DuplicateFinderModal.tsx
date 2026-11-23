import React, { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  CheckCircle2,
  CopyCheck,
  FolderOpen,
  Heart,
  RefreshCw,
  StickyNote,
  Trash2,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { getThumbMediaUrl } from '../utils/mediaUrl'
import { formatFileSize } from '@shared/mediaTypes'
import type { DuplicateGroup } from '@shared/types'

export const DuplicateFinderModal: React.FC = () => {
  const { duplicatesOpen, closeDuplicates, refreshAll, showToast, confirm } = useLibraryStore(
    useShallow((s) => ({
      duplicatesOpen: s.duplicatesOpen,
      closeDuplicates: s.closeDuplicates,
      refreshAll: s.refreshAll,
      showToast: s.showToast,
      confirm: s.confirm
    }))
  )

  const [loading, setLoading] = useState(false)
  const [mergingKey, setMergingKey] = useState<string | null>(null)
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [keepByFp, setKeepByFp] = useState<Record<string, number>>({})

  const scanDuplicates = async () => {
    setLoading(true)
    try {
      const list = await window.api.assets.findDuplicates()
      setGroups(list)
      const defaults: Record<string, number> = {}
      for (const g of list) {
        // Prefer the copy with note / favorite / most groups
        const best = [...g.items].sort((a, b) => {
          const scoreA = (a.note.trim() ? 4 : 0) + (a.isFavorite ? 2 : 0) + a.groupIds.length
          const scoreB = (b.note.trim() ? 4 : 0) + (b.isFavorite ? 2 : 0) + b.groupIds.length
          return scoreB - scoreA || a.indexedAt - b.indexedAt
        })[0]
        if (best) defaults[g.fingerprint] = best.id
      }
      setKeepByFp(defaults)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!duplicatesOpen) return
    scanDuplicates().catch(() => undefined)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useLibraryStore.getState().confirmDialog) {
        closeDuplicates()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [duplicatesOpen])

  const summary = useMemo(() => {
    let extraFiles = 0
    let reclaimableBytes = 0
    for (const g of groups) {
      extraFiles += Math.max(0, g.items.length - 1)
      reclaimableBytes += Math.max(0, g.items.length - 1) * g.fileSize
    }
    return { groupCount: groups.length, extraFiles, reclaimableBytes }
  }, [groups])

  if (!duplicatesOpen) return null

  const handleMergeSingleGroup = async (g: DuplicateGroup) => {
    const keepId = keepByFp[g.fingerprint] ?? g.items[0]?.id
    if (!keepId) return
    const removeItems = g.items.filter((a) => a.id !== keepId)
    const removeIds = removeItems.map((a) => a.id)
    if (removeIds.length === 0) return

    const keepItem = g.items.find((a) => a.id === keepId)
    const previewRemovePaths = removeItems
      .slice(0, 4)
      .map((a) => `  • ${a.filePath}`)
      .join('\n')
    const moreSuffix = removeItems.length > 4 ? `\n  • 等共 ${removeItems.length} 份文件` : ''

    const ok = await confirm({
      title: `保留选中项，并清理其余 ${removeIds.length} 份副本`,
      message: `确定保留当前选中的主文件，并将未选中的 ${removeIds.length} 份重复副本移至 Windows 回收站？`,
      detail: `✓ 保留主文件：\n  ${keepItem?.filePath ?? keepItem?.fileName ?? '所选文件'}\n\n✕ 移入回收站（${removeIds.length} 份）：\n${previewRemovePaths}${moreSuffix}\n\n所有副本的分组、收藏与备注都会自动无损合并到保留文件中。`,
      confirmText: '合并并移至回收站',
      variant: 'warning'
    })
    if (!ok) return

    setMergingKey(g.fingerprint)
    try {
      const res = await window.api.assets.mergeDuplicates(keepId, removeIds, true)
      showToast(
        res.failed.length > 0
          ? `已清理 ${res.removed} 份副本（${res.failed.length} 份移动失败）`
          : `已合并分组备注并清理 ${res.removed} 份重复副本`,
        res.failed.length > 0 ? 'error' : 'success'
      )
      await refreshAll()
      await scanDuplicates()
    } finally {
      setMergingKey(null)
    }
  }

  const handleMergeAll = async () => {
    if (groups.length === 0) return
    const ok = await confirm({
      title: `一键清理全部 ${summary.extraFiles} 份重复文件`,
      message: `将处理全部 ${summary.groupCount} 组重复文件，预计释放 ${formatFileSize(summary.reclaimableBytes)} 磁盘空间。`,
      detail: '每组按当前选中的保留项保留 1 份，所有副本的分组、收藏与备注均自动无损合并，多余原文件移至 Windows 回收站。',
      confirmText: '全部合并并移至回收站',
      variant: 'danger'
    })
    if (!ok) return

    setMergingKey('__all__')
    try {
      let totalRemoved = 0
      let totalFailed = 0
      for (const g of groups) {
        const keepId = keepByFp[g.fingerprint] ?? g.items[0]?.id
        if (!keepId) continue
        const removeIds = g.items.filter((a) => a.id !== keepId).map((a) => a.id)
        if (removeIds.length === 0) continue
        const res = await window.api.assets.mergeDuplicates(keepId, removeIds, true)
        totalRemoved += res.removed
        totalFailed += res.failed.length
      }
      showToast(
        totalFailed > 0
          ? `批量清理完成：移至回收站 ${totalRemoved} 份（${totalFailed} 份失败）`
          : `批量清理完成：已无损合并并清理 ${totalRemoved} 份重复文件`,
        totalFailed > 0 ? 'error' : 'success'
      )
      await refreshAll()
      await scanDuplicates()
    } finally {
      setMergingKey(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-[3px] p-4"
      onClick={closeDuplicates}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[660px] max-h-[88vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)'
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CopyCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                跨盘符重复文件清理雷达
              </h3>
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                基于内容指纹精准匹配跨盘重复副本，清理前自动无损合并所有分组、收藏与备注
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={loading || mergingKey != null}
              onClick={() => scanDuplicates()}
              className="h-8 px-3 rounded-lg border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              重新扫描
            </button>
            {groups.length > 0 && (
              <button
                type="button"
                disabled={loading || mergingKey != null}
                onClick={handleMergeAll}
                className="h-8 px-3.5 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                style={{ backgroundColor: 'var(--accent-solid)' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {mergingKey === '__all__'
                  ? '正在批量清理...'
                  : `一键清理全部 (${formatFileSize(summary.reclaimableBytes)})`}
              </button>
            )}
            <button
              type="button"
              onClick={closeDuplicates}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary Banner */}
        {!loading && groups.length > 0 && (
          <div
            className="px-5 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs shrink-0"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-active)' }}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span style={{ color: 'var(--text-primary)' }}>
                共发现 <strong>{summary.groupCount}</strong> 组重复（多余 <strong>{summary.extraFiles}</strong> 份）
              </span>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                点击选择每组要 <strong style={{ color: 'var(--success)' }}>保留</strong> 的主文件，其余未选副本将移入回收站
              </span>
            </div>
            <span className="font-mono font-semibold shrink-0" style={{ color: 'var(--accent)' }}>
              预计可释放：{formatFileSize(summary.reclaimableBytes)}
            </span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              <RefreshCw className="w-7 h-7 animate-spin" style={{ color: 'var(--accent)' }} />
              <span>正在通过内容指纹检索跨盘重复文件...</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <CheckCircle2 className="w-12 h-12" style={{ color: 'var(--success)' }} />
              <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                太棒了！当前资源库没有发现重复文件
              </div>
              <p className="text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
                所有已索引的跨盘素材均拥有唯一内容指纹，无需清理。
              </p>
            </div>
          ) : (
            groups.map((g) => {
              const keepId = keepByFp[g.fingerprint] ?? g.items[0]?.id
              const sample = g.items.find((a) => a.id === keepId) ?? g.items[0]
              const thumbUrl = sample ? getThumbMediaUrl(sample.thumbPath) : null
              const isMerging = mergingKey === g.fingerprint || mergingKey === '__all__'

              return (
                <div
                  key={g.fingerprint}
                  className="rounded-xl border overflow-hidden"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div
                    className="px-4 py-2.5 border-b flex items-center justify-between gap-3"
                    style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-black/20 flex items-center justify-center">
                        {thumbUrl ? (
                          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[0.68rem] font-mono uppercase" style={{ color: 'var(--text-muted)' }}>
                            {sample?.ext.replace('.', '') || 'FILE'}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {sample?.fileName}
                        </div>
                        <div className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                          <span>{g.items.length} 份完全相同</span>
                          <span>·</span>
                          <span>单份 {formatFileSize(g.fileSize)}</span>
                          <span>·</span>
                          <span style={{ color: 'var(--accent)' }}>
                            可省 {formatFileSize((g.items.length - 1) * g.fileSize)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isMerging}
                      onClick={() => handleMergeSingleGroup(g)}
                      className="h-8 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 hover:bg-red-500/15 disabled:opacity-50 cursor-pointer shrink-0"
                      style={{ borderColor: 'rgba(239,68,68,0.35)', color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isMerging ? '处理中...' : `清理其余 ${g.items.length - 1} 份`}</span>
                    </button>
                  </div>

                  <div className="p-2 space-y-1.5">
                    {g.items.map((item) => {
                      const isKeep = item.id === keepId
                      return (
                        <div
                          key={item.id}
                          onClick={() => setKeepByFp((prev) => ({ ...prev, [g.fingerprint]: item.id }))}
                          className={`px-3 py-2 rounded-lg border flex items-center gap-3 cursor-pointer transition-all ${
                            isKeep ? '' : 'opacity-75 hover:opacity-100'
                          }`}
                          style={{
                            backgroundColor: isKeep ? 'rgba(16, 185, 129, 0.10)' : 'var(--bg-surface)',
                            borderColor: isKeep ? 'rgba(16, 185, 129, 0.55)' : 'var(--border-subtle)'
                          }}
                          title={isKeep ? '当前选中：此文件将被保留' : '点击切换为保留此文件（当前状态：将被移入回收站）'}
                        >
                          <input
                            type="radio"
                            name={`keep-${g.fingerprint}`}
                            checked={isKeep}
                            onChange={() => setKeepByFp((prev) => ({ ...prev, [g.fingerprint]: item.id }))}
                            className="accent-emerald-500 cursor-pointer shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-flex items-center gap-1 text-[0.68rem] px-1.5 py-0.5 rounded font-semibold shrink-0"
                                style={{
                                  backgroundColor: isKeep ? '#10b981' : 'rgba(239,68,68,0.14)',
                                  color: isKeep ? '#fff' : 'var(--danger)'
                                }}
                              >
                                {isKeep ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>保留此文件</span>
                                  </>
                                ) : (
                                  <>
                                    <Trash2 className="w-3 h-3" />
                                    <span>将移入回收站</span>
                                  </>
                                )}
                              </span>
                              <span
                                className={`text-xs font-medium truncate ${isKeep ? '' : 'line-through'}`}
                                style={{ color: isKeep ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                              >
                                {item.fileName}
                              </span>
                              {item.isFavorite && <Heart className="w-3 h-3 shrink-0 fill-rose-500 text-rose-500" />}
                              {item.note.trim() && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[0.68rem] px-1.5 rounded bg-amber-500/15 text-amber-400 shrink-0"
                                  title={item.note}
                                >
                                  <StickyNote className="w-3 h-3" />
                                  有备注
                                </span>
                              )}
                              {item.groupIds.length > 0 && (
                                <span className="text-[0.68rem] shrink-0" style={{ color: 'var(--text-muted)' }}>
                                  {item.groupIds.length} 个分组
                                </span>
                              )}
                            </div>
                            <div
                              className={`text-[0.72rem] font-mono truncate mt-0.5 ${isKeep ? '' : 'line-through opacity-80'}`}
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {item.filePath}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              window.api.system.revealInExplorer(item.filePath)
                            }}
                            className="p-1.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
                            style={{ color: 'var(--text-muted)' }}
                            title="在资源管理器中定位"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
