import { NextResponse } from 'next/server'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const url = searchParams.get('url')

        if (!url) {
            return new NextResponse('Missing url', { status: 400 })
        }

        const range = req.headers.get('range')

        const upstream = await fetch(url, {
            headers: range ? { Range: range } : undefined,
        })

        if (!upstream.ok && upstream.status !== 206) {
            return new NextResponse('Failed to fetch media', { status: 502 })
        }

        const headers = new Headers()
        const contentType =
            upstream.headers.get('content-type') || 'application/octet-stream'

        headers.set('Content-Type', contentType)

        const contentLength = upstream.headers.get('content-length')
        if (contentLength) headers.set('Content-Length', contentLength)

        const contentRange = upstream.headers.get('content-range')
        if (contentRange) headers.set('Content-Range', contentRange)

        const acceptRanges = upstream.headers.get('accept-ranges')
        if (acceptRanges) headers.set('Accept-Ranges', acceptRanges)
        else headers.set('Accept-Ranges', 'bytes')

        headers.set('Cache-Control', 'public, max-age=3600')

        return new NextResponse(upstream.body, {
            status: upstream.status,
            headers,
        })
    } catch (error) {
        console.error('[media-proxy]', error)
        return new NextResponse('Proxy failed', { status: 500 })
    }
}