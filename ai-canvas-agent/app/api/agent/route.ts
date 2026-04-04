import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import type {
  AgentAction,
  AgentMode,
  AgentRequestBody,
  AgentResponseBody,
} from '@/lib/agent-types'

const anthropicApiKey = process.env.ANTHROPIC_API_KEY
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

function extractKnownIds(canvasSummary: string): string[] {
  return [...canvasSummary.matchAll(/id:([^\s]+)/g)].map((m) => m[1])
}

function buildMockActions(mode: AgentMode, canvasSummary: string): AgentResponseBody {
  const ids = extractKnownIds(canvasSummary)

  if (mode === 'generate') {
    const actions: AgentAction[] = [
      { type: 'create_label', text: 'AI Ideas', x: 120, y: 60 },
      {
        type: 'create_sticky',
        text: 'Shared cursor + sticky-note collaboration',
        x: 120,
        y: 120,
        color: 'yellow',
      },
      {
        type: 'create_sticky',
        text: 'AI clusters ideas into themes automatically',
        x: 360,
        y: 120,
        color: 'blue',
      },
      {
        type: 'create_sticky',
        text: 'Users can ask AI to suggest image concepts',
        x: 600,
        y: 120,
        color: 'green',
      },
      {
        type: 'create_sticky',
        text: 'Facilitator mode keeps brainstorming focused',
        x: 840,
        y: 120,
        color: 'orange',
      },
    ]

    return {
      summary: 'Mock mode: generated starter ideas on the board.',
      actions,
    }
  }

  if (mode === 'cluster') {
    const actions: AgentAction[] = [
      { type: 'create_label', text: 'Collaboration', x: 120, y: 320 },
      { type: 'create_label', text: 'AI Features', x: 520, y: 320 },
    ]

    if (ids[0]) actions.push({ type: 'move_shape', id: ids[0], x: 120, y: 380 })
    if (ids[1]) actions.push({ type: 'move_shape', id: ids[1], x: 120, y: 580 })
    if (ids[2]) actions.push({ type: 'move_shape', id: ids[2], x: 520, y: 380 })
    if (ids[3]) actions.push({ type: 'move_shape', id: ids[3], x: 520, y: 580 })

    return {
      summary: 'Mock mode: clustered existing items into two themes.',
      actions,
    }
  }

  return {
    summary: 'Mock mode: created one media card.',
    actions: [
      {
        type: 'create_media_card',
        title: 'Hero image concept',
        description:
          'A collaborative whiteboard with two users and an AI agent placing sticky notes in real time.',
        x: 950,
        y: 360,
        url: 'https://example.com/reference',
      },
    ],
  }
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function safeParseAgentJson(text: string): AgentResponseBody {
  const cleaned = stripCodeFences(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return JSON.')
  }

  const jsonString = cleaned.slice(start, end + 1)
  const parsed = JSON.parse(jsonString)

  return {
    summary:
      typeof parsed.summary === 'string'
        ? parsed.summary
        : 'Agent completed an action.',
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
  }
}

function buildSystemPrompt() {
  return `
You are an AI brainstorming agent living INSIDE a collaborative infinite canvas.

You do NOT reply like a chatbot.
You must return ONLY valid JSON with this exact top-level shape:
{
  "summary": "short one-sentence summary",
  "actions": [ ... ]
}

Allowed action types:

1. create_sticky
{
  "type": "create_sticky",
  "text": "idea text",
  "x": 100,
  "y": 200,
  "color": "yellow"
}

2. create_label
{
  "type": "create_label",
  "text": "section title",
  "x": 100,
  "y": 80
}

3. move_shape
{
  "type": "move_shape",
  "id": "existing-shape-id",
  "x": 300,
  "y": 500
}

4. create_media_card
{
  "type": "create_media_card",
  "title": "short title",
  "description": "what image/video should show",
  "x": 900,
  "y": 300,
  "url": "optional reference url"
}

Rules:
- Return ONLY JSON. No markdown. No explanation before or after.
- Never invent shape ids for move_shape. Only use ids present in canvasSummary.
- Keep actions concise and useful for a live brainstorming session.
- Prefer 3 to 6 actions.
- Place related things near each other spatially.
- For generate mode: create new ideas as sticky notes.
- For cluster mode: mostly move existing notes and add 1-3 labels.
- For suggest_media mode: create one media card and optionally one label.
`.trim()
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequestBody
    const { userMessage, mode, canvasSummary } = body

    if (!anthropicApiKey) {
      return NextResponse.json(buildMockActions(mode, canvasSummary))
    }

    const client = new Anthropic({ apiKey: anthropicApiKey })

    const prompt = `
mode: ${mode}

userMessage:
${userMessage}

canvasSummary:
${canvasSummary}
    `.trim()

    const message = await client.messages.create({
      model,
      max_tokens: 1200,
      temperature: 0.3,
      system: buildSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    const parsed = safeParseAgentJson(text)
    return NextResponse.json(parsed)
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      {
        summary: 'Agent failed, so a fallback note was created.',
        actions: [
          {
            type: 'create_sticky',
            text: 'Fallback: agent request failed. Check API key, model name, or route logs.',
            x: 120,
            y: 120,
            color: 'red',
          },
        ],
      } satisfies AgentResponseBody,
      { status: 200 }
    )
  }
}
