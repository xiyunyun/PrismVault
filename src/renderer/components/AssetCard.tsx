import React from 'react'
import {
  AlertTriangle,
  File,
  FileCode2,
  FileText,
  Film,
  Music,
  Pause,
  Play,
  StickyNote
} from 'lucide-react'
import type { Asset, GridFitMode, ViewMode } from '@shared/types'
import { formatDuration, formatFileSize, isPdfExt, isPsdExt } from '@shared/mediaTypes'
import { getFileMediaUrl, getThumbMediaUrl } from '../utils/mediaUrl'

interface AssetCardProps {
  asset: Asset
  viewMode: ViewMode
  gridFitMode: GridFitMode
  mediaHeight: number
  selected: boolean
  isPlayingAudio: boolean
  onSelect: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onToggleAudioPlay: (e: React.MouseEvent) => void
}

export const AssetCard: React.FC<AssetCardProps> = React.memo(
  ({
    asset,
    viewMode,
    gridFitMode,
    mediaHeight,
    selected,
    isPlayingAudio,
    onSelect,
    onDoubleClick,
    onContextMenu,
    onDragStart,
    onToggleAudioPlay
  }) => {
    const thumbUrl = getThumbMediaUrl(asset.thumbPath)
    const fileUrl = getFileMediaUrl(asset.id)
    const hasNote = Boolean(asset.note && asset.note.trim().length > 0)
    const extBadge = asset.ext ? asset.ext.replace('.', '').toUpperCase() : 'FILE'
    const isMissing = asset.status === 'missing'

    const imgFitClass =
      viewMode === 'waterfall'
        ? 'object-cover'
        : gridFitMode === 'contain'
        ? 'object-contain p-1.5'
        : 'object-cover'

    const renderMediaPreview = () => {
      if (asset.mediaType === 'image') {
        const isPsd = isPsdExt(asset.ext)
        const src = asset.ext === '.svg' || asset.ext === '.gif' ? fileUrl : thumbUrl || fileUrl
        return (
          <div className="w-full h-full relative">
            <img
              src={src}
              alt={asset.fileName}
              loading="lazy"
              decoding="async"
              draggable={false}
              className={`w-full h-full ${imgFitClass} transition-transform duration-200 group-hover:scale-[1.02]`}
            />
            {isPsd && (
              <span
                className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-xs font-bold tracking-wider shadow"
                style={{ backgroundColor: '#001e36', color: '#31a8ff', border: '1px solid rgba(49,168,255,0.45)' }}
              >
                {extBadge}
              </span>
            )}
          </div>
        )
      }

      if (asset.mediaType === 'video') {
        return (
          <div className="w-full h-full relative flex items-center justify-center bg-[#101010]">
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt={asset.fileName}
                loading="lazy"
                decoding="async"
                draggable={false}
                className={`w-full h-full ${imgFitClass} transition-transform duration-200 group-hover:scale-[1.02]`}
              />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-neutral-400">
                <Film className="w-9 h-9 opacity-70" />
                <span className="text-xs font-mono uppercase opacity-80">{extBadge}</span>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/15 group-hover:bg-black/30 transition-colors">
              <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-xs border border-white/20 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
                <Play className="w-4 h-4 fill-white ml-0.5" />
              </div>
            </div>
            {asset.duration != null && (
              <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-white text-xs font-mono tabular-nums">
                {formatDuration(asset.duration)}
              </span>
            )}
          </div>
        )
      }

      if (asset.mediaType === 'audio') {
        return (
          <div
            className="w-full h-full relative flex flex-col items-center justify-center p-3 overflow-hidden"
            style={{
              background: thumbUrl
                ? '#121212'
                : 'linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(0, 120, 212, 0.24) 100%)'
            }}
          >
            {thumbUrl && (
              <img
                src={thumbUrl}
                alt={asset.fileName}
                loading="lazy"
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover opacity-55"
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-2 text-center max-w-full">
              <button
                type="button"
                onClick={onToggleAudioPlay}
                className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110 cursor-pointer border border-white/20"
                style={{
                  backgroundColor: isPlayingAudio ? 'var(--accent-solid)' : 'rgba(20, 20, 20, 0.72)',
                  color: '#ffffff'
                }}
                title={isPlayingAudio ? '暂停试听' : '快捷试听'}
              >
                {isPlayingAudio ? (
                  <Pause className="w-5 h-5 fill-white" />
                ) : (
                  <Play className="w-5 h-5 fill-white ml-0.5" />
                )}
              </button>
              {asset.extraMeta?.artist && (
                <div className="text-xs font-medium truncate max-w-full px-2 py-0.5 rounded bg-black/50 text-white">
                  {asset.extraMeta.artist}
                </div>
              )}
            </div>
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-emerald-300 text-xs font-mono">
              <Music className="w-3 h-3" />
              <span>{extBadge}</span>
            </div>
            {asset.duration != null && (
              <span className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 rounded bg-black/75 text-white text-xs font-mono tabular-nums">
                {formatDuration(asset.duration)}
              </span>
            )}
          </div>
        )
      }

      if (asset.mediaType === 'text') {
        const pdf = isPdfExt(asset.ext)
        if (pdf) {
          return (
            <div
              className="w-full h-full relative flex flex-col items-center justify-center gap-2 p-3"
              style={{
                background: 'linear-gradient(145deg, rgba(239, 68, 68, 0.14) 0%, rgba(245, 158, 11, 0.10) 100%)'
              }}
            >
              <FileText className="w-11 h-11 text-rose-400" />
              <span className="px-2.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-xs font-semibold tracking-wide">
                PDF 文档
              </span>
            </div>
          )
        }

        const isCode = ['.js', '.ts', '.tsx', '.jsx', '.py', '.json', '.html', '.css', '.sql', '.go', '.rs', '.java', '.cpp', '.c'].includes(
          asset.ext
        )
        return (
          <div
            className="w-full h-full relative p-3 overflow-hidden flex flex-col"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            <div className="flex items-center justify-between mb-1.5 shrink-0">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium"
                style={{
                  backgroundColor: 'var(--bg-active)',
                  color: 'var(--accent)'
                }}
              >
                {isCode ? <FileCode2 className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                {extBadge}
              </span>
            </div>
            <pre
              className="flex-1 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all overflow-hidden m-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              {asset.textSnippet?.trim() || '（空文本文件）'}
            </pre>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
              style={{
                background: 'linear-gradient(to top, var(--bg-elevated), transparent)'
              }}
            />
          </div>
        )
      }

      return (
        <div
          className="w-full h-full flex flex-col items-center justify-center gap-2 p-3"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <File className="w-10 h-10" style={{ color: 'var(--text-muted)' }} />
          <span
            className="px-2 py-0.5 rounded text-xs font-mono uppercase"
            style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
          >
            {extBadge}
          </span>
        </div>
      )
    }

    return (
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        className="group h-full w-full rounded-lg overflow-hidden flex flex-col border transition-all cursor-pointer"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
          boxShadow: selected ? '0 0 0 2px var(--accent)' : 'var(--card-shadow)'
        }}
      >
        {/* Media Viewport */}
        <div
          className="relative w-full overflow-hidden shrink-0"
          style={{ height: `${mediaHeight}px`, backgroundColor: 'var(--bg-elevated)' }}
        >
          {renderMediaPreview()}

          {/* Top-right badges */}
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            {hasNote && (
              <span
                className="w-6 h-6 rounded-md bg-amber-500/90 text-white flex items-center justify-center shadow"
                title={`备注：${asset.note.slice(0, 80)}`}
              >
                <StickyNote className="w-3.5 h-3.5" />
              </span>
            )}
            {isMissing && (
              <span
                className="px-2 h-6 rounded-md bg-amber-600/95 text-white text-xs font-medium flex items-center gap-1 shadow"
                title="文件已离线或路径变更"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                离线
              </span>
            )}
          </div>

          {/* Hover resolution/ext pill for images */}
          {asset.mediaType === 'image' && (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 left-2 px-2 py-0.5 rounded bg-black/65 text-white text-xs font-mono">
              {extBadge}
              {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
            </span>
          )}
        </div>

        {/* Footer Info */}
        <div className="h-[56px] px-3 py-1.5 flex flex-col justify-center shrink-0">
          <div
            className="text-sm font-medium truncate leading-snug"
            style={{ color: 'var(--text-primary)' }}
            title={asset.fileName}
          >
            {asset.fileName}
          </div>
          <div
            className="flex items-center justify-between gap-2 mt-0.5 text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            <span className="truncate font-mono">{extBadge}</span>
            <span className="shrink-0 tabular-nums">{formatFileSize(asset.fileSize)}</span>
          </div>
        </div>
      </div>
    )
  }
)

AssetCard.displayName = 'AssetCard'
