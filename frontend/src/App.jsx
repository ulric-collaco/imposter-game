import { useEffect, useState } from 'react'
import { useRealtime } from './hooks/useRealtime'
import { DiscussionBoard, VotingScreen, ResultsDisplay } from './components'

// No authentication: players enter a display name and 3-digit room code

function PlayerList({ players, meId, showReadyButtons, onToggleReady, activeIds, presenceSynced }) {
  // Only consider players that have explicitly joined (joined_at set).
  const joinedPlayers = (players || []).filter(p => !!p.joined_at)

  if (joinedPlayers.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400 mb-2">No players yet</div>
        <div className="text-sm text-gray-500">Be the first to join!</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {joinedPlayers.map(p => {
        const isActive = presenceSynced && activeIds && activeIds.size > 0 ? activeIds.has(p.id) : false
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
                  <span className="text-green-400 text-sm font-medium">✓ Ready</span>
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
    myPlayerId
  } = useRealtime()
  
  // Local state for UI management
  const [hasJoined, setHasJoined] = useState(false)
  
  // Use WebSocket data as primary source, fallback to local state only when disconnected
  const players = wsPlayers
  const game = wsGameState || { state: 'waiting' }
  
  // Legacy state for backward compatibility during transition
  const [activeIds] = useState(new Set())
  const [presenceSynced] = useState(false)

  // Check if current user has joined
  useEffect(() => {
  if (isConnected && joinedSuccessfully) setHasJoined(true)
  }, [isConnected, joinedSuccessfully])

  // Capture server-assigned playerId after join
  useEffect(() => {
  if (myPlayerId && !playerId) setPlayerId(myPlayerId)
  }, [myPlayerId, playerId])

  // Update activeIds based on WebSocket players for backward compatibility
  // Active IDs/presence removed in no-auth mode

  // Removed Supabase fallback

  // Removed Supabase fallback game state subscription

  const handleJoin = async () => {
    if (!playerName.trim()) return alert('Enter a name')
    const code = roomCode.trim()
    if (!/^\d{3}$/.test(code)) return alert('Enter a 3-digit room code (e.g., 123)')

    const success = await sendMessage('join', {
      playerName: playerName.trim(),
      roomCode: code
    })
    if (!success) {
      alert('Failed to join. Please check your connection and env settings.')
    }
  }

  const handleLeave = async () => {
    if (!hasJoined) return
    const success = await sendMessage('leave', { })
    if (success) setHasJoined(false)
  }



  const canStart = players.length >= 2 && hasJoined // Reduced to 2 for testing
  const currentPlayer = players.find(p => p.id === playerId)
  const isReady = currentPlayer?.ready || false
  const allPlayersReady = players.length > 0 && players.every(p => p.ready)
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

  const resetGame = async () => {
    // Only valid from results phase; enforced in hook
    await sendMessage('new_game', { })
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
          </div>
          
          {wsError && (
            <div className="text-red-400 text-sm mb-4 p-2 bg-red-900/20 rounded">
              Error: {wsError}
            </div>
          )}
          
          {/* Join form (no auth) */}
          <div className="flex justify-center mb-6">
            {!hasJoined ? (
              <div className="flex gap-2">
                <input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="Your name" className="px-3 py-2 rounded bg-gray-800 border border-gray-700" />
                <input value={roomCode} onChange={e=>setRoomCode(e.target.value)} placeholder="Room (3 digits)" className="px-3 py-2 rounded bg-gray-800 border border-gray-700 w-36" />
                <button onClick={handleJoin} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded">Join</button>
              </div>
            ) : (
              <div className="text-sm text-gray-300">Joined as <span className="font-semibold">{playerName}</span> • Room {roomCode || '---'}</div>
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
                {players.length < 2 ? (
                  <span className="text-gray-400">Need {2 - players.length} more player{2 - players.length !== 1 ? 's' : ''}</span>
                ) : allPlayersReady ? (
                  <span className="text-green-400">🎮 Game starting soon...</span>
                ) : (
                  <span className="text-yellow-400">Ready: {readyCount}/{players.length}</span>
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
                      Leave
                    </button>
                    {hasJoined && (
                      <button 
                        onClick={toggleReady} 
                        className={`flex-1 px-3 py-2 rounded text-sm font-medium ${
                          isReady 
                            ? 'bg-green-600 hover:bg-green-500 text-white' 
                            : 'bg-yellow-600 hover:bg-yellow-500 text-white'
                        }`}
                      >
                        {isReady ? '✓ Ready' : 'Ready Up'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Players List - Centered */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 text-center">Players</h3>
            <PlayerList 
              players={players} 
              meId={playerId} 
              showReadyButtons={game?.state === 'waiting' || game?.phase === 'waiting'} 
              onToggleReady={toggleReady}
              activeIds={activeIds}
              presenceSynced={presenceSynced}
            />
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
                  onNewGame={resetGame}
                />
              )}
            </div>
          )}

          {/* Debug/Admin Actions */}
          <div className="text-center">
            <button 
              onClick={resetGame} 
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm"
            >
              Reset Game
            </button>
          </div>
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


