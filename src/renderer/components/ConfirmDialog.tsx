import React, { useEffect } from 'react'
import { AlertTriangle, Info, Trash2, X } from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'

export const ConfirmDialog: React.FC = () => {
  const { confirmDialog, resolveConfirm } = useLibraryStore()

  useEffect(() => {
    if (!confirmDialog) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        resolveConfirm(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        resolveConfirm(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDialog, resolveConfirm])

  if (!confirmDialog) return null

  const variant = confirmDialog.variant ?? 'warning'
  const Icon = variant === 'danger' ? Trash2 : variant === 'info' ? Info : AlertTriangle
  const iconColor =
    variant === 'danger' ? 'var(--danger)' : variant === 'info' ? 'var(--accent)' : 'var(--warning)'
  const iconBg =
    variant === 'danger'
      ? 'rgba(239, 68, 68, 0.14)'
      : variant === 'info'
      ? 'var(--bg-active)'
      : 'rgba(245, 158, 11, 0.15)'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      onClick={() => resolveConfirm(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)'
        }}
      >
        <div className="p-5 flex items-start gap-3.5">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ backgroundColor: iconBg, color: iconColor }}
          >
            <Icon className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                {confirmDialog.title}
              </h3>
              <button
                type="button"
                onClick={() => resolveConfirm(false)}
                className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {confirmDialog.message}
            </p>

            {confirmDialog.detail && (
              <p
                className="text-xs leading-relaxed px-3 py-2 rounded-md border mt-2"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-muted)'
                }}
              >
                {confirmDialog.detail}
              </p>
            )}
          </div>
        </div>

        <div
          className="px-5 py-3.5 border-t flex items-center justify-end gap-2.5"
          style={{
            backgroundColor: 'var(--bg-sidebar)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <button
            type="button"
            onClick={() => resolveConfirm(false)}
            className="h-9 px-4 rounded-md border text-sm font-medium hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)'
            }}
          >
            {confirmDialog.cancelText || '取消'}
          </button>
          <button
            type="button"
            onClick={() => resolveConfirm(true)}
            className="h-9 px-4 rounded-md text-sm font-medium text-white cursor-pointer transition-opacity hover:opacity-90"
            style={{
              backgroundColor: variant === 'danger' ? '#d13438' : 'var(--accent-solid)'
            }}
          >
            {confirmDialog.confirmText || '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
