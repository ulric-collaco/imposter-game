import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, supabaseUrl, supabaseKey } from '../supabaseClient'

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
  const [countdownTime, setCountdownTime] = useState(null) // Countdown timer in seconds

  // refs
  const roomCodeRef = useRef(null)
  const playerNameRef = useRef('')
  const isLeaderRef = useRef(false)
  const discussionTimerRef = useRef(null)
  const countdownIntervalRef = useRef(null)
  const countdownCheckRef = useRef(null)

  // Helpers
  const nowIso = () => new Date().toISOString()
  const randId = () => 'p_' + Math.random().toString(36).slice(2, 10)
  
  // Generate a unique device ID that persists only in memory (not across refreshes)
  const deviceIdRef = useRef(null)
  const getDeviceId = () => {
    if (!deviceIdRef.current) {
      // Generate new device ID (memory only - not persisted)
      deviceIdRef.current = 'd_' + Math.random().toString(36).slice(2, 15) + Date.now().toString(36)
    }
    return deviceIdRef.current
  }

  // Determine leader: smallest player id among active room players
  const computeLeader = useCallback((list) => {
    if (!Array.isArray(list) || list.length === 0) return false
    const sorted = [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)))
    return sorted[0]?.id === myPlayerId
  }, [myPlayerId])

  // Countdown timer management
  const startCountdown = useCallback(async (roomCode) => {
    if (!isLeaderRef.current) return
    
    const startTime = new Date().toISOString()
    await supabase
      .from('games')
      .update({ 
        countdown_started_at: startTime,
        countdown_paused_at: null,
        countdown_remaining_ms: 5000,
        updated_at: nowIso()
      })
      .eq('room_code', roomCode)
    
    console.log('Countdown started:', startTime)
  }, [])

  const pauseCountdown = useCallback(async (roomCode, remainingMs) => {
    if (!isLeaderRef.current) return
    
    await supabase
      .from('games')
      .update({ 
        countdown_paused_at: new Date().toISOString(),
        countdown_remaining_ms: remainingMs,
        updated_at: nowIso()
      })
      .eq('room_code', roomCode)
    
    console.log('Countdown paused with', remainingMs, 'ms remaining')
  }, [])

  const resumeCountdown = useCallback(async (roomCode, remainingMs) => {
    if (!isLeaderRef.current) return
    
    await supabase
      .from('games')
      .update({ 
        countdown_started_at: new Date().toISOString(),
        countdown_paused_at: null,
        countdown_remaining_ms: remainingMs,
        updated_at: nowIso()
      })
      .eq('room_code', roomCode)
    
    console.log('Countdown resumed with', remainingMs, 'ms remaining')
  }, [])

  const stopCountdown = useCallback(async (roomCode) => {
    if (!isLeaderRef.current) return
    
    await supabase
      .from('games')
      .update({ 
        countdown_started_at: null,
        countdown_paused_at: null,
        countdown_remaining_ms: 5000,
        updated_at: nowIso()
      })
      .eq('room_code', roomCode)
    
    setCountdownTime(null)
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    if (countdownCheckRef.current) {
      clearInterval(countdownCheckRef.current)
      countdownCheckRef.current = null
    }
    
    console.log('Countdown stopped')
  }, [])

  // Check countdown state and manage timer
  const updateCountdownDisplay = useCallback((game) => {
    if (!game) return

    const { countdown_started_at, countdown_paused_at, countdown_remaining_ms } = game
    
    // Clear existing interval
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    
    if (countdown_paused_at) {
      // Countdown is paused
      const remaining = Math.max(0, Math.ceil((countdown_remaining_ms || 5000) / 1000))
      setCountdownTime(remaining)
      console.log('Countdown paused at', remaining, 'seconds')
      return
    }
    
    if (countdown_started_at) {
      // Countdown is active
      const startTime = new Date(countdown_started_at).getTime()
      const totalMs = countdown_remaining_ms || 5000
      
      const updateTimer = () => {
        const now = Date.now()
        const elapsed = now - startTime
        const remaining = Math.max(0, totalMs - elapsed)
        const remainingSeconds = Math.ceil(remaining / 1000)
        
        setCountdownTime(remainingSeconds)
        
        if (remaining <= 0 && isLeaderRef.current) {
          // Countdown complete, start game
          clearInterval(countdownIntervalRef.current)
          countdownIntervalRef.current = null
          startGame()
        }
      }
      
      updateTimer()
      countdownIntervalRef.current = setInterval(updateTimer, 100)
    } else {
      // No countdown active
      setCountdownTime(null)
    }
  }, [isLeaderRef])

  // Periodically check ready states and manage countdown
  const checkReadyStatesAndCountdown = useCallback(async (roomCode, playersList) => {
    if (!isLeaderRef.current || !roomCode) return
    
    const activePlayers = playersList.filter(p => p.joined_at)
    
    // Need at least 3 players for countdown
    if (activePlayers.length < 3) {
      // Stop any existing countdown
      const { data: currentGame } = await supabase
        .from('games')
        .select('countdown_started_at, countdown_paused_at')
        .eq('room_code', roomCode)
        .single()
      
      if (currentGame?.countdown_started_at || currentGame?.countdown_paused_at) {
        await stopCountdown(roomCode)
      }
      return
    }
    
    const allReady = activePlayers.every(p => p.ready)
    const anyNotReady = activePlayers.some(p => !p.ready)
    
    // Get current countdown state
    const { data: currentGame } = await supabase
      .from('games')
      .select('countdown_started_at, countdown_paused_at, countdown_remaining_ms, phase')
      .eq('room_code', roomCode)
      .single()
    
    if (!currentGame || currentGame.phase !== 'waiting') return
    
    const isCountdownActive = !!currentGame.countdown_started_at && !currentGame.countdown_paused_at
    const isCountdownPaused = !!currentGame.countdown_paused_at
    
    if (allReady && !isCountdownActive && !isCountdownPaused) {
      // Start countdown
      await startCountdown(roomCode)
    } else if (anyNotReady && (isCountdownActive || isCountdownPaused)) {
      // Someone unreadied, pause countdown if active or stop if was paused
      if (isCountdownActive) {
        const startTime = new Date(currentGame.countdown_started_at).getTime()
        const elapsed = Date.now() - startTime
        const remaining = Math.max(0, (currentGame.countdown_remaining_ms || 5000) - elapsed)
        await pauseCountdown(roomCode, remaining)
      } else {
        // Was paused, just keep it paused (state already correct)
      }
    } else if (allReady && isCountdownPaused) {
      // Resume countdown
      await resumeCountdown(roomCode, currentGame.countdown_remaining_ms || 5000)
    }
  }, [startCountdown, pauseCountdown, resumeCountdown, stopCountdown])

  // Clean up orphaned rooms (games with no active players)
  const cleanupOrphanedRooms = useCallback(async () => {
    try {
      // Get all game rooms
      const { data: allGames, error: gErr } = await supabase
        .from('games')
        .select('room_code')
      
      if (gErr || !allGames || allGames.length === 0) return

      // Check each room for any players (active or not)
      for (const game of allGames) {
        const { data: remainingPlayers } = await supabase
          .from('players')
          .select('id')
          .eq('room_code', game.room_code)
        
        // If no players at all, delete the room completely
        if (!remainingPlayers || remainingPlayers.length === 0) {
          console.log(`Cleaning up orphaned room: ${game.room_code}`)
          await Promise.all([
            supabase.from('games').delete().eq('room_code', game.room_code),
            supabase.from('messages').delete().eq('room_code', game.room_code),
            supabase.from('votes').delete().eq('room_code', game.room_code),
            supabase.from('answers').delete().eq('room_code', game.room_code)
          ])
        }
      }
    } catch (e) {
      console.error('Cleanup orphaned rooms failed:', e)
    }
  }, [])

  const loadInitialData = useCallback(async (roomCode) => {
    try {
      // First, clean up orphaned rooms (games with no active players)
      await cleanupOrphanedRooms()
      
      // players
      const { data: pData, error: pErr } = await supabase
        .from('players')
        .select('id,name,ready,is_active,created_at,joined_at')
        .eq('room_code', roomCode)
        .eq('is_active', true) // Only load active players
        .order('created_at', { ascending: true })
      if (pErr) throw pErr
      const mappedPlayers = (pData || []).map(p => ({
        id: p.id,
        name: p.name,
        joined_at: p.joined_at || p.created_at,
        is_active: p.is_active,
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
          countdown_started_at: game.countdown_started_at || null,
          countdown_paused_at: game.countdown_paused_at || null,
          countdown_remaining_ms: game.countdown_remaining_ms || 5000,
          votesReceived: 0,
          totalPlayers: mappedPlayers.length,
          results: game.results || null,
          imposter: game.imposter_id || null,
        })
        updateCountdownDisplay(game)
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
      
      // Start countdown check interval if leader
      if (leader && mappedPlayers.length >= 3) {
        if (countdownCheckRef.current) {
          clearInterval(countdownCheckRef.current)
        }
        countdownCheckRef.current = setInterval(() => {
          checkReadyStatesAndCountdown(code, mappedPlayers)
        }, 500)
      }
    } catch (e) {
      console.error('Initial load failed', e)
      setError(e?.message || 'Failed initial load')
      setConnectionStatus('error')
    }
  }, [computeLeader, updateCountdownDisplay, checkReadyStatesAndCountdown])

  // Subscriptions per-room
  const setupSubscriptions = useCallback((roomCode) => {
    // Players
    const playersChannel = supabase
      .channel(`players-room-${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_code=eq.${roomCode}` }, (payload) => {
        console.log('👥 Player event received:', payload.eventType, payload)
        setPlayers(prev => {
          let next = [...prev]
          const row = payload.new || payload.old
          if (payload.eventType === 'INSERT') {
            // Only add if active
            if (row.is_active) {
              console.log('➕ Adding player:', row.name)
              next = [...next, { id: row.id, name: row.name, joined_at: row.joined_at || row.created_at, is_active: row.is_active, ready: !!row.ready }]
            }
          } else if (payload.eventType === 'UPDATE') {
            if (row.is_active) {
              // Update if exists, or add if becoming active
              const exists = next.some(p => p.id === row.id)
              if (exists) {
                console.log('🔄 Updating player:', row.name)
                next = next.map(p => p.id === row.id ? { ...p, name: row.name, joined_at: row.joined_at || p.joined_at, is_active: row.is_active, ready: !!row.ready } : p)
              } else {
                console.log('➕ Adding active player:', row.name)
                next = [...next, { id: row.id, name: row.name, joined_at: row.joined_at || row.created_at, is_active: row.is_active, ready: !!row.ready }]
              }
            } else {
              // Remove if becoming inactive
              console.log('➖ Removing inactive player:', row.name)
              next = next.filter(p => p.id !== row.id)
            }
          } else if (payload.eventType === 'DELETE') {
            console.log('🗑️ Deleting player:', row?.name || row?.id, 'Current players:', prev.length)
            const beforeLength = next.length
            next = next.filter(p => p.id !== row.id)
            console.log(`Filtered from ${beforeLength} to ${next.length} players`)
          }
          // update leader
          const newLeader = computeLeader(next)
          const wasLeader = isLeaderRef.current
          isLeaderRef.current = newLeader
          
          // If became leader, start managing countdown
          if (newLeader && !wasLeader) {
            if (countdownCheckRef.current) clearInterval(countdownCheckRef.current)
            countdownCheckRef.current = setInterval(() => {
              checkReadyStatesAndCountdown(roomCode, next)
            }, 500)
          }
          
          // Check ready states and manage countdown (leader only)
          if (isLeaderRef.current) {
            checkReadyStatesAndCountdown(roomCode, next)
          }
          
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
          countdown_started_at: g.countdown_started_at || null,
          countdown_paused_at: g.countdown_paused_at || null,
          countdown_remaining_ms: g.countdown_remaining_ms || 5000,
          results: g.results || null,
          imposter: g.imposter_id || null,
        }))
        updateCountdownDisplay(g)
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
      if (countdownCheckRef.current) {
        clearInterval(countdownCheckRef.current)
        countdownCheckRef.current = null
      }
    }
  }, [computeLeader, updateCountdownDisplay, checkReadyStatesAndCountdown])

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
    
    // Clear countdown state before starting
    await stopCountdown(roomCode)
    
    await transitionPhase('question', { 
      imposter_id: imposterId, 
      question_id: 1,
      countdown_started_at: null,
      countdown_paused_at: null,
      countdown_remaining_ms: 5000
    })
    // Immediately move to discussion phase (to match previous UX)
    await transitionPhase('discussion')
  }, [players, transitionPhase, stopCountdown])

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
        case 'create_room': {
          const name = payload.playerName?.trim()
          const code = (payload.roomCode || '').trim()
          if (!name || !/^\d{3}$/.test(code)) throw new Error('Invalid create room payload')

          // Get unique device ID
          const deviceId = getDeviceId()

          // Check globally if this name is already taken by ANY player
          const { data: globalNameCheck, error: gnErr } = await supabase
            .from('players')
            .select('id, name, room_code, device_id')
            .ilike('name', name)
          
          if (gnErr) throw gnErr

          const nameTakenGlobally = globalNameCheck?.some(p => 
            p.name.toLowerCase() === name.toLowerCase()
          )

          if (nameTakenGlobally) {
            throw new Error(`The name "${name}" is already taken. Please choose a different name.`)
          }

          // Check if room already exists
          const { data: existingRoom } = await supabase
            .from('games')
            .select('room_code, player_count')
            .eq('room_code', code)
            .single()

          if (existingRoom && existingRoom.player_count > 0) {
            throw new Error(`Room ${code} already exists. Try a different code or join the existing room.`)
          }

          // Create new room
          await supabase.from('games').upsert({ 
            room_code: code, 
            phase: 'waiting',
            player_count: 0,
            updated_at: nowIso(),
            created_at: nowIso()
          }, { onConflict: 'room_code' })

          // Generate player ID
          const id = randId()
          roomCodeRef.current = code
          playerNameRef.current = name

          console.log('Creating room and joining:', { name, code, id, deviceId })

          // Insert player
          const { error: pErr } = await supabase.from('players').insert({
            id,
            name,
            room_code: code,
            device_id: deviceId,
            ready: false,
            is_active: true,
            last_seen: nowIso(),
            created_at: nowIso(),
            updated_at: nowIso(),
            joined_at: nowIso(),
          })
          
          if (pErr) {
            if (pErr.message?.includes('duplicate key') || pErr.code === '23505') {
              throw new Error(`The name "${name}" was just taken by someone else. Please choose a different name.`)
            }
            throw pErr
          }
          
          setMyPlayerId(id)
          setJoinedSuccessfully(true)
          setError(null)

          // Update player count
          await supabase
            .from('games')
            .update({ player_count: 1, updated_at: nowIso() })
            .eq('room_code', code)

          // Load initial data and subscribe
          await loadInitialData(code)
          const cleanup = setupSubscriptions(code)
          window.__roomCleanup && window.__roomCleanup()
          window.__roomCleanup = cleanup
          
          return true
        }
        case 'join': {
          const name = payload.playerName?.trim()
          const code = (payload.roomCode || '').trim()
          if (!name || !/^\d{3}$/.test(code)) throw new Error('Invalid join payload')

          // Get unique device ID
          const deviceId = getDeviceId()

          // Check if room exists
          const { data: roomCheck } = await supabase
            .from('games')
            .select('room_code, player_count, phase')
            .eq('room_code', code)
            .single()

          if (!roomCheck) {
            throw new Error(`Room ${code} does not exist. Please check the code or create a new room.`)
          }

          // First, check globally if this name is already taken by ANY player
          const { data: globalNameCheck, error: gnErr } = await supabase
            .from('players')
            .select('id, name, room_code, device_id')
            .ilike('name', name) // Case-insensitive match
          
          if (gnErr) throw gnErr

          // Check if name is taken by someone else globally
          const nameTakenGlobally = globalNameCheck?.some(p => 
            p.name.toLowerCase() === name.toLowerCase()
          )

          if (nameTakenGlobally) {
            throw new Error(`The name "${name}" is already taken globally. Please choose a different name.`)
          }

          // Check if this device is already in this specific room
          const { data: existingPlayers, error: checkErr } = await supabase
            .from('players')
            .select('name, id, device_id')
            .eq('room_code', code)
          
          if (checkErr) throw checkErr

          // Check if this device already has a player in this room
          const devicePlayer = existingPlayers?.find(p => p.device_id === deviceId)
          if (devicePlayer) {
            // This device is already in the room, reconnect to that player
            console.log('Reconnecting to existing player:', devicePlayer)
            const id = devicePlayer.id
            setMyPlayerId(id)
            roomCodeRef.current = code
            playerNameRef.current = devicePlayer.name
            setJoinedSuccessfully(true)
            setError(null) // Clear any previous errors
            
            // Update last_seen timestamp
            await supabase
              .from('players')
              .update({ last_seen: nowIso(), updated_at: nowIso() })
              .eq('id', id)
            
            await loadInitialData(code)
            const cleanup = setupSubscriptions(code)
            window.__roomCleanup && window.__roomCleanup()
            window.__roomCleanup = cleanup
            return true
          }

          // Generate new player ID
          const id = randId()

          // Ensure room code is set
          roomCodeRef.current = code
          playerNameRef.current = name

          console.log('Joining room:', { 
            name, 
            code, 
            id,
            deviceId,
            existingPlayers: existingPlayers?.map(p => ({ name: p.name, id: p.id, device_id: p.device_id }))
          })

          // Insert player with device_id (using INSERT to let unique constraint catch conflicts)
          const { error: pErr } = await supabase.from('players').insert({
            id,
            name,
            room_code: code,
            device_id: deviceId,
            ready: false,
            is_active: true,
            last_seen: nowIso(),
            created_at: nowIso(),
            updated_at: nowIso(),
            joined_at: nowIso(),
          })
          
          if (pErr) {
            // Check if it's a unique constraint violation
            if (pErr.message?.includes('duplicate key') || pErr.code === '23505') {
              throw new Error(`The name "${name}" was just taken by someone else. Please choose a different name.`)
            }
            throw pErr
          }
          
          setMyPlayerId(id)
          setJoinedSuccessfully(true)

          // Ensure a games row exists and increment player count
          const { data: existingGame } = await supabase
            .from('games')
            .select('player_count')
            .eq('room_code', code)
            .single()
          
          const newPlayerCount = (existingGame?.player_count || 0) + 1
          
          await supabase.from('games').upsert({ 
            room_code: code, 
            phase: 'waiting',
            player_count: newPlayerCount,
            updated_at: nowIso(),
            created_at: nowIso()
          }, { onConflict: 'room_code' })

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
          
          console.log('🚪 Leaving room:', { roomCode, myPlayerId })
          
          // Clean up subscriptions FIRST to avoid receiving our own delete events
          if (window.__roomCleanup) { 
            window.__roomCleanup()
            window.__roomCleanup = null 
          }
          
          // Clear countdown intervals
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current)
            countdownIntervalRef.current = null
          }
          if (countdownCheckRef.current) {
            clearInterval(countdownCheckRef.current)
            countdownCheckRef.current = null
          }
          
          // Delete player completely (not just mark inactive)
          // This will trigger DELETE events for other clients' subscriptions
          const { error: delError } = await supabase.from('players').delete().eq('id', myPlayerId)
          if (delError) {
            console.error('Failed to delete player:', delError)
          } else {
            console.log('✅ Player deleted successfully')
          }
          
          // Also delete their votes, answers, and messages
          await Promise.all([
            supabase.from('votes').delete().eq('player_id', myPlayerId).eq('room_code', roomCode),
            supabase.from('answers').delete().eq('player_id', myPlayerId).eq('room_code', roomCode),
            supabase.from('messages').delete().eq('player_id', myPlayerId).eq('room_code', roomCode)
          ])
          
          // Decrement player count
          const { data: currentGame } = await supabase
            .from('games')
            .select('player_count')
            .eq('room_code', roomCode)
            .single()
          
          const newPlayerCount = Math.max(0, (currentGame?.player_count || 1) - 1)
          
          if (newPlayerCount === 0) {
            // Room is empty, delete all room data
            console.log(`🗑️ Room ${roomCode} is empty, deleting all room data...`)
            await Promise.all([
              supabase.from('games').delete().eq('room_code', roomCode),
              supabase.from('messages').delete().eq('room_code', roomCode),
              supabase.from('votes').delete().eq('room_code', roomCode),
              supabase.from('answers').delete().eq('room_code', roomCode)
            ])
          } else {
            // Update player count
            await supabase
              .from('games')
              .update({ player_count: newPlayerCount, updated_at: nowIso() })
              .eq('room_code', roomCode)
            console.log(`📊 Updated player count to ${newPlayerCount}`)
          }
          
          // Clear local state AFTER all database operations
          setJoinedSuccessfully(false)
          setMyPlayerId(null)
          setPlayers([]) // Clear players list
          setMessages([]) // Clear messages
          setGameState({ state: 'waiting' }) // Reset game state
          setCountdownTime(null) // Clear countdown
          setError(null) // Clear errors
          
          roomCodeRef.current = null
          playerNameRef.current = ''
          
          console.log('✅ Left room successfully')
          return true
        }
        case 'toggle_ready': {
          if (!roomCode || !myPlayerId) return false
          // fetch current
          const me = players.find(p => p.id === myPlayerId)
          const nextReady = !me?.ready
          await supabase.from('players').update({ ready: nextReady, updated_at: nowIso() }).eq('id', myPlayerId)
          
          // Leader handles countdown logic via subscription updates
          // No need to manually check here - the subscription will trigger checkReadyStatesAndCountdown
          
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
            // Clear old game data
            await Promise.all([
              supabase.from('votes').delete().eq('room_code', roomCode),
              supabase.from('answers').delete().eq('room_code', roomCode),
              supabase.from('messages').delete().eq('room_code', roomCode)
            ])
            
            // Reset all players to not ready
            await supabase.from('players')
              .update({ ready: false, updated_at: nowIso() })
              .eq('room_code', roomCode)
              .eq('is_active', true)
            
            // Stop countdown
            await stopCountdown(roomCode)
            
            // Reset game state
            await transitionPhase('waiting', { 
              results: null, 
              imposter_id: null, 
              question_id: null, 
              discussion_ends_at: null,
              countdown_started_at: null,
              countdown_paused_at: null,
              countdown_remaining_ms: 5000
            })
          }
          return true
        }
        case 'clear_all_tables': {
          // Testing only - clears all data from all tables
          console.log('⚠️ CLEARING ALL TABLES')
          try {
            // Delete all data from all tables using gte (greater than or equal)
            // This effectively deletes all rows since IDs/timestamps are always >= their minimum values
            const results = await Promise.allSettled([
              supabase.from('players').delete().gte('created_at', '2000-01-01'),
              supabase.from('games').delete().gte('created_at', '2000-01-01'),
              supabase.from('votes').delete().gte('created_at', '2000-01-01'),
              supabase.from('messages').delete().gte('created_at', '2000-01-01'),
              supabase.from('answers').delete().gte('created_at', '2000-01-01')
            ])
            
            // Check for any errors
            const errors = results.filter(r => r.status === 'rejected')
            if (errors.length > 0) {
              console.error('Some deletions failed:', errors)
            }
            
            // Clear local state
            setPlayers([])
            setMessages([])
            setGameState({ state: 'waiting' })
            setCountdownTime(null)
            setJoinedSuccessfully(false)
            setMyPlayerId(null)
            setError(null)
            
            roomCodeRef.current = null
            playerNameRef.current = ''
            
            // Clean up subscriptions
            if (window.__roomCleanup) {
              window.__roomCleanup()
              window.__roomCleanup = null
            }
            
            // Clear countdown intervals
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current)
              countdownIntervalRef.current = null
            }
            if (countdownCheckRef.current) {
              clearInterval(countdownCheckRef.current)
              countdownCheckRef.current = null
            }
            
            console.log('✅ All tables cleared successfully')
            return true
          } catch (e) {
            console.error('Failed to clear tables:', e)
            setError('Failed to clear tables: ' + e.message)
            return false
          }
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
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      if (countdownCheckRef.current) clearInterval(countdownCheckRef.current)
      if (window.__roomCleanup) { window.__roomCleanup(); window.__roomCleanup = null }
    }
  }, [])

  // Handle page unload/tab close - delete player to free username
  useEffect(() => {
    const handleBeforeUnload = async () => {
      const roomCode = roomCodeRef.current
      const playerId = myPlayerId
      
      if (roomCode && playerId) {
        console.log('Tab closing - cleaning up player:', playerId)
        
        // Clear ALL session storage so user starts fresh next time
        try {
          sessionStorage.removeItem('imposter_game_player_name')
          sessionStorage.removeItem('imposter_game_room_code')
          sessionStorage.removeItem('imposter_game_device_id')
        } catch (e) {
          // Ignore errors
        }
        
        // Delete player to free username
        const url = `${supabaseUrl}/rest/v1/players?id=eq.${playerId}`
        const headers = {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
        
        // Use fetch with keepalive (reliable for cleanup on page unload)
        try {
          fetch(url, {
            method: 'DELETE',
            headers: headers,
            keepalive: true
          }).catch(() => {
            // Silently fail - page is closing anyway
          })
        } catch (e) {
          console.error('Cleanup failed:', e)
        }
      }
    }
    
    // Handle both beforeunload and pagehide for better browser compatibility
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handleBeforeUnload)
    }
  }, [myPlayerId])

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
    countdownTime, // Countdown timer in seconds (null if not active)
  }
}
