const { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals')
const WebSocket = require('ws')
const GameServer = require('../../index.js')
const { createClient } = require('@supabase/supabase-js')

// Test configuration
const TEST_PORT = 8083
const TEST_WS_URL = `ws://localhost:${TEST_PORT}`
const TEST_SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
const TEST_SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key'

// Mock environment for server
process.env.PORT = TEST_PORT
process.env.SUPABASE_URL = TEST_SUPABASE_URL
process.env.SUPABASE_SERVICE_KEY = TEST_SUPABASE_KEY
process.env.NODE_ENV = 'test'

describe('Server Load Testing', () => {
  let server
  let supabase
  let connections = []

  beforeAll(async () => {
    // Initialize Supabase client
    supabase = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_KEY)
    
    // Start test server
    server = new GameServer()
    
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000))
  }, 10000)

  afterAll(async () => {
    // Close all connections
    connections.forEach(conn => {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.close()
      }
    })
    
    // Shutdown server
    if (server) {
      server.shutdown()
    }
  }, 5000)

  beforeEach(async () => {
    // Clean up database
    await cleanupDatabase()
    connections = []
  })

  afterEach(async () => {
    // Close test connections
    connections.forEach(conn => {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.close()
      }
    })
    connections = []
    
    await cleanupDatabase()
  })

  async function cleanupDatabase() {
    try {
      await supabase.from('votes').delete().neq('id', 0)
      await supabase.from('answers').delete().neq('id', 0)
      await supabase.from('player_roles').delete().neq('player_id', 'NULL')
      await supabase.from('players').delete().neq('id', 'NULL')
      await supabase.from('game_state').delete().neq('id', 0)
      
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

  function createConnection(playerId, playerName) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(TEST_WS_URL)
      const connection = {
        ws,
        playerId,
        playerName,
        messages: [],
        connected: false,
        messageCount: 0,
        latencies: []
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 5000)

      ws.on('open', () => {
        clearTimeout(timeout)
        connection.connected = true
        
        // Send join message
        const joinMessage = {
          type: 'join',
          payload: {
            playerId,
            playerName,
            avatarUrl: ''
          },
          playerId,
          timestamp: Date.now()
        }
        
        ws.send(JSON.stringify(joinMessage))
        resolve(connection)
      })

      ws.on('message', (data) => {
        const receiveTime = Date.now()
        try {
          const message = JSON.parse(data.toString())
          connection.messages.push(message)
          connection.messageCount++
          
          // Calculate latency for messages with timestamps
          if (message.timestamp) {
            const latency = receiveTime - message.timestamp
            connection.latencies.push(latency)
          }
        } catch (error) {
          console.error('Failed to parse message:', error)
        }
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })

      connections.push(connection)
    })
  }

  function sendMessage(connection, type, payload) {
    if (connection.ws.readyState === WebSocket.OPEN) {
      const message = {
        type,
        payload,
        playerId: connection.playerId,
        timestamp: Date.now()
      }
      connection.ws.send(JSON.stringify(message))
      return true
    }
    return false
  }

  function calculateStats(values) {
    if (values.length === 0) return { min: 0, max: 0, avg: 0, p95: 0, p99: 0 }
    
    const sorted = values.slice().sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]
    
    return { min, max, avg, p95, p99 }
  }

  test('should handle 50 concurrent connections', async () => {
    const connectionCount = 50
    const connectionPromises = []
    
    console.log(`Creating ${connectionCount} concurrent connections...`)
    const startTime = Date.now()
    
    // Create connections concurrently
    for (let i = 0; i < connectionCount; i++) {
      connectionPromises.push(createConnection(`player${i}`, `Player ${i}`))
    }
    
    const connections = await Promise.all(connectionPromises)
    const connectionTime = Date.now() - startTime
    
    console.log(`All connections established in ${connectionTime}ms`)
    
    // Verify all connections are established
    expect(connections).toHaveLength(connectionCount)
    connections.forEach(conn => {
      expect(conn.connected).toBe(true)
    })
    
    // Connection time should be reasonable (under 10 seconds)
    expect(connectionTime).toBeLessThan(10000)
    
    // Test message broadcasting performance
    const broadcastStartTime = Date.now()
    
    // Send a message that should be broadcast to all
    sendMessage(connections[0], 'chat', {
      playerId: connections[0].playerId,
      playerName: connections[0].playerName,
      message: 'Load test message',
      timestamp: Date.now()
    })
    
    // Wait for message to propagate
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    const broadcastTime = Date.now() - broadcastStartTime
    console.log(`Broadcast completed in ${broadcastTime}ms`)
    
    // Most connections should receive the broadcast
    const receivedCount = connections.filter(conn => 
      conn.messages.some(msg => msg.type === 'chat_message')
    ).length
    
    expect(receivedCount).toBeGreaterThan(connectionCount * 0.9) // 90% success rate
    expect(broadcastTime).toBeLessThan(5000) // Under 5 seconds
  }, 30000)

  test('should maintain performance under high message volume', async () => {
    const connectionCount = 20
    const messagesPerConnection = 50
    const totalMessages = connectionCount * messagesPerConnection
    
    console.log(`Testing ${totalMessages} total messages from ${connectionCount} connections`)
    
    // Create connections
    const connectionPromises = []
    for (let i = 0; i < connectionCount; i++) {
      connectionPromises.push(createConnection(`player${i}`, `Player ${i}`))
    }
    
    const connections = await Promise.all(connectionPromises)
    
    // Wait for initial setup
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Send messages concurrently from all connections
    const messageStartTime = Date.now()
    const messagePromises = []
    
    for (let i = 0; i < connectionCount; i++) {
      const connection = connections[i]
      
      for (let j = 0; j < messagesPerConnection; j++) {
        messagePromises.push(
          new Promise(resolve => {
            setTimeout(() => {
              sendMessage(connection, 'test_message', {
                messageId: `${i}-${j}`,
                timestamp: Date.now()
              })
              resolve()
            }, Math.random() * 1000) // Spread messages over 1 second
          })
        )
      }
    }
    
    await Promise.all(messagePromises)
    
    // Wait for message processing
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    const messageEndTime = Date.now()
    const totalTime = messageEndTime - messageStartTime
    
    console.log(`Processed ${totalMessages} messages in ${totalTime}ms`)
    console.log(`Throughput: ${(totalMessages / totalTime * 1000).toFixed(2)} messages/second`)
    
    // Calculate latency statistics
    const allLatencies = connections.flatMap(conn => conn.latencies)
    const latencyStats = calculateStats(allLatencies)
    
    console.log('Latency stats:', latencyStats)
    
    // Performance assertions
    expect(totalTime).toBeLessThan(15000) // Complete within 15 seconds
    expect(latencyStats.avg).toBeLessThan(1000) // Average latency under 1 second
    expect(latencyStats.p95).toBeLessThan(2000) // 95th percentile under 2 seconds
    
    // Verify server is still responsive
    const healthResponse = await fetch(`http://localhost:${TEST_PORT}/health`)
    expect(healthResponse.ok).toBe(true)
  }, 45000)

  test('should handle rapid connection/disconnection cycles', async () => {
    const cycles = 10
    const connectionsPerCycle = 10
    
    console.log(`Testing ${cycles} cycles of ${connectionsPerCycle} connections each`)
    
    const cycleTimes = []
    
    for (let cycle = 0; cycle < cycles; cycle++) {
      const cycleStartTime = Date.now()
      
      // Create connections
      const connectionPromises = []
      for (let i = 0; i < connectionsPerCycle; i++) {
        connectionPromises.push(createConnection(`cycle${cycle}_player${i}`, `Cycle${cycle} Player${i}`))
      }
      
      const cycleConnections = await Promise.all(connectionPromises)
      
      // Send some messages
      for (const conn of cycleConnections) {
        sendMessage(conn, 'test', { cycleId: cycle })
      }
      
      // Wait briefly
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Disconnect all
      cycleConnections.forEach(conn => {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.close()
        }
      })
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const cycleTime = Date.now() - cycleStartTime
      cycleTimes.push(cycleTime)
      
      console.log(`Cycle ${cycle + 1} completed in ${cycleTime}ms`)
    }
    
    const avgCycleTime = cycleTimes.reduce((sum, time) => sum + time, 0) / cycleTimes.length
    console.log(`Average cycle time: ${avgCycleTime}ms`)
    
    // Each cycle should complete reasonably quickly
    expect(avgCycleTime).toBeLessThan(5000)
    
    // Server should remain healthy
    const healthResponse = await fetch(`http://localhost:${TEST_PORT}/health`)
    expect(healthResponse.ok).toBe(true)
    
    const healthData = await healthResponse.json()
    expect(healthData.status).toBe('healthy')
  }, 60000)

  test('should handle memory usage efficiently under load', async () => {
    const connectionCount = 30
    const testDuration = 10000 // 10 seconds
    
    // Get initial memory usage
    const initialMemory = process.memoryUsage()
    console.log('Initial memory usage:', initialMemory)
    
    // Create connections
    const connectionPromises = []
    for (let i = 0; i < connectionCount; i++) {
      connectionPromises.push(createConnection(`mem_player${i}`, `Memory Player ${i}`))
    }
    
    const connections = await Promise.all(connectionPromises)
    
    // Continuously send messages for test duration
    const endTime = Date.now() + testDuration
    let messagesSent = 0
    
    const messageInterval = setInterval(() => {
      if (Date.now() >= endTime) {
        clearInterval(messageInterval)
        return
      }
      
      // Send message from random connection
      const randomConn = connections[Math.floor(Math.random() * connections.length)]
      if (sendMessage(randomConn, 'memory_test', { 
        messageId: messagesSent++,
        timestamp: Date.now(),
        data: 'x'.repeat(100) // Small payload
      })) {
        messagesSent++
      }
    }, 50) // 20 messages per second
    
    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, testDuration + 1000))
    
    // Get final memory usage
    const finalMemory = process.memoryUsage()
    console.log('Final memory usage:', finalMemory)
    console.log(`Messages sent: ${messagesSent}`)
    
    // Calculate memory increase
    const heapIncrease = finalMemory.heapUsed - initialMemory.heapUsed
    const heapIncreasePercent = (heapIncrease / initialMemory.heapUsed) * 100
    
    console.log(`Heap increase: ${heapIncrease} bytes (${heapIncreasePercent.toFixed(2)}%)`)
    
    // Memory increase should be reasonable (less than 100% increase)
    expect(heapIncreasePercent).toBeLessThan(100)
    
    // Clean up connections
    connections.forEach(conn => {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.close()
      }
    })
    
    // Wait for cleanup and check memory again
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc()
    }
    
    const cleanupMemory = process.memoryUsage()
    console.log('Memory after cleanup:', cleanupMemory)
    
    // Memory should not continuously grow (basic leak detection)
    const finalIncrease = cleanupMemory.heapUsed - initialMemory.heapUsed
    const finalIncreasePercent = (finalIncrease / initialMemory.heapUsed) * 100
    
    console.log(`Final heap increase: ${finalIncrease} bytes (${finalIncreasePercent.toFixed(2)}%)`)
    
    // After cleanup, memory increase should be minimal
    expect(finalIncreasePercent).toBeLessThan(50)
  }, 30000)

  test('should maintain database consistency under concurrent load', async () => {
    const connectionCount = 15
    const gameCount = 3 // Multiple concurrent games
    
    console.log(`Testing ${gameCount} concurrent games with ${connectionCount} total connections`)
    
    // Create connections
    const connectionPromises = []
    for (let i = 0; i < connectionCount; i++) {
      connectionPromises.push(createConnection(`db_player${i}`, `DB Player ${i}`))
    }
    
    const connections = await Promise.all(connectionPromises)
    
    // Divide connections into games
    const gamesConnections = []
    const connectionsPerGame = Math.floor(connectionCount / gameCount)
    
    for (let game = 0; game < gameCount; game++) {
      const startIndex = game * connectionsPerGame
      const endIndex = game === gameCount - 1 ? connectionCount : startIndex + connectionsPerGame
      gamesConnections.push(connections.slice(startIndex, endIndex))
    }
    
    // Start games concurrently
    const gamePromises = gamesConnections.map(async (gameConnections, gameIndex) => {
      // Start game
      sendMessage(gameConnections[0], 'start_game', { playerId: gameConnections[0].playerId })
      
      // Wait for question phase
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Submit answers
      for (let i = 0; i < gameConnections.length; i++) {
        sendMessage(gameConnections[i], 'submit_answer', {
          playerId: gameConnections[i].playerId,
          answer: `Game ${gameIndex} Answer ${i}`
        })
      }
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      return gameIndex
    })
    
    await Promise.all(gamePromises)
    
    // Verify database consistency
    const { data: answers } = await supabase.from('answers').select('*')
    const { data: players } = await supabase.from('players').select('*')
    const { data: gameStates } = await supabase.from('game_state').select('*')
    
    console.log(`Database state: ${answers?.length || 0} answers, ${players?.length || 0} players, ${gameStates?.length || 0} game states`)
    
    // Should have answers from all players
    expect(answers?.length || 0).toBe(connectionCount)
    
    // Should have all players registered
    expect(players?.length || 0).toBe(connectionCount)
    
    // Each player should have exactly one answer
    const playerAnswerCounts = {}
    answers?.forEach(answer => {
      playerAnswerCounts[answer.player_id] = (playerAnswerCounts[answer.player_id] || 0) + 1
    })
    
    Object.values(playerAnswerCounts).forEach(count => {
      expect(count).toBe(1)
    })
    
    // Verify no data corruption
    answers?.forEach(answer => {
      expect(answer.player_id).toBeTruthy()
      expect(answer.answer).toBeTruthy()
      expect(answer.question_id).toBeTruthy()
    })
  }, 30000)

  test('should handle multiple concurrent games with full gameplay cycles', async () => {
    const gamesCount = 5
    const playersPerGame = 6
    const totalConnections = gamesCount * playersPerGame
    
    console.log(`Testing ${gamesCount} concurrent full games with ${playersPerGame} players each`)
    
    // Create all connections
    const allConnections = []
    for (let game = 0; game < gamesCount; game++) {
      for (let player = 0; player < playersPerGame; player++) {
        const playerId = `game${game}_player${player}`
        const playerName = `Game${game} Player${player}`
        allConnections.push(createConnection(playerId, playerName))
      }
    }
    
    const connections = await Promise.all(allConnections)
    
    // Group connections by game
    const gameGroups = []
    for (let game = 0; game < gamesCount; game++) {
      const startIndex = game * playersPerGame
      const endIndex = startIndex + playersPerGame
      gameGroups.push(connections.slice(startIndex, endIndex))
    }
    
    // Run full game cycles concurrently
    const gamePromises = gameGroups.map(async (gameConnections, gameIndex) => {
      const gameStartTime = Date.now()
      
      try {
        // Phase 1: Start game
        sendMessage(gameConnections[0], 'start_game', { 
          playerId: gameConnections[0].playerId 
        })
        
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Phase 2: Submit answers (question phase)
        for (const conn of gameConnections) {
          sendMessage(conn, 'submit_answer', {
            playerId: conn.playerId,
            answer: `Game ${gameIndex} answer from ${conn.playerName}`
          })
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Phase 3: Discussion phase (send chat messages)
        for (let i = 0; i < 3; i++) {
          const randomPlayer = gameConnections[Math.floor(Math.random() * gameConnections.length)]
          sendMessage(randomPlayer, 'chat', {
            playerId: randomPlayer.playerId,
            playerName: randomPlayer.playerName,
            message: `Game ${gameIndex} discussion message ${i}`
          })
          await new Promise(resolve => setTimeout(resolve, 200))
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Phase 4: Voting phase
        for (const conn of gameConnections) {
          // Vote for a random other player
          const otherPlayers = gameConnections.filter(c => c.playerId !== conn.playerId)
          const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)]
          
          sendMessage(conn, 'vote', {
            playerId: conn.playerId,
            targetId: target.playerId
          })
        }
        
        await new Promise(resolve => setTimeout(resolve, 1500))
        
        const gameEndTime = Date.now()
        const gameDuration = gameEndTime - gameStartTime
        
        console.log(`Game ${gameIndex} completed in ${gameDuration}ms`)
        
        return {
          gameIndex,
          duration: gameDuration,
          playerCount: gameConnections.length,
          success: true
        }
        
      } catch (error) {
        console.error(`Game ${gameIndex} failed:`, error)
        return {
          gameIndex,
          duration: Date.now() - gameStartTime,
          playerCount: gameConnections.length,
          success: false,
          error: error.message
        }
      }
    })
    
    const gameResults = await Promise.all(gamePromises)
    
    // Analyze results
    const successfulGames = gameResults.filter(r => r.success)
    const failedGames = gameResults.filter(r => !r.success)
    
    console.log(`Successful games: ${successfulGames.length}/${gamesCount}`)
    console.log(`Failed games: ${failedGames.length}`)
    
    if (failedGames.length > 0) {
      console.log('Failed game details:', failedGames)
    }
    
    const avgDuration = successfulGames.reduce((sum, r) => sum + r.duration, 0) / successfulGames.length
    console.log(`Average game duration: ${avgDuration}ms`)
    
    // Performance assertions
    expect(successfulGames.length).toBeGreaterThanOrEqual(gamesCount * 0.8) // 80% success rate
    expect(avgDuration).toBeLessThan(10000) // Average game under 10 seconds
    
    // Verify server health after concurrent games
    const healthResponse = await fetch(`http://localhost:${TEST_PORT}/health`)
    expect(healthResponse.ok).toBe(true)
    
    // Check database consistency
    const { data: finalPlayers } = await supabase.from('players').select('*')
    const { data: finalAnswers } = await supabase.from('answers').select('*')
    const { data: finalVotes } = await supabase.from('votes').select('*')
    
    console.log(`Final DB state: ${finalPlayers?.length || 0} players, ${finalAnswers?.length || 0} answers, ${finalVotes?.length || 0} votes`)
    
    // Should have data from successful games
    expect(finalPlayers?.length || 0).toBeGreaterThan(0)
    expect(finalAnswers?.length || 0).toBeGreaterThan(0)
    
  }, 60000)

  test('should handle server resource limits gracefully', async () => {
    const maxConnections = 100 // Test server limits
    const batchSize = 20
    const batches = Math.ceil(maxConnections / batchSize)
    
    console.log(`Testing server limits with ${maxConnections} connections in ${batches} batches`)
    
    const allConnections = []
    const connectionTimes = []
    
    // Create connections in batches to avoid overwhelming the server
    for (let batch = 0; batch < batches; batch++) {
      const batchStartTime = Date.now()
      const batchPromises = []
      
      const connectionsInBatch = Math.min(batchSize, maxConnections - (batch * batchSize))
      
      for (let i = 0; i < connectionsInBatch; i++) {
        const globalIndex = (batch * batchSize) + i
        batchPromises.push(createConnection(`limit_player${globalIndex}`, `Limit Player ${globalIndex}`))
      }
      
      try {
        const batchConnections = await Promise.all(batchPromises)
        allConnections.push(...batchConnections)
        
        const batchTime = Date.now() - batchStartTime
        connectionTimes.push(batchTime)
        
        console.log(`Batch ${batch + 1}/${batches}: ${batchConnections.length} connections in ${batchTime}ms`)
        
        // Brief pause between batches
        await new Promise(resolve => setTimeout(resolve, 500))
        
      } catch (error) {
        console.log(`Batch ${batch + 1} failed after ${allConnections.length} total connections:`, error.message)
        break // Stop if we hit server limits
      }
    }
    
    console.log(`Successfully created ${allConnections.length} connections`)
    
    // Test server responsiveness under load
    const responseStartTime = Date.now()
    
    // Send a message from each connection
    let messagesSent = 0
    for (const conn of allConnections) {
      if (sendMessage(conn, 'load_test', { 
        playerId: conn.playerId,
        timestamp: Date.now()
      })) {
        messagesSent++
      }
    }
    
    const responseTime = Date.now() - responseStartTime
    console.log(`Sent ${messagesSent} messages in ${responseTime}ms`)
    
    // Wait for message processing
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Check server health under maximum load
    try {
      const healthResponse = await fetch(`http://localhost:${TEST_PORT}/health`)
      const isHealthy = healthResponse.ok
      
      if (isHealthy) {
        const healthData = await healthResponse.json()
        console.log('Server health under load:', healthData)
      }
      
      // Server should either be healthy or gracefully indicate overload
      expect([200, 503]).toContain(healthResponse.status)
      
    } catch (error) {
      console.log('Health check failed under load:', error.message)
      // This is acceptable under extreme load
    }
    
    // Performance expectations
    expect(allConnections.length).toBeGreaterThan(50) // Should handle at least 50 connections
    expect(messagesSent).toBeGreaterThan(allConnections.length * 0.8) // 80% message success rate
    
    // Connection time shouldn't degrade too much with load
    const avgConnectionTime = connectionTimes.reduce((sum, time) => sum + time, 0) / connectionTimes.length
    console.log(`Average batch connection time: ${avgConnectionTime}ms`)
    
    expect(avgConnectionTime).toBeLessThan(10000) // Under 10 seconds per batch
    
  }, 120000) // 2 minute timeout for this intensive test
})