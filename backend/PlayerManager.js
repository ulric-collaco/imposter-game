const WebSocket = require("ws");

class PlayerManager {
  constructor(supabaseClient, broadcastCallback, roomManager) {
    this.supabase = supabaseClient;
    this.broadcast = broadcastCallback;
    this.roomManager = roomManager;
    this.clients = new Map(); // clientId -> { ws, playerId, playerData, lastHeartbeat }
    this.players = new Map(); // playerId -> playerData
    this.heartbeatInterval = null;
    this.heartbeatTimeout = 60000; // 60 seconds (more lenient)
    this.cleanupInterval = 60000; // Check for stale connections every minute

    this.startHeartbeatSystem();
  }

  async addPlayer(clientId, ws, playerData) {
    try {
      let { playerId, playerName, email, roomCode } = playerData;

      // Generate a playerId if not provided (no-auth mode)
      if (!playerId) {
        playerId = 'p_' + Math.random().toString(36).slice(2, 10);
      }

      // Validate required player data
      if (!playerId || !playerName) {
        throw new Error("Missing required player data (playerId, playerName)");
      }

      // Check if player is already connected
      const existingClient = this.findClientByPlayerId(playerId);
      if (existingClient) {
        // Replace existing connection
        console.log(`Replacing existing connection for player ${playerId}`);
        this.removeClient(existingClient.clientId);
      }

      // Store client connection
      this.clients.set(clientId, {
        ws,
        playerId,
        playerData: {
          id: playerId,
          name: playerName,
          email: email || null,
          roomCode: roomCode || null,
          joinedAt: new Date(),
          isActive: true,
        },
        lastHeartbeat: new Date(),
        connectedAt: new Date(),
      });

      // Store player data
      this.players.set(playerId, {
        id: playerId,
        name: playerName,
        email: email || null,
        roomCode: roomCode || null,
        joinedAt: new Date(),
        isActive: true,
        ready: false, // Players start as not ready
        clientId,
      });

      // Track membership in room
      if (roomCode) {
        this.roomManager.addClientToRoom(roomCode, clientId);
        this.roomManager.addPlayerToRoom(roomCode, playerId, true);
      }

      // Update player in database
      await this.updatePlayerInDatabase(playerId, {
        name: playerName,
        email: email || null,
        is_active: true,
        last_seen: new Date().toISOString(),
      });

      // Broadcast updated player list to the specific room (if provided) or globally
      if (roomCode) {
        await this.broadcastPlayerList(roomCode);
      } else {
        await this.broadcastPlayerList();
      }

      console.log(
        `Player ${playerName} (${playerId}) added via client ${clientId}`
      );

      return {
        success: true,
        playerData: this.players.get(playerId),
      };
    } catch (error) {
      console.error(`Error adding player via client ${clientId}:`, error);
      throw error;
    }
  }

  async removePlayer(playerId) {
    try {
      const player = this.players.get(playerId);
      if (!player) {
        console.log(`Player ${playerId} not found for removal`);
        return;
      }

      // Find and remove client connection
      const client = this.clients.get(player.clientId);
      if (client) {
        this.removeClient(player.clientId);
      }

      // Remove from players map
      this.players.delete(playerId);

      // Update database
      await this.updatePlayerInDatabase(playerId, {
        is_active: false,
        last_seen: new Date().toISOString(),
      });

      // Remove from room and broadcast updated player list within that room
      if (player.roomCode) {
        this.roomManager.removePlayerFromRoom(player.roomCode, playerId);
        await this.broadcastPlayerList(player.roomCode);
      } else {
        await this.broadcastPlayerList();
      }

      console.log(`Player ${player.name} (${playerId}) removed`);
    } catch (error) {
      console.error(`Error removing player ${playerId}:`, error);
    }
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      // Close WebSocket if still open
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1000, "Client disconnected");
      }

      // Remove from clients map
      this.clients.delete(clientId);

      // If this was the only client for the player, remove player too
      if (client.playerId) {
        const hasOtherClients = Array.from(this.clients.values()).some(
          (c) => c.playerId === client.playerId
        );

        if (!hasOtherClients) {
          this.removePlayer(client.playerId);
        }
      }

      // Also remove client from room tracking
      if (client.playerData?.roomCode) {
        this.roomManager.removeClientFromRoom(client.playerData.roomCode, clientId);
      }

      console.log(`Client ${clientId} removed`);
    }
  }

  findClientByPlayerId(playerId) {
    for (const [clientId, client] of this.clients) {
      if (client.playerId === playerId) {
        return { clientId, ...client };
      }
    }
    return null;
  }

  async broadcastPlayerList(roomCode = null) {
    // Build a list scoped to room if roomCode provided
    const listSource = roomCode
      ? Array.from(this.players.values()).filter(p => p.roomCode === roomCode)
      : Array.from(this.players.values());

    const playerList = listSource.map((player) => ({
      id: player.id,
      name: player.name,
      joined_at: player.joinedAt, // Use snake_case to match frontend expectation
      isActive: player.isActive,
      ready: player.ready || false // Include ready state
    }));

    const message = {
      type: "player_list_update",
      payload: {
        players: playerList,
        totalPlayers: playerList.length,
        roomCode: roomCode || null
      },
      timestamp: Date.now(),
    };

    if (roomCode) {
      this.broadcastToRoom(roomCode, message);
    } else {
      this.broadcast(message);
    }
  }

  broadcastToAll(message) {
    let sentCount = 0;
    let failedCount = 0;

    this.clients.forEach((client, clientId) => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          console.error(`Error sending message to client ${clientId}:`, error);
          failedCount++;
          // Schedule client for removal
          setTimeout(() => this.removeClient(clientId), 0);
        }
      } else {
        failedCount++;
        // Schedule client for removal
        setTimeout(() => this.removeClient(clientId), 0);
      }
    });

    if (failedCount > 0) {
      console.log(
        `Broadcast sent to ${sentCount} clients, ${failedCount} failed`
      );
    }
  }

  broadcastToRoom(roomCode, message) {
    let sentCount = 0;
    let failedCount = 0;

    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    room.clients.forEach((clientId) => {
      const client = this.clients.get(clientId);
      if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          console.error(`Error sending message to client ${clientId}:`, error);
          failedCount++;
          setTimeout(() => this.removeClient(clientId), 0);
        }
      } else {
        failedCount++;
        setTimeout(() => this.removeClient(clientId), 0);
      }
    });

    if (failedCount > 0) {
      console.log(
        `Room ${roomCode} broadcast sent to ${sentCount} clients, ${failedCount} failed`
      );
    }
  }

  sendToPlayer(playerId, message) {
    const client = this.findClientByPlayerId(playerId);
    if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`Error sending message to player ${playerId}:`, error);
        this.removeClient(client.clientId);
        return false;
      }
    }
    return false;
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`Error sending message to client ${clientId}:`, error);
        this.removeClient(clientId);
        return false;
      }
    }
    return false;
  }

  updateHeartbeat(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastHeartbeat = new Date();
      return true;
    }
    return false;
  }

  startHeartbeatSystem() {
    // Skip heartbeat system in development if DISABLE_HEARTBEAT is set
    if (process.env.DISABLE_HEARTBEAT === 'true') {
      console.log("Heartbeat system disabled for development");
      return;
    }

    // Send ping to all clients every 20 seconds
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeatPings();
      this.cleanupStaleConnections();
    }, 20000);

    console.log("Heartbeat system started (ping every 20s, timeout after 60s)");
  }

  sendHeartbeatPings() {
    const pingMessage = {
      type: "ping",
      payload: {},
      timestamp: Date.now(),
    };

    this.clients.forEach((client, clientId) => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify(pingMessage));
        } catch (error) {
          console.error(`Error sending ping to client ${clientId}:`, error);
          this.removeClient(clientId);
        }
      }
    });
  }

  cleanupStaleConnections() {
    const now = new Date();
    const staleClients = [];

    this.clients.forEach((client, clientId) => {
      const timeSinceHeartbeat = now - client.lastHeartbeat;

      // Remove clients that are at or beyond the heartbeat timeout
      if (timeSinceHeartbeat >= this.heartbeatTimeout) {
        staleClients.push(clientId);
      }
    });

    staleClients.forEach((clientId) => {
      const client = this.clients.get(clientId);
      const timeSinceHeartbeat = now - client.lastHeartbeat;
      console.log(`Removing stale client ${clientId} (${Math.round(timeSinceHeartbeat/1000)}s since last heartbeat)`);
      this.removeClient(clientId);
    });

    if (staleClients.length > 0) {
      console.log(`Cleaned up ${staleClients.length} stale connections`);
    }
  }

  async updatePlayerInDatabase(playerId, updates) {
    try {
      if (!this.supabase?.from) {
        return; // DB disabled
      }
      const { error } = await this.supabase.from("players").upsert({
        id: playerId,
        ...updates,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        if (
          error.code === "PGRST205" ||
          error.code === "42703" ||
          error.code === "PGRST204"
        ) {
          // Table or column doesn't exist - skip database operations silently
          return;
        }
        console.error("Error updating player in database:", error);
      }
    } catch (error) {
      console.error("Database operation failed:", error);
      // Don't throw - continue with in-memory state
    }
  }

  getActivePlayers() {
    return Array.from(this.players.values()).filter(
      (player) => player.isActive
    );
  }

  getPlayerCount() {
    return this.players.size;
  }

  getClientCount() {
    return this.clients.size;
  }

  getPlayerById(playerId) {
    return this.players.get(playerId);
  }

  getClientById(clientId) {
    return this.clients.get(clientId);
  }

  isPlayerConnected(playerId) {
    return this.players.has(playerId) && this.players.get(playerId).isActive;
  }

  async loadPlayersFromDatabase() {
    try {
      if (!this.supabase?.from) {
        return; // DB disabled
      }
      const { data: players, error } = await this.supabase
        .from("players")
        .select("*")
        .eq("is_active", true);

      if (error) {
        if (error.code === "PGRST205" || error.code === "42703") {
          console.warn(
            "Players table or is_active column does not exist. Skipping database load."
          );
          return;
        }
        console.error("Error loading players from database:", error);
        return;
      }

      // Clear current players and reload from database
      this.players.clear();

      if (players) {
        players.forEach((player) => {
          this.players.set(player.id, {
            id: player.id,
            name: player.name,
            email: player.email,
            joinedAt: new Date(player.created_at),
            isActive: player.is_active,
            clientId: null, // Will be set when client connects
          });
        });
      }

      console.log(
        `Loaded ${players?.length || 0} active players from database`
      );
    } catch (error) {
      console.error("Failed to load players from database:", error);
      console.log("Continuing without database persistence...");
    }
  }

  async togglePlayerReady(playerId) {
    const player = this.players.get(playerId);
    if (!player) {
      console.log(`Player ${playerId} not found for ready toggle`);
      return false;
    }

    // Toggle ready state
    player.ready = !player.ready;
    
    console.log(`Player ${player.name} is now ${player.ready ? 'ready' : 'not ready'}`);

    // Broadcast updated player list
    await this.broadcastPlayerList();

    return true;
  }

  areAllPlayersReady() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.isActive);
    if (activePlayers.length === 0) return false;
    
    return activePlayers.every(player => player.ready);
  }

  getReadyPlayerCount() {
    return Array.from(this.players.values()).filter(p => p.isActive && p.ready).length;
  }

  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    this.clients.forEach((client, clientId) => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1000, "Server shutting down");
      }
    });

    this.clients.clear();
    this.players.clear();

    console.log("PlayerManager cleanup completed");
  }
}

module.exports = PlayerManager;
