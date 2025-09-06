import React, { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'

function useAuth() {
  const [user, setUser] = useState(null)
  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(r => { if (mounted) setUser(r.data.user) })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => { mounted = false; sub?.subscription?.unsubscribe?.() }
  }, [])
  return user
}

function AuthPanel() {
  const user = useAuth()
  const signIn = async () => supabase.auth.signInWithOAuth({ provider: 'google' })
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

function PlayerList({ players, meId, onToggleReady }) {
  return (
    <div className="space-y-2">
      {players.map(p => (
        <div key={p.id} className="flex items-center justify-between p-3 bg-gray-800 rounded">
          <div className="flex items-center gap-3">
            <img src={p.avatar_url} className="w-10 h-10 rounded-full" alt="avatar" />
            <div>
              <div className="font-medium">{p.name} {p.id===meId && <span className="text-xs text-gray-400">(you)</span>}</div>
              <div className="text-sm text-gray-500">{p.status}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {p.ready ? <span className="text-green-400">✔ Ready</span> : <span className="text-gray-400">Not ready</span>}
            {p.id===meId && <button onClick={() => onToggleReady(p)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">{p.ready? 'Unready':'Ready'}</button>}
          </div>
        </div>
      ))}
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
  const [game, setGame] = useState(null)

  // load players and subscribe
  useEffect(() => {
    let channel
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
    }
    load()
    return () => channel && supabase.removeChannel(channel)
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
      avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || ''
    }
    console.log('handleJoin payload', payload)
    try {
      const { data, error } = await supabase.from('players').upsert(payload, { onConflict: 'id', returning: 'representation' })
      if (error) {
        console.error('upsert players error', error)
        alert('Join failed: ' + (error.message || JSON.stringify(error)))
        return
      }
      console.log('joined player', data)

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

  const canStart = players.length >= 3 && players.every(p => p.ready)

  const startGame = async () => {
    if (!canStart) return alert('Need >=3 players and all ready')
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
          <button onClick={handleJoin} className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded">Join Game</button>
          <button onClick={startGame} disabled={!canStart} className={`px-4 py-2 rounded ${canStart? 'bg-yellow-600 hover:bg-yellow-500 text-white':'bg-gray-700 text-gray-400 cursor-not-allowed'}`}>Start Game</button>
          <button onClick={resetGame} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Reset</button>
        </div>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PhaseBox title={`Phase: ${game?.state || 'waiting'}`}>
              {game?.state === 'waiting' && <div className="text-gray-400">Waiting for players to join and ready up. At least 3 players required.</div>}
              {game?.state === 'question' && <QuestionPhase submitAnswer={submitAnswer} user={user} />}
              {game?.state === 'discussion' && <DiscussionPhase endsAt={game.discussion_ends_at} />}
              {game?.state === 'voting' && <VotingPhase players={players} onVote={vote} />}
              {game?.state === 'results' && <ResultsPhase results={game.results} imposter={game.imposter} />}
            </PhaseBox>
          </div>

          <aside>
            <PhaseBox title="Players">
              <PlayerList players={players} meId={user?.id} onToggleReady={toggleReady} />
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
            <div className="flex items-center gap-3"><img src={p.avatar_url} className="w-8 h-8 rounded-full" alt="avatar" />{p.name}</div>
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
