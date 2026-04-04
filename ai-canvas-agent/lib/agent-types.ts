export type AgentMode =
  | 'suggest_next'
  | 'generate'
  | 'cluster'
  | 'visualize'
  | 'critic'

export type AgentPersona = 'facilitator' | 'creative' | 'critic'

export type ContributionLevel = 'low' | 'medium' | 'high'

export type SectionKind = 'group' | 'recommendation' | 'risk'

export type ConversationMessage = {
  role: 'user' | 'agent'
  text: string
  timestamp: number
}

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
      type: 'update_text'
      id: string
      text: string
    }
  | {
      type: 'create_section'
      sectionId: string
      title: string
      kind?: SectionKind
    }
  | {
      type: 'assign_to_section'
      id: string
      sectionId: string
      shortText?: string
    }
  | {
      type: 'create_section_note'
      sectionId: string
      text: string
      color?: 'yellow' | 'blue' | 'green' | 'violet' | 'red' | 'orange'
    }
  | {
      type: 'create_media_card'
      title: string
      description: string
      x: number
      y: number
      url?: string
      mediaType?: 'image' | 'video' | 'concept'
    }
  | {
      type: 'generate_image'
      prompt: string
      x: number
      y: number
      title?: string
    }
  | {
      type: 'generate_video'
      prompt: string
      x: number
      y: number
      title?: string
    }

export interface AgentRequestBody {
  userMessage: string
  mode: AgentMode
  canvasSummary: string
  conversationHistory?: ConversationMessage[]
  persona?: AgentPersona
  contributionLevel?: ContributionLevel
}

export interface AgentResponseBody {
  summary: string
  actions: AgentAction[]
}