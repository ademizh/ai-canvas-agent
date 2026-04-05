import { Liveblocks } from '@liveblocks/node'

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY!,
})

export async function POST() {
  const userId = 'user-' + Math.random().toString(36).slice(2, 9)

  const session = liveblocks.prepareSession(userId, {
    userInfo: {
      name: 'Aisana',
      color: 'violet',
      avatar: '',
    },
  })

  session.allow('hacknu-room', session.FULL_ACCESS)

  const { status, body } = await session.authorize()
  return new Response(body, { status })
}