/**
 * Server-only helpers for Replicate predictions. Uses REPLICATE_API_TOKEN from the environment.
 */

const REPLICATE_API = 'https://api.replicate.com/v1'

export type GenerateMediaKind = 'image' | 'video'

type ReplicatePrediction = {
  id: string
  status: string
  output?: unknown
  error?: string | null
  urls?: { get?: string }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeMediaUrl(output: unknown): string | null {
  if (output == null) return null
  if (typeof output === 'string') return output
  if (Array.isArray(output) && output.length > 0 && typeof output[0] === 'string') {
    return output[0]
  }
  return null
}

function modelInputForKind(
  kind: GenerateMediaKind,
  prompt: string,
  model: string
): Record<string, unknown> {
  if (kind === 'image') {
    if (model.includes('flux-schnell')) {
      return {
        prompt,
        go_fast: true,
        output_format: 'png',
        aspect_ratio: '16:9',
      }
    }
    return { prompt }
  }

  if (model.includes('text2video') && model.includes('pschaldenbrand')) {
    return { prompts: prompt }
  }

  return { prompt }
}

async function fetchPrediction(token: string, url: string): Promise<ReplicatePrediction> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Replicate get failed (${res.status}): ${text.slice(0, 400)}`)
  }
  return res.json() as Promise<ReplicatePrediction>
}

async function createPrediction(
  token: string,
  body: Record<string, unknown>
): Promise<ReplicatePrediction> {
  const res = await fetch(`${REPLICATE_API}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Replicate create failed (${res.status}): ${text.slice(0, 400)}`)
  }

  return res.json() as Promise<ReplicatePrediction>
}

/**
 * Runs a Replicate model and returns a public HTTPS URL to the generated image or video.
 */
export async function generateMediaUrl(
  kind: GenerateMediaKind,
  prompt: string
): Promise<{ url: string }> {
  const token = process.env.REPLICATE_API_TOKEN?.trim()
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN is not set.')
  }

  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) {
    throw new Error('Prompt is required.')
  }

  const imageModel =
    process.env.REPLICATE_IMAGE_MODEL?.trim() || 'black-forest-labs/flux-schnell'
  const videoModel =
    process.env.REPLICATE_VIDEO_MODEL?.trim() || 'wan-video/wan-2.1-t2v-480p'

  const version = kind === 'image' ? imageModel : videoModel
  const input = modelInputForKind(kind, trimmedPrompt, version)

  let prediction = await createPrediction(token, { version, input })
  const deadline = Date.now() + 180_000

  let pollUrl =
    prediction.urls?.get ?? `${REPLICATE_API}/predictions/${encodeURIComponent(prediction.id)}`

  while (prediction.status === 'starting' || prediction.status === 'processing') {
    if (Date.now() > deadline) {
      throw new Error('Generation timed out.')
    }
    await sleep(2000)
    prediction = await fetchPrediction(token, pollUrl)
    pollUrl =
      prediction.urls?.get ?? `${REPLICATE_API}/predictions/${encodeURIComponent(prediction.id)}`
  }

  if (prediction.status !== 'succeeded') {
    const detail = prediction.error || prediction.status
    throw new Error(detail || 'Generation failed.')
  }

  const url = normalizeMediaUrl(prediction.output)
  if (!url) {
    throw new Error('Model returned no media URL.')
  }

  return { url }
}
