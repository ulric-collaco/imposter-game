import { useEffect, useState } from 'react'
import { useRealtime } from './hooks/useRealtime'
import { DiscussionBoard, VotingScreen, ResultsDisplay } from './components'

// No authentication: players enter a display name and 3-digit room code

function PlayerList({ players, meId, showReadyButtons, onToggleReady, activeIds, presenceSynced }) {
  // Show all players who have joined (since we delete players completely on leave)
  const joinedPlayers = (players || []).filter(p => {
    const hasJoined = !!p.joined_at
    console.log('Player filter:', { name: p.name, id: p.id, joined_at: p.joined_at, hasJoined })
    return hasJoined
  })

  if (joinedPlayers.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400 mb-2">No players in room</div>
        <div className="text-sm text-gray-500">Enter a room code to join!</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {joinedPlayers.map(p => {
        const isActive = presenceSynced && activeIds && activeIds.size > 0 ? activeIds.has(p.id) : true
        const isMe = p.id === meId
        
        return (
          <div key={p.id} className={`p-3 rounded-lg border ${isMe ? 'bg-blue-900/20 border-blue-700' : 'bg-gray-700 border-gray-600'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-400' : 'bg-gray-500'}`}></div>
                <div>
                  <div className="font-medium text-white">
                    {p.name} 
                    {isMe && <span className="text-xs text-blue-400 ml-2">(you)</span>}
                  </div>
                  <div className="text-xs text-gray-400">
                    {isActive ? 'online' : 'offline'}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {p.ready ? (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-green-400 text-sm font-medium">Ready</span>
                  </div>
                ) : (
                  <span className="text-gray-400 text-sm">Not ready</span>
                )}
              </div>
            </div>
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
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [playerId, setPlayerId] = useState(null)
  const [isCreatingRoom, setIsCreatingRoom] = useState(false)
  
  // Use Supabase Realtime for real-time communication (no WebSocket server)
  const {
    connectionStatus,
    gameState: wsGameState,
    players: wsPlayers,
    messages: wsMessages,
    error: wsError,
    sendMessage,
    isConnected,
    joinedSuccessfully,
    myPlayerId,
    countdownTime // Countdown timer from hook
  } = useRealtime()
  
  // Local state for UI management
  const [hasJoined, setHasJoined] = useState(false)
  
  // Use WebSocket data as primary source, fallback to local state only when disconnected
  const players = wsPlayers
  const game = wsGameState || { state: 'waiting' }
  
  // Legacy state for backward compatibility during transition
  const [activeIds] = useState(new Set())
  const [presenceSynced] = useState(false)

  // Session storage disabled - users start fresh each time
  // This ensures usernames are freed when tabs close
  // Users must manually create/join rooms each session

  // Check if current user has joined
  useEffect(() => {
    if (isConnected && joinedSuccessfully) {
      setHasJoined(true)
    }
  }, [isConnected, joinedSuccessfully])

  // Capture server-assigned playerId after join
  useEffect(() => {
  if (myPlayerId && !playerId) setPlayerId(myPlayerId)
  }, [myPlayerId, playerId])

  const generateRoomCode = () => {
    // Generate random 3-digit code
    return Math.floor(100 + Math.random() * 900).toString()
  }

  const handleCreateRoom = async () => {
    if (!playerName.trim()) return alert('Enter your name first')
    
    setIsCreatingRoom(true)
    const newRoomCode = generateRoomCode()
    setRoomCode(newRoomCode)
    
    const success = await sendMessage('create_room', {
      playerName: playerName.trim(),
      roomCode: newRoomCode
    })
    
    setIsCreatingRoom(false)
    
    if (success) {
      console.log(`✅ Room ${newRoomCode} created successfully!`)
    } else {
      console.error('Failed to create room')
      setRoomCode('') // Clear the generated code on failure
    }
  }

  const handleJoinRoom = async () => {
    if (!playerName.trim()) return alert('Enter your name')
    const code = roomCode.trim()
    if (!/^\d{3}$/.test(code)) return alert('Enter a 3-digit room code (e.g., 123)')

    const success = await sendMessage('join', {
      playerName: playerName.trim(),
      roomCode: code
    })
    
    if (!success) {
      console.error('Failed to join room')
    }
  }

  const handleLeave = async () => {
    if (!hasJoined) return
    const success = await sendMessage('leave', { })
    if (success) {
      setHasJoined(false)
      setPlayerId(null)
      setPlayerName('')
      setRoomCode('')
    }
  }

  const handleClearAllTables = async () => {
    if (!confirm('⚠️ WARNING: This will delete ALL data from ALL tables. Are you absolutely sure?')) {
      return
    }
    
    const success = await sendMessage('clear_all_tables', {})
    if (success) {
      alert('✅ All tables cleared successfully!')
      // Reset local state
      setHasJoined(false)
      setPlayerId(null)
      setPlayerName('')
      setRoomCode('')
    } else {
      alert('❌ Failed to clear tables. Check console for errors.')
    }
  }



  const canStart = players.length >= 3 && hasJoined // Need at least 3 players for countdown
  const currentPlayer = players.find(p => p.id === playerId)
  const isReady = currentPlayer?.ready || false
  const allPlayersReady = players.length >= 3 && players.every(p => p.ready)
  const readyCount = players.filter(p => p.ready).length

  const toggleReady = async () => {
    if (!hasJoined) return alert('You must join the game first')
    await sendMessage('toggle_ready', { })
  }

  const submitAnswer = async (text) => {
    if (!playerId) return
    await sendMessage('submit_answer', { answer: text })
  }

  const vote = async (targetId) => {
    if (!playerId) return
    await sendMessage('vote', { targetId })
  }

  const handleSendChatMessage = async (message) => {
  if (!playerId || !message.trim()) return

    // Validate message length (character limit)
    if (message.length > 200) {
      alert('Message too long. Maximum 200 characters allowed.')
      return
    }
    const success = await sendMessage('chat', {
      playerId,
      playerName,
      message: message.trim(),
      timestamp: Date.now()
    })
    if (!success) {
      alert('Failed to send message. Please check your connection.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-4 max-w-2xl">
        <header className="text-center mb-6">
          <h1 className="text-3xl font-bold mb-4">Imposter Game</h1>
          
          {/* Connection Status */}
          <div className="flex items-center justify-center gap-2 text-sm mb-4">
            <div className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' : 
              connectionStatus === 'connecting' ? 'bg-yellow-500' : 
              'bg-red-500'
            }`}></div>
            <span className="text-gray-400">
              {connectionStatus === 'connected' ? 'Connected' : 
               connectionStatus === 'connecting' ? 'Connecting...' : 
               'Offline'}
            </span>
            {/* Testing Tool - Quick Access */}
            <button
              onClick={handleClearAllTables}
              className="ml-4 px-2 py-1 bg-red-900/50 hover:bg-red-900 text-red-300 rounded text-xs transition-colors border border-red-700/50"
              title="Clear all database tables (testing only)"
            >
              🗑️ Clear DB
            </button>
          </div>
          
          {wsError && (
            <div className="text-center mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg">
              <div className="text-red-400 text-sm font-medium mb-1">⚠️ Error</div>
              <div className="text-red-300 text-sm">{wsError}</div>
            </div>
          )}
          
          {/* Join form (no auth) */}
          <div className="flex justify-center mb-6">
            {!hasJoined ? (
              <div className="w-full max-w-md space-y-4">
                {/* Player Name Input */}
                <div>
                  <input 
                    value={playerName} 
                    onChange={e=>setPlayerName(e.target.value)} 
                    placeholder="Enter your name" 
                    className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    disabled={connectionStatus === 'connecting'}
                  />
                  <div className="text-xs text-gray-500 mt-1 ml-1">Choose a unique name - visible to all players</div>
                </div>

                {/* Create Room Button */}
                <button 
                  onClick={handleCreateRoom} 
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={connectionStatus === 'connecting' || isCreatingRoom || !playerName.trim()}
                >
                  {isCreatingRoom ? 'Creating Room...' : '🎮 Create New Room'}
                </button>
                {playerName.trim() && (
                  <div className="text-xs text-gray-500 text-center -mt-2">Creates a room with a random 3-digit code</div>
                )}

                {/* OR Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-700"></div>
                  <span className="text-gray-500 text-sm">OR</span>
                  <div className="flex-1 h-px bg-gray-700"></div>
                </div>

                {/* Join Existing Room */}
                <div>
                  <div className="flex gap-2">
                    <input 
                      value={roomCode} 
                      onChange={e=>setRoomCode(e.target.value)} 
                      placeholder="Room code (3 digits)" 
                      className="flex-1 px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                      maxLength={3}
                      disabled={connectionStatus === 'connecting'}
                    />
                    <button 
                      onClick={handleJoinRoom} 
                      className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={connectionStatus === 'connecting' || !playerName.trim() || !roomCode.trim()}
                    >
                      Join
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 ml-1">Enter the room code shared by your friend</div>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-sm text-gray-400 mb-1">Playing as</div>
                <div className="text-xl font-semibold text-white mb-1">{playerName}</div>
                <div className="text-sm text-gray-400">Room: <span className="text-blue-400 font-mono text-lg">{roomCode}</span></div>
              </div>
            )}
          </div>
        </header>

        {/* Phase Status Bar - Always at top */}
        <div className="mb-6 text-center">
          <div className="inline-block bg-gray-800 rounded-lg px-6 py-3 border border-gray-700">
            <div className="text-lg font-semibold text-white mb-1">
              Phase: {game?.state?.toUpperCase() || 'WAITING'}
            </div>
            {game?.state === 'waiting' && (
              <div className="text-sm">
                {players.length < 3 ? (
                  <span className="text-gray-400">Need {3 - players.length} more player{3 - players.length !== 1 ? 's' : ''} (minimum 3)</span>
                ) : countdownTime !== null ? (
                  <div className="space-y-1">
                    <div className="text-yellow-400 font-bold text-2xl animate-pulse">
                      Starting in {countdownTime}...
                    </div>
                    <div className="text-xs text-gray-400">
                      {allPlayersReady ? 'All players ready!' : 'Countdown paused - waiting for all players to be ready'}
                    </div>
                  </div>
                ) : allPlayersReady ? (
                  <span className="text-green-400">🎮 All ready - countdown starting...</span>
                ) : (
                  <span className="text-yellow-400">Ready: {readyCount}/{players.length} - Need all players ready to start</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mobile-First Layout */}
        <div className="max-w-md mx-auto space-y-6">
          
          {/* Game Actions */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="space-y-3">
              {!hasJoined ? null : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button 
                      onClick={handleLeave} 
                      className="flex-1 px-3 py-2 bg-red-700 hover:bg-red-600 text-white rounded text-sm"
                    >
                      Leave Room
                    </button>
                    {hasJoined && players.length >= 3 && (
                      <button 
                        onClick={toggleReady} 
                        className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
                          isReady 
                            ? 'bg-green-600 hover:bg-green-500 text-white' 
                            : 'bg-yellow-600 hover:bg-yellow-500 text-white'
                        }`}
                      >
                        {isReady ? '✓ Ready' : 'Ready Up'}
                      </button>
                    )}
                  </div>
                  {players.length < 3 && (
                    <div className="text-xs text-gray-400 text-center">
                      Need at least 3 players to start
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Players List - Centered */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 text-center">Players</h3>
            {!hasJoined ? (
              <div className="text-center py-8">
                <div className="text-gray-400 mb-2">Not in a room</div>
                <div className="text-sm text-gray-500">Join a room to see players</div>
              </div>
            ) : (
              <PlayerList 
                players={players} 
                meId={playerId} 
                showReadyButtons={game?.state === 'waiting' || game?.phase === 'waiting'} 
                onToggleReady={toggleReady}
                activeIds={activeIds}
                presenceSynced={presenceSynced}
              />
            )}
          </div>

          {/* Game Content */}
          {game?.state !== 'waiting' && (
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              {game?.state === 'question' && <QuestionPhase submitAnswer={submitAnswer} user={{ id: playerId }} />}
              {game?.state === 'discussion' && (
                <DiscussionPhase 
                  endsAt={game.discussion_ends_at} 
                  messages={wsMessages}
                  onSendMessage={handleSendChatMessage}
                  currentUser={{ id: playerId, user_metadata: { full_name: playerName } }}
                />
              )}
              {game?.state === 'voting' && <VotingPhase players={players} onVote={vote} user={{ id: playerId }} gameState={game} />}
              {game?.state === 'results' && (
                <ResultsDisplay 
                  voteResults={game.results?.voteCounts || {}} 
                  imposter={game.results?.imposter || game.imposter} 
                  players={players}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function QuestionPhase({ submitAnswer, user }) {
  const [answer, setAnswer] = useState('')

  const onSubmit = async () => {
    if (!answer.trim()) return
    await submitAnswer(answer.trim())
    setAnswer('')
  }

  return (
    <div>
      <div className="mb-2 text-gray-400">Provide your answer based on your role.</div>
      <textarea value={answer} onChange={e=>setAnswer(e.target.value)} className="w-full p-2 border-gray-600 bg-white text-black rounded mb-3" placeholder="Your answer..." />
      <button onClick={onSubmit} className="w-full px-3 py-2 bg-indigo-700 hover:bg-indigo-600 text-white rounded">Submit Answer</button>
    </div>
  )
}

function DiscussionPhase({ endsAt, messages, onSendMessage, currentUser }) {
  const [now, setNow] = useState(Date.now())
  
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  
  const remaining = endsAt ? Math.max(0, new Date(endsAt).getTime() - now) : 0
  const timeRemainingSeconds = Math.ceil(remaining / 1000)
  const isTimeUp = timeRemainingSeconds <= 0
  
  return (
    <div>
      <div className="mb-4 text-gray-400">
        Discuss with other players to find the imposter.
      </div>
      <DiscussionBoard
        messages={messages || []}
        onSendMessage={onSendMessage}
        timeRemaining={timeRemainingSeconds}
        currentUser={currentUser}
        disabled={isTimeUp}
      />
    </div>
  )
}

function VotingPhase({ players, onVote, user, gameState }) {
  // Extract voting progress from game state
  const votingProgress = {
    voted: gameState?.votesReceived || 0,
    total: gameState?.totalPlayers || players.length
  }

  return (
    <VotingScreen
      players={players}
      onVote={onVote}
      votingProgress={votingProgress}
      currentUser={user}
      disabled={false}
    />
  )
}


