'use client'

import { useMemo, useState } from 'react'
import {
  AssetRecordType,
  createShapeId,
  Editor,
  getHashForString,
  Tldraw,
  TLShape,
  toRichText,
} from 'tldraw'
import { useSyncDemo } from '@tldraw/sync'
import type {
  AgentAction,
  AgentMode,
  AgentPersona,
  AgentResponseBody,
  ContributionLevel,
  ConversationMessage,
  SectionKind,
} from '@/lib/agent-types'

const ROOM_ID = process.env.NEXT_PUBLIC_ROOM_ID || 'hacknu-ai-agent-room'

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
  title?: string
) {
  const res = await fetch('/api/generate-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, prompt }),
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
      const x = startX + idx * (sectionWidth + sectionGapX)
      const y = currentY

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
    await requestGeneratedMedia(
      editor,
      'image',
      action.prompt,
      action.x,
      action.y,
      action.title
    )
    return
  }

  if (action.type === 'generate_video') {
    await requestGeneratedMedia(
      editor,
      'video',
      action.prompt,
      action.x,
      action.y,
      action.title
    )
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

export default function Page() {
  const store = useSyncDemo({ roomId: ROOM_ID })

  const [editor, setEditor] = useState<Editor | null>(null)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('Ready')
  const [loading, setLoading] = useState(false)
  const [paused, setPaused] = useState(false)

  const [persona, setPersona] = useState<AgentPersona>('facilitator')
  const [contributionLevel, setContributionLevel] =
    useState<ContributionLevel>('medium')
  const [mode, setMode] = useState<AgentMode>('suggest_next')

  const [conversationHistory, setConversationHistory] = useState<
    ConversationMessage[]
  >([])
  const [helperShapeIds, setHelperShapeIds] = useState<string[]>([])
  const [mediaKind, setMediaKind] = useState<'image' | 'video'>('image')

  const canRun = useMemo(
    () => !!editor && !loading && !paused,
    [editor, loading, paused]
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

  function statusForMode(selectedMode: AgentMode) {
    if (selectedMode === 'generate') return 'AI is adding a focused batch of ideas…'
    if (selectedMode === 'cluster') return 'AI is cleaning and organizing the board…'
    if (selectedMode === 'visualize') return 'AI is preparing a visual concept…'
    if (selectedMode === 'critic') return 'AI is refining weak notes and surfacing gaps…'
    return 'AI is deciding the most useful next step…'
  }

  async function runAgent(customMode?: AgentMode) {
    if (!editor || loading || paused) return

    const effectiveMode = customMode || mode
    const userText = prompt.trim() || defaultMessageForMode(effectiveMode)

    pushConversation('user', userText)
    setLoading(true)
    setStatus(statusForMode(effectiveMode))

    try {
      const canvasSummary = summarizeBoard(editor)

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: userText,
          mode: effectiveMode,
          canvasSummary,
          conversationHistory: [
            ...conversationHistory.slice(-19),
            { role: 'user', text: userText, timestamp: Date.now() },
          ],
          persona,
          contributionLevel,
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
    } catch (error) {
      console.error(error)
      setStatus('Something went wrong. Check console and /api/agent logs.')
      pushConversation('agent', 'Agent failed to respond properly.')
    } finally {
      setLoading(false)
    }
  }

  async function generateMediaOnCanvas() {
    if (!editor || loading) return

    const fallback =
      mediaKind === 'image'
        ? 'A futuristic collaborative whiteboard with sticky notes and soft studio lighting.'
        : 'Short clip: hands arranging sticky notes on a glass whiteboard, smooth camera pan.'

    const text = prompt.trim() || fallback
    const vp = editor.getViewportPageBounds()
    const x = vp.x + vp.width / 2 - DEFAULT_MEDIA_W / 2
    const y = vp.y + vp.height / 2 - DEFAULT_MEDIA_H / 2

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
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 100,
          width: 470,
          maxHeight: '92vh',
          overflow: 'auto',
          background: 'rgba(255,255,255,0.97)',
          border: '1px solid #ddd',
          borderRadius: 16,
          padding: 16,
          boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
          AI Canvas Agent
        </div>

        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Room: <strong>{ROOM_ID}</strong>
        </div>

        <label style={labelStyle}>Instruction (optional)</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Optional. Leave empty and let the agent infer the next helpful step."
          rows={4}
          style={textareaStyle}
        />

        <div
          style={{
            fontSize: 12,
            color: '#666',
            marginTop: -6,
            marginBottom: 12,
            lineHeight: 1.4,
          }}
        >
          Better for the brief: users can guide the AI, but the AI can also understand the board and suggest its own next move.
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={labelStyle}>Mode</label>
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

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Contribution level</label>
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
            marginBottom: 10,
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
            disabled={!editor || loading}
            style={buttonStyle('#0f766e')}
          >
            Generate on canvas
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
            disabled={!editor || loading}
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

        <div
          style={{
            borderTop: '1px solid #eee',
            paddingTop: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            Conversation memory
          </div>

          {conversationHistory.length === 0 ? (
            <div style={{ fontSize: 13, color: '#666' }}>
              No conversation yet.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 220,
                overflow: 'auto',
              }}
            >
              {conversationHistory.map((message, index) => (
                <div
                  key={`${message.timestamp}-${index}`}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    background:
                      message.role === 'user' ? '#f3f4f6' : '#eefaf6',
                    border:
                      message.role === 'user'
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
                    {message.role} • {formatTime(message.timestamp)}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                    {message.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Tldraw
        store={store}
        onMount={(editorInstance) => {
          setEditor(editorInstance)
        }}
      />
    </div>
  )
}

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