const MessageProtocol = require('../MessageProtocol');

// Mock GameManager
const mockGameManager = {
  getGameState: jest.fn(() => ({
    phase: 'waiting',
    players: [],
    votes: []
  })),
  getPublicGameState: jest.fn(() => ({
    phase: 'waiting',
    players: []
  })),
  transitionPhase: jest.fn(),
  handleVote: jest.fn(),
  updatePlayers: jest.fn()
};

// Mock PlayerManager
const mockPlayerManager = {
  getClientById: jest.fn(),
  getPlayerById: jest.fn(),
  getActivePlayers: jest.fn(() => []),
  getPlayerCount: jest.fn(() => 0),
  addPlayer: jest.fn(),
  removePlayer: jest.fn(),
  sendToClient: jest.fn(),
  broadcastToAll: jest.fn(),
  updateHeartbeat: jest.fn()
};

describe('MessageProtocol', () => {
  let messageProtocol;

  beforeEach(() => {
    jest.clearAllMocks();
    messageProtocol = new MessageProtocol(mockGameManager, mockPlayerManager);
  });

  describe('message parsing and validation', () => {
    test('should parse valid JSON message', () => {
      const rawMessage = JSON.stringify({
        type: 'ping',
        timestamp: Date.now(),
        payload: {}
      });

      const parsed = messageProtocol.parseMessage(rawMessage);
      expect(parsed.type).toBe('ping');
      expect(parsed.timestamp).toBeDefined();
    });

    test('should reject invalid JSON', () => {
      const invalidJson = 'invalid json';
      
      expect(() => messageProtocol.parseMessage(invalidJson))
        .toThrow('Invalid JSON message format');
    });

    test('should validate message structure', () => {
      const validMessage = {
        type: 'ping',
        timestamp: Date.now()
      };

      expect(() => messageProtocol.validateMessageStructure(validMessage))
        .not.toThrow();
    });

    test('should reject message without type', () => {
      const invalidMessage = {
        timestamp: Date.now()
      };

      expect(() => messageProtocol.validateMessageStructure(invalidMessage))
        .toThrow('Message missing required field: type');
    });

    test('should reject message without timestamp', () => {
      const invalidMessage = {
        type: 'ping'
      };

      expect(() => messageProtocol.validateMessageStructure(invalidMessage))
        .toThrow('Message missing required field: timestamp');
    });

    test('should reject message with old timestamp', () => {
      const oldMessage = {
        type: 'ping',
        timestamp: Date.now() - 400000 // 6+ minutes ago
      };

      expect(() => messageProtocol.validateMessageStructure(oldMessage))
        .toThrow('Message timestamp is too old or invalid');
    });
  });

  describe('message type validation', () => {
    const mockClient = {
      playerId: 'player1',
      ws: {}
    };

    test('should validate known message type', async () => {
      const message = { type: 'ping', timestamp: Date.now() };
      
      await expect(messageProtocol.validateMessage(message, mockClient))
        .resolves.not.toThrow();
    });

    test('should reject unknown message type', async () => {
      const message = { type: 'unknown', timestamp: Date.now() };
      
      await expect(messageProtocol.validateMessage(message, mockClient))
        .rejects.toThrow('Unknown message type: unknown');
    });

    test('should reject unauthenticated message requiring auth', async () => {
      const message = { type: 'join', timestamp: Date.now() };
      const unauthClient = { playerId: null, ws: {} };
      
      await expect(messageProtocol.validateMessage(message, unauthClient))
        .rejects.toThrow('Authentication required for this message type');
    });
  });

  describe('payload schema validation', () => {
    test('should validate required string field', () => {
      const payload = { playerId: 'player1' };
      const schema = { playerId: 'string' };
      
      expect(() => messageProtocol.validatePayloadSchema(payload, schema))
        .not.toThrow();
    });

    test('should reject missing required field', () => {
      const payload = {};
      const schema = { playerId: 'string' };
      
      expect(() => messageProtocol.validatePayloadSchema(payload, schema))
        .toThrow('Missing required field: playerId');
    });

    test('should allow missing optional field', () => {
      const payload = {};
      const schema = { email: 'string?' };
      
      expect(() => messageProtocol.validatePayloadSchema(payload, schema))
        .not.toThrow();
    });

    test('should validate field types', () => {
      const payload = { count: 'not a number' };
      const schema = { count: 'number' };
      
      expect(() => messageProtocol.validatePayloadSchema(payload, schema))
        .toThrow('Field count must be a number');
    });

    test('should validate message length', () => {
      const longMessage = 'a'.repeat(600);
      const payload = { message: longMessage };
      const schema = { message: 'string', maxLength: 500 };
      
      expect(() => messageProtocol.validatePayloadSchema(payload, schema))
        .toThrow('Message too long (max 500 characters)');
    });
  });

  describe('message routing', () => {
    const mockClient = {
      playerId: 'player1',
      ws: { send: jest.fn() }
    };

    beforeEach(() => {
      mockPlayerManager.getClientById.mockReturnValue(mockClient);
    });

    test('should handle ping message', async () => {
      const message = {
        type: 'ping',
        timestamp: Date.now(),
        payload: {}
      };

      await messageProtocol.handleMessage('client1', JSON.stringify(message));

      expect(mockPlayerManager.updateHeartbeat).toHaveBeenCalledWith('client1');
      expect(mockPlayerManager.sendToClient).toHaveBeenCalledWith('client1',
        expect.objectContaining({ type: 'pong' })
      );
    });

    test('should handle pong message', async () => {
      const message = {
        type: 'pong',
        timestamp: Date.now(),
        payload: {}
      };

      await messageProtocol.handleMessage('client1', JSON.stringify(message));

      expect(mockPlayerManager.updateHeartbeat).toHaveBeenCalledWith('client1');
    });

    test('should handle join message', async () => {
      const message = {
        type: 'join',
        timestamp: Date.now(),
        payload: {
          playerId: 'player1',
          playerName: 'Test Player'
        }
      };

      mockPlayerManager.addPlayer.mockResolvedValue({
        success: true,
        playerData: { id: 'player1', name: 'Test Player' }
      });

      await messageProtocol.handleMessage('client1', JSON.stringify(message));

      expect(mockPlayerManager.addPlayer).toHaveBeenCalled();
      expect(mockGameManager.updatePlayers).toHaveBeenCalled();
      expect(mockPlayerManager.sendToClient).toHaveBeenCalledWith('client1',
        expect.objectContaining({ type: 'join_success' })
      );
    });
  });

  describe('game action handling', () => {
    const mockClient = {
      playerId: 'player1',
      ws: { send: jest.fn() }
    };

    beforeEach(() => {
      mockPlayerManager.getClientById.mockReturnValue(mockClient);
      mockPlayerManager.getPlayerById.mockReturnValue({
        id: 'player1',
        name: 'Test Player'
      });
    });

    test('should handle start game message', async () => {
      mockGameManager.getGameState.mockReturnValue({ phase: 'waiting' });
      mockPlayerManager.getPlayerCount.mockReturnValue(2);
      mockPlayerManager.getActivePlayers.mockReturnValue([
        { id: 'player1' },
        { id: 'player2' },
        { id: 'player3' }
      ]);

      const message = {
        type: 'start_game',
        timestamp: Date.now(),
        payload: {}
      };

      await messageProtocol.handleMessage('client1', JSON.stringify(message));

      expect(mockGameManager.transitionPhase).toHaveBeenCalledWith('question',
        expect.objectContaining({
          imposter: expect.any(String),
          questionId: 1
        })
      );
    });

    test('should reject start game with insufficient players', async () => {
      mockGameManager.getGameState.mockReturnValue({ phase: 'waiting' });
      mockPlayerManager.getPlayerCount.mockReturnValue(2);

      const message = {
        type: 'start_game',
        timestamp: Date.now(),
        payload: {}
      };

      try {
        await messageProtocol.handleMessage('client1', JSON.stringify(message));
      } catch (error) {
        // Expected to throw
      }

      expect(mockPlayerManager.sendToClient).toHaveBeenCalledWith('client1',
        expect.objectContaining({
          type: 'error',
          payload: expect.objectContaining({
            message: 'Need at least 2 players to start game'
          })
        })
      );
    });

    test('should handle chat message during discussion', async () => {
      mockGameManager.getGameState.mockReturnValue({ phase: 'discussion' });

      const message = {
        type: 'chat_message',
        timestamp: Date.now(),
        payload: {
          message: 'Hello everyone!'
        }
      };

      await messageProtocol.handleMessage('client1', JSON.stringify(message));

      expect(mockPlayerManager.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat_broadcast',
          payload: expect.objectContaining({
            playerId: 'player1',
            playerName: 'Test Player',
            message: 'Hello everyone!'
          })
        })
      );
    });

    test('should reject chat message outside discussion phase', async () => {
      mockGameManager.getGameState.mockReturnValue({ phase: 'waiting' });

      const message = {
        type: 'chat_message',
        timestamp: Date.now(),
        payload: {
          message: 'Hello everyone!'
        }
      };

      try {
        await messageProtocol.handleMessage('client1', JSON.stringify(message));
      } catch (error) {
        // Expected to throw
      }

      expect(mockPlayerManager.sendToClient).toHaveBeenCalledWith('client1',
        expect.objectContaining({
          type: 'error',
          payload: expect.objectContaining({
            message: 'Chat is only available during discussion phase'
          })
        })
      );
    });

    test('should handle vote message', async () => {
      const message = {
        type: 'vote',
        timestamp: Date.now(),
        payload: {
          targetId: 'player2'
        }
      };

      await messageProtocol.handleMessage('client1', JSON.stringify(message));

      expect(mockGameManager.handleVote).toHaveBeenCalledWith('player1', 'player2');
    });
  });

  describe('error handling', () => {
    test('should send error message for invalid JSON', async () => {
      try {
        await messageProtocol.handleMessage('client1', 'invalid json');
      } catch (error) {
        // Expected to throw
      }

      expect(mockPlayerManager.sendToClient).toHaveBeenCalledWith('client1',
        expect.objectContaining({
          type: 'error',
          payload: expect.objectContaining({
            message: 'Invalid JSON message format'
          })
        })
      );
    });

    test('should handle client not found error', async () => {
      mockPlayerManager.getClientById.mockReturnValue(null);

      const message = JSON.stringify({
        type: 'ping',
        timestamp: Date.now(),
        payload: {}
      });

      await expect(messageProtocol.handleMessage('nonexistent', message))
        .rejects.toThrow('Client not found');
    });
  });

  describe('utility methods', () => {
    test('should create standardized message', () => {
      const message = messageProtocol.createMessage('test_type', { data: 'test' });

      expect(message).toMatchObject({
        type: 'test_type',
        payload: { data: 'test' },
        timestamp: expect.any(Number)
      });
    });

    test('should return protocol information', () => {
      const info = messageProtocol.getProtocolInfo();

      expect(info).toHaveProperty('inboundTypes');
      expect(info).toHaveProperty('outboundTypes');
      expect(info).toHaveProperty('version');
      expect(Array.isArray(info.inboundTypes)).toBe(true);
      expect(Array.isArray(info.outboundTypes)).toBe(true);
    });
  });
});