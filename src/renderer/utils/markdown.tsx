import React from 'react'
import type { Components } from 'react-markdown'

/**
 * Shared safe Markdown renderer overrides so clicking external links opens the
 * user's default system browser instead of navigating the Electron BrowserWindow.
 */
export const SAFE_MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      title={href || undefined}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (href && /^https?:\/\//i.test(href)) {
          window.api.system.openExternalUrl(href)
        }
      }}
    >
      {children}
    </a>
  )
}
