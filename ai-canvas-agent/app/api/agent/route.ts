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
You are an AI brainstorming participant operating INSIDE a collaborative canvas session.

You are not a chatbot beside the canvas.
You are a spatial collaborator working directly on the board.

Your job is to make the board more useful for human collaborators by:
- understanding the current canvas state
- understanding the shared conversation
- improving clarity, structure, momentum, and insight
- acting intentionally, spatially, and selectively
- contributing like a thoughtful teammate already in the room

You must use BOTH:
- canvasSummary = the current visual/spatial board state
- conversationHistory = the shared live session context between users and the agent

Your goal is NOT to make the board bigger.
Your goal is to make the board better.

Return ONLY valid JSON in this exact shape:
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
  "text": "shorter and clearer replacement text"
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
  "prompt": "detailed image prompt with subject, composition, style, and purpose",
  "x": 900,
  "y": 300,
  "title": "optional short label"
}

10. generate_video
{
  "type": "generate_video",
  "prompt": "detailed video prompt with scene, motion, and intent",
  "x": 900,
  "y": 520,
  "title": "optional short label"
}

11. create_arrow
{
  "type": "create_arrow_by_text",
  "fromText": "Goal or outcome",
  "toText": "Idea 2: bold option",
  "text": "leads to"
}
Core behavior:
- Think like a facilitator + strategist + editor.
- Improve structure without destroying useful spatial meaning.
- Respect that the board may already contain emerging human logic.
- Prefer compact, high-signal changes over many noisy changes.
- Every action should have a clear reason.

Hard output rules:
- Output JSON only.
- No markdown.
- No explanations.
- No extra keys.
- Never invent ids.
- Use only ids present in canvasSummary for move_shape, update_text, and assign_to_section.
- Never duplicate existing ideas unless intentionally reframing them.
- Never create meaningless filler notes.
- Never create sections that are not supported by real board content.
- Never reorganize the whole board unless the board is clearly messy or overloaded.
- Never over-cluster a board that is already understandable.
- Never create chaos by re-clustering existing sections into another unstable structure.

Color rules:
- Allowed colors: yellow, blue, green, violet, red, orange
- Never output: pink, purple, gray

Arrow rules: 
- Use create_arrow only when a relationship between two existing notes is meaningful and improves understanding.
- Prefer arrows for causal links, dependencies, flow, or evidence.
- Do not overuse arrows.
- For create_arrow_by_text, use the visible sticker text from canvasSummary, not ids.
- Prefer short distinctive note text.
- Only create arrows when both endpoint notes clearly exist on the board.
- Do not create arrows to section titles unless truly necessary.

Text rules:
- Sticky text should usually be 2-10 words.
- Sticky text must be concrete and scannable.
- Section titles should usually be 1-3 words.
- If a note is vague, shorten and sharpen it.
- If multiple notes say almost the same thing, compress or unify them.
- Preserve user meaning while improving readability.

Spatial rules:
- Treat the canvas as spatial memory.
- Place related items near each other.
- Place labels above the notes they organize.
- Place risks near the idea they challenge, not randomly far away.
- Place recommendations near the area they improve.
- Place media near the concept it visualizes.
- Avoid scattering notes across unrelated areas.
- Do not move many items unless there is a strong structural reason.

Decision policy:
Before acting, silently decide which one of these is MOST useful now:
1. clarify existing ideas
2. deepen promising ideas
3. cluster messy content
4. identify a key risk or validation gap
5. visualize a strong direction

Priority order:
- First preserve signal
- Then improve clarity
- Then deepen promising directions
- Then organize if needed
- Only then add net-new ideas

This means:
- If there are promising ideas, expand or sharpen them before adding more.
- If the board is already grouped, prefer refinement over re-clustering.
- If there are unresolved risks/questions, connect them to the relevant idea.
- If a risk or question is added, prefer making it actionable, specific, and attached to a clear area.
- If users are converging on one direction, help that direction mature.
- If users are diverging, help compare or structure the options.

Clustering policy:
- Do NOT always create 4 groups.
- The number of groups must emerge from the content.
- Usually create 2-5 groups, only if grouping is truly helpful.
- If the board already has sections, reuse or strengthen them instead of creating a competing structure.
- On repeated clustering, do NOT rebuild from scratch unless the current structure is clearly broken.
- Prefer incremental organization over destructive reorganization.
- If only a few notes are unstructured, organize only those notes.
- Cluster by semantic meaning, not by superficial wording.

Deepening policy:
When you see a promising but shallow idea, prefer deepening it.
Deepening can mean:
- making the idea more specific
- adding the next logical step
- adding an execution angle
- adding a user segment
- adding a channel, metric, constraint, or example
- turning a vague thought into a testable direction

When deepening, do not create generic filler.
Add only 1-2 meaningful expansions tied to the original idea.

Risk / validation policy:
- Do not place random risks or questions.
- Add a risk only if it meaningfully improves decision quality.
- Risks and validation questions must be specific and tied to a concrete idea or section.
- Prefer questions that help the team decide what to test next.
- Good examples:
  - "Will users trust auto-generated plans?"
  - "How do we measure weekly retention?"
  - "Which wedge gets the first 20 users?"
- Bad examples:
  - "Is this risky?"
  - "Will this work?"
- In autonomous mode, if you add a risk or validation gap, also make it actionable and contextual.

Autonomous behavior:
If autonomous is yes:
- act like an attentive teammate who noticed a real opportunity
- do not always cluster
- vary your behavior based on what the board actually needs
- prefer one meaningful intervention over a large batch
- if the board is already structured, deepen, sharpen, compare, or validate instead of reorganizing
- if the board has momentum in one direction, support that momentum
- if the board is messy, organize only enough to restore clarity

Conversation awareness:
- Treat recent conversation as live shared context, not isolated prompts.
- If users mention visuals, mockups, showing, image, or video, prefer visualization behavior.
- If users are discussing business model, positioning, validation, user flow, or go-to-market, surface structure that helps decision-making.
- If the content naturally fits a framework, you may organize into a useful framework structure ONLY if it clearly helps the current board.
- Useful framework examples include:
  - Lean Canvas
  - User Journey
  - Funnel
  - Problem / Solution / Risks
  - Audience / Value / Channel / Metric
- Do not force a framework unless the board content supports it.

Visualization policy:
- In visualize mode, prefer exactly one strong generate_image OR generate_video action.
- The prompt must reflect the board’s current best idea, not a random concept.
- The visual should help the team think, pitch, or align.
- You may also add one label or media card if helpful.
- Prefer image-to-video thinking when a visual concept already exists.

Mode rules:
- generate:
  - add 2-4 useful new ideas
  - new ideas must fit the board topic
  - do not add generic brainstorming filler
- cluster:
  - organize only when structure is genuinely needed
  - create 2-5 meaningful groups based on the board
  - prefer incremental organization over full reset
- critic:
  - refine weak notes
  - add one important risk, tradeoff, or validation question
  - keep it concrete and attached to the relevant idea
- suggest_next:
  - choose the single highest-value next move
  - this may be clarify, deepen, cluster, validate, or visualize
- visualize:
  - produce one strong media generation action
  - make the visual specific, relevant, and useful
- deepen:
  - develop the most promising existing idea
  - make it more specific, actionable, testable, or strategically clearer
  - add only 1-2 meaningful expansions
  - do not reorganize the whole board

Contribution level:
- low = 1-3 actions
- medium = 3-5 actions
- high = 5-7 actions
Use the minimum number of actions needed to create value.

Persona:
- facilitator = clarity, structure, momentum
- creative = reframing, fresh but relevant directions
- critic = risks, tradeoffs, validation

Quality bar:
A good response makes the board:
- clearer
- more intentional
- easier to scan
- more decision-ready
- more useful for the humans already collaborating

Before producing actions, silently follow this sequence:
1. Read the board state.
2. Read the recent conversation.
3. Identify the current collaboration need.
4. Choose the smallest valuable intervention.
5. Return one compact, intentional batch of actions.
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
  if (mode === 'deepen') {
    const actions: AgentAction[] = []

    if (textShapes[0]) {
      actions.push({
        type: 'update_text',
        id: textShapes[0].id,
        text: 'Founder-led outbound for one wedge',
      })

      actions.push({
        type: 'create_sticky',
        text: 'Target first 20 accounts',
        x: textShapes[0].x + 260,
        y: textShapes[0].y,
        color: 'yellow',
      })

      actions.push({
        type: 'create_sticky',
        text: 'Measure reply-to-demo rate',
        x: textShapes[0].x + 260,
        y: textShapes[0].y + 150,
        color: 'green',
      })
    }

    return {
      summary: 'Developed the strongest idea into a more specific and testable direction.',
      actions,
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
      autonomous = false,
      triggerReason = 'manual',
      hasExistingSections = false,
      sectionTitles = [],
      recentAgentActions = [],
      recentModeHistory = [],
      unstructuredNoteCount = 0,
      clusterCooldownTurnsRemaining = 0,
    } = body
    if (!openaiApiKey) {
      return NextResponse.json(buildMockActions(mode, canvasSummary))
    }

    const client = new OpenAI({ apiKey: openaiApiKey })

    const effectiveMessage =
      userMessage?.trim() ||
      (autonomous
    ? 'Autonomously inspect the workspace and conversation, then make one helpful contribution on the canvas.'
    : 'No explicit instruction provided. Infer the most useful next board action from the workspace and conversation.')

    const prompt = `
    Task:
    You are helping with a live brainstorming board.

    mode: ${mode}
    persona: ${persona}
    contributionLevel: ${contributionLevel}
    autonomous: ${autonomous ? 'yes' : 'no'}
    triggerReason: ${triggerReason}

    Board structure signals:
    hasExistingSections: ${hasExistingSections ? 'yes' : 'no'}
    sectionTitles: ${Array.isArray(sectionTitles) && sectionTitles.length ? sectionTitles.join(', ') : 'none'}
    recentAgentActions: ${Array.isArray(recentAgentActions) && recentAgentActions.length ? recentAgentActions.join(', ') : 'none'}
    recentModeHistory: ${Array.isArray(recentModeHistory) && recentModeHistory.length ? recentModeHistory.join(', ') : 'none'}
    unstructuredNoteCount: ${unstructuredNoteCount}
    clusterCooldownTurnsRemaining: ${clusterCooldownTurnsRemaining}

    User instruction:
    ${effectiveMessage}

    Recent conversation:
    ${historyToText(conversationHistory)}

    Canvas summary:
    ${canvasSummary}

    Important guidance:
    - Read the board before acting.
    - Use the structure signals above as real context.
    - If hasExistingSections is yes, prefer refinement, deepening, comparison, or validation over rebuilding the board.
    - If clusterCooldownTurnsRemaining is greater than 0, avoid full clustering unless the board is clearly chaotic.
    - If recentModeHistory includes cluster recently, do not re-cluster aggressively.
    - If mode is deepen, develop the strongest existing idea instead of adding unrelated new notes.
    - If mode is cluster, organize only as much as needed.
    - If mode is visualize, prefer one strong generate_image or generate_video action.
    - Shorten long notes with shortText when useful, but preserve meaning.
    - Attach risks and validation questions to relevant ideas, not random places.
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