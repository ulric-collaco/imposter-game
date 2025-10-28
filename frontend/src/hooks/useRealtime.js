import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// Supabase-only realtime hook that emulates the previous useWebSocket API
// Contract
// Inputs: none at init; room is provided via sendMessage('join', { playerName, roomCode })
// State exposed: connectionStatus, gameState, players, messages, error, joinedSuccessfully, myPlayerId
// Methods: sendMessage(type, payload) with types: join, leave, toggle_ready, submit_answer, vote, new_game, chat|chat_message

export function useRealtime() {
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [gameState, setGameState] = useState({ state: 'waiting' })
  const [players, setPlayers] = useState([])
  const [messages, setMessages] = useState([])
  const [error, setError] = useState(null)
  const [joinedSuccessfully, setJoinedSuccessfully] = useState(false)
  const [myPlayerId, setMyPlayerId] = useState(null)

  // refs
  const roomCodeRef = useRef(null)
  const playerNameRef = useRef('')
  const isLeaderRef = useRef(false)
  const discussionTimerRef = useRef(null)

  // Helpers
  const nowIso = () => new Date().toISOString()
  const randId = () => 'p_' + Math.random().toString(36).slice(2, 10)

  // Determine leader: smallest player id among active room players
  const computeLeader = useCallback((list) => {
    if (!Array.isArray(list) || list.length === 0) return false
    const sorted = [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)))
    return sorted[0]?.id === myPlayerId
  }, [myPlayerId])

  const loadInitialData = useCallback(async (roomCode) => {
    try {
      // players
      const { data: pData, error: pErr } = await supabase
        .from('players')
        .select('id,name,ready,is_active,created_at')
        .eq('room_code', roomCode)
        .order('created_at', { ascending: true })
      if (pErr) throw pErr
      const mappedPlayers = (pData || []).map(p => ({
        id: p.id,
        name: p.name,
        joined_at: p.created_at,
        isActive: p.is_active,
        ready: !!p.ready,
      }))
      setPlayers(mappedPlayers)

      // games (one row per room)
      const { data: gData, error: gErr } = await supabase
        .from('games')
        .select('*')
        .eq('room_code', roomCode)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (gErr) throw gErr
      const game = gData && gData[0]
      if (game) {
        setGameState({
          state: game.phase || 'waiting',
          phase: game.phase || 'waiting',
          questionId: game.question_id || null,
          discussion_ends_at: game.discussion_ends_at || null,
          votesReceived: 0,
          totalPlayers: mappedPlayers.length,
          results: game.results || null,
          imposter: game.imposter_id || null,
        })
      } else {
        setGameState({ state: 'waiting', phase: 'waiting', totalPlayers: mappedPlayers.length })
      }

      // messages (recent)
      const { data: mData, error: mErr } = await supabase
        .from('messages')
        .select('id,player_id,player_name,message,created_at')
        .eq('room_code', roomCode)
        .order('created_at', { ascending: true })
        .limit(200)
      if (mErr) throw mErr
      const mappedMessages = (mData || []).map(m => ({
        id: m.id,
        playerId: m.player_id,
        playerName: m.player_name,
        message: m.message,
        timestamp: new Date(m.created_at).getTime(),
      }))
      setMessages(mappedMessages)

      // establish connection status
      setConnectionStatus('connected')

      // leader election
      const leader = computeLeader(mappedPlayers)
      isLeaderRef.current = leader
    } catch (e) {
      console.error('Initial load failed', e)
      setError(e?.message || 'Failed initial load')
      setConnectionStatus('error')
    }
  }, [computeLeader])

  // Subscriptions per-room
  const setupSubscriptions = useCallback((roomCode) => {
    // Players
    const playersChannel = supabase
      .channel(`players-room-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_code=eq.${roomCode}` }, (payload) => {
        setPlayers(prev => {
          let next = [...prev]
          const row = payload.new || payload.old
          if (payload.eventType === 'INSERT') {
            next = [...next, { id: row.id, name: row.name, joined_at: row.created_at, isActive: row.is_active, ready: !!row.ready }]
          } else if (payload.eventType === 'UPDATE') {
            next = next.map(p => p.id === row.id ? { ...p, name: row.name, isActive: row.is_active, ready: !!row.ready } : p)
          } else if (payload.eventType === 'DELETE') {
            next = next.filter(p => p.id !== row.id)
          }
          // update leader
          isLeaderRef.current = computeLeader(next)
          // update totals
          setGameState(gs => ({ ...gs, totalPlayers: next.length }))
          return next
        })
      })
      .subscribe()

    // Games
    const gamesChannel = supabase
      .channel(`games-room-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `room_code=eq.${roomCode}` }, (payload) => {
        const g = payload.new
        if (!g) return
        setGameState(prev => ({
          ...prev,
          state: g.phase || 'waiting',
          phase: g.phase || 'waiting',
          questionId: g.question_id || null,
          discussion_ends_at: g.discussion_ends_at || null,
          results: g.results || null,
          imposter: g.imposter_id || null,
        }))
      })
      .subscribe()

    // Votes (for progress only)
    const votesChannel = supabase
      .channel(`votes-room-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `room_code=eq.${roomCode}` }, async () => {
        const { data, error: vErr } = await supabase
          .from('votes')
          .select('id')
          .eq('room_code', roomCode)
        if (!vErr) {
          setGameState(prev => ({ ...prev, votesReceived: data?.length || 0 }))
        }
      })
      .subscribe()

    // Messages
    const messagesChannel = supabase
      .channel(`messages-room-${roomCode}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_code=eq.${roomCode}` }, (payload) => {
        const m = payload.new
        setMessages(prev => ([...prev, { id: m.id, playerId: m.player_id, playerName: m.player_name, message: m.message, timestamp: new Date(m.created_at).getTime() }]))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(playersChannel)
      supabase.removeChannel(gamesChannel)
      supabase.removeChannel(votesChannel)
      supabase.removeChannel(messagesChannel)
    }
  }, [computeLeader])

  // Phase helpers (leader only executes writes)
  const transitionPhase = useCallback(async (phase, fields = {}) => {
    const roomCode = roomCodeRef.current
    if (!roomCode) return
    try {
      // upsert games row for room
      const update = {
        room_code: roomCode,
        phase,
        updated_at: nowIso(),
        ...fields,
      }
      const { error: err } = await supabase.from('games').upsert(update, { onConflict: 'room_code' })
      if (err) throw err

      // setup local timers for discussion auto-advance
      if (phase === 'discussion') {
        if (discussionTimerRef.current) {
          clearTimeout(discussionTimerRef.current)
        }
        const endsAt = new Date(Date.now() + 120000).toISOString()
        await supabase.from('games').update({ discussion_ends_at: endsAt, updated_at: nowIso() }).eq('room_code', roomCode)
        discussionTimerRef.current = setTimeout(async () => {
          if (isLeaderRef.current) {
            await transitionPhase('voting')
          }
        }, 120000)
      }
      if (phase === 'voting') {
        if (discussionTimerRef.current) {
          clearTimeout(discussionTimerRef.current)
        }
      }
    } catch (e) {
      console.error('Phase transition failed', e)
      setError(e?.message || 'Phase transition failed')
    }
  }, [])

  const startGame = useCallback(async () => {
    const roomCode = roomCodeRef.current
    if (!roomCode) return
    // choose imposter randomly among current players
    const active = players
    if (!active || active.length < 2) return
    const randomIndex = Math.floor(Math.random() * active.length)
    const imposterId = active[randomIndex].id
    await transitionPhase('question', { imposter_id: imposterId, question_id: 1 })
    // Immediately move to discussion phase (to match previous UX)
    await transitionPhase('discussion')
  }, [players, transitionPhase])

  const computeAndFinishResults = useCallback(async () => {
    const roomCode = roomCodeRef.current
    if (!roomCode) return
    try {
      // fetch current votes
      const { data: votes, error: vErr } = await supabase
        .from('votes')
        .select('target_id')
        .eq('room_code', roomCode)
      if (vErr) throw vErr
      const counts = {}
      for (const v of votes || []) {
        counts[v.target_id] = (counts[v.target_id] || 0) + 1
      }
      // fetch game for imposter
      const { data: gData, error: gErr } = await supabase
        .from('games')
        .select('imposter_id')
        .eq('room_code', roomCode)
        .limit(1)
      if (gErr) throw gErr
      const imposterId = gData?.[0]?.imposter_id || null
      // most voted
      let mostVoted = null
      let maxVotes = 0
      Object.entries(counts).forEach(([pid, c]) => { if (c > maxVotes) { maxVotes = c; mostVoted = pid } })
      const playersWon = mostVoted && imposterId ? mostVoted === String(imposterId) : false
      const results = { voteCounts: counts, mostVotedPlayer: mostVoted, imposter: imposterId, playersWon, totalVotes: (votes||[]).length }
      await transitionPhase('results', { results })
      // auto-return to waiting
      setTimeout(async () => {
        if (isLeaderRef.current) {
          await transitionPhase('waiting', { results: null, imposter_id: null, question_id: null, discussion_ends_at: null })
          // clear votes/messages optional: leave as history
        }
      }, 30000)
    } catch (e) {
      console.error('Finish results failed', e)
      setError(e?.message || 'Failed to compute results')
    }
  }, [transitionPhase])

  // Public sendMessage API
  const sendMessage = useCallback(async (type, payload) => {
    const ts = Date.now()
    const roomCode = roomCodeRef.current
    try {
      switch (type) {
        case 'join': {
          const id = payload.playerId || randId()
          const name = payload.playerName?.trim()
          const code = (payload.roomCode || '').trim()
          if (!name || !/^\d{3}$/.test(code)) throw new Error('Invalid join payload')

          // Ensure room code is set
          roomCodeRef.current = code
          playerNameRef.current = name

          // Upsert player
          const { error: pErr } = await supabase.from('players').upsert({
            id,
            name,
            room_code: code,
            ready: false,
            is_active: true,
            last_seen: nowIso(),
            created_at: nowIso(),
            updated_at: nowIso(),
          })
          if (pErr) throw pErr
          setMyPlayerId(id)
          setJoinedSuccessfully(true)

          // Ensure a games row exists
          await supabase.from('games').upsert({ room_code: code, phase: 'waiting', updated_at: nowIso() }, { onConflict: 'room_code' })

          // Load initial + subscribe
          await loadInitialData(code)
          const cleanup = setupSubscriptions(code)
          // Attach cleanup to ref so we can leave later
          window.__roomCleanup && window.__roomCleanup()
          window.__roomCleanup = cleanup
          return true
        }
        case 'leave': {
          if (!roomCode || !myPlayerId) return false
          await supabase.from('players').update({ is_active: false, updated_at: nowIso() }).eq('id', myPlayerId)
          setJoinedSuccessfully(false)
          if (window.__roomCleanup) { window.__roomCleanup(); window.__roomCleanup = null }
          return true
        }
        case 'toggle_ready': {
          if (!roomCode || !myPlayerId) return false
          // fetch current
          const me = players.find(p => p.id === myPlayerId)
          const nextReady = !me?.ready
          await supabase.from('players').update({ ready: nextReady, updated_at: nowIso() }).eq('id', myPlayerId)
          // if everyone ready and leader, start game
          const after = players.map(p => p.id === myPlayerId ? { ...p, ready: nextReady } : p)
          const allReady = after.length >= 2 && after.every(p => p.ready)
          if (allReady && isLeaderRef.current) {
            await startGame()
          }
          return true
        }
        case 'chat':
        case 'chat_message': {
          if (!roomCode || !myPlayerId) return false
          const message = payload.message?.slice(0, 500)
          if (!message) return false
          await supabase.from('messages').insert({
            room_code: roomCode,
            player_id: myPlayerId,
            player_name: playerNameRef.current || 'Anonymous',
            message,
            created_at: nowIso(),
          })
          return true
        }
        case 'submit_answer': {
          if (!roomCode || !myPlayerId) return false
          await supabase.from('answers').insert({
            room_code: roomCode,
            player_id: myPlayerId,
            answer: payload.answer,
            question_id: gameState?.questionId || 1,
            created_at: nowIso(),
          })
          return true
        }
        case 'vote': {
          if (!roomCode || !myPlayerId) return false
          await supabase.from('votes').insert({
            room_code: roomCode,
            player_id: myPlayerId,
            target_id: payload.targetId,
            created_at: nowIso(),
          })
          // if all voted and leader, compute results
          const total = players.length
          const { data: vCount } = await supabase.from('votes').select('id', { count: 'exact', head: true }).eq('room_code', roomCode)
          const votesReceived = vCount?.length || 0 // head:true returns no rows; fallback handled below
          // Alternative precise count
          const { count, error: cErr } = await supabase.from('votes').select('*', { count: 'exact', head: true }).eq('room_code', roomCode)
          if (!cErr && typeof count === 'number' && count >= total && isLeaderRef.current) {
            await computeAndFinishResults()
          }
          return true
        }
        case 'new_game': {
          if (!roomCode) return false
          // reset back to waiting (leader performs)
          if (isLeaderRef.current) {
            await transitionPhase('waiting', { results: null, imposter_id: null, question_id: null, discussion_ends_at: null })
          }
          return true
        }
        default:
          console.warn('Unknown message type', type)
          return false
      }
    } catch (e) {
      console.error('sendMessage error', type, e)
      setError(e?.message || 'Action failed')
      return false
    }
  }, [players, myPlayerId, gameState, loadInitialData, setupSubscriptions, startGame, computeAndFinishResults, transitionPhase])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (discussionTimerRef.current) clearTimeout(discussionTimerRef.current)
      if (window.__roomCleanup) { window.__roomCleanup(); window.__roomCleanup = null }
    }
  }, [])

  return {
    connectionStatus,
    gameState,
    players,
    messages,
    error,
    sendMessage,
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting',
    joinedSuccessfully,
    myPlayerId,
  }
}
