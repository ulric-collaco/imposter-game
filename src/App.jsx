import React, { useEffect, useState, useRef } from 'react'
import { supabase } from './supabaseClient'

function useAuth() {
  const [user, setUser] = useState(null)
  useEffect(() => {
    let mounted = true
    // getSession returns the full session (access/refresh tokens handled internally)
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      const session = data?.session
      setUser(session?.user ?? null)
      // clear tokens from the URL (they are returned in the hash after OAuth)
      try {
        if (window && window.location && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname)
        }
      } catch (e) {
        // ignore in environments without history
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => { mounted = false; sub?.subscription?.unsubscribe?.() }
  }, [])
  return user
}

function AuthPanel() {
  const user = useAuth()
  const signIn = async () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  const signOut = async () => supabase.auth.signOut()
  if (!user) return <button onClick={signIn} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">Sign in</button>
  return (
    <div className="flex items-center gap-3">
      <img src={user.user_metadata?.avatar_url || user.user_metadata?.picture} alt="avatar" className="w-8 h-8 rounded-full" />
      <div className="text-sm hidden sm:block">{user.user_metadata?.full_name || user.email}</div>
      <button onClick={signOut} className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-sm">Sign out</button>
    </div>
  )
}

function PlayerList({ players, meId, showReadyButtons, onToggleReady, activeIds, presenceSynced }) {
  // Only consider players that have explicitly joined (joined_at set).
  const joinedPlayers = (players || []).filter(p => !!p.joined_at)

  if (joinedPlayers.length === 0) {
    return <div className="text-gray-400">No one has joined the game yet.</div>
  }

  // If presence has synced AND there are known active connections, indicate online/offline.
  // We still show the joined players list (so people who joined but are disconnected still appear as offline).
  return (
    <div className="space-y-2">
      {joinedPlayers.map(p => {
        const isActive = presenceSynced && activeIds && activeIds.size > 0 ? activeIds.has(p.id) : false
        return (
          <div key={p.id} className="flex items-center justify-between p-3 bg-gray-800 rounded">
            <div className="flex items-center gap-3">
              <div>
                <div className="font-medium">{p.name} {p.id===meId && <span className="text-xs text-gray-400">(you)</span>}</div>
                <div className="text-sm text-gray-500">{isActive ? (p.status || 'online') : 'offline'}</div>
              </div>
            </div>
            {showReadyButtons && (
              <div className="flex items-center gap-2">
                {p.ready ? <span className="text-green-400">✔ Ready</span> : <span className="text-gray-400">Not ready</span>}
                {p.id===meId && onToggleReady && <button onClick={() => onToggleReady(p)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">{p.ready? 'Unready':'Ready'}</button>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PhaseBox({ title, children }) {
  return (
    <div className="p-4 bg-gray-800 rounded">
      <h3 className="font-semibold mb-3 text-lg">{title}</h3>
      {children}
    </div>
  )
}

export default function App() {
  const user = useAuth()
  const [players, setPlayers] = useState([])
  const [activeIds, setActiveIds] = useState(new Set())
  const [presenceSynced, setPresenceSynced] = useState(false)
  const [game, setGame] = useState(null)
  const [hasJoined, setHasJoined] = useState(false)
  const presenceChannelRef = useRef(null)

  // Check if current user has joined
  useEffect(() => {
    if (user && players.length > 0) {
      const userInPlayers = players.some(p => p.id === user.id)
      setHasJoined(userInPlayers)
    } else {
      setHasJoined(false)
    }
  }, [user, players])

  // load players and subscribe
  useEffect(() => {
    let channel
    let heartbeatInterval
    
    const load = async () => {
      try {
        const { data, error } = await supabase.from('players').select('*')
        if (error) {
          console.error('players load error', error)
        } else {
          setPlayers(data || [])
        }
      } catch (e) {
        console.error('players load exception', e)
      }

      // Subscribe to players table changes so UI updates when someone joins/leaves
      channel = supabase
        .channel('public:players')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, async () => {
          try {
            const r = await supabase.from('players').select('*')
            if (r.error) console.error('players subscription fetch error', r.error)
            else setPlayers(r.data || [])
          } catch (e) {
            console.error('players subscription exception', e)
          }
        })
        .subscribe()

      // Also create a presence channel to track active websocket connections.
      // We'll use presence to show only currently connected players in the UI.
      try {
        const pch = supabase.channel('presence:players')
          .on('presence', { event: 'sync' }, () => {
            try {
              const state = pch.presenceState()
              const ids = new Set()
              Object.keys(state || {}).forEach(key => {
                const entries = state[key] || []
                entries.forEach(en => { if (en.user_id) ids.add(en.user_id) })
              })
              setActiveIds(ids)
              setPresenceSynced(true)
            } catch (e) {
              console.error('presence sync error', e)
            }
          })
          .on('presence', { event: 'diff' }, ({ oldState, newState }) => {
            try {
              const state = pch.presenceState()
              const ids = new Set()
              Object.keys(state || {}).forEach(key => {
                const entries = state[key] || []
                entries.forEach(en => { if (en.user_id) ids.add(en.user_id) })
              })
              setActiveIds(ids)
            } catch (e) {
              console.error('presence diff error', e)
            }
          })
          .subscribe()
        presenceChannelRef.current = pch
      } catch (e) {
        console.error('presence channel setup failed', e)
      }
    }
    load()

    // Heartbeat to keep player active and detect when they leave
    if (user && hasJoined) {
      const updateHeartbeat = async () => {
        try {
          // Try to update last_seen, fallback to updating joined_at if column doesn't exist
          const { error } = await supabase.from('players').update({ 
            last_seen: new Date().toISOString() 
          }).eq('id', user.id)
          
          if (error && error.message.includes('column "last_seen" does not exist')) {
            // Fallback: update joined_at as heartbeat
            await supabase.from('players').update({ 
              joined_at: new Date().toISOString() 
            }).eq('id', user.id)
          }
        } catch (e) {
          console.error('Error updating heartbeat', e)
        }
      }
      
      // Update heartbeat every 10 seconds
      heartbeatInterval = setInterval(updateHeartbeat, 10000)
      // Initial heartbeat
      updateHeartbeat()
    }

    // Cleanup function to remove player when they leave
    const handleBeforeUnload = () => {
      if (user && hasJoined) {
        // Use sendBeacon for more reliable cleanup on page unload
        const data = JSON.stringify({ user_id: user.id })
        if (navigator.sendBeacon) {
          // This is more reliable but we need a server endpoint
          // For now, use synchronous request as fallback
          try {
            supabase.from('players').delete().eq('id', user.id)
          } catch (e) {
            console.error('Error removing player on unload', e)
          }
        }
      }
    }

    // Add event listeners for when user leaves
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handleBeforeUnload)
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && user && hasJoined) {
        // User switched tabs or minimized window
        setTimeout(() => {
          if (document.visibilityState === 'hidden') {
            // Still hidden after 2 seconds, consider leaving
            // We rely on presence to remove the user from the active list.
            // Attempt best-effort untrack so presence removes this connection.
            try { presenceChannelRef.current?.untrack?.(user.id) } catch (e) { /* ignore */ }
          }
        }, 2000)
      }
    })

    return () => {
      if (channel) supabase.removeChannel(channel)
      if (presenceChannelRef.current) supabase.removeChannel(presenceChannelRef.current)
      if (heartbeatInterval) clearInterval(heartbeatInterval)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handleBeforeUnload)
      
      // Remove player when component unmounts
      if (user && hasJoined) {
        // Best-effort: untrack presence and attempt to delete the player row.
  try { presenceChannelRef.current?.untrack?.(user.id) } catch (e) { /* ignore */ }
        supabase.from('players').delete().eq('id', user.id).then().catch(console.error)
      }
    }
  }, [user, hasJoined])

  // Periodic cleanup of inactive players
  useEffect(() => {
    const cleanupInterval = setInterval(async () => {
      try {
        // Remove players who haven't been seen for more than 30 seconds
        const cutoff = new Date(Date.now() - 30000).toISOString()
        
        // Try to use last_seen column first, fallback to joined_at
        let { error } = await supabase.from('players').delete().lt('last_seen', cutoff)
        
        if (error && error.message.includes('column "last_seen" does not exist')) {
          // Fallback: use joined_at column for cleanup (less reliable but works)
          await supabase.from('players').delete().lt('joined_at', cutoff)
        }
      } catch (e) {
        console.error('Error during periodic cleanup', e)
      }
    }, 15000) // Run cleanup every 15 seconds

    return () => clearInterval(cleanupInterval)
  }, [])

  // load game_state and subscribe
  useEffect(() => {
    let channel
    const load = async () => {
      // ensure a game_state row exists (id=1). If not, create it.
      try {
        await supabase.from('game_state').insert([{ id: 1, state: 'waiting' }], { upsert: false }).then(()=>{}).catch(()=>{})
      } catch (e) { /* ignore */ }

      const { data } = await supabase.from('game_state').select('*').limit(1).single()
      setGame(data || { state: 'waiting' })

      channel = supabase
        .channel('public:game_state')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, () => {
          supabase.from('game_state').select('*').limit(1).single().then(r => setGame(r.data || { state: 'waiting' }))
        })
        .subscribe()
    }
    load()
    return () => channel && supabase.removeChannel(channel)
  }, [])

  const handleJoin = async () => {
    if (!user) return alert('Please sign in')
    const payload = {
      id: user.id,
      uid: user.id,
      name: user.user_metadata?.full_name || user.email,
      avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
      ready: false,
      joined_at: new Date().toISOString()
    }
    
    // Try to add last_seen if column exists
    try {
      payload.last_seen = new Date().toISOString()
    } catch (e) {
      // Column might not exist yet
    }
    
  // attempt to upsert the player row
    try {
      const { data, error } = await supabase.from('players').upsert(payload, { onConflict: 'id', returning: 'representation' })
      if (error) {
        console.error('upsert players error', error)
        alert('Join failed: ' + (error.message || JSON.stringify(error)))
        return
      }
      setHasJoined(true)

      // Track presence on the presence channel so other clients know we're active
      try {
        const pch = presenceChannelRef.current
        // If presence channel not set up yet, try to create a minimal one and join
        if (!pch) {
          const newPch = supabase.channel('presence:players')
          await newPch.subscribe()
          presenceChannelRef.current = newPch
        }
        // Track this connection with a unique key and payload so presenceState exposes user_id
        try {
          // Preferred: track(key, payload)
          await presenceChannelRef.current.track(user.id, { user_id: user.id, name: payload.name })
        } catch (e) {
          // Fallback older signature: track(payload)
          try { await presenceChannelRef.current.track({ user_id: user.id, name: payload.name }) } catch (err) { /* ignore */ }
        }
      } catch (e) {
        console.error('presence track failed', e)
      }

      // refresh game_state so UI reflects current phase immediately
      try {
        const { data: gs, error: gsErr } = await supabase.from('game_state').select('*').limit(1).single()
        if (!gsErr) setGame(gs || { state: 'waiting' })
        else console.warn('refresh game_state error', gsErr)
      } catch (e) {
        console.error('refresh game_state exception', e)
      }
    } catch (e) {
      console.error('upsert exception', e)
      alert('Join failed: ' + e.message)
    }
  }

  const handleLeave = async () => {
    if (!user || !hasJoined) return
    try {
  await supabase.from('players').delete().eq('id', user.id)
  try { await presenceChannelRef.current?.untrack?.(user.id) } catch (e) { /* ignore */ }
      setHasJoined(false)
    } catch (e) {
      console.error('Error leaving game', e)
    }
  }

  const toggleReady = async (p) => {
    try {
      const { data, error } = await supabase.from('players').update({ ready: !p.ready }).eq('id', p.id)
      if (error) {
        console.error('toggleReady error', error)
        alert('Unable to toggle ready: ' + (error.message || JSON.stringify(error)))
      } else {
        console.log('toggleReady result', data)
      }
    } catch (err) {
      console.error('toggleReady exception', err)
      alert('Unable to toggle ready: ' + (err.message || JSON.stringify(err)))
    }
  }

  const canStart = players.length >= 3 && hasJoined

  const startGame = async () => {
    if (!canStart) return alert('Need >=3 players and you must join the game')
    
    // Set all players as ready when game starts
    for (const p of players) {
      await supabase.from('players').update({ ready: true }).eq('id', p.id)
    }
    
    const imp = players[Math.floor(Math.random()*players.length)].id
    const qres = await supabase.from('questions').select('*').limit(1).order('id', { ascending: false })
    const question = (qres.data && qres.data[0]) || null
    for (const p of players) {
      const role = p.id === imp ? 'imposter' : 'player'
      const assigned_text = role === 'imposter' ? (question?.related_prompt || `Related hint for ${question?.id}`) : question?.prompt
      await supabase.from('player_roles').upsert({ player_id: p.id, role, assigned_text, assigned_question_id: question?.id })
    }
    await supabase.from('game_state').upsert({ id: 1, state: 'question', phase_started_at: new Date().toISOString(), imposter: imp, question_id: question?.id, results: null })
  }

  const submitAnswer = async (text) => {
    const me = user
    if (!me) return
    const roleRow = (await supabase.from('player_roles').select('*').eq('player_id', me.id).single()).data
    await supabase.from('answers').insert({ player_id: me.id, question_id: roleRow.assigned_question_id, answer: text })
    const { data: allAnswers } = await supabase.from('answers').select('*')
    const answeredPlayers = new Set((allAnswers || []).map(a => a.player_id))
    if (players.every(p => answeredPlayers.has(p.id))) {
      await supabase.from('game_state').update({ state: 'discussion', phase_started_at: new Date().toISOString(), discussion_ends_at: new Date(Date.now()+60*1000).toISOString() }).eq('id', 1)
    }
  }

  const vote = async (targetId) => {
    const me = user
    if (!me) return
    await supabase.from('votes').insert({ voter: me.id, target: targetId })
    const { data: allVotes } = await supabase.from('votes').select('*')
    if (allVotes && allVotes.length >= players.length) {
      const counts = {}
      for (const v of allVotes) counts[v.target] = (counts[v.target]||0)+1
      await supabase.from('game_state').update({ state: 'results', results: counts }).eq('id', 1)
    }
  }

  const resetGame = async () => {
    await supabase.from('answers').delete().neq('id', 0)
    await supabase.from('votes').delete().neq('id', 0)
    await supabase.from('player_roles').delete().neq('player_id', 'NULL')
    await supabase.from('game_state').upsert({ id:1, state: 'waiting', phase_started_at: null, imposter: null, question_id: null, results: null })
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 bg-gray-900 text-gray-200">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Imposter</h1>
          <AuthPanel />
        </header>

        <div className="mb-4 flex flex-wrap gap-3">
          {!hasJoined ? (
            <button onClick={handleJoin} className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded">Join Game</button>
          ) : (
            <div className="flex gap-2">
              <span className="px-4 py-2 bg-green-800 text-green-200 rounded">✓ Joined</span>
              <button onClick={handleLeave} className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded">Leave Game</button>
            </div>
          )}
          <button onClick={startGame} disabled={!canStart} className={`px-4 py-2 rounded ${canStart? 'bg-yellow-600 hover:bg-yellow-500 text-white':'bg-gray-700 text-gray-400 cursor-not-allowed'}`}>Start Game</button>
          <button onClick={resetGame} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Reset</button>
        </div>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PhaseBox title={`Phase: ${game?.state || 'waiting'}`}>
              {game?.state === 'waiting' && <div className="text-gray-400">Waiting for players to join. At least 3 players required to start the game.</div>}
              {game?.state === 'question' && <QuestionPhase submitAnswer={submitAnswer} user={user} />}
              {game?.state === 'discussion' && <DiscussionPhase endsAt={game.discussion_ends_at} />}
              {game?.state === 'voting' && <VotingPhase players={players} onVote={vote} />}
              {game?.state === 'results' && <ResultsPhase results={game.results} imposter={game.imposter} />}
            </PhaseBox>
          </div>

          <aside>
            <PhaseBox title="Players">
              <PlayerList 
                players={players} 
                meId={user?.id} 
                showReadyButtons={players.length < 3} 
                onToggleReady={players.length < 3 ? toggleReady : null}
                activeIds={activeIds}
                presenceSynced={presenceSynced}
              />
            </PhaseBox>
          </aside>
        </main>
      </div>
    </div>
  )
}

function QuestionPhase({ submitAnswer, user }) {
  const [assignedText, setAssignedText] = useState('')
  const [answer, setAnswer] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!user) return
      const { data } = await supabase.from('player_roles').select('*').eq('player_id', user.id).single()
      if (mounted) setAssignedText(data?.assigned_text || '')
    }
    load()
    return () => { mounted = false }
  }, [user])

  const onSubmit = async () => {
    if (!answer) return
    await submitAnswer(answer)
  }

  return (
    <div>
      <div className="mb-2 text-gray-400">Your prompt:</div>
      <div className="p-3 bg-gray-700 rounded mb-4">{assignedText || '...'}</div>
      <textarea value={answer} onChange={e=>setAnswer(e.target.value)} className="w-full p-2 border-gray-600 bg-white text-black rounded mb-3" placeholder="Your answer..." />
      <button onClick={onSubmit} className="w-full px-3 py-2 bg-indigo-700 hover:bg-indigo-600 text-white rounded">Submit Answer</button>
    </div>
  )
}

function DiscussionPhase({ endsAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(()=>setNow(Date.now()), 500)
    return ()=>clearInterval(t)
  }, [])
  const remaining = endsAt ? Math.max(0, new Date(endsAt).getTime() - now) : 0
  return (
    <div>
      <div className="mb-2 text-gray-400">Discuss with other players to find the imposter.</div>
      <div className="text-2xl font-medium text-center p-4 bg-gray-700 rounded">Time left: {Math.ceil(remaining/1000)}s</div>
    </div>
  )
}

function VotingPhase({ players, onVote }) {
  return (
    <div>
      <div className="mb-3 text-gray-400">Who is the imposter?</div>
      <div className="space-y-2">
        {players.map(p => (
          <div key={p.id} className="flex justify-between items-center p-2 bg-gray-700 rounded">
            <div className="flex items-center gap-3">{p.name}</div>
            <button onClick={()=>onVote(p.id)} className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white rounded">Vote</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultsPhase({ results, imposter }) {
  return (
    <div>
      <div className="mb-2 text-gray-400">Vote Results:</div>
      <pre className="p-3 bg-gray-700 rounded text-white">{JSON.stringify(results, null, 2)}</pre>
      <div className="mt-4 text-lg">The Imposter was: <span className="font-bold">{imposter}</span></div>
    </div>
  )
}
