import React, { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, File, Heart, Search, X } from 'lucide-react'
import { getThumbMediaUrl } from '../utils/mediaUrl'
import { formatFileSize } from '@shared/mediaTypes'
import type { Asset } from '@shared/types'

export const QuickSearchApp: React.FC = () => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Asset[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Sync theme and make transparent window background clean
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    window.api.settings
      .getAll()
      .then((s) => {
        document.documentElement.setAttribute('data-theme', s.theme)
      })
      .catch(() => undefined)

    const onFocus = () => {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    window.addEventListener('focus', onFocus)
    onFocus()
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.assets.query({
          smartView: 'all',
          mediaTypes: [],
          groupId: null,
          rootId: null,
          search: query.trim(),
          sortField: 'modified_at',
          sortOrder: 'desc',
          limit: 16,
          offset: 0
        })
        setResults(res.items)
        setActiveIdx(0)
      } catch {
        setResults([])
      }
    }, 90)
    return () => clearTimeout(timer)
  }, [query])

  const flashToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }

  const handleCopyAsset = async (asset: Asset) => {
    const mode = asset.mediaType === 'image' ? 'file' : 'file'
    const res = await window.api.system.copyFilesToClipboard([asset.filePath], mode)
    if (res.ok) {
      flashToast(`已复制「${asset.fileName}」`)
      setTimeout(() => window.api.quickSearch.hide(), 260)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      window.api.quickSearch.hide()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(Math.max(0, results.length - 1), i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && results[activeIdx]) {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        handleCopyAsset(results[activeIdx])
      } else {
        window.api.quickSearch.openAssetInMain(results[activeIdx].id)
      }
    }
  }

  return (
    <div
      onKeyDown={handleKeyDown}
      className="h-screen w-screen p-2 flex flex-col overflow-hidden select-none"
      style={{ background: 'transparent' }}
    >
      <div
        className="flex-1 flex flex-col rounded-2xl border shadow-2xl overflow-hidden backdrop-blur-xl"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)'
        }}
      >
        {/* Spotlight Search Input */}
        <div
          className="h-14 px-4 border-b flex items-center gap-3 shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Search className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="PrismVault 极速搜图 / 搜模型 / 搜备注（可直接拖出文件）..."
            className="flex-1 bg-transparent outline-none text-base placeholder:text-[var(--text-muted)]"
            style={{ color: 'var(--text-primary)' }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
              {query.trim() ? `未找到匹配「${query}」的素材` : '输入关键词立即检索全库素材'}
            </div>
          ) : (
            results.map((item, idx) => {
              const active = idx === activeIdx
              const thumbUrl = getThumbMediaUrl(item.thumbPath)
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => {
                    e.preventDefault()
                    window.api.system.startDragOut([item.filePath], item.thumbPath)
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => window.api.quickSearch.openAssetInMain(item.id)}
                  className="px-3 py-2 rounded-xl flex items-center gap-3 cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--bg-active)' : 'transparent'
                  }}
                >
                  <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-black/20 flex items-center justify-center border border-white/10">
                    {thumbUrl ? (
                      <img src={thumbUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                    ) : (
                      <File className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.fileName}
                      </span>
                      {item.isFavorite && <Heart className="w-3 h-3 shrink-0 fill-rose-500 text-rose-500" />}
                    </div>
                    <div className="text-xs truncate mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                      {item.ext.replace('.', '').toUpperCase()} · {formatFileSize(item.fileSize)}
                      {item.note.trim() ? ` · ${item.note.trim().slice(0, 32)}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCopyAsset(item)
                      }}
                      className="h-7 px-2 rounded-md border text-xs flex items-center gap-1 hover:bg-[var(--bg-hover)] cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      title="复制文件到剪贴板 (Ctrl+Enter)"
                    >
                      <Copy className="w-3 h-3" />
                      <span>复制</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        window.api.system.openExternal(item.filePath)
                        window.api.quickSearch.hide()
                      }}
                      className="p-1.5 rounded-md border hover:bg-[var(--bg-hover)] cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      title="用系统默认软件打开"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer Shortcut Legend */}
        <div
          className="h-9 px-4 border-t flex items-center justify-between text-[0.72rem] shrink-0"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
        >
          <span>{toast || '拖拽列表项可直接拖入 PS / Blender / 微信 / 桌面'}</span>
          <span className="font-mono">Enter 预览 · Ctrl+Enter 复制 · Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
