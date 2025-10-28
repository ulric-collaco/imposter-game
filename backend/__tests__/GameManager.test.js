const GameManager = require('../GameManager');

// Mock Supabase client
const mockSupabase = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      order: jest.fn(() => ({
        limit: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: null, error: null }))
        }))
      }))
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null }))
    })),
    insert: jest.fn(() => Promise.resolve({ error: null }))
  }))
};

// Mock broadcast function
const mockBroadcast = jest.fn();

describe('GameManager', () => {
  let gameManager;

  beforeEach(() => {
    jest.clearAllMocks();
    gameManager = new GameManager(mockSupabase, mockBroadcast);
  });

  afterEach(() => {
    gameManager.cleanup();
  });

  describe('initialization', () => {
    test('should initialize with default waiting phase', () => {
      expect(gameManager.getGameState().phase).toBe('waiting');
      expect(gameManager.getGameState().players).toEqual([]);
      expect(gameManager.getGameState().votes).toEqual([]);
    });

    test('should initialize game from database', async () => {
      const mockGameData = {
        phase: 'discussion',
        question_id: 1,
        imposter_id: 'player1'
      };

      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({ data: mockGameData, error: null }))
            }))
          }))
        }))
      });

      await gameManager.initializeGame();

      expect(gameManager.getGameState().phase).toBe('discussion');
      expect(gameManager.getGameState().questionId).toBe(1);
      expect(gameManager.getGameState().imposter).toBe('player1');
    });
  });

  describe('phase transitions', () => {
    test('should transition from waiting to question phase', async () => {
      await gameManager.transitionPhase('question', {
        questionId: 1,
        imposter: 'player1'
      });

      const state = gameManager.getGameState();
      expect(state.phase).toBe('question');
      expect(state.questionId).toBe(1);
      expect(state.imposter).toBe('player1');
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'phase_change',
          payload: expect.objectContaining({
            phase: 'question',
            previousPhase: 'waiting'
          })
        })
      );
    });

    test('should transition to discussion phase and start timer', async () => {
      jest.useFakeTimers();
      
      await gameManager.transitionPhase('discussion');

      const state = gameManager.getGameState();
      expect(state.phase).toBe('discussion');
      expect(state.discussionEndsAt).toBeInstanceOf(Date);
      
      // Fast-forward time to trigger auto-transition
      jest.advanceTimersByTime(120000); // 2 minutes
      
      jest.useRealTimers();
    });

    test('should transition to voting phase and clear votes', async () => {
      // Set up some existing votes
      gameManager.gameState.votes = [{ playerId: 'player1', targetId: 'player2' }];
      
      await gameManager.transitionPhase('voting');

      const state = gameManager.getGameState();
      expect(state.phase).toBe('voting');
      expect(state.votes).toEqual([]);
      expect(state.discussionEndsAt).toBeNull();
    });

    test('should transition to results phase and calculate results', async () => {
      // Set up votes and imposter
      gameManager.gameState.votes = [
        { playerId: 'player1', targetId: 'player2' },
        { playerId: 'player3', targetId: 'player2' }
      ];
      gameManager.gameState.imposter = 'player2';
      
      await gameManager.transitionPhase('results');

      const state = gameManager.getGameState();
      expect(state.phase).toBe('results');
      expect(state.results).toBeDefined();
      expect(state.results.playersWon).toBe(true);
    });
  });

  describe('vote handling', () => {
    beforeEach(() => {
      gameManager.gameState.phase = 'voting';
      gameManager.gameState.players = [
        { id: 'player1' },
        { id: 'player2' },
        { id: 'player3' }
      ];
    });

    test('should record valid vote', async () => {
      await gameManager.handleVote('player1', 'player2');

      expect(gameManager.gameState.votes).toHaveLength(1);
      expect(gameManager.gameState.votes[0]).toMatchObject({
        playerId: 'player1',
        targetId: 'player2'
      });
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'vote_progress'
        })
      );
    });

    test('should reject duplicate vote from same player', async () => {
      await gameManager.handleVote('player1', 'player2');
      
      await expect(gameManager.handleVote('player1', 'player3'))
        .rejects.toThrow('Player has already voted');
    });

    test('should reject vote when not in voting phase', async () => {
      gameManager.gameState.phase = 'discussion';
      
      await expect(gameManager.handleVote('player1', 'player2'))
        .rejects.toThrow('Voting is not currently active');
    });

    test('should auto-transition to results when all votes received', async () => {
      const transitionSpy = jest.spyOn(gameManager, 'transitionPhase');
      
      await gameManager.handleVote('player1', 'player2');
      await gameManager.handleVote('player2', 'player3');
      await gameManager.handleVote('player3', 'player1');

      expect(transitionSpy).toHaveBeenCalledWith('results');
    });
  });

  describe('vote results calculation', () => {
    test('should calculate correct vote results', () => {
      gameManager.gameState.votes = [
        { playerId: 'player1', targetId: 'player2' },
        { playerId: 'player3', targetId: 'player2' },
        { playerId: 'player4', targetId: 'player1' }
      ];
      gameManager.gameState.imposter = 'player2';

      const results = gameManager.calculateVoteResults();

      expect(results.voteCounts).toEqual({
        'player2': 2,
        'player1': 1
      });
      expect(results.mostVotedPlayer).toBe('player2');
      expect(results.imposter).toBe('player2');
      expect(results.playersWon).toBe(true);
      expect(results.totalVotes).toBe(3);
    });

    test('should handle case where imposter is not voted out', () => {
      gameManager.gameState.votes = [
        { playerId: 'player1', targetId: 'player3' },
        { playerId: 'player2', targetId: 'player3' }
      ];
      gameManager.gameState.imposter = 'player1';

      const results = gameManager.calculateVoteResults();

      expect(results.mostVotedPlayer).toBe('player3');
      expect(results.imposter).toBe('player1');
      expect(results.playersWon).toBe(false);
    });
  });

  describe('public game state', () => {
    test('should return public state without sensitive information', () => {
      gameManager.gameState.imposter = 'player1';
      gameManager.gameState.phase = 'discussion';
      gameManager.gameState.players = [{ id: 'player1' }, { id: 'player2' }];

      const publicState = gameManager.getPublicGameState();

      expect(publicState).not.toHaveProperty('imposter');
      expect(publicState.phase).toBe('discussion');
      expect(publicState.players).toHaveLength(2);
    });

    test('should include results in public state during results phase', () => {
      gameManager.gameState.phase = 'results';
      gameManager.gameState.results = {
        voteCounts: { 'player1': 2 },
        playersWon: true
      };

      const publicState = gameManager.getPublicGameState();

      expect(publicState.results).toBeDefined();
      expect(publicState.results.playersWon).toBe(true);
    });
  });
});