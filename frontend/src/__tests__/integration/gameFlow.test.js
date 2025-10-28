import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import GameServer from '../../../backend/index.js'

// Test configuration
const TEST_PORT = 8081
const TEST_WS_URL = `ws://localhost:${TEST_PORT}`
const TEST_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
const TEST_SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-key'
// Only use real DB when clearly running against a local/emulated instance or explicitly enabled
const USE_DB = (() => {
  try {
    const u = new URL(TEST_SUPABASE_URL)
    const isLocal = ['localhost', '127.0.0.1'].includes(u.hostname)
    return process.env.USE_DB_TESTS === 'true' || isLocal
  } catch {
    return false
  }
})()

// Mock environment for server
process.env.PORT = TEST_PORT
process.env.SUPABASE_URL = TEST_SUPABASE_URL
process.env.SUPABASE_SERVICE_KEY = TEST_SUPABASE_KEY
process.env.NODE_ENV = 'test'

describe('Complete Game Flow Integration Tests', () => {
  let server
  let supabase
  let clients = []

  beforeEach(async () => {
    // Initialize Supabase client for test verification (or a no-op stub)
    if (USE_DB) {
      supabase = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_KEY)
    } else {
      console.warn('[integration] Supabase DB disabled for tests (USE_DB_TESTS!=true and not local). Skipping DB operations.')
      supabase = null
    }
    
    // Clean up database before each test (if enabled)
    if (USE_DB) {
      await cleanupDatabase()
    }
    
    // Start test server
    server = new GameServer()
    
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000))
  })

  afterEach(async () => {
    // Close all client connections
    clients.forEach(client => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.close()
      }
    })
    clients = []
    
    // Shutdown server
    if (server) {
      server.shutdown()
      server = null
    }
    
    // Clean up database after test
    if (USE_DB) {
      await cleanupDatabase()
    }
  })

  async function cleanupDatabase() {
    try {
      if (!USE_DB || !supabase) return
      await supabase.from('votes').delete().neq('id', 0)
      await supabase.from('answers').delete().neq('id', 0)
      await supabase.from('player_roles').delete().neq('player_id', 'NULL')
      await supabase.from('players').delete().neq('id', 'NULL')
      await supabase.from('game_state').delete().neq('id', 0)
      
      // Insert default game state
      await supabase.from('game_state').insert({
        id: 1,
        state: 'waiting',
        phase_started_at: null,
        imposter: null,
        question_id: null,
        results: null
      })
    } catch (error) {
      console.warn('Database cleanup failed:', error.message)
    }
  }

  function createTestClient(playerId, playerName) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(TEST_WS_URL)
      const client = {
        ws,
        playerId,
        playerName,
        messages: [],
        gameState: null,
        players: [],
        connected: false
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 5000)

      ws.on('open', () => {
        clearTimeout(timeout)
        client.connected = true
        
        // Send join message
        ws.send(JSON.stringify({
          type: 'join',
          payload: {
            playerId,
            playerName,
            avatarUrl: ''
          },
          playerId,
          timestamp: Date.now()
        }))
        
        resolve(client)
      })

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          client.messages.push(message)
          
          // Update client state based on message type
          switch (message.type) {
            case 'game_state':
              client.gameState = message.payload
              break
            case 'player_update':
              client.players = message.payload.players || []
              break
            case 'phase_change':
              if (client.gameState) {
                client.gameState.phase = message.payload.phase
              }
              break
          }
        } catch (error) {
          console.error('Failed to parse message:', error)
        }
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })

      clients.push(client)
    })
  }

  function waitForMessage(client, messageType, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for message type: ${messageType}`))
      }, timeout)

      const checkMessages = () => {
        const message = client.messages.find(msg => msg.type === messageType)
        if (message) {
          clearTimeout(timeoutId)
          resolve(message)
        } else {
          setTimeout(checkMessages, 100)
        }
      }
      
      checkMessages()
    })
  }

  test('should handle complete game flow from waiting to results', async () => {
    // Create 3 test clients (minimum for game)
    const client1 = await createTestClient('player1', 'Player One')
    const client2 = await createTestClient('player2', 'Player Two')
    const client3 = await createTestClient('player3', 'Player Three')

    // Verify all clients connected and received initial state
    expect(client1.connected).toBe(true)
    expect(client2.connected).toBe(true)
    expect(client3.connected).toBe(true)

    // Wait for player updates
    await waitForMessage(client1, 'player_update')
    await waitForMessage(client2, 'player_update')
    await waitForMessage(client3, 'player_update')

    // Verify all players are in the game
    expect(client1.players).toHaveLength(3)
    expect(client2.players).toHaveLength(3)
    expect(client3.players).toHaveLength(3)

    // Start the game
    client1.ws.send(JSON.stringify({
      type: 'start_game',
      payload: { playerId: 'player1' },
      playerId: 'player1',
      timestamp: Date.now()
    }))

    // Wait for phase change to question
    await waitForMessage(client1, 'phase_change')
    await waitForMessage(client2, 'phase_change')
    await waitForMessage(client3, 'phase_change')

    // Verify game state changed to question phase
    expect(client1.gameState.phase).toBe('question')
    expect(client2.gameState.phase).toBe('question')
    expect(client3.gameState.phase).toBe('question')

    // Verify database consistency (if DB testing enabled)
    if (USE_DB && supabase) {
      const { data: gameState } = await supabase
        .from('game_state')
        .select('*')
        .eq('id', 1)
        .single()
      
      expect(gameState.state).toBe('question')
      expect(gameState.imposter).toBeTruthy()
      expect(gameState.question_id).toBeTruthy()
    }

    // Submit answers for all players
    const answers = ['Answer 1', 'Answer 2', 'Answer 3']
    const playerIds = ['player1', 'player2', 'player3']
    
    for (let i = 0; i < 3; i++) {
      const client = [client1, client2, client3][i]
      client.ws.send(JSON.stringify({
        type: 'submit_answer',
        payload: {
          playerId: playerIds[i],
          answer: answers[i]
        },
        playerId: playerIds[i],
        timestamp: Date.now()
      }))
    }

    // Wait for phase change to discussion
    await waitForMessage(client1, 'phase_change')
    await waitForMessage(client2, 'phase_change')
    await waitForMessage(client3, 'phase_change')

    // Verify discussion phase
    expect(client1.gameState.phase).toBe('discussion')
    expect(client2.gameState.phase).toBe('discussion')
    expect(client3.gameState.phase).toBe('discussion')

    // Test chat functionality during discussion
    client1.ws.send(JSON.stringify({
      type: 'chat',
      payload: {
        playerId: 'player1',
        playerName: 'Player One',
        message: 'I think player2 is suspicious',
        timestamp: Date.now()
      },
      playerId: 'player1',
      timestamp: Date.now()
    }))

    // Wait for chat message to be broadcast
    await waitForMessage(client2, 'chat_message')
    await waitForMessage(client3, 'chat_message')

    // Verify chat message received by other clients
    const chatMessage = client2.messages.find(msg => msg.type === 'chat_message')
    expect(chatMessage.payload.message).toBe('I think player2 is suspicious')
    expect(chatMessage.payload.playerName).toBe('Player One')

    // Simulate discussion timer expiration by manually transitioning to voting
    // (In real scenario, this would happen automatically after timer)
    client1.ws.send(JSON.stringify({
      type: 'force_phase_transition',
      payload: { phase: 'voting' },
      playerId: 'player1',
      timestamp: Date.now()
    }))

    // Wait for phase change to voting
    await waitForMessage(client1, 'phase_change')
    await waitForMessage(client2, 'phase_change')
    await waitForMessage(client3, 'phase_change')

    // Verify voting phase
    expect(client1.gameState.phase).toBe('voting')
    expect(client2.gameState.phase).toBe('voting')
    expect(client3.gameState.phase).toBe('voting')

    // Submit votes
    const votes = [
      { voter: 'player1', target: 'player2' },
      { voter: 'player2', target: 'player3' },
      { voter: 'player3', target: 'player2' }
    ]

    for (const vote of votes) {
      const client = vote.voter === 'player1' ? client1 : 
                    vote.voter === 'player2' ? client2 : client3
      
      client.ws.send(JSON.stringify({
        type: 'vote',
        payload: { targetId: vote.target },
        playerId: vote.voter,
        timestamp: Date.now()
      }))

      // Wait for vote progress update
      await waitForMessage(client1, 'vote_progress')
    }

    // Wait for phase change to results
    await waitForMessage(client1, 'phase_change')
    await waitForMessage(client2, 'phase_change')
    await waitForMessage(client3, 'phase_change')

    // Verify results phase
    expect(client1.gameState.phase).toBe('results')
    expect(client2.gameState.phase).toBe('results')
    expect(client3.gameState.phase).toBe('results')

    // Verify vote results are calculated correctly
    expect(client1.gameState.results).toBeDefined()
    expect(client1.gameState.results.voteCounts).toBeDefined()
    expect(client1.gameState.results.mostVotedPlayer).toBe('player2')
    expect(client1.gameState.results.totalVotes).toBe(3)

    // Verify database consistency for final state (if DB testing enabled)
    if (USE_DB && supabase) {
      const { data: finalGameState } = await supabase
        .from('game_state')
        .select('*')
        .eq('id', 1)
        .single()
      
      expect(finalGameState.state).toBe('results')
      expect(finalGameState.results).toBeDefined()

      // Verify votes are stored in database
      const { data: storedVotes } = await supabase
        .from('votes')
        .select('*')
      
      expect(storedVotes).toHaveLength(3)
      expect(storedVotes.map(v => v.target)).toContain('player2')
      expect(storedVotes.map(v => v.target)).toContain('player3')
    }
  }, 30000) // 30 second timeout for complete flow

  test('should handle player disconnection and reconnection', async () => {
    // Create 3 clients
    const client1 = await createTestClient('player1', 'Player One')
    const client2 = await createTestClient('player2', 'Player Two')
    const client3 = await createTestClient('player3', 'Player Three')

    // Wait for all players to be registered
    await waitForMessage(client1, 'player_update')
    await waitForMessage(client2, 'player_update')
    await waitForMessage(client3, 'player_update')

    expect(client1.players).toHaveLength(3)

    // Disconnect client2
    client2.ws.close()

    // Wait for player update reflecting disconnection
    await waitForMessage(client1, 'player_update')
    await waitForMessage(client3, 'player_update')

    // Verify player count decreased
    expect(client1.players).toHaveLength(2)
    expect(client3.players).toHaveLength(2)

    // Reconnect client2
    const reconnectedClient2 = await createTestClient('player2', 'Player Two')
    
    // Wait for player update reflecting reconnection
    await waitForMessage(client1, 'player_update')
    await waitForMessage(client3, 'player_update')
    await waitForMessage(reconnectedClient2, 'player_update')

    // Verify player count restored
    expect(client1.players).toHaveLength(3)
    expect(client3.players).toHaveLength(3)
    expect(reconnectedClient2.players).toHaveLength(3)

    // Verify database consistency
    if (USE_DB && supabase) {
      const { data: players } = await supabase
        .from('players')
        .select('*')
        .eq('is_active', true)
      
      expect(players).toHaveLength(3)
    }
  }, 15000)

  test('should maintain database consistency during concurrent operations', async () => {
    // Create multiple clients
    const clients = []
    for (let i = 1; i <= 4; i++) {
      const client = await createTestClient(`player${i}`, `Player ${i}`)
      clients.push(client)
    }

    // Wait for all clients to receive player updates
    for (const client of clients) {
      await waitForMessage(client, 'player_update')
    }

    // Start game
    clients[0].ws.send(JSON.stringify({
      type: 'start_game',
      payload: { playerId: 'player1' },
      playerId: 'player1',
      timestamp: Date.now()
    }))

    // Wait for phase change
    for (const client of clients) {
      await waitForMessage(client, 'phase_change')
    }

    // Submit answers concurrently
    const answerPromises = clients.map((client, index) => {
      return new Promise(resolve => {
        client.ws.send(JSON.stringify({
          type: 'submit_answer',
          payload: {
            playerId: `player${index + 1}`,
            answer: `Answer ${index + 1}`
          },
          playerId: `player${index + 1}`,
          timestamp: Date.now()
        }))
        resolve()
      })
    })

    await Promise.all(answerPromises)

    // Wait for phase transition to discussion
    for (const client of clients) {
      await waitForMessage(client, 'phase_change')
    }

    // Verify DB storage/consistency (if DB testing enabled)
    if (USE_DB && supabase) {
      // Verify all answers were stored in database
      const { data: answers } = await supabase
        .from('answers')
        .select('*')
      
      expect(answers).toHaveLength(4)
      
      // Verify each player has exactly one answer
      const playerAnswers = new Set(answers.map(a => a.player_id))
      expect(playerAnswers.size).toBe(4)

      // Verify game state consistency
      const { data: gameState } = await supabase
        .from('game_state')
        .select('*')
        .eq('id', 1)
        .single()
      
      expect(gameState.state).toBe('discussion')
    }
  }, 20000)

  test('should handle invalid messages gracefully', async () => {
    const client = await createTestClient('player1', 'Player One')
    
    // Send invalid JSON
    client.ws.send('invalid json')
    
    // Send message with missing required fields
    client.ws.send(JSON.stringify({
      type: 'vote'
      // Missing payload and other required fields
    }))
    
    // Send message with invalid type
    client.ws.send(JSON.stringify({
      type: 'invalid_type',
      payload: {},
      playerId: 'player1',
      timestamp: Date.now()
    }))
    
    // Wait a bit to see if server handles errors gracefully
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Verify connection is still active
    expect(client.ws.readyState).toBe(WebSocket.OPEN)
    
    // Verify we can still send valid messages
    client.ws.send(JSON.stringify({
      type: 'heartbeat',
      payload: {},
      playerId: 'player1',
      timestamp: Date.now()
    }))
    
    // Connection should remain stable
    expect(client.ws.readyState).toBe(WebSocket.OPEN)
  }, 10000)
})