import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import type {
  AgentAction,
  AgentMode,
  AgentPersona,
  AgentRequestBody,
  AgentResponseBody,
  ContributionLevel,
  ConversationMessage,
} from '@/lib/agent-types'

const openaiApiKey = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano'

type ParsedShape = {
  id: string
  type: string
  x: number
  y: number
  text: string
}

function parseCanvasSummary(canvasSummary: string): ParsedShape[] {
  const lines = canvasSummary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return lines
    .map((line) => {
      const idMatch = line.match(/id:([^\s]+)/)
      const typeMatch = line.match(/type:([^\s]+)/)
      const xMatch = line.match(/x:(-?\d+)/)
      const yMatch = line.match(/y:(-?\d+)/)
      const textMatch = line.match(/text:(.*)$/)

      if (!idMatch || !typeMatch || !xMatch || !yMatch) return null

      return {
        id: idMatch[1],
        type: typeMatch[1],
        x: Number(xMatch[1]),
        y: Number(yMatch[1]),
        text: textMatch?.[1]?.trim() || '',
      }
    })
    .filter(Boolean) as ParsedShape[]
}

function historyToText(history: ConversationMessage[] = []): string {
  if (!history.length) return 'No conversation yet.'

  return history
    .slice(-8)
    .map((m) => `${m.role}: ${m.text}`)
    .join('\n')
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

  const parsed = JSON.parse(cleaned.slice(start, end + 1))

  return {
    summary:
      typeof parsed.summary === 'string'
        ? parsed.summary
        : 'Agent completed a batch action.',
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
  }
}

function buildSystemPrompt() {
  return `
You are an AI brainstorming participant acting INSIDE a collaborative canvas.
You improve the board itself.

Your job:
- understand the canvas
- understand the conversation
- make the board clearer, more structured, and more useful
- act like a thoughtful teammate already in the session
The goal is to make it meaningfully better.

Return ONLY valid JSON:
{
  "summary": "short one-sentence summary",
  "actions": []
}

Allowed actions:

1. create_sticky
{
  "type": "create_sticky",
  "text": "short text",
  "x": 100,
  "y": 200,
  "color": "yellow"
}

2. create_label
{
  "type": "create_label",
  "text": "short section title",
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

4. update_text
{
  "type": "update_text",
  "id": "existing-shape-id",
  "text": "shorter and cleaner replacement text"
}

5. create_section
{
  "type": "create_section",
  "sectionId": "group_1",
  "title": "Channels",
  "kind": "group"
}

6. assign_to_section
{
  "type": "assign_to_section",
  "id": "existing-shape-id",
  "sectionId": "group_1",
  "shortText": "Shorter note"
}

7. create_section_note
{
  "type": "create_section_note",
  "sectionId": "group_2",
  "text": "Key recommendation",
  "color": "green"
}

8. create_media_card
{
  "type": "create_media_card",
  "title": "short title",
  "description": "what image/video should show",
  "x": 900,
  "y": 300,
  "url": "optional reference url",
  "mediaType": "image"
}

9. generate_image
{
  "type": "generate_image",
  "prompt": "detailed image prompt, style and composition",
  "x": 900,
  "y": 300,
  "title": "optional short label"
}

10. generate_video
{
  "type": "generate_video",
  "prompt": "detailed video prompt, motion and scene",
  "x": 900,
  "y": 520,
  "title": "optional short label"
}

Rules:
- Output JSON only. No markdown. No extra text.
- Read the board before acting.
- Never invent ids.
- Use only ids from canvasSummary for move_shape, update_text, and assign_to_section.
- Sticky text should usually be 2-10 words.
- Section titles should usually be 1-3 words.
- If a note is long, vague, or repetitive, shorten it.
- If notes mean almost the same thing, compress to one.
- Preserve user intent.
- Do not duplicate content.
- Make the board easier to scan and understand in a few seconds.
- Use section names that match the real board content.

Never output colors:
pink, purple, gray

Before acting:
1. Read stickers and understand the board state.
2. Infer what is most useful now.
3. Make one compact batch of actions.

Mode rules:
- generate: add 2-5 useful new ideas as stickers. New ideas must fit the board topic.
- cluster: organize existing notes into 2 to 4 meaningful groups. Use create_section, assign_to_section, and create_section_note.
- critic: refine weak notes and add one important risk, gap, or validation question.
- suggest_next: choose the single most useful next move.
- visualize: prefer one strong generate_image OR generate_video action with a detailed prompt. You may also add one create_label or create_media_card if helpful.

Contribution level:
- low = 2-3 actions
- medium = 4-6 actions
- high = 6-8 actions

Persona:
- facilitator = structure, clarity, progress
- creative = fresh angles and useful reframing
- critic = risks, gaps, validation questions

Good output:
- the board becomes clearer
- the AI acts intentionally
- the contribution feels useful and timely
- the board gets better, not just bigger
`.trim()
}

function buildMockActions(
  mode: AgentMode,
  canvasSummary: string
): AgentResponseBody {
  const shapes = parseCanvasSummary(canvasSummary)
  const textShapes = shapes.filter((s) => s.text && s.text !== '-')

  if (mode === 'cluster' || mode === 'suggest_next') {
    const actions: AgentAction[] = [
      {
        type: 'create_section',
        sectionId: 'acquisition',
        title: 'Acquisition',
        kind: 'group',
      },
      {
        type: 'create_section',
        sectionId: 'product',
        title: 'Product',
        kind: 'group',
      },
      {
        type: 'create_section',
        sectionId: 'community',
        title: 'Community',
        kind: 'group',
      },
      {
        type: 'create_section',
        sectionId: 'risk',
        title: 'Risk',
        kind: 'risk',
      },
    ]

    if (textShapes[0]) {
      actions.push({
        type: 'assign_to_section',
        id: textShapes[0].id,
        sectionId: 'acquisition',
        shortText: 'Founder-led outbound',
      })
    }

    if (textShapes[1]) {
      actions.push({
        type: 'assign_to_section',
        id: textShapes[1].id,
        sectionId: 'product',
        shortText: 'Product-led demo',
      })
    }

    if (textShapes[2]) {
      actions.push({
        type: 'assign_to_section',
        id: textShapes[2].id,
        sectionId: 'community',
        shortText: 'Niche landing pages',
      })
    }

    actions.push({
      type: 'create_section_note',
      sectionId: 'product',
      text: 'Recommendation: demo + outbound wedge',
      color: 'green',
    })

    actions.push({
      type: 'create_section_note',
      sectionId: 'risk',
      text: 'Need one wedge + one metric',
      color: 'red',
    })

    return {
      summary:
        'Reduced chaos by organizing notes into cleaner sections and adding one recommendation plus one risk/gap.',
      actions,
    }
  }

  if (mode === 'visualize') {
    return {
      summary: 'Prepared one visual direction for the strongest idea.',
      actions: [
        {
          type: 'generate_image',
          prompt:
            'A modern collaborative brainstorming canvas on a large digital whiteboard, grouped into acquisition, product, community, and risk sections, one winning growth path highlighted, startup strategy workshop, clean sticky notes, polished product-style interface, cinematic lighting, high detail',
          x: 980,
          y: 180,
          title: 'Growth concept visual',
        },
      ],
    }
  }

  if (mode === 'critic') {
    const actions: AgentAction[] = []

    if (textShapes[0]) {
      actions.push({
        type: 'update_text',
        id: textShapes[0].id,
        text: 'Founder-led outbound\n\nNeed success metric.',
      })
    }

    actions.push({
      type: 'create_sticky',
      text: 'Validation: pick one wedge first',
      x: 980,
      y: 200,
      color: 'red',
    })

    return {
      summary: 'Refined one note and added one validation question.',
      actions,
    }
  }

  return {
    summary: 'Added a compact batch of new ideas.',
    actions: [
      {
        type: 'create_sticky',
        text: 'Founder-led outbound',
        x: 120,
        y: 180,
        color: 'yellow',
      },
      {
        type: 'create_sticky',
        text: 'Product-led demo',
        x: 380,
        y: 180,
        color: 'blue',
      },
      {
        type: 'create_sticky',
        text: 'Referral incentives',
        x: 640,
        y: 180,
        color: 'green',
      },
    ],
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequestBody
    const {
      userMessage,
      mode,
      canvasSummary,
      conversationHistory = [],
      persona = 'facilitator',
      contributionLevel = 'medium',
    } = body

    if (!openaiApiKey) {
      return NextResponse.json(buildMockActions(mode, canvasSummary))
    }

    const client = new OpenAI({ apiKey: openaiApiKey })

    const effectiveMessage =
      userMessage?.trim() ||
      'No explicit instruction provided. Infer the most useful next board action from the workspace and conversation.'

    const prompt = `
Task:
You are helping with a live brainstorming board.

mode: ${mode}
persona: ${persona}
contributionLevel: ${contributionLevel}

User instruction:
${effectiveMessage}

Recent conversation:
${historyToText(conversationHistory)}

Canvas summary:
${canvasSummary}

What to do:
- Read the existing notes first.
- If mode is cluster, organize the board into clear groups based on sticker meaning.
- Shorten long notes with shortText when useful, but preserve meaning.
- If mode is visualize, prefer one strong generate_image or generate_video action.
- Return JSON only.
`.trim()

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const text = completion.choices[0]?.message?.content ?? ''
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
            text: 'Fallback: agent request failed. Check API key, model, or permissions.',
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