'use client'

import type { ReactNode } from 'react'
import { LiveList, LiveMap } from '@liveblocks/client'
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from '@liveblocks/react/suspense'

export function Room({ children }: { children: ReactNode }) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id="hacknu-room"
        initialPresence={{ presence: null }}
        initialStorage={{
          records: new LiveMap<string, any>(),
          conversationHistory: new LiveList([]),
          sessionEvents: new LiveList([]),
        }}
      >
        <ClientSideSuspense fallback={<div>Loading…</div>}>
          {children}
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  )
}