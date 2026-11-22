import type { XiyunApi } from '@shared/types'

declare global {
  interface Window {
    api: XiyunApi
  }
}

export {}
