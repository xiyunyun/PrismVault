import type { GroupNode } from '@shared/types'

export function getFileMediaUrl(assetId: number): string {
  return `xiyun-media://file/${assetId}`
}

export function getThumbMediaUrl(thumbPath: string | null | undefined): string | null {
  if (!thumbPath) return null
  return `xiyun-media://thumb/${encodeURIComponent(thumbPath)}`
}

export interface FlatGroupEntry {
  id: number
  parentId: number | null
  name: string
  color: string
  depth: number
  fullPath: string
  assetCount: number
  totalCount: number
}

export function flattenGroupTree(nodes: GroupNode[], depth = 0, prefix = ''): FlatGroupEntry[] {
  const result: FlatGroupEntry[] = []
  for (const n of nodes) {
    const fullPath = prefix ? `${prefix} / ${n.name}` : n.name
    result.push({
      id: n.id,
      parentId: n.parentId,
      name: n.name,
      color: n.color,
      depth,
      fullPath,
      assetCount: n.assetCount,
      totalCount: n.totalCount
    })
    if (n.children.length > 0) {
      result.push(...flattenGroupTree(n.children, depth + 1, fullPath))
    }
  }
  return result
}

export const GROUP_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#64748b'
]
