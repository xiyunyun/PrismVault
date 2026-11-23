import React, { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CopyPlus,
  File,
  FileText,
  Film,
  Music,
  RefreshCw,
  SkipForward,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { getFileMediaUrl, getThumbMediaUrl } from '../utils/mediaUrl'
import { formatDateTime, formatFileSize, isPdfExt } from '@shared/mediaTypes'
import type { ConflictResolution, ImportConflictItem } from '@shared/types'

const PreviewBox: React.FC<{
  mediaType: ImportConflictItem['incomingMediaType']
  ext: string
  imgSrc: string | null
  textSnippet: string | null | undefined
}> = ({ mediaType, ext, imgSrc, textSnippet }) => {
  const extLabel = ext ? ext.replace('.', '').toUpperCase() : 'FILE'

  if (imgSrc) {
    return (
      <img
        src={imgSrc}
        alt={extLabel}
        className="w-full h-full object-contain"
        draggable={false}
      />
    )
  }

  if (mediaType === 'text' && !isPdfExt(ext) && textSnippet) {
    return (
      <pre
        className="w-full h-full p-2.5 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all overflow-hidden m-0 text-left"
        style={{ color: 'var(--text-secondary)' }}
      >
        {textSnippet}
      </pre>
    )
  }

  const Icon =
    mediaType === 'video'
      ? Film
      : mediaType === 'audio'
      ? Music
      : mediaType === 'text'
      ? FileText
      : File

  return (
    <div className="flex flex-col items-center justify-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
      <Icon className="w-10 h-10 opacity-75" />
      <span className="text-xs font-mono px-2 py-0.5 rounded bg-black/20">{extLabel}</span>
    </div>
  )
}

export const ImportConflictDialog: React.FC = () => {
  const { importConflictDialog, finishImportConflicts } = useLibraryStore()

  const [index, setIndex] = useState(0)
  const [applyToAll, setApplyToAll] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, ConflictResolution>>({})

  useEffect(() => {
    setIndex(0)
    setApplyToAll(false)
    setDecisions({})
  }, [importConflictDialog])

  useEffect(() => {
    if (!importConflictDialog) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finishImportConflicts(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [importConflictDialog, finishImportConflicts])

  if (!importConflictDialog || importConflictDialog.conflicts.length === 0) return null

  const conflicts = importConflictDialog.conflicts
  const current = conflicts[index]
  if (!current) return null

  const remaining = conflicts.length - index - 1
  const existing = current.existingAsset
  const existingImgSrc =
    existing.mediaType === 'image'
      ? existing.ext === '.svg' || existing.ext === '.gif'
        ? getFileMediaUrl(existing.id)
        : getThumbMediaUrl(existing.thumbPath) || getFileMediaUrl(existing.id)
      : existing.thumbPath
      ? getThumbMediaUrl(existing.thumbPath)
      : null

  const handleChoose = (choice: ConflictResolution) => {
    const nextDecisions: Record<string, ConflictResolution> = { ...decisions }

    if (applyToAll) {
      for (let i = index; i < conflicts.length; i++) {
        nextDecisions[conflicts[i].incomingPath.toLowerCase()] = choice
      }
      finishImportConflicts(nextDecisions)
      return
    }

    nextDecisions[current.incomingPath.toLowerCase()] = choice
    if (index + 1 >= conflicts.length) {
      finishImportConflicts(nextDecisions)
    } else {
      setDecisions(nextDecisions)
      setIndex(index + 1)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      onClick={() => finishImportConflicts(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)'
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b flex items-center justify-between gap-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  发现同名文件冲突
                </h3>
                {conflicts.length > 1 && (
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                  >
                    {index + 1} / {conflicts.length}
                  </span>
                )}
              </div>
              <div className="text-xs truncate mt-0.5 font-mono" style={{ color: 'var(--text-secondary)' }}>
                {current.fileName}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => finishImportConflicts(null)}
            className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
            title="取消本次导入 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Side-by-Side Visual Thumbnail Comparison */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Existing Asset Card */}
            <div
              className="rounded-lg border p-3.5 flex flex-col gap-2.5"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  库中已有文件
                </span>
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}
                >
                  现有
                </span>
              </div>

              <div
                className="h-44 rounded-md border overflow-hidden flex items-center justify-center"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-subtle)' }}
              >
                <PreviewBox
                  mediaType={existing.mediaType}
                  ext={existing.ext}
                  imgSrc={existingImgSrc}
                  textSnippet={existing.textSnippet}
                />
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>大小</span>
                  <span className="font-mono">{formatFileSize(existing.fileSize)}</span>
                </div>
                {existing.width && existing.height && (
                  <div className="flex justify-between gap-2">
                    <span style={{ color: 'var(--text-muted)' }}>分辨率</span>
                    <span className="font-mono">
                      {existing.width} × {existing.height}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>修改时间</span>
                  <span className="font-mono">{formatDateTime(existing.modifiedAt)}</span>
                </div>
                <div
                  className="pt-1 font-mono truncate"
                  style={{ color: 'var(--text-muted)' }}
                  title={existing.filePath}
                >
                  {existing.filePath}
                </div>
              </div>
            </div>

            {/* Incoming New File Card */}
            <div
              className="rounded-lg border p-3.5 flex flex-col gap-2.5"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--accent)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  准备导入的新文件
                </span>
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                >
                  新文件
                </span>
              </div>

              <div
                className="h-44 rounded-md border overflow-hidden flex items-center justify-center"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-subtle)' }}
              >
                <PreviewBox
                  mediaType={current.incomingMediaType}
                  ext={current.incomingExt}
                  imgSrc={current.incomingThumbDataUrl ?? null}
                  textSnippet={current.incomingTextSnippet}
                />
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>大小</span>
                  <span className="font-mono">{formatFileSize(current.incomingSize)}</span>
                </div>
                {current.incomingWidth && current.incomingHeight && (
                  <div className="flex justify-between gap-2">
                    <span style={{ color: 'var(--text-muted)' }}>分辨率</span>
                    <span className="font-mono">
                      {current.incomingWidth} × {current.incomingHeight}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>修改时间</span>
                  <span className="font-mono">{formatDateTime(current.incomingModifiedAt)}</span>
                </div>
                <div
                  className="pt-1 font-mono truncate"
                  style={{ color: 'var(--text-muted)' }}
                  title={current.incomingPath}
                >
                  {current.incomingPath}
                </div>
              </div>
            </div>
          </div>

          {remaining > 0 && (
            <label
              className="flex items-center gap-2 text-xs cursor-pointer select-none"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="accent-[var(--accent-solid)] w-4 h-4 cursor-pointer"
              />
              <span>对其余 {remaining} 个同名冲突全部应用此选择</span>
            </label>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="px-5 py-3.5 border-t flex flex-wrap items-center justify-between gap-2"
          style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-subtle)' }}
        >
          <button
            type="button"
            onClick={() => finishImportConflicts(null)}
            className="h-9 px-3.5 rounded-md text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
          >
            取消本次导入
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleChoose('skip')}
              className="h-9 px-4 rounded-md border text-sm font-medium flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)'
              }}
            >
              <SkipForward className="w-4 h-4" />
              <span>跳过</span>
            </button>

            <button
              type="button"
              onClick={() => handleChoose('replace')}
              className="h-9 px-4 rounded-md border text-sm font-medium flex items-center gap-1.5 hover:bg-amber-500/15 cursor-pointer"
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                borderColor: 'rgba(245, 158, 11, 0.45)',
                color: 'var(--warning)'
              }}
              title="覆盖已有原文件并更新缩略图（保留原备注与分组）"
            >
              <RefreshCw className="w-4 h-4" />
              <span>替换</span>
            </button>

            <button
              type="button"
              onClick={() => handleChoose('keep_both')}
              className="h-9 px-4 rounded-md text-sm font-medium text-white flex items-center gap-1.5 hover:opacity-90 cursor-pointer"
              style={{ backgroundColor: 'var(--accent-solid)' }}
              title="为新文件自动编号保留两份"
            >
              <CopyPlus className="w-4 h-4" />
              <span>都保留</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
