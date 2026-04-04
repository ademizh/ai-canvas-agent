import { NextResponse } from 'next/server'
import {
  generateMediaUrl,
  type GenerateMediaKind,
} from '../../../lib/higgsfield-generate'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { kind?: string; prompt?: string }

    const kind = body.kind as GenerateMediaKind | undefined
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''

    if (kind !== 'image' && kind !== 'video') {
      return NextResponse.json(
        { error: 'kind must be "image" or "video".' },
        { status: 400 }
      )
    }

    if (!prompt) {
      return NextResponse.json(
        { error: 'prompt is required.' },
        { status: 400 }
      )
    }

    if (
      !process.env.HIGGSFIELD_API_KEY?.trim() ||
      !process.env.HIGGSFIELD_API_SECRET?.trim()
    ) {
      return NextResponse.json(
        {
          error:
            'Media generation is disabled: set HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET in .env.local.',
        },
        { status: 503 }
      )
    }

    const { url } = await generateMediaUrl(kind, prompt)
    return NextResponse.json({ url, kind })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[generate-media]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}