import { useState } from 'react'

export function VotingScreen(props) {
  const players = props.players || []
  const onVote = props.onVote
  const votingProgress = props.votingProgress || { voted: 0, total: players.length }
  const currentUser = props.currentUser
  const disabled = props.disabled || false
  
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [hasVoted, setHasVoted] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  // Filter out current user from voting options
  const votableePlayers = players.filter(p => p.id !== currentUser?.id)

  const handlePlayerSelect = (player) => {
    if (disabled || hasVoted) return
    setSelectedPlayer(player)
    setShowConfirmation(true)
  }

  const handleConfirmVote = () => {
    if (!selectedPlayer || !onVote || hasVoted) return
    
    onVote(selectedPlayer.id)
    setHasVoted(true)
    setShowConfirmation(false)
  }

  const handleCancelVote = () => {
    setShowConfirmation(false)
    setSelectedPlayer(null)
  }

  // Calculate progress percentage
  const progressPercentage = votingProgress.total > 0 
    ? Math.round((votingProgress.voted / votingProgress.total) * 100) 
    : 0

  return (
    <div className="space-y-6">
      {/* Header with instructions */}
      <div className="text-center">
        <h3 className="text-xl font-semibold text-white mb-2">
          Who is the imposter?
        </h3>
        <p className="text-gray-400">
          Select a player you believe is the imposter and cast your vote
        </p>
      </div>

      {/* Voting Progress */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-400">Voting Progress</span>
          <span className="text-sm text-gray-400">
            {votingProgress.voted} / {votingProgress.total} votes cast
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
        <div className="text-center text-xs text-gray-500 mt-1">
          {progressPercentage}% complete
        </div>
      </div>

      {/* Player Selection Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {votableePlayers.map(player => (
          <button
            key={player.id}
            onClick={() => handlePlayerSelect(player)}
            disabled={disabled || hasVoted}
            className={`
              p-4 rounded-lg border-2 transition-all duration-200 text-left
              ${selectedPlayer?.id === player.id 
                ? 'border-red-500 bg-red-900/30' 
                : 'border-gray-600 bg-gray-800 hover:border-gray-500 hover:bg-gray-700'
              }
              ${disabled || hasVoted 
                ? 'opacity-50 cursor-not-allowed' 
                : 'cursor-pointer'
              }
            `}
          >
            <div className="flex items-center space-x-3">
              {player.avatar_url && (
                <img 
                  src={player.avatar_url} 
                  alt={`${player.name} avatar`}
                  className="w-10 h-10 rounded-full"
                />
              )}
              <div className="flex-1">
                <div className="font-medium text-white">{player.name}</div>
                <div className="text-sm text-gray-400">
                  {player.status || 'online'}
                </div>
              </div>
              {selectedPlayer?.id === player.id && (
                <div className="text-red-400">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Vote Status */}
      {hasVoted && (
        <div className="text-center p-4 bg-green-900/30 border border-green-600 rounded-lg">
          <div className="text-green-400 font-medium">
            ✓ Vote submitted successfully
          </div>
          <div className="text-sm text-gray-400 mt-1">
            Waiting for other players to vote...
          </div>
        </div>
      )}

      {/* Empty State */}
      {votableePlayers.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          No other players available to vote for
        </div>
      )}

      {/* Vote Confirmation Modal */}
      {showConfirmation && selectedPlayer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h4 className="text-lg font-semibold text-white mb-4">
              Confirm Your Vote
            </h4>
            <p className="text-gray-300 mb-6">
              Are you sure you want to vote for{' '}
              <span className="font-medium text-red-400">{selectedPlayer.name}</span>{' '}
              as the imposter?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleConfirmVote}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Confirm Vote
              </button>
              <button
                onClick={handleCancelVote}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}