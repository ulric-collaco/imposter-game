import { useMemo } from 'react'

export function ResultsDisplay(props) {
  const voteResults = props.voteResults || {}
  const imposter = props.imposter
  const players = props.players || []
  
  // Calculate vote tallies and determine outcome
  const gameAnalysis = useMemo(() => {
    // Convert vote results to array format for easier processing
    const voteTallies = Object.entries(voteResults).map(([playerId, voteCount]) => {
      const player = players.find(p => p.id === playerId)
      return {
        playerId,
        playerName: player?.name || 'Unknown Player',
        voteCount: voteCount || 0,
        isImposter: playerId === imposter
      }
    })
    
    // Sort by vote count (highest first)
    voteTallies.sort((a, b) => b.voteCount - a.voteCount)
    
    // Determine the player with most votes (could be tied)
    const maxVotes = voteTallies.length > 0 ? voteTallies[0].voteCount : 0
    const mostVotedPlayers = voteTallies.filter(p => p.voteCount === maxVotes)
    
    // Determine game outcome
    let outcome = 'tie'
    let outcomeMessage = 'The vote ended in a tie!'
    
    if (mostVotedPlayers.length === 1) {
      const votedOutPlayer = mostVotedPlayers[0]
      if (votedOutPlayer.isImposter) {
        outcome = 'players_win'
        outcomeMessage = `Players win! The imposter ${votedOutPlayer.playerName} was successfully voted out!`
      } else {
        outcome = 'imposter_wins'
        outcomeMessage = `Imposter wins! An innocent player ${votedOutPlayer.playerName} was voted out.`
      }
    } else if (mostVotedPlayers.length > 1) {
      // Check if imposter is among tied players
      const imposterInTie = mostVotedPlayers.some(p => p.isImposter)
      if (imposterInTie) {
        outcome = 'imposter_wins'
        outcomeMessage = 'Imposter wins! The vote was tied and the imposter survived.'
      } else {
        outcome = 'imposter_wins'
        outcomeMessage = 'Imposter wins! The vote was tied and no one was eliminated.'
      }
    }
    
    return {
      voteTallies,
      mostVotedPlayers,
      outcome,
      outcomeMessage,
      totalVotes: Object.values(voteResults).reduce((sum, count) => sum + count, 0)
    }
  }, [voteResults, imposter, players])
  
  // Find imposter player info
  const imposterPlayer = players.find(p => p.id === imposter)
  
  // Get outcome styling
  const getOutcomeStyle = (outcome) => {
    switch (outcome) {
      case 'players_win':
        return 'bg-green-900/30 border-green-600 text-green-400'
      case 'imposter_wins':
        return 'bg-red-900/30 border-red-600 text-red-400'
      default:
        return 'bg-yellow-900/30 border-yellow-600 text-yellow-400'
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Game Outcome Banner */}
      <div className={`p-6 rounded-lg border-2 text-center ${getOutcomeStyle(gameAnalysis.outcome)}`}>
        <h2 className="text-2xl font-bold mb-2">
          {gameAnalysis.outcome === 'players_win' ? '🎉 Players Win!' : 
           gameAnalysis.outcome === 'imposter_wins' ? '😈 Imposter Wins!' : 
           '🤝 Tie Game!'}
        </h2>
        <p className="text-lg">{gameAnalysis.outcomeMessage}</p>
      </div>
      
      {/* Imposter Reveal */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold text-white mb-4 text-center">
          🎭 Imposter Revealed
        </h3>
        <div className="flex items-center justify-center space-x-4 p-4 bg-red-900/20 border border-red-600 rounded-lg">
          {imposterPlayer?.avatar_url && (
            <img 
              src={imposterPlayer.avatar_url} 
              alt={`${imposterPlayer.name} avatar`}
              className="w-16 h-16 rounded-full border-2 border-red-500"
            />
          )}
          <div className="text-center">
            <div className="text-2xl font-bold text-red-400">
              {imposterPlayer?.name || 'Unknown'}
            </div>
            <div className="text-sm text-gray-400">was the imposter</div>
          </div>
        </div>
      </div>
      
      {/* Vote Tally Results */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-xl font-semibold text-white mb-4">
          📊 Vote Results
        </h3>
        
        {gameAnalysis.voteTallies.length === 0 ? (
          <div className="text-center text-gray-400 py-4">
            No votes were cast
          </div>
        ) : (
          <div className="space-y-3">
            {gameAnalysis.voteTallies.map((result, index) => (
              <div 
                key={result.playerId}
                className={`flex items-center justify-between p-4 rounded-lg border ${
                  result.isImposter 
                    ? 'bg-red-900/20 border-red-600' 
                    : 'bg-gray-700 border-gray-600'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="text-lg font-bold text-gray-400">
                    #{index + 1}
                  </div>
                  <div className="flex items-center space-x-3">
                    {players.find(p => p.id === result.playerId)?.avatar_url && (
                      <img 
                        src={players.find(p => p.id === result.playerId).avatar_url} 
                        alt={`${result.playerName} avatar`}
                        className="w-10 h-10 rounded-full"
                      />
                    )}
                    <div>
                      <div className="font-medium text-white flex items-center space-x-2">
                        <span>{result.playerName}</span>
                        {result.isImposter && (
                          <span className="text-xs bg-red-600 text-white px-2 py-1 rounded">
                            IMPOSTER
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">
                      {result.voteCount}
                    </div>
                    <div className="text-sm text-gray-400">
                      {result.voteCount === 1 ? 'vote' : 'votes'}
                    </div>
                  </div>
                  
                  {/* Vote percentage bar */}
                  <div className="w-24 bg-gray-600 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        result.isImposter ? 'bg-red-500' : 'bg-blue-500'
                      }`}
                      style={{ 
                        width: `${gameAnalysis.totalVotes > 0 
                          ? (result.voteCount / gameAnalysis.totalVotes) * 100 
                          : 0}%` 
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        <div className="mt-4 text-center text-sm text-gray-400">
          Total votes cast: {gameAnalysis.totalVotes}
        </div>
      </div>
      
      {/* Game Over - Players must leave and rejoin for a new game */}
      <div className="text-center p-4 bg-gray-800 rounded-lg border border-gray-700">
        <p className="text-gray-300 mb-2">
          🎮 Game Over! To play again, leave the room and join a new game.
        </p>
        <p className="text-sm text-gray-400">
          Click the "Leave" button to exit this room.
        </p>
      </div>
    </div>
  )
}