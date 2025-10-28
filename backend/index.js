require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const GameManager = require('./GameManager');
const PlayerManager = require('./PlayerManager');
const MessageProtocol = require('./MessageProtocol');
const RoomManager = require('./RoomManager');

class GameServer {
  constructor() {
    this.port = process.env.PORT || 8080;
    
    // Initialize Supabase client only if configured and not disabled
    const supabaseDisabled = process.env.DISABLE_SUPABASE === 'true'
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY
    if (!supabaseDisabled && supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey)
      console.log('Supabase client initialized')
    } else {
      this.supabase = null
      console.log('Supabase disabled (missing credentials or DISABLE_SUPABASE=true). Running in in-memory mode.')
    }
    
    // Initialize managers
    this.roomManager = new RoomManager();
    this.gameManager = new GameManager(this.supabase, this.broadcastToAll.bind(this));
    this.playerManager = new PlayerManager(this.supabase, this.broadcastToAll.bind(this), this.roomManager);
    this.messageProtocol = new MessageProtocol(this.gameManager, this.playerManager, this.roomManager);
    
    // Create HTTP server for health checks
    this.httpServer = http.createServer(this.handleHttpRequest.bind(this));
    
    // Initialize WebSocket server with HTTP server
    this.wss = new WebSocket.Server({ 
      server: this.httpServer,
      verifyClient: this.verifyClient.bind(this)
    });
    
    this.setupEventHandlers();
    this.initialize();
    
    // Start HTTP server
    this.httpServer.listen(this.port, () => {
      console.log(`WebSocket server started on port ${this.port}`);
    });
  }

  handleHttpRequest(req, res) {
    // Enable CORS for all HTTP requests
    this.setCorsHeaders(res);
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        connections: this.playerManager.clients.size,
        gamePhase: this.gameManager.getGameState().phase
      }));
      return;
    }

    // Simple routing for room management
    if (req.url === '/rooms' && req.method === 'POST') {
      // Create a new room and return the code
      try {
        const room = this.roomManager.createRoom(null);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: room.code }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create room' }));
      }
      return;
    }

    if (req.url.startsWith('/rooms/') && req.method === 'GET') {
      const code = req.url.split('/')[2];
      const room = this.roomManager.getRoom(code);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exists: !!room,
        code,
        players: room ? this.roomManager.listPlayers(code) : []
      }));
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  setCorsHeaders(res) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    
    if (process.env.NODE_ENV === 'development') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      // In production, use specific origins
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins.join(','));
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  verifyClient(info) {
    // Basic CORS handling for WebSocket connections
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    const origin = info.origin;
    
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return true; // Allow all origins in development
    }
    
    return allowedOrigins.includes(origin);
  }

  async initialize() {
    try {
      await this.gameManager.initializeGame();
      await this.playerManager.loadPlayersFromDatabase();
      console.log('Server initialization completed');
    } catch (error) {
      console.error('Error during server initialization:', error);
    }
  }

  setupEventHandlers() {
    this.wss.on('connection', (ws) => {
      console.log('New WebSocket connection established');
      
      // Generate unique client ID
      const clientId = this.generateClientId();
      
      // Store client connection in PlayerManager
      this.playerManager.clients.set(clientId, {
        ws,
        playerId: null,
        playerData: null,
        lastHeartbeat: new Date(),
        connectedAt: new Date()
      });

      // Set up message handling for this client
      ws.on('message', (data) => {
        this.handleMessage(clientId, data);
      });

      // Handle client disconnect
      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      // Handle connection errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        this.handleDisconnect(clientId);
      });

      // Send welcome message
      this.playerManager.sendToClient(clientId, {
        type: 'connection_established',
        payload: { 
          clientId,
          gameState: this.gameManager.getPublicGameState(),
          protocolInfo: this.messageProtocol.getProtocolInfo()
        },
        timestamp: Date.now()
      });
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  generateClientId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  async handleMessage(clientId, data) {
    try {
      await this.messageProtocol.handleMessage(clientId, data);
    } catch (error) {
      // Error handling is done within MessageProtocol
      console.error(`Message handling failed for client ${clientId}:`, error.message);
    }
  }

  handleDisconnect(clientId) {
    this.playerManager.removeClient(clientId);
  }

  broadcastToAll(message) {
    this.playerManager.broadcastToAll(message);
  }

  // Graceful shutdown
  shutdown() {
    if (process.env.NODE_ENV !== 'test') {
      console.log('Shutting down WebSocket server...');
    }
    
    // Cleanup managers
    this.playerManager.cleanup();
    this.gameManager.cleanup();
    
    // Close WebSocket server
    this.wss.close(() => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('WebSocket server closed');
      }
    });
    
    // Close HTTP server
    this.httpServer.close(() => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('HTTP server closed');
      }
    });
  }
}

// Initialize server
const server = new GameServer();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  server.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  server.shutdown();
  process.exit(0);
});

module.exports = GameServer;