const PlayerManager = require('../PlayerManager');
const WebSocket = require('ws');

// Mock Supabase client
const mockSupabase = {
  from: jest.fn(() => ({
    upsert: jest.fn(() => Promise.resolve({ error: null })),
    select: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ data: [], error: null }))
    }))
  }))
};

// Mock broadcast function
const mockBroadcast = jest.fn();

// Mock WebSocket
const mockWebSocket = {
  readyState: WebSocket.OPEN,
  send: jest.fn(),
  close: jest.fn()
};

describe('PlayerManager', () => {
  let playerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    playerManager = new PlayerManager(mockSupabase, mockBroadcast);
    // Clear any existing timers
    if (playerManager.heartbeatInterval) {
      clearInterval(playerManager.heartbeatInterval);
      playerManager.heartbeatInterval = null;
    }
  });

  afterEach(() => {
    playerManager.cleanup();
  });

  describe('player management', () => {
    test('should add player successfully', async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player',
        email: 'test@example.com'
      };

      const result = await playerManager.addPlayer('client1', mockWebSocket, playerData);

      expect(result.success).toBe(true);
      expect(playerManager.getPlayerCount()).toBe(1);
      expect(playerManager.getClientCount()).toBe(1);
      expect(playerManager.isPlayerConnected('player1')).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'player_list_update'
        })
      );
    });

    test('should reject player with missing required data', async () => {
      const invalidPlayerData = {
        playerName: 'Test Player'
        // Missing playerId
      };

      await expect(playerManager.addPlayer('client1', mockWebSocket, invalidPlayerData))
        .rejects.toThrow('Missing required player data');
    });

    test('should replace existing connection for same player', async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player'
      };

      // Add player first time
      await playerManager.addPlayer('client1', mockWebSocket, playerData);
      expect(playerManager.getClientCount()).toBe(1);

      // Add same player with different client
      const newMockWs = { ...mockWebSocket };
      await playerManager.addPlayer('client2', newMockWs, playerData);

      expect(playerManager.getClientCount()).toBe(1);
      expect(playerManager.getPlayerCount()).toBe(1);
      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    test('should remove player successfully', async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player'
      };

      await playerManager.addPlayer('client1', mockWebSocket, playerData);
      expect(playerManager.getPlayerCount()).toBe(1);

      await playerManager.removePlayer('player1');

      expect(playerManager.getPlayerCount()).toBe(0);
      expect(playerManager.isPlayerConnected('player1')).toBe(false);
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'player_list_update'
        })
      );
    });

    test('should handle removal of non-existent player gracefully', async () => {
      await expect(playerManager.removePlayer('nonexistent'))
        .resolves.not.toThrow();
    });
  });

  describe('client management', () => {
    test('should remove client and associated player', async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player'
      };

      await playerManager.addPlayer('client1', mockWebSocket, playerData);
      expect(playerManager.getClientCount()).toBe(1);
      expect(playerManager.getPlayerCount()).toBe(1);

      playerManager.removeClient('client1');

      expect(playerManager.getClientCount()).toBe(0);
      expect(playerManager.getPlayerCount()).toBe(0);
      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    test('should find client by player ID', async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player'
      };

      await playerManager.addPlayer('client1', mockWebSocket, playerData);

      const foundClient = playerManager.findClientByPlayerId('player1');
      expect(foundClient).toBeDefined();
      expect(foundClient.clientId).toBe('client1');
      expect(foundClient.playerId).toBe('player1');
    });

    test('should return null for non-existent player ID', () => {
      const foundClient = playerManager.findClientByPlayerId('nonexistent');
      expect(foundClient).toBeNull();
    });
  });

  describe('messaging', () => {
    beforeEach(async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player'
      };
      await playerManager.addPlayer('client1', mockWebSocket, playerData);
    });

    test('should send message to specific client', () => {
      const message = { type: 'test', payload: {} };
      
      const result = playerManager.sendToClient('client1', message);
      
      expect(result).toBe(true);
      expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    test('should send message to specific player', () => {
      const message = { type: 'test', payload: {} };
      
      const result = playerManager.sendToPlayer('player1', message);
      
      expect(result).toBe(true);
      expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    test('should handle send failure gracefully', () => {
      mockWebSocket.send.mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      const result = playerManager.sendToClient('client1', { type: 'test' });
      
      expect(result).toBe(false);
      expect(playerManager.getClientCount()).toBe(0); // Client should be removed
    });

    test('should broadcast to all clients', () => {
      const message = { type: 'broadcast', payload: {} };
      
      playerManager.broadcastToAll(message);
      
      expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });
  });

  describe('heartbeat system', () => {
    test('should update heartbeat for client', async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player'
      };
      await playerManager.addPlayer('client1', mockWebSocket, playerData);

      const result = playerManager.updateHeartbeat('client1');
      
      expect(result).toBe(true);
      
      const client = playerManager.getClientById('client1');
      expect(client.lastHeartbeat).toBeInstanceOf(Date);
    });

    test('should return false for non-existent client heartbeat update', () => {
      const result = playerManager.updateHeartbeat('nonexistent');
      expect(result).toBe(false);
    });

    test('should send heartbeat pings', () => {
      playerManager.sendHeartbeatPings();
      // Should not throw error even with no clients
    });

    test('should cleanup stale connections', async () => {
      const playerData = {
        playerId: 'player1',
        playerName: 'Test Player'
      };
      await playerManager.addPlayer('client1', mockWebSocket, playerData);

      // Manually set old heartbeat
      const client = playerManager.getClientById('client1');
      client.lastHeartbeat = new Date(Date.now() - 60000); // 1 minute ago

      playerManager.cleanupStaleConnections();

      expect(playerManager.getClientCount()).toBe(0);
    });
  });

  describe('player data retrieval', () => {
    beforeEach(async () => {
      const playerData1 = {
        playerId: 'player1',
        playerName: 'Player One'
      };
      const playerData2 = {
        playerId: 'player2',
        playerName: 'Player Two'
      };

      await playerManager.addPlayer('client1', mockWebSocket, playerData1);
      await playerManager.addPlayer('client2', { ...mockWebSocket }, playerData2);
    });

    test('should get active players', () => {
      const activePlayers = playerManager.getActivePlayers();
      
      expect(activePlayers).toHaveLength(2);
      expect(activePlayers[0].isActive).toBe(true);
      expect(activePlayers[1].isActive).toBe(true);
    });

    test('should get player by ID', () => {
      const player = playerManager.getPlayerById('player1');
      
      expect(player).toBeDefined();
      expect(player.name).toBe('Player One');
    });

    test('should return undefined for non-existent player', () => {
      const player = playerManager.getPlayerById('nonexistent');
      expect(player).toBeUndefined();
    });

    test('should get correct player and client counts', () => {
      expect(playerManager.getPlayerCount()).toBe(2);
      expect(playerManager.getClientCount()).toBe(2);
    });
  });

  describe('database integration', () => {
    test('should load players from database', async () => {
      const mockPlayers = [
        {
          id: 'player1',
          name: 'Player One',
          email: 'player1@example.com',
          is_active: true,
          created_at: new Date().toISOString()
        }
      ];

      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: mockPlayers, error: null }))
        }))
      });

      await playerManager.loadPlayersFromDatabase();

      expect(playerManager.getPlayerCount()).toBe(1);
      expect(playerManager.getPlayerById('player1')).toBeDefined();
    });

    test('should handle database load errors gracefully', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: null, error: new Error('DB Error') }))
        }))
      });

      await expect(playerManager.loadPlayersFromDatabase())
        .resolves.not.toThrow();
    });
  });
});