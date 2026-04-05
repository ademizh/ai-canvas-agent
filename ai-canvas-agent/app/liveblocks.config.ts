import { LiveList, LiveMap } from '@liveblocks/client'

declare global {
  interface Liveblocks {
    Presence: {
      presence: any
    }
    Storage: {
      records: LiveMap<string, any>
      conversationHistory: LiveList<{
        role: 'user' | 'agent'
        text: string
        timestamp: number
      }>
      sessionEvents: LiveList<{
        id: string
        kind: string
        author: string
        text: string
        timestamp: number
      }>
    }
    UserMeta: {
      id: string
      info: {
        name: string
        color: string
        avatar?: string
      }
    }
  }
}

export {}