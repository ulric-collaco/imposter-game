const { createClient } = require('@supabase/supabase-js');

class GameManager {
  constructor(supabaseClient, broadcastCallback) {
    this.supabase = supabaseClient;
    this.broadcast = broadcastCallback;
    this.gameState = {
      phase: 'waiting',
      players: [],
      imposter: null,
      questionId: null,
      discussionEndsAt: null,
      votes: [],
      results: null
    };
    this.phaseTimer = null;
    this.discussionDuration = 120000; // 2 minutes in milliseconds
    this.votingTimeout = 60000; // 1 minute timeout for voting
  }

  async initializeGame() {
    try {
      // Load current game state from database (if available)
      const table = this.supabase?.from?.('games');
      let gameData = null;
      let error = null;
      if (table && typeof table.select === 'function') {
        const res = await table
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        gameData = res?.data || null;
        error = res?.error || null;
      }

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        if (error.code === 'PGRST205') {
          console.warn('Games table does not exist. Using default game state.');
          return;
        }
        throw error;
      }

      if (gameData) {
        this.gameState.phase = gameData.phase || 'waiting';
        this.gameState.questionId = gameData.question_id;
        this.gameState.imposter = gameData.imposter_id;
      }

      console.log('GameManager initialized with phase:', this.gameState.phase);
    } catch (error) {
      console.error('Error initializing game:', error);
      console.log('Continuing with default game state...');
      // Continue with default state if database fails
    }
  }

  async transitionPhase(newPhase, additionalData = {}) {
    try {
      const previousPhase = this.gameState.phase;
      this.gameState.phase = newPhase;

      // Clear existing timer
      if (this.phaseTimer) {
        clearTimeout(this.phaseTimer);
        this.phaseTimer = null;
      }

      // Handle phase-specific logic
      switch (newPhase) {
        case 'question':
          await this.handleQuestionPhase(additionalData);
          break;
        case 'discussion':
          await this.handleDiscussionPhase();
          break;
        case 'voting':
          await this.handleVotingPhase();
          break;
        case 'results':
          await this.handleResultsPhase();
          break;
        case 'waiting':
          await this.handleWaitingPhase();
          break;
      }

      // Update database
      await this.updateGameStateInDatabase();

      // Broadcast phase change to all clients
      this.broadcast({
        type: 'phase_change',
        payload: {
          phase: newPhase,
          previousPhase,
          gameState: this.getPublicGameState(),
          timestamp: Date.now()
        },
        timestamp: Date.now()
      });

      console.log(`Phase transitioned from ${previousPhase} to ${newPhase}`);
    } catch (error) {
      console.error('Error transitioning phase:', error);
      throw error;
    }
  }

  async handleQuestionPhase(data) {
    if (data.questionId) {
      this.gameState.questionId = data.questionId;
    }
    if (data.imposter) {
      this.gameState.imposter = data.imposter;
    }
  }

  async handleDiscussionPhase() {
    // Set discussion end time
    this.gameState.discussionEndsAt = new Date(Date.now() + this.discussionDuration);
    
    // Start discussion timer
    this.phaseTimer = setTimeout(() => {
      this.transitionPhase('voting');
    }, this.discussionDuration);

    // Broadcast discussion timer updates every 5 seconds
    this.startDiscussionTimer();
  }

  async handleVotingPhase() {
    // Clear votes from previous round
    this.gameState.votes = [];
    this.gameState.discussionEndsAt = null;

    // Set voting timeout
    this.phaseTimer = setTimeout(() => {
      // Auto-transition to results if voting takes too long
      this.transitionPhase('results');
    }, this.votingTimeout);
  }

  async handleResultsPhase() {
    // Calculate results
    this.gameState.results = this.calculateVoteResults();
    
    // Auto-transition back to waiting after 30 seconds
    this.phaseTimer = setTimeout(() => {
      this.transitionPhase('waiting');
    }, 30000);
  }

  async handleWaitingPhase() {
    // Reset game state
    this.gameState.imposter = null;
    this.gameState.questionId = null;
    this.gameState.votes = [];
    this.gameState.results = null;
    this.gameState.discussionEndsAt = null;
  }

  startDiscussionTimer() {
    const updateInterval = setInterval(() => {
      if (this.gameState.phase !== 'discussion' || !this.gameState.discussionEndsAt) {
        clearInterval(updateInterval);
        return;
      }

      const timeRemaining = Math.max(0, this.gameState.discussionEndsAt.getTime() - Date.now());
      
      this.broadcast({
        type: 'discussion_timer',
        payload: {
          timeRemaining,
          discussionEndsAt: this.gameState.discussionEndsAt.toISOString()
        },
        timestamp: Date.now()
      });

      if (timeRemaining <= 0) {
        clearInterval(updateInterval);
      }
    }, 5000); // Update every 5 seconds
  }

  async handleVote(playerId, targetId) {
    // Validate voting state
    if (this.gameState.phase !== 'voting') {
      throw new Error('Voting is not currently active');
    }

    // Check if player already voted
    const existingVote = this.gameState.votes.find(vote => vote.playerId === playerId);
    if (existingVote) {
      throw new Error('Player has already voted');
    }

    // Add vote in memory
    const vote = {
      playerId,
      targetId,
      timestamp: new Date()
    };
    this.gameState.votes.push(vote);

    // Best-effort: record vote in database if API is available
    try {
      const table = this.supabase?.from?.('votes');
      if (table && typeof table.insert === 'function') {
        await table.insert({
          player_id: playerId,
          target_id: targetId,
          game_id: await this.getCurrentGameId()
        });
      }
    } catch (dbError) {
      // Skip DB persistence failures in favor of in-memory correctness
      console.error('Error handling vote:', dbError);
    }

    // Broadcast vote progress (without revealing individual votes)
    this.broadcast({
      type: 'vote_progress',
      payload: {
        votesReceived: this.gameState.votes.length,
        totalPlayers: this.gameState.players.length,
        allVotesReceived: this.gameState.votes.length >= this.gameState.players.length
      },
      timestamp: Date.now()
    });

    // Check if all players have voted
    if (this.gameState.votes.length >= this.gameState.players.length) {
      // Clear voting timeout
      if (this.phaseTimer) {
        clearTimeout(this.phaseTimer);
        this.phaseTimer = null;
      }

      // Transition to results
      await this.transitionPhase('results');
    }

    console.log(`Vote recorded: ${playerId} voted for ${targetId}`);
  }

  calculateVoteResults() {
    const voteCounts = {};
    
    // Count votes for each target
    this.gameState.votes.forEach(vote => {
      voteCounts[vote.targetId] = (voteCounts[vote.targetId] || 0) + 1;
    });

    // Find player with most votes
    let mostVotedPlayer = null;
    let maxVotes = 0;
    
    Object.entries(voteCounts).forEach(([playerId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        mostVotedPlayer = playerId;
      }
    });

    // Determine if players won
    const playersWon = mostVotedPlayer === this.gameState.imposter;

    return {
      voteCounts,
      mostVotedPlayer,
      imposter: this.gameState.imposter,
      playersWon,
      totalVotes: this.gameState.votes.length
    };
  }

  async updateGameStateInDatabase() {
    try {
      const gameId = await this.getCurrentGameId();

      const table = this.supabase?.from?.('games');
      if (table && typeof table.update === 'function') {
        const query = table.update({
          phase: this.gameState.phase,
          question_id: this.gameState.questionId,
          imposter_id: this.gameState.imposter,
          updated_at: new Date().toISOString()
        });
        if (query && typeof query.eq === 'function') {
          await query.eq('id', gameId);
        }
      }
    } catch (error) {
      console.error('Error updating game state in database:', error);
      // Don't throw - continue with in-memory state
    }
  }

  async getCurrentGameId() {
    // For now, return a default game ID
    // In a full implementation, this would track the current active game
    return 1;
  }

  getPublicGameState() {
    // Return game state without sensitive information like imposter identity
    return {
      phase: this.gameState.phase,
      players: this.gameState.players,
      questionId: this.gameState.questionId,
      discussionEndsAt: this.gameState.discussionEndsAt,
      votesReceived: this.gameState.votes.length,
      totalPlayers: this.gameState.players.length,
      results: this.gameState.results
    };
  }

  getGameState() {
    return { ...this.gameState };
  }

  updatePlayers(players) {
    this.gameState.players = players;
  }

  cleanup() {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }
}

module.exports = GameManager;