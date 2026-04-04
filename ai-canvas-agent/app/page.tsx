'use client'

import 'tldraw/tldraw.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AssetRecordType,
  createShapeId,
  Editor,
  getHashForString,
  Tldraw,
  TLShape,
  toRichText,
} from 'tldraw'

import type {
  AgentAction,
  AgentMode,
  AgentPersona,
  AgentResponseBody,
  ContributionLevel,
  ConversationMessage,
  SectionKind,
  SessionEvent,
} from '@/lib/agent-types'

// const ROOM_ID = process.env.NEXT_PUBLIC_ROOM_ID || 'hacknu-ai-agent-room'

type SectionPlan = {
  sectionId: string
  title: string
  kind: SectionKind
  assigned: Array<{ id: string; shortText?: string }>
  newNotes: Array<{
    text: string
    color?: 'yellow' | 'blue' | 'green' | 'violet' | 'red' | 'orange'
  }>
}

function extractPlainText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    return value.map(extractPlainText).join(' ')
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>

    if (typeof obj.text === 'string') return obj.text

    return Object.values(obj)
      .map(extractPlainText)
      .join(' ')
  }

  return ''
}

function shapeText(shape: TLShape): string {
  const props = (shape as any).props ?? {}
  const text =
    extractPlainText(props.richText) ||
    extractPlainText(props.text) ||
    extractPlainText(props)

  return text.replace(/\s+/g, ' ').trim()
}

function summarizeBoard(editor: Editor): string {
  const shapes = editor.getCurrentPageShapes()

  if (!shapes.length) return 'Board is empty.'

  return shapes
    .slice(0, 80)
    .map((shape) => {
      const text = shapeText(shape).slice(0, 180)
      return `id:${shape.id} type:${shape.type} x:${Math.round(shape.x)} y:${Math.round(shape.y)} text:${text || '-'}`
    })
    .join('\n')
}

function getBoardBounds(editor: Editor) {
  const shapes = editor.getCurrentPageShapes()

  if (!shapes.length) {
    return {
      minX: 120,
      minY: 120,
      maxX: 1200,
      maxY: 900,
    }
  }

  const xs = shapes.map((s) => s.x)
  const ys = shapes.map((s) => s.y)

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}
function findPlacementNearSection(
  editor: Editor,
  keywords: string[],
  fallbackX: number,
  fallbackY: number
) {
  const shapes = editor.getCurrentPageShapes()

  const match = shapes.find((shape) => {
    const text = shapeText(shape).toLowerCase()
    return keywords.some((keyword) => text.includes(keyword))
  })

  if (!match) {
    return { x: fallbackX, y: fallbackY }
  }

  return {
    x: match.x + 360,
    y: match.y + 40,
  }
}
function createSticky(
  editor: Editor,
  text: string,
  x: number,
  y: number,
  color?: string
) {
  const safeColor = normalizeTldrawColor(color)

  const id = createShapeId()

  editor.createShape({
    id,
    type: 'note',
    x,
    y,
    props: {
      color: safeColor,
      labelColor: 'black',
      richText: toRichText(text),
      size: 'm',
      font: 'sans',
      align: 'middle',
      verticalAlign: 'middle',
    },
  } as any)

  return id
}

function createLabel(editor: Editor, text: string, x: number, y: number) {
  const id = createShapeId()

  editor.createShape({
    id,
    type: 'text',
    x,
    y,
    props: {
      richText: toRichText(text),
      font: 'sans',
      size: 'l',
      autoSize: true,
      textAlign: 'start',
    },
  } as any)

  return id
}

function createMediaCard(
  editor: Editor,
  title: string,
  description: string,
  x: number,
  y: number,
  url?: string,
  mediaType?: 'image' | 'video' | 'concept'
) {
  const id = createShapeId()

  const prefix =
    mediaType === 'image'
      ? 'IMAGE'
      : mediaType === 'video'
        ? 'VIDEO'
        : 'MEDIA'

  const content = url
    ? `${prefix}: ${title}\n\n${description}\n\n${url}`
    : `${prefix}: ${title}\n\n${description}`

  editor.createShape({
    id,
    type: 'geo',
    x,
    y,
    props: {
      geo: 'rectangle',
      w: 340,
      h: 190,
      richText: toRichText(content),
      font: 'sans',
      size: 'm',
      align: 'middle',
      verticalAlign: 'middle',
    },
  } as any)

  return id
}

const DEFAULT_MEDIA_W = 640
const DEFAULT_MEDIA_H = 360

function createImageFromUrl(
  editor: Editor,
  url: string,
  x: number,
  y: number,
  label?: string
) {
  const proxiedUrl = `/api/media-proxy?url=${encodeURIComponent(url)}`
  const assetId = AssetRecordType.createId(getHashForString(proxiedUrl))

  editor.createAssets([
    {
      id: assetId,
      typeName: 'asset',
      type: 'image',
      props: {
        w: DEFAULT_MEDIA_W,
        h: DEFAULT_MEDIA_H,
        name: label?.slice(0, 120) ?? '',
        isAnimated: false,
        mimeType: 'image/png',
        src: proxiedUrl,
      },
      meta: {},
    },
  ])

  editor.createShape({
    id: createShapeId(),
    type: 'image',
    x,
    y,
    props: {
      w: DEFAULT_MEDIA_W,
      h: DEFAULT_MEDIA_H,
      assetId,
      crop: null,
      flipX: false,
      flipY: false,
    },
  } as any)
}

function createVideoFromUrl(
  editor: Editor,
  url: string,
  x: number,
  y: number,
  label?: string
) {
  const proxiedUrl = `/api/media-proxy?url=${encodeURIComponent(url)}`
  const assetId = AssetRecordType.createId(getHashForString(proxiedUrl))

  editor.createAssets([
    {
      id: assetId,
      typeName: 'asset',
      type: 'video',
      props: {
        w: DEFAULT_MEDIA_W,
        h: DEFAULT_MEDIA_H,
        name: label?.slice(0, 120) ?? '',
        isAnimated: true,
        mimeType: 'video/mp4',
        src: proxiedUrl,
      },
      meta: {},
    },
  ])

  editor.createShape({
    id: createShapeId(),
    type: 'video',
    x,
    y,
    props: {
      w: DEFAULT_MEDIA_W,
      h: DEFAULT_MEDIA_H,
      assetId,
      time: 0,
      playing: false,
      url: '',
    },
  } as any)
}

async function requestGeneratedMedia(
  editor: Editor,
  kind: 'image' | 'video',
  prompt: string,
  x: number,
  y: number,
  title?: string,
  imageUrl?: string
) {
  const res = await fetch('/api/generate-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, prompt, imageUrl }),
  })

  let data: { url?: string; error?: string } = {}
  try {
    data = (await res.json()) as { url?: string; error?: string }
  } catch {
    // ignore bad json
  }

  if (!res.ok || !data.url) {
    const msg = data.error || `HTTP ${res.status}`
    createSticky(
      editor,
      `${kind === 'image' ? 'Image' : 'Video'} generation failed: ${msg}`,
      x,
      y,
      'red'
    )
    return
  }

  if (kind === 'image') {
    createImageFromUrl(editor, data.url, x, y, title)
  } else {
    createVideoFromUrl(editor, data.url, x, y, title)
  }
}

function updateShapeText(editor: Editor, id: string, text: string) {
  const shape = editor.getShape(id as any) as any
  if (!shape) return

  const nextProps = { ...(shape.props ?? {}) }

  if (
    'richText' in nextProps ||
    shape.type === 'note' ||
    shape.type === 'text' ||
    shape.type === 'geo'
  ) {
    nextProps.richText = toRichText(text)
  } else if ('text' in nextProps) {
    nextProps.text = text
  } else {
    nextProps.richText = toRichText(text)
  }

  editor.updateShape({
    id: shape.id,
    type: shape.type,
    props: nextProps,
  } as any)
}

function normalizeShortText(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 60)
}

function sortSectionsForLayout(sections: SectionPlan[]) {
  const priority: Record<SectionKind, number> = {
    group: 0,
    recommendation: 1,
    risk: 2,
  }

  return [...sections].sort((a, b) => {
    const byKind = priority[a.kind] - priority[b.kind]
    if (byKind !== 0) return byKind
    return a.title.localeCompare(b.title)
  })
}

function buildSectionPlan(actions: AgentAction[]) {
  const sectionMap = new Map<string, SectionPlan>()

  for (const action of actions) {
    if (action.type === 'create_section') {
      sectionMap.set(action.sectionId, {
        sectionId: action.sectionId,
        title: action.title,
        kind: action.kind || 'group',
        assigned: [],
        newNotes: [],
      })
    }
  }

  for (const action of actions) {
    if (action.type === 'assign_to_section') {
      const section = sectionMap.get(action.sectionId)
      if (!section) continue
      section.assigned.push({
        id: action.id,
        shortText: action.shortText,
      })
    }

    if (action.type === 'create_section_note') {
      const section = sectionMap.get(action.sectionId)
      if (!section) continue
      section.newNotes.push({
        text: action.text,
        color: action.color,
      })
    }
  }

  return sortSectionsForLayout(Array.from(sectionMap.values()))
}

function applySectionLayout(
  editor: Editor,
  actions: AgentAction[],
  previousHelperShapeIds: string[]
) {
  const sectionPlan = buildSectionPlan(actions)
  if (!sectionPlan.length) return previousHelperShapeIds

  if (previousHelperShapeIds.length) {
    editor.deleteShapes(previousHelperShapeIds as any)
  }

  const bounds = getBoardBounds(editor)
  const helperShapeIds: string[] = []

  const sectionWidth = 280
  const sectionGapX = 90
  const noteGapY = 155
  const startX = Math.max(120, bounds.minX + 20)
  const startY = Math.max(120, bounds.minY + 40)

  const sectionCount = sectionPlan.length
  const cols =
    sectionCount <= 2 ? sectionCount : sectionCount === 3 ? 3 : 2

  let currentY = startY

  for (let i = 0; i < sectionPlan.length; i += cols) {
    const rowSections = sectionPlan.slice(i, i + cols)

    let rowHeight = 0

    rowSections.forEach((section, idx) => {
      let x = startX + idx * (sectionWidth + sectionGapX)

      if (section.kind === 'risk') {
        x += 120
      }
      const y = section.kind === 'recommendation' ? currentY - 10 : currentY


      const titleId = createLabel(editor, section.title, x, y)
      helperShapeIds.push(titleId)

      const itemsCount = section.assigned.length + section.newNotes.length
      const localHeight = 80 + Math.max(1, itemsCount) * noteGapY
      rowHeight = Math.max(rowHeight, localHeight)

      section.assigned.forEach((item, itemIndex) => {
        if (item.shortText) {
          updateShapeText(editor, item.id, normalizeShortText(item.shortText))
        }

        editor.updateShape({
          id: item.id as any,
          x,
          y: y + 70 + itemIndex * noteGapY,
        } as any)
      })

      section.newNotes.forEach((note, noteIndex) => {
        const stickyId = createSticky(
          editor,
          note.text,
          x,
          y + 70 + (section.assigned.length + noteIndex) * noteGapY,
          note.color ||
            (section.kind === 'risk'
              ? 'red'
              : section.kind === 'recommendation'
                ? 'green'
                : 'yellow')
        )
        helperShapeIds.push(stickyId)
      })
    })

    currentY += rowHeight + 120
  }

  return helperShapeIds
}

async function applyNonSectionAction(editor: Editor, action: AgentAction) {
  if (action.type === 'create_sticky') {
    createSticky(editor, action.text, action.x, action.y, action.color)
    return
  }

  if (action.type === 'create_label') {
    createLabel(editor, action.text, action.x, action.y)
    return
  }

  if (action.type === 'move_shape') {
    editor.updateShape({
      id: action.id as any,
      x: action.x,
      y: action.y,
    } as any)
    return
  }

  if (action.type === 'update_text') {
    updateShapeText(editor, action.id, action.text)
    return
  }

  if (action.type === 'create_media_card') {
    createMediaCard(
      editor,
      action.title,
      action.description,
      action.x,
      action.y,
      action.url,
      action.mediaType
    )
    return
  }

  if (action.type === 'generate_image') {
    const placement = findPlacementNearSection(
      editor,
      ['product', 'visual', 'concept', 'recommendation'],
      action.x,
      action.y
    )

    await requestGeneratedMedia(
      editor,
      'image',
      action.prompt,
      placement.x,
      placement.y,
      action.title
    )
    return
  }

  if (action.type === 'generate_video') {
    const placement = findPlacementNearSection(
      editor,
      ['product', 'visual', 'concept', 'recommendation'],
      action.x,
      action.y
    )

    await requestGeneratedMedia(
      editor,
      'video',
      action.prompt,
      placement.x,
      placement.y,
      action.title
    )
    return
  }
}

async function applyAgentActions(
  editor: Editor,
  actions: AgentAction[],
  previousHelperShapeIds: string[]
) {
  const hasSectionActions = actions.some(
    (action) =>
      action.type === 'create_section' ||
      action.type === 'assign_to_section' ||
      action.type === 'create_section_note'
  )

  if (hasSectionActions) {
    const nextHelperIds = applySectionLayout(
      editor,
      actions,
      previousHelperShapeIds
    )

    const nonSectionActions = actions.filter(
      (action) =>
        action.type !== 'create_section' &&
        action.type !== 'assign_to_section' &&
        action.type !== 'create_section_note'
    )

    for (const action of nonSectionActions) {
      await applyNonSectionAction(editor, action)
    }

    return nextHelperIds
  }

  for (const action of actions) {
    await applyNonSectionAction(editor, action)
  }

  return previousHelperShapeIds
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function conversationFingerprint(history: ConversationMessage[]) {
  return history
    .slice(-8)
    .map((m) => `${m.role}:${m.text}`)
    .join('|')
}

function chooseAutonomousMode(
  canvasSummary: string,
  conversationHistory: ConversationMessage[]
): AgentMode {
  const lower = canvasSummary.toLowerCase()
  const historyText = conversationHistory
    .slice(-6)
    .map((m) => m.text.toLowerCase())
    .join(' ')

  const noteCount = canvasSummary === 'Board is empty.'
    ? 0
    : canvasSummary.split('\n').length

  if (historyText.includes('visual') || historyText.includes('image') || historyText.includes('video')) {
    return 'visualize'
  }

  if (noteCount >= 5) {
    return 'cluster'
  }

  if (lower.includes('risk') || lower.includes('metric') || lower.includes('validation')) {
    return 'critic'
  }

  if (noteCount === 0) {
    return 'generate'
  }

  return 'suggest_next'
}
function countRecentUserCreatedNotes(editor: Editor) {
  const shapes = editor.getCurrentPageShapes()
  return shapes.filter((shape) => shape.type === 'note').length
}
export default function Page() {
  //const store = useSyncDemo({ roomId: ROOM_ID })
  const licenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY
  const [autonomousEnabled, setAutonomousEnabled] = useState(false)
  const [showAgentPanel, setShowAgentPanel] = useState(true)
  const [showSessionPanel, setShowSessionPanel] = useState(true)
  
  const lastCanvasFingerprintRef = useRef('')
  const lastConversationFingerprintRef = useRef('')
  const lastAgentRunAtRef = useRef(0)
  const lastObservedChangeAtRef = useRef(0)

  const [editor, setEditor] = useState<Editor | null>(null)
  const [prompt, setPrompt] = useState('')
  const [voiceText, setVoiceText] = useState('')
  const [status, setStatus] = useState('Ready')
  const [loading, setLoading] = useState(false)
  const [paused, setPaused] = useState(false)
  const [inputMode, setInputMode] = useState<'text' | 'voice' | 'both'>('both')
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)

  const [persona, setPersona] = useState<AgentPersona>('facilitator')
  const [contributionLevel, setContributionLevel] =
    useState<ContributionLevel>('medium')
  const [mode, setMode] = useState<AgentMode>('suggest_next')

  const [conversationHistory, setConversationHistory] = useState<
    ConversationMessage[]
  >([])
  const [sessionMessage, setSessionMessage] = useState('')
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([])
  const [agentPresence, setAgentPresence] = useState('observing canvas')
  
  const [recentUserNoteBursts, setRecentUserNoteBursts] = useState<number[]>([])
  const [helperShapeIds, setHelperShapeIds] = useState<string[]>([])
  const [mediaKind, setMediaKind] = useState<'image' | 'video'>('image')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaChunksRef = useRef<Blob[]>([])

  const canRun = useMemo(
    () => !!editor && !loading && !paused && !isTranscribing,
    [editor, loading, paused, isTranscribing]
  )

  function pushConversation(role: 'user' | 'agent', text: string) {
    setConversationHistory((prev) => [
      ...prev.slice(-19),
      {
        role,
        text,
        timestamp: Date.now(),
      },
    ])
  }
  function pushSessionEvent(
  kind: SessionEvent['kind'],
  author: SessionEvent['author'],
  text: string
) {
  setSessionEvents((prev) => [
    ...prev.slice(-39),
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      author,
      text,
      timestamp: Date.now(),
    },
  ])
}

function sendSessionTextMessage() {
  const text = sessionMessage.trim()
  if (!text) return

  pushConversation('user', text)
  pushSessionEvent('user_text', 'user', text)
  setPrompt(text)
  setSessionMessage('')
}


  function commitVoiceToSession() {
    const text = voiceText.trim()
    if (!text) return

    pushConversation('user', text)
    pushSessionEvent('user_voice', 'user', text)
  }
  function defaultMessageForMode(selectedMode: AgentMode) {
    if (selectedMode === 'generate') {
      return 'Generate useful brainstorming ideas for the current board.'
    }
    if (selectedMode === 'cluster') {
      return 'Reduce chaos, cluster ideas into 3 or 4 clean groups, shorten long notes, and add one recommendation.'
    }
    if (selectedMode === 'visualize') {
      return 'Suggest one strong image or video concept for the best direction.'
    }
    if (selectedMode === 'critic') {
      return 'Refine weak notes and add one important validation or risk question.'
    }
    return 'Look at the board and conversation, then decide the most useful next action.'
  }
  function setAgentPresenceState(text: string) {
    setAgentPresence(text)
    pushSessionEvent('agent_observation', 'agent', text)
  }

  function statusForMode(selectedMode: AgentMode) {
    if (selectedMode === 'generate') return 'AI is adding a focused batch of ideas…'
    if (selectedMode === 'cluster') return 'AI is cleaning and organizing the board…' 
    if (selectedMode === 'visualize') return 'AI is preparing a visual concept…'
    if (selectedMode === 'critic') return 'AI is refining weak notes and surfacing gaps…'
    return 'AI is deciding the most useful next step…'
  }

  function getPreferredAudioMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ]

    for (const type of candidates) {
      if (
        typeof MediaRecorder !== 'undefined' &&
        typeof MediaRecorder.isTypeSupported === 'function' &&
        MediaRecorder.isTypeSupported(type)
      ) {
        return type
      }
    }

    return ''
  }

  async function transcribeAudioBlob(blob: Blob) {
    const ext =
      blob.type.includes('mp4')
        ? 'm4a'
        : blob.type.includes('ogg')
          ? 'ogg'
          : 'webm'

    const file = new File([blob], `voice-input.${ext}`, {
      type: blob.type || 'audio/webm',
    })

    const formData = new FormData()
    formData.append('file', file)
    formData.append(
      'prompt',
      'Expect brainstorming, product ideas, canvas collaboration, sticky notes, design discussion, AI agent.'
    )

    const res = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    })

    const data = (await res.json()) as { text?: string; error?: string }

    if (!res.ok) {
      throw new Error(data.error || `Transcription failed with ${res.status}`)
    }

    return (data.text || '').trim()
  }

  async function startRecording() {
    if (isRecording || isTranscribing || loading) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      mediaChunksRef.current = []

      const mimeType = getPreferredAudioMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          mediaChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        try {
          const blob = new Blob(mediaChunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          })

          if (!blob.size) {
            setStatus('No audio recorded.')
            return
          }

          setIsTranscribing(true)
          setStatus('Transcribing voice…')

          const text = await transcribeAudioBlob(blob)
          setVoiceText(text)

          if (text) {
            pushConversation('user', text)
            pushSessionEvent('user_voice', 'user', text)
            setStatus('Voice transcript added to session.')
          } else {
            setStatus('No speech detected.')
          }
        } catch (error) {
          console.error(error)
          setStatus('Voice transcription failed.')
        } finally {
          setIsRecording(false)
          setIsTranscribing(false)
          mediaRecorderRef.current = null
          mediaChunksRef.current = []

          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop())
            mediaStreamRef.current = null
          }
        }
      }

      recorder.start()
      setIsRecording(true)
      setStatus('Recording voice…')
    } catch (error) {
      console.error(error)
      setIsRecording(false)
      setStatus('Microphone access failed.')
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return
    }

    mediaRecorderRef.current.stop()
  }

  function clearVoiceText() {
    setVoiceText('')
  }

  function buildEffectiveUserText(selectedMode: AgentMode) {
    const textPart = prompt.trim()
    const voicePart = voiceText.trim()

    if (inputMode === 'text') {
      return textPart || defaultMessageForMode(selectedMode)
    }

    if (inputMode === 'voice') {
      return voicePart || defaultMessageForMode(selectedMode)
    }

    if (textPart && voicePart) {
      return `Text input:\n${textPart}\n\nVoice input:\n${voicePart}`
    }

    return textPart || voicePart || defaultMessageForMode(selectedMode)
  }

  async function runAgent(
    customMode?: AgentMode,
    options?: {
      autonomous?: boolean
      injectedMessage?: string
      silentUser?: boolean
      triggerReason?: string
    }
  ) {
    if (!editor || loading || paused || isTranscribing) return

    const effectiveMode = customMode || mode
    const autonomous = options?.autonomous ?? false
    if (autonomous) {
      setAgentPresenceState('observing canvas and preparing a contextual contribution')
    } else if (effectiveMode === 'cluster') {
      setAgentPresenceState('noticed a cluster opportunity')
    } else if (effectiveMode === 'visualize') {
      setAgentPresenceState('preparing visual concept')
    } else if (effectiveMode === 'critic') {
      setAgentPresenceState('checking for risks and validation gaps')
    } else if (effectiveMode === 'generate') {
      setAgentPresenceState('adding 2 ideas')
    } else {
      setAgentPresenceState('observing canvas')
    }
    setStatus(
      autonomous
        ? 'AI noticed activity and is contributing on its own…'
        : statusForMode(effectiveMode)
    )
    const userText =
      options?.injectedMessage?.trim() ||
      buildEffectiveUserText(effectiveMode)

    if (!options?.silentUser) {
      pushConversation('user', userText)
    }

    setLoading(true)
    setStatus(
      autonomous
        ? 'AI noticed activity and is contributing on its own…'
        : statusForMode(effectiveMode)
    )

    try {
      const canvasSummary = summarizeBoard(editor)

      const outgoingConversation = options?.silentUser
        ? conversationHistory.slice(-19)
        : [
          ...conversationHistory.slice(-19),
          { role: 'user' as const, text: userText, timestamp: Date.now() },
        ]

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: userText,
          mode: effectiveMode,
          canvasSummary,
          conversationHistory: outgoingConversation,
          persona,
          contributionLevel,
          autonomous,
          triggerReason: options?.triggerReason || (autonomous ? 'idle_board_change' : 'manual'),
        }),
      })

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`)
      }

      const data = (await res.json()) as AgentResponseBody

      await new Promise((resolve) => setTimeout(resolve, 700))

      const nextHelperIds = await applyAgentActions(
        editor,
        data.actions,
        helperShapeIds
      )
      setHelperShapeIds(nextHelperIds)

      setStatus(data.summary || 'Done')
      pushConversation('agent', data.summary || 'Agent acted on the board.')
      lastAgentRunAtRef.current = Date.now()
    } catch (error) {
      console.error(error)
      setStatus('Something went wrong. Check console and /api/agent logs.')
      pushConversation('agent', 'Agent failed to respond properly.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!editor || !autonomousEnabled || paused) return

    const interval = window.setInterval(() => {
      if (loading || isRecording || isTranscribing) return

      const canvas = summarizeBoard(editor)
      const convo = conversationFingerprint(conversationHistory)
      const noteCount = countRecentUserCreatedNotes(editor)

    const historyText = conversationHistory
      .slice(-6)
      .map((m) => m.text.toLowerCase())
      .join(' ')

    const hasVisualIntent =
      historyText.includes('show') ||
      historyText.includes('visual') ||
      historyText.includes('mockup') ||
      historyText.includes('image')

    const hasConflictSignal =
      historyText.includes('but') ||
      historyText.includes('however') ||
      historyText.includes('not sure') ||
      historyText.includes('unclear') ||
      historyText.includes('risk') ||
      historyText.includes('validate')
      const canvasChanged = canvas !== lastCanvasFingerprintRef.current
      const convoChanged = convo !== lastConversationFingerprintRef.current

      if (canvasChanged || convoChanged) {
        lastCanvasFingerprintRef.current = canvas
        lastConversationFingerprintRef.current = convo
        lastObservedChangeAtRef.current = Date.now()
        return
      }

      const now = Date.now()
      const idleForMs = now - lastObservedChangeAtRef.current
      const sinceLastRunMs = now - lastAgentRunAtRef.current

      const boardIsNonEmpty = canvas !== 'Board is empty.'

      if (
        boardIsNonEmpty &&
        idleForMs > 8000 &&
        sinceLastRunMs > 20000
      ) {
        let autoMode = chooseAutonomousMode(canvas, conversationHistory)
        let triggerReason = 'board_idle_after_change'

        if (hasVisualIntent) {
          autoMode = 'visualize'
          triggerReason = 'visual_intent_detected'
          setAgentPresenceState('preparing visual concept')
        } else if (noteCount >= 5) {
          autoMode = 'cluster'
          triggerReason = 'note_density_cluster_opportunity'
          setAgentPresenceState('noticed a cluster opportunity')
        } else if (hasConflictSignal) {
          autoMode = 'critic'
          triggerReason = 'validation_gap_detected'
          setAgentPresenceState('checking for risk or validation gap')
        }
        if (hasVisualIntent) {
          setAgentPresenceState('preparing visual concept')
        }

        if (noteCount >= 5) {
          setAgentPresenceState('noticed a cluster opportunity')
        }

        if (hasConflictSignal) {
          setAgentPresenceState('checking for risk or validation gap')
        }
        void runAgent(autoMode, {
          autonomous: true,
          silentUser: true,
          injectedMessage:
            'Inspect the current canvas and conversation. Contribute as an active teammate by making the single most useful improvement directly on the board.',
          triggerReason,
        })
      }
    }, 2500)

    return () => window.clearInterval(interval)
  }, [
    editor,
    autonomousEnabled,
    paused,
    loading,
    isRecording,
    isTranscribing,
    conversationHistory,
    persona,
    contributionLevel,
    helperShapeIds,
  ])

  async function generateMediaOnCanvas() {
    if (!editor || loading || isTranscribing) return

    const fallback =
      mediaKind === 'image'
        ? 'A futuristic collaborative whiteboard with sticky notes and soft studio lighting.'
        : 'Short clip: hands arranging sticky notes on a glass whiteboard, smooth camera pan.'
    
    const text = buildEffectiveUserText(mode).trim() || fallback
    const vp = editor.getViewportPageBounds()
    const x = vp.x + vp.width / 2 - DEFAULT_MEDIA_W / 2
    const y = vp.y + vp.height / 2 - DEFAULT_MEDIA_H / 2
    setAgentPresenceState('preparing visual concept')
    setLoading(true)
    setStatus(mediaKind === 'image' ? 'Generating image…' : 'Generating video…')

    try {
      await requestGeneratedMedia(editor, mediaKind, text, x, y)
      setStatus('Media added to the canvas.')
    } catch (error) {
      console.error(error)
      setStatus('Media generation failed. Check /api/generate-media logs.')
    } finally {
      setLoading(false)
    }
  }
async function animateSelectedImageOnCanvas() {
  if (!editor || loading || isTranscribing) return

  const imageUrl = getSelectedImageUrl(editor)

  if (!imageUrl) {
    setStatus('Select an image on the canvas first.')
    return
  }

  const prompt =
    buildEffectiveUserText(mode).trim() ||
    'Animate this image with subtle cinematic motion.'

  const selectedShapes = editor.getSelectedShapes()
  const selected = selectedShapes.find((shape) => shape.type === 'image')

  const x = selected ? selected.x + 680 : 300
  const y = selected ? selected.y : 300

  setLoading(true)
  setStatus('Generating video from selected image…')

  try {
    await requestGeneratedMedia(
      editor,
      'video',
      prompt,
      x,
      y,
      'Animated from selected image',
      imageUrl
    )
    setStatus('Image-to-video added to the canvas.')
  } catch (error) {
    console.error(error)
    setStatus('Image-to-video generation failed.')
  } finally {
    setLoading(false)
  }
}
  function seedManualExample() {
    if (!editor) return

    createLabel(editor, 'Raw ideas', 120, 80)

    createSticky(
      editor,
      'Founder-led outbound: target 30 accounts/day with a personalized demo tailored to their content',
      120,
      150,
      'yellow'
    )
    createSticky(
      editor,
      'Product-led growth: ship a 1-click demo and publish before/after examples',
      430,
      150,
      'blue'
    )
    createSticky(
      editor,
      'Niche landing pages for selected verticals',
      740,
      150,
      'green'
    )
    createSticky(
      editor,
      'Referral loop for teams',
      120,
      360,
      'orange'
    )
    createSticky(
      editor,
      'Community growth challenge',
      430,
      360,
      'violet'
    )
    createSticky(
      editor,
      'Need one clear wedge and one metric',
      740,
      360,
      'red'
    )

    setStatus('Added starter notes.')
  }

  function clearConversation() {
    setConversationHistory([])
  }
return (
  <div style={{ position: 'fixed', inset: 0 }}>
    {showSessionPanel && (
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 100,
          width: 420,
          maxHeight: '92vh',
          overflow: 'auto',
          background: 'rgba(255,255,255,0.97)',
          border: '1px solid #ddd',
          borderRadius: 16,
          padding: 16,
          boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            Session
          </div>

          <button
            onClick={() => setShowSessionPanel(false)}
            style={miniButtonStyle('#6b7280')}
          >
            Hide
          </button>
        </div>

        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Shared text + voice layer for users and AI
        </div>

        <label style={labelStyle}>Session message</label>
        <textarea
          value={sessionMessage}
          onChange={(e) => {
            setSessionMessage(e.target.value)
            setPrompt(e.target.value)
          }}
          placeholder="Write a message to the session..."
          rows={3}
          style={textareaStyle}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={sendSessionTextMessage}
            disabled={!sessionMessage.trim()}
            style={buttonStyle('#111')}
          >
            Send to session
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Input mode</label>
            <select
              value={inputMode}
              onChange={(e) =>
                setInputMode(e.target.value as 'text' | 'voice' | 'both')
              }
              style={selectStyle}
            >
              <option value="text">Text</option>
              <option value="voice">Voice</option>
              <option value="both">Text + Voice</option>
            </select>
          </div>

          <button
            onClick={() => void startRecording()}
            disabled={isRecording || isTranscribing || loading}
            style={buttonStyle('#0f766e')}
          >
            {isRecording ? 'Recording…' : 'Start voice'}
          </button>

          <button
            onClick={stopRecording}
            disabled={!isRecording}
            style={buttonStyle('#b42318')}
          >
            Stop voice
          </button>
        </div>

        <label style={labelStyle}>Voice transcript</label>
        <textarea
          value={voiceText}
          onChange={(e) => setVoiceText(e.target.value)}
          placeholder="Your recorded voice will appear here."
          rows={3}
          style={textareaStyle}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={clearVoiceText}
            disabled={!voiceText}
            style={buttonStyle('#6b7280')}
          >
            Clear voice
          </button>
        </div>

        <div
          style={{
            fontSize: 12,
            color: '#444',
            marginBottom: 10,
            padding: '8px 10px',
            borderRadius: 10,
            background: '#f8fafc',
            border: '1px solid #e5e7eb',
          }}
        >
          <strong>AI status:</strong> {agentPresence}
        </div>

        <div
          style={{
            borderTop: '1px solid #eee',
            paddingTop: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            Session conversation
          </div>

          {sessionEvents.length === 0 ? (
            <div style={{ fontSize: 13, color: '#666' }}>
              No session messages yet.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 260,
                overflow: 'auto',
              }}
            >
              {sessionEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    background: event.author === 'user' ? '#f3f4f6' : '#eefaf6',
                    border:
                      event.author === 'user'
                        ? '1px solid #e5e7eb'
                        : '1px solid #ccefe2',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: '#666',
                      marginBottom: 4,
                    }}
                  >
                    {event.kind.replace('_', ' ')} • {formatTime(event.timestamp)}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                    {event.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}

    {showAgentPanel && (
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 460,
          zIndex: 100,
          width: 360,
          maxHeight: '92vh',
          overflow: 'auto',
          background: 'rgba(255,255,255,0.97)',
          border: '1px solid #ddd',
          borderRadius: 16,
          padding: 16,
          boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            Agent controls
          </div>

          <button
            onClick={() => setShowAgentPanel(false)}
            style={miniButtonStyle('#6b7280')}
          >
            Hide
          </button>
        </div>

        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Focus, control, and direct the AI participant
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Focus</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as AgentMode)}
              style={selectStyle}
            >
              <option value="suggest_next">Suggest next</option>
              <option value="generate">Generate</option>
              <option value="cluster">Cluster</option>
              <option value="visualize">Visualize</option>
              <option value="critic">Critic</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Persona</label>
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as AgentPersona)}
              style={selectStyle}
            >
              <option value="facilitator">Facilitator</option>
              <option value="creative">Creative</option>
              <option value="critic">Critic</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Contribution amount</label>
            <select
              value={contributionLevel}
              onChange={(e) =>
                setContributionLevel(e.target.value as ContributionLevel)
              }
              style={selectStyle}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 12, color: '#555' }}>Canvas media:</span>
          <select
            value={mediaKind}
            onChange={(e) => setMediaKind(e.target.value as 'image' | 'video')}
            disabled={loading}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid #ccc',
              fontSize: 13,
            }}
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>

          <button
            onClick={() => void generateMediaOnCanvas()}
            disabled={!editor || loading || isTranscribing}
            style={buttonStyle('#0f766e')}
          >
            Generate on canvas
            
          </button>
          <button
            onClick={animateSelectedImageOnCanvas}
            disabled={!canRun}
            style={{
              marginTop: 10,
              width: '100%',
              padding: '12px 14px',
              borderRadius: 14,
              border: 'none',
              background: '#1f2937',
              color: 'white',
              fontWeight: 700,
              cursor: canRun ? 'pointer' : 'not-allowed',
              opacity: canRun ? 1 : 0.6,
            }}
          >
            Animate selected image
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={() => runAgent()}
            disabled={!canRun}
            style={buttonStyle('#111')}
          >
            Run agent
          </button>

          <button
            onClick={() => runAgent('suggest_next')}
            disabled={!canRun}
            style={buttonStyle('#5b21b6')}
          >
            Suggest next
          </button>

          <button
            onClick={seedManualExample}
            disabled={!editor || loading || isTranscribing}
            style={buttonStyle('#444')}
          >
            Seed notes
          </button>

          <button
            onClick={() => setPaused((v) => !v)}
            style={buttonStyle(paused ? '#b42318' : '#0f766e')}
          >
            {paused ? 'Resume agent' : 'Pause agent'}
          </button>

          <button
            onClick={() => setAutonomousEnabled((v) => !v)}
            style={buttonStyle(autonomousEnabled ? '#1d4ed8' : '#6b7280')}
          >
            {autonomousEnabled ? 'Autonomy on' : 'Autonomy off'}
          </button>

          <button
            onClick={clearConversation}
            style={buttonStyle('#6b7280')}
          >
            Clear memory
          </button>
        </div>

        <div
          style={{
            fontSize: 13,
            color: '#444',
            lineHeight: 1.4,
            marginBottom: 14,
          }}
        >
          <strong>Status:</strong> {loading ? 'Working…' : status}
        </div>

        <div style={{ fontSize: 12, color: '#666' }}>
          Autonomous participant: <strong>{autonomousEnabled ? 'enabled' : 'disabled'}</strong>
        </div>
      </div>
    )}

   
        <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 24,
        zIndex: 101,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {!showSessionPanel && (
        <button
          onClick={() => setShowSessionPanel(true)}
          style={miniButtonStyle('#111')}
        >
          Open session
        </button>
      )}

      {!showAgentPanel && (
        <button
          onClick={() => setShowAgentPanel(true)}
          style={miniButtonStyle('#111')}
        >
          Open agent controls
        </button>
      )}
    </div>

    <Tldraw
      licenseKey={licenseKey}
      persistenceKey="ai-canvas-agent"
      onMount={(editorInstance) => {
        setEditor(editorInstance)
      }}
    />
  </div>
)}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
  color: '#444',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  resize: 'vertical',
  padding: 12,
  borderRadius: 12,
  border: '1px solid #ccc',
  marginBottom: 12,
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: 10,
  borderRadius: 12,
  border: '1px solid #ccc',
  background: 'white',
}

function buttonStyle(background: string): React.CSSProperties {
  return {
    background,
    color: 'white',
    border: 'none',
    borderRadius: 12,
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 600,
  }
}
function miniButtonStyle(background: string): React.CSSProperties {
  return {
    background,
    color: 'white',
    border: 'none',
    borderRadius: 10,
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
  }
}
function getSelectedImageUrl(editor: Editor): string | undefined {
  const selectedShapes = editor.getSelectedShapes()

  for (const shape of selectedShapes) {
    if (shape.type !== 'image') continue

    const assetId = (shape as any).props?.assetId
    if (!assetId) continue

    const asset = editor.getAsset(assetId as any) as any
    const src = asset?.props?.src

    if (typeof src === 'string' && src.trim()) {
      return src
    }
  }

  return undefined
}
function normalizeTldrawColor(
  color?: string
):
  | 'black'
  | 'grey'
  | 'light-violet'
  | 'violet'
  | 'blue'
  | 'light-blue'
  | 'yellow'
  | 'orange'
  | 'green'
  | 'light-green'
  | 'light-red'
  | 'red'
  | 'white' {
  const value = (color || '').toLowerCase().trim()

  const allowed = new Set([
    'black',
    'grey',
    'light-violet',
    'violet',
    'blue',
    'light-blue',
    'yellow',
    'orange',
    'green',
    'light-green',
    'light-red',
    'red',
    'white',
  ])

  if (allowed.has(value)) {
    return value as
      | 'black'
      | 'grey'
      | 'light-violet'
      | 'violet'
      | 'blue'
      | 'light-blue'
      | 'yellow'
      | 'orange'
      | 'green'
      | 'light-green'
      | 'light-red'
      | 'red'
      | 'white'
  }

  if (value === 'pink') return 'light-red'
  if (value === 'purple') return 'violet'
  if (value === 'gray') return 'grey'

  return 'yellow'
}