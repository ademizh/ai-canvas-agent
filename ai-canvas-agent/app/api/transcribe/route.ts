import OpenAI from 'openai'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const openaiApiKey = process.env.OPENAI_API_KEY
const transcriptionModel =
  process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'

export async function POST(req: Request) {
  try {
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not set.' },
        { status: 503 }
      )
    }

    const formData = await req.formData()
    const audioFile = formData.get('file')
    const promptHint = formData.get('prompt')

    if (!(audioFile instanceof File)) {
      return NextResponse.json(
        { error: 'file is required.' },
        { status: 400 }
      )
    }

    const client = new OpenAI({ apiKey: openaiApiKey })

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: transcriptionModel,
      response_format: 'json',
      ...(typeof promptHint === 'string' && promptHint.trim()
        ? { prompt: promptHint.trim() }
        : {}),
    })

    return NextResponse.json({
      text: transcription.text || '',
      model: transcriptionModel,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[transcribe]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}