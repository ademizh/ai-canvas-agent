type GenerateMediaKind = 'image' | 'video'

type HiggsfieldSubmitResponse = {
    status: string
    request_id: string
    status_url: string
    cancel_url?: string
}

function getEnv(name: string) {
    const value = process.env[name]?.trim()
    if (!value) {
        throw new Error(`Missing required env var: ${name}`)
    }
    return value
}

function getAuthHeader() {
    const key = getEnv('HIGGSFIELD_API_KEY')
    const secret = getEnv('HIGGSFIELD_API_SECRET')
    return `Key ${key}:${secret}`
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function getModelId(kind: GenerateMediaKind) {
    return kind === 'image'
        ? getEnv('HIGGSFIELD_IMAGE_MODEL_ID')
        : getEnv('HIGGSFIELD_VIDEO_MODEL_ID')
}

function buildSubmitUrl(kind: GenerateMediaKind) {
    const base = getEnv('HIGGSFIELD_BASE_URL').replace(/\/$/, '')
    const modelId = getModelId(kind)
    return `${base}/${modelId}`
}

function extractFinalUrl(data: any): string | undefined {
    return (
        data?.url ||
        data?.output_url ||
        data?.result_url ||
        data?.result?.url ||
        data?.output?.url ||
        data?.output?.[0]?.url ||
        data?.output?.[0] ||
        data?.images?.[0]?.url ||
        data?.videos?.[0]?.url ||
        data?.video?.url
    )
}

export async function generateMediaUrl(
    kind: GenerateMediaKind,
    prompt: string
): Promise<{ url: string }> {
    if (!prompt.trim()) {
        throw new Error('Prompt is required.')
    }

    const submitRes = await fetch(buildSubmitUrl(kind), {
        method: 'POST',
        headers: {
            Authorization: getAuthHeader(),
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            prompt,
            aspect_ratio: process.env.HIGGSFIELD_ASPECT_RATIO || '16:9',
            resolution: process.env.HIGGSFIELD_RESOLUTION || '720p',
        }),
    })

    if (!submitRes.ok) {
        const text = await submitRes.text()
        throw new Error(`Higgsfield submit failed: ${submitRes.status} ${text}`)
    }

    const submitData = (await submitRes.json()) as HiggsfieldSubmitResponse

    if (!submitData.status_url) {
        throw new Error('Higgsfield did not return status_url.')
    }

    const maxAttempts = Number(process.env.HIGGSFIELD_POLL_ATTEMPTS || 40)
    const delayMs = Number(process.env.HIGGSFIELD_POLL_INTERVAL_MS || 2000)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const statusRes = await fetch(submitData.status_url, {
            method: 'GET',
            headers: {
                Authorization: getAuthHeader(),
                Accept: 'application/json',
            },
        })

        if (!statusRes.ok) {
            const text = await statusRes.text()
            throw new Error(`Higgsfield status failed: ${statusRes.status} ${text}`)
        }

        const statusData = await statusRes.json()
        const status = String(statusData?.status || '').toLowerCase()

        console.log('[higgsfield] final status response:', JSON.stringify(statusData, null, 2))

        if (
            status === 'completed' ||
            status === 'succeeded' ||
            status === 'success'
        ) {
            const url = extractFinalUrl(statusData)

            if (!url) {
                throw new Error(
                    'Generation completed but no media URL was found in the status response.'
                )
            }

            return { url }
        }

        if (
            status === 'failed' ||
            status === 'error' ||
            status === 'cancelled' ||
            status === 'canceled'
        ) {
            throw new Error(
                statusData?.error ||
                `Higgsfield generation ended with status "${status}".`
            )
        }

        await sleep(delayMs)
    }

    throw new Error('Timed out waiting for Higgsfield generation.')
}

export type { GenerateMediaKind }