'use client'

import { useEffect, useState } from 'react'
import { useRoom } from '@liveblocks/react/suspense'
import {
  computed,
  createPresenceStateDerivation,
  createTLStore,
  react,
  defaultShapeUtils,
  DocumentRecordType,
  InstancePresenceRecordType,
  PageRecordType,
  type IndexKey,
  type TLAnyShapeUtilConstructor,
  type TLDocument,
  type TLInstancePresence,
  type TLPageId,
  type TLRecord,
  type TLStoreEventInfo,
  type TLStoreWithStatus,
} from 'tldraw'

export function useStorageStore({
  shapeUtils = [],
  user,
}: Partial<{
  shapeUtils: TLAnyShapeUtilConstructor[]
  user: {
    id: string
    color: string
    name: string
  }
}>) {
  const room = useRoom()

  const [store] = useState(() => {
    return createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    })
  })

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: 'loading',
  })

  useEffect(() => {
    const unsubs: Array<() => void> = []
    let cancelled = false

    async function setup() {
      try {
        const { root } = await room.getStorage()

        let liveRecords = root.get('records')
        if (!liveRecords) {
          room.batch(() => {
            root.set('records', new Map() as any)
          })

          const refreshed = await room.getStorage()
          liveRecords = refreshed.root.get('records')
        }

        if (!liveRecords) {
          throw new Error('Liveblocks storage "records" was not initialized.')
        }

        store.mergeRemoteChanges(() => {
          store.put(
            [
              DocumentRecordType.create({
                id: 'document:document' as TLDocument['id'],
              }),
              PageRecordType.create({
                id: 'page:page' as TLPageId,
                name: 'Page 1',
                index: 'a1' as IndexKey,
              }),
              ...[...liveRecords.values()],
            ],
            'initialize'
          )
        })

        unsubs.push(
          store.listen(
            ({ changes }: TLStoreEventInfo) => {
              room.batch(() => {
                Object.values(changes.added).forEach((record) => {
                  liveRecords.set(record.id, record as any)
                })

                Object.values(changes.updated).forEach(([_, record]) => {
                  liveRecords.set(record.id, record as any)
                })

                Object.values(changes.removed).forEach((record) => {
                  liveRecords.delete(record.id)
                })
              })
            },
            { source: 'user', scope: 'document' }
          )
        )

        function syncStoreWithPresence({ changes }: TLStoreEventInfo) {
          room.batch(() => {
            Object.values(changes.added).forEach((record) => {
              room.updatePresence({ [record.id]: record } as any)
            })

            Object.values(changes.updated).forEach(([_, record]) => {
              room.updatePresence({ [record.id]: record } as any)
            })

            Object.values(changes.removed).forEach((record) => {
              room.updatePresence({ [record.id]: null } as any)
            })
          })
        }

        unsubs.push(
          store.listen(syncStoreWithPresence, {
            source: 'user',
            scope: 'session',
          })
        )

        unsubs.push(
          store.listen(syncStoreWithPresence, {
            source: 'user',
            scope: 'presence',
          })
        )

        unsubs.push(
          room.subscribe(
            liveRecords,
            (storageChanges) => {
              const toRemove: TLRecord['id'][] = []
              const toPut: TLRecord[] = []

              for (const update of storageChanges) {
                if (update.type !== 'LiveMap') continue

                for (const [id, value] of Object.entries(update.updates)) {
                  switch (value.type) {
                    case 'delete': {
                      toRemove.push(id as TLRecord['id'])
                      break
                    }
                    case 'update': {
                      const curr = update.node.get(id)
                      if (curr) {
                        toPut.push(curr as unknown as TLRecord)
                      }
                      break
                    }
                  }
                }
              }

              store.mergeRemoteChanges(() => {
                if (toRemove.length) store.remove(toRemove)
                if (toPut.length) store.put(toPut)
              })
            },
            { isDeep: true }
          )
        )

        const userPreferences = computed<{
          id: string
          color: string
          name: string
        }>('userPreferences', () => {
          if (!user) {
            throw new Error('Failed to get user')
          }

          return {
            id: user.id,
            color: user.color,
            name: user.name,
          }
        })

        const connectionIdString = String(room.getSelf()?.connectionId ?? 0)

        const presenceDerivation = createPresenceStateDerivation(
          userPreferences,
          InstancePresenceRecordType.createId(connectionIdString)
        )(store)

        room.updatePresence({
          presence: presenceDerivation.get() ?? null,
        } as any)

        unsubs.push(
          react('when presence changes', () => {
            const presence = presenceDerivation.get() ?? null

            requestAnimationFrame(() => {
              room.updatePresence({ presence } as any)
            })
          })
        )

        unsubs.push(
          room.subscribe('others', (others, event) => {
            const toRemove: TLInstancePresence['id'][] = []
            const toPut: TLInstancePresence[] = []

            switch (event.type) {
              case 'leave': {
                if (event.user.connectionId) {
                  toRemove.push(
                    InstancePresenceRecordType.createId(
                      String(event.user.connectionId)
                    )
                  )
                }
                break
              }

              case 'reset': {
                others.forEach((other) => {
                  toRemove.push(
                    InstancePresenceRecordType.createId(
                      String(other.connectionId)
                    )
                  )
                })
                break
              }

              case 'enter':
              case 'update': {
                const presence = event.user?.presence as any
                if (presence?.presence) {
                  toPut.push(presence.presence as TLInstancePresence)
                }
                break
              }
            }

            store.mergeRemoteChanges(() => {
              if (toRemove.length) store.remove(toRemove)
              if (toPut.length) store.put(toPut)
            })
          })
        )

        if (!cancelled) {
          setStoreWithStatus({
            status: 'synced-remote',
            store,
            connectionStatus: 'online',
          })
        }
      } catch (error) {
        console.error('useStorageStore setup failed:', error)
      }
    }

    setup()

    return () => {
      cancelled = true
      unsubs.forEach((fn) => fn())
    }
  }, [room, store, user?.id, user?.color, user?.name])

  return storeWithStatus
}