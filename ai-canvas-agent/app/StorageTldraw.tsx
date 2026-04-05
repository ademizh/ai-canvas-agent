'use client'

import { useMemo } from 'react'
import { useSelf } from '@liveblocks/react/suspense'
import { Tldraw } from 'tldraw'
import { useStorageStore } from './useStorageStore'

export function StorageTldraw({
  onMount,
  licenseKey,
}: {
  onMount?: (editor: any) => void
  licenseKey?: string
}) {
  const id = useSelf((me) => me.id)
  const info = useSelf((me) => me.info)

  const user = useMemo(
    () => ({
      id,
      color: info?.color || 'red',
      name: info?.name || 'Guest',
    }),
    [id, info?.color, info?.name]
  )

  const store = useStorageStore({ user })

  if (store.status === 'loading') {
    return <div style={{ height: '100%', width: '100vw' }}>Loading canvas…</div>
  }

  return (
    <div style={{ height: '100%', width: '100vw' }}>
      <Tldraw
        store={store.store}
        licenseKey={licenseKey}
        onMount={onMount}
        autoFocus
      />
    </div>
  )
}