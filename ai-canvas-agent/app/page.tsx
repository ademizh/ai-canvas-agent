'use client'

import { useMemo, useState } from 'react'
import {
  createShapeId,
  Editor,
  Tldraw,
  TLShape,
  toRichText,
} from 'tldraw'
import { useSyncDemo } from '@tldraw/sync'
import type {
  AgentAction,
  AgentMode,
  AgentResponseBody,
} from '@/lib/agent-types'

const ROOM_ID = process.env.NEXT_PUBLIC_ROOM_ID || 'hacknu-ai-agent-room'

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
    .slice(0, 40)
    .map((shape) => {
      const text = shapeText(shape).slice(0, 120)
      return `id:${shape.id} type:${shape.type} x:${Math.round(shape.x)} y:${Math.round(shape.y)} text:${text || '-'}`
    })
    .join('\n')
}

function createSticky(
  editor: Editor,
  text: string,
  x: number,
  y: number,
  color: 'yellow' | 'blue' | 'green' | 'violet' | 'red' | 'orange' = 'yellow'
) {
  editor.createShape({
    id: createShapeId(),
    type: 'note',
    x,
    y,
    props: {
      color,
      labelColor: 'black',
      richText: toRichText(text),
      size: 'm',
      font: 'sans',
      align: 'middle',
      verticalAlign: 'middle',
    },
  } as any)
}

function createLabel(editor: Editor, text: string, x: number, y: number) {
  editor.createShape({
    id: createShapeId(),
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
}

function createMediaCard(
  editor: Editor,
  title: string,
  description: string,
  x: number,
  y: number,
  url?: string
) {
  const content = url
    ? `${title}\n\n${description}\n\n${url}`
    : `${title}\n\n${description}`

  editor.createShape({
    id: createShapeId(),
    type: 'geo',
    x,
    y,
    props: {
      geo: 'rectangle',
      w: 320,
      h: 180,
      richText: toRichText(content),
      font: 'sans',
      size: 'm',
      align: 'middle',
      verticalAlign: 'middle',
    },
  } as any)
}

function applyAgentActions(editor: Editor, actions: AgentAction[]) {
  for (const action of actions) {
    if (action.type === 'create_sticky') {
      createSticky(editor, action.text, action.x, action.y, action.color)
      continue
    }

    if (action.type === 'create_label') {
      createLabel(editor, action.text, action.x, action.y)
      continue
    }

    if (action.type === 'move_shape') {
      editor.updateShape({
        id: action.id as any,
        x: action.x,
        y: action.y,
      } as any)
      continue
    }

    if (action.type === 'create_media_card') {
      createMediaCard(
        editor,
        action.title,
        action.description,
        action.x,
        action.y,
        action.url
      )
    }
  }
}

export default function Page() {
  const store = useSyncDemo({ roomId: ROOM_ID })
  const [editor, setEditor] = useState<Editor | null>(null)
  const [prompt, setPrompt] = useState('Brainstorm ideas for an AI teammate on a collaborative canvas')
  const [status, setStatus] = useState('Ready')
  const [loading, setLoading] = useState(false)
  const [paused, setPaused] = useState(false)

  const canRun = useMemo(() => !!editor && !loading && !paused, [editor, loading, paused])

  async function runAgent(mode: AgentMode) {
    if (!editor || loading || paused) return

    setLoading(true)

    try {
      const canvasSummary = summarizeBoard(editor)

      const fallbackMessage =
        mode === 'generate'
          ? 'Generate 4 to 6 useful brainstorming ideas.'
          : mode === 'cluster'
            ? 'Cluster related ideas spatially into themes.'
            : 'Suggest one useful image or video concept.'

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: prompt.trim() || fallbackMessage,
          mode,
          canvasSummary,
        }),
      })

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`)
      }

      const data = (await res.json()) as AgentResponseBody
      applyAgentActions(editor, data.actions)
      setStatus(data.summary || 'Done')
    } catch (error) {
      console.error(error)
      setStatus('Something went wrong. Check console and /api/agent logs.')
    } finally {
      setLoading(false)
    }
  }

  function seedManualExample() {
    if (!editor) return

    createLabel(editor, 'User Notes', 120, 80)
    createSticky(editor, 'Users need a shared canvas with realtime sync', 120, 140, 'yellow')
    createSticky(editor, 'AI should add ideas directly on the board', 380, 140, 'blue')
    createSticky(editor, 'Need controls so AI does not overwhelm users', 640, 140, 'green')
    setStatus('Added manual starter notes.')
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 100,
          width: 420,
          background: 'rgba(255,255,255,0.96)',
          border: '1px solid #ddd',
          borderRadius: 16,
          padding: 16,
          boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          AI Canvas Agent
        </div>

        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Room: <strong>{ROOM_ID}</strong>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Tell the agent what to do..."
          rows={4}
          style={{
            width: '100%',
            resize: 'vertical',
            padding: 12,
            borderRadius: 12,
            border: '1px solid #ccc',
            marginBottom: 12,
          }}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={() => runAgent('generate')}
            disabled={!canRun}
            style={buttonStyle('#111')}
          >
            Generate
          </button>

          <button
            onClick={() => runAgent('cluster')}
            disabled={!canRun}
            style={buttonStyle('#111')}
          >
            Cluster
          </button>

          <button
            onClick={() => runAgent('suggest_media')}
            disabled={!canRun}
            style={buttonStyle('#111')}
          >
            Suggest media
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
        </div>

        <div
          style={{
            fontSize: 13,
            color: loading ? '#0f766e' : '#444',
            lineHeight: 1.4,
          }}
        >
          <strong>Status:</strong> {loading ? 'Agent is thinking…' : status}
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