import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '@/db/db'
import { saveAsset, updateMap } from '@/db/repo'
import type { BattleMap, MapState } from '@/types'

/**
 * Local, optimistic copy of a map's live state with serialized writes.
 * External changes (reset, AI edits, other tabs) are adopted when they differ from what we wrote.
 */
export function useMapController(map: BattleMap) {
  const [state, setState] = useState<MapState>(map.state)
  const ref = useRef<MapState>(map.state)
  const lastWritten = useRef<string>(JSON.stringify(map.state))
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    const json = JSON.stringify(map.state)
    if (json !== lastWritten.current) {
      lastWritten.current = json
      ref.current = map.state
      setState(map.state)
    }
  }, [map.state])

  const commit = useCallback(
    (next: MapState | ((s: MapState) => MapState)) => {
      const value = typeof next === 'function' ? next(ref.current) : next
      ref.current = value
      setState(value)
      lastWritten.current = JSON.stringify(value)
      queue.current = queue.current.then(() => updateMap(map.id, { state: value })).catch((e) => console.error(e))
    },
    [map.id],
  )

  const commitFog = useCallback(
    async (blob: Blob) => {
      const old = ref.current.fog
      const asset = await saveAsset(blob, map.campaignId)
      commit((s) => ({ ...s, fog: asset.id }))
      // drop the previous snapshot unless the starting setup still uses it
      const fresh = await db.maps.get(map.id)
      if (old && old !== fresh?.initialState.fog) await db.assets.delete(old)
    },
    [commit, map.id, map.campaignId],
  )

  return { state, ref, commit, commitFog }
}
