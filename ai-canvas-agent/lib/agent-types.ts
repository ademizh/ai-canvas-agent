export type AgentMode = 'generate' | 'cluster' | 'suggest_media'

export type AgentAction =
  | {
      type: 'create_sticky'
      text: string
      x: number
      y: number
      color?: 'yellow' | 'blue' | 'green' | 'violet' | 'red' | 'orange'
    }
  | {
      type: 'create_label'
      text: string
      x: number
      y: number
    }
  | {
      type: 'move_shape'
      id: string
      x: number
      y: number
    }
  | {
      type: 'create_media_card'
      title: string
      description: string
      x: number
      y: number
      url?: string
    }

export interface AgentRequestBody {
  userMessage: string
  mode: AgentMode
  canvasSummary: string
}

export interface AgentResponseBody {
  summary: string
  actions: AgentAction[]
}