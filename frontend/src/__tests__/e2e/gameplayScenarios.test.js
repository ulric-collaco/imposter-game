import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { chromium, firefox, webkit } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import GameServer from '../../../backend/index.js'

// Test configuration
const TEST_PORT = 8082
const TEST_URL = `http://localhost:3000` // Vite dev server
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

describe('End-to-End Gameplay Scenarios', () => {
  let server
  let supabase
  let browsers = {}
  let contexts = {}
  let pages = {}

  beforeAll(async () => {
    // Initialize Supabase client (or disable DB ops)
    if (USE_DB) {
      supabase = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_KEY)
    } else {
      console.warn('[e2e] Supabase DB disabled for tests (USE_DB_TESTS!=true and not local). Skipping DB operations.')
      supabase = null
    }
    
    // Start WebSocket server
    server = new GameServer()
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Launch browsers for cross-browser testing
    browsers.chromium = await chromium.launch({ headless: true })
    browsers.firefox = await firefox.launch({ headless: true })
    browsers.webkit = await webkit.launch({ headless: true })
    
    console.log('E2E test environment initialized')
  }, 30000)

  afterAll(async () => {
    // Close browsers
    for (const browser of Object.values(browsers)) {
      if (browser) await browser.close()
    }
    
    // Shutdown server
    if (server) {
      server.shutdown()
    }
  }, 10000)

  beforeEach(async () => {
    // Clean database (if enabled)
    if (USE_DB) {
      await cleanupDatabase()
    }
    
    // Create browser contexts
    for (const [name, browser] of Object.entries(browsers)) {
      contexts[name] = await browser.newContext({
        // Mock WebSocket URL for testing
        extraHTTPHeaders: {
          'X-Test-WebSocket-URL': TEST_WS_URL
        }
      })
      pages[name] = await contexts[name].newPage()
    }
  })

  afterEach(async () => {
    // Close contexts
    for (const context of Object.values(contexts)) {
      if (context) await context.close()
    }
    contexts = {}
    pages = {}
    
    // Clean database
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

  async function mockAuthentication(page, userId, userName) {
    // Mock Supabase authentication
    await page.addInitScript((userId, userName) => {
      window.mockUser = {
        id: userId,
        email: `${userName.toLowerCase()}@test.com`,
        user_metadata: {
          full_name: userName,
          avatar_url: `https://example.com/${userId}.jpg`
        }
      }
      
      // Mock Supabase client
      window.supabase = {
        auth: {
          getSession: () => Promise.resolve({
            data: { session: { user: window.mockUser } }
          }),
          onAuthStateChange: (callback) => {
            callback('SIGNED_IN', { user: window.mockUser })
            return { data: { subscription: { unsubscribe: () => {} } } }
          },
          signInWithOAuth: () => Promise.resolve(),
          signOut: () => Promise.resolve()
        },
        from: () => ({
          select: () => ({ data: [], error: null }),
          insert: () => Promise.resolve({ error: null }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
          upsert: () => Promise.resolve({ error: null })
        }),
        channel: () => ({
          on: () => ({ subscribe: () => {} }),
          track: () => Promise.resolve(),
          untrack: () => Promise.resolve()
        }),
        removeChannel: () => {}
      }
    }, userId, userName)
  }

  test('should support complete gameplay across multiple browsers', async () => {
    const browserNames = ['chromium', 'firefox', 'webkit']
    const playerData = [
      { id: 'player1', name: 'Alice' },
      { id: 'player2', name: 'Bob' },
      { id: 'player3', name: 'Charlie' }
    ]

    // Set up authentication for each browser
    for (let i = 0; i < browserNames.length; i++) {
      const browserName = browserNames[i]
      const player = playerData[i]
      
      await mockAuthentication(pages[browserName], player.id, player.name)
      await pages[browserName].goto(TEST_URL)
      
      // Wait for app to load
      await pages[browserName].waitForSelector('h1:has-text("Imposter")')
    }

    // Join game from each browser
    for (let i = 0; i < browserNames.length; i++) {
      const browserName = browserNames[i]
      const page = pages[browserName]
      
      // Click join button
      await page.click('button:has-text("Join Game")')
      
      // Wait for join confirmation
      await page.waitForSelector('span:has-text("✓ Joined")')
      
      // Verify player appears in player list
      await page.waitForSelector(`text=${playerData[i].name}`)
    }

    // Start game from first browser
    await pages.chromium.click('button:has-text("Start Game")')

    // Wait for question phase in all browsers
    for (const browserName of browserNames) {
      await pages[browserName].waitForSelector('text=Phase: question')
    }

    // Submit answers from each browser
    const answers = ['Red apple', 'Green apple', 'Yellow banana']
    for (let i = 0; i < browserNames.length; i++) {
      const browserName = browserNames[i]
      const page = pages[browserName]
      
      // Fill answer
      await page.fill('textarea[placeholder="Your answer..."]', answers[i])
      
      // Submit answer
      await page.click('button:has-text("Submit Answer")')
    }

    // Wait for discussion phase
    for (const browserName of browserNames) {
      await pages[browserName].waitForSelector('text=Phase: discussion')
    }

    // Test chat functionality
    await pages.chromium.fill('input[placeholder="Type your message..."]', 'I think Bob is suspicious')
    await pages.chromium.press('input[placeholder="Type your message..."]', 'Enter')

    // Verify message appears in other browsers
    for (const browserName of ['firefox', 'webkit']) {
      await pages[browserName].waitForSelector('text=I think Bob is suspicious')
    }

    // Wait for voting phase (or manually trigger)
    // Note: In real test, we'd wait for timer or manually advance
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Simulate voting phase transition
    for (const browserName of browserNames) {
      await pages[browserName].waitForSelector('text=Phase: voting', { timeout: 10000 })
    }

    // Cast votes from each browser
    const votes = ['Bob', 'Charlie', 'Alice']
    for (let i = 0; i < browserNames.length; i++) {
      const browserName = browserNames[i]
      const page = pages[browserName]
      
      // Click on player to vote for
      await page.click(`button:has-text("${votes[i]}")`)
      
      // Confirm vote
      await page.click('button:has-text("Submit Vote")')
    }

    // Wait for results phase
    for (const browserName of browserNames) {
      await pages[browserName].waitForSelector('text=Phase: results')
    }

    // Verify results are displayed consistently across browsers
    for (const browserName of browserNames) {
      const page = pages[browserName]
      
      // Check that vote results are shown
      await page.waitForSelector('text=Vote Results')
      
      // Check that imposter is revealed
      await page.waitForSelector('text=Imposter:')
      
      // Check that game outcome is displayed
      const outcome = await page.textContent('[data-testid="game-outcome"]')
      expect(outcome).toMatch(/(Players Won|Imposter Won)/)
    }

    // Verify database consistency (if DB testing enabled)
    if (USE_DB && supabase) {
      const { data: finalGameState } = await supabase
        .from('game_state')
        .select('*')
        .eq('id', 1)
        .single()
      
      expect(finalGameState.state).toBe('results')
      expect(finalGameState.results).toBeDefined()
    }
  }, 60000)

  test('should handle player disconnection during gameplay', async () => {
    const browserNames = ['chromium', 'firefox']
    const playerData = [
      { id: 'player1', name: 'Alice' },
      { id: 'player2', name: 'Bob' }
    ]

    // Set up players
    for (let i = 0; i < browserNames.length; i++) {
      const browserName = browserNames[i]
      const player = playerData[i]
      
      await mockAuthentication(pages[browserName], player.id, player.name)
      await pages[browserName].goto(TEST_URL)
      await pages[browserName].waitForSelector('h1:has-text("Imposter")')
      
      // Join game
      await pages[browserName].click('button:has-text("Join Game")')
      await pages[browserName].waitForSelector('span:has-text("✓ Joined")')
    }

    // Add third player programmatically to meet minimum (only if DB enabled)
    if (USE_DB && supabase) {
      await supabase.from('players').insert({
        id: 'player3',
        name: 'Charlie',
        joined_at: new Date().toISOString(),
        is_active: true
      })
    }

    // Start game
    await pages.chromium.click('button:has-text("Start Game")')
    
    // Wait for question phase
    await pages.chromium.waitForSelector('text=Phase: question')
    await pages.firefox.waitForSelector('text=Phase: question')

    // Disconnect one player by closing browser context
    await contexts.firefox.close()
    delete pages.firefox

    // Verify remaining player can continue
    await pages.chromium.fill('textarea[placeholder="Your answer..."]', 'Test answer')
    await pages.chromium.click('button:has-text("Submit Answer")')

    // Game should continue despite disconnection
    // (Implementation would need to handle minimum player requirements)
    
    // Verify database reflects disconnection (if DB enabled)
    if (USE_DB && supabase) {
      const { data: activePlayers } = await supabase
        .from('players')
        .select('*')
        .eq('is_active', true)
      
      expect(activePlayers.length).toBeLessThan(3)
    }
  }, 30000)

  test('should maintain performance under concurrent load', async () => {
    const concurrentPlayers = 5
    const playerContexts = []
    const playerPages = []

    // Create multiple concurrent connections
    for (let i = 0; i < concurrentPlayers; i++) {
      const context = await browsers.chromium.newContext()
      const page = await context.newPage()
      
      await mockAuthentication(page, `player${i + 1}`, `Player ${i + 1}`)
      await page.goto(TEST_URL)
      await page.waitForSelector('h1:has-text("Imposter")')
      
      playerContexts.push(context)
      playerPages.push(page)
    }

    // Measure join performance
    const joinStartTime = Date.now()
    
    // Join all players concurrently
    const joinPromises = playerPages.map(page => 
      page.click('button:has-text("Join Game")')
    )
    await Promise.all(joinPromises)

    // Wait for all joins to complete
    const joinCompletionPromises = playerPages.map(page =>
      page.waitForSelector('span:has-text("✓ Joined")')
    )
    await Promise.all(joinCompletionPromises)
    
    const joinEndTime = Date.now()
    const joinDuration = joinEndTime - joinStartTime
    
    // Join should complete within reasonable time (5 seconds)
    expect(joinDuration).toBeLessThan(5000)

    // Start game
    await playerPages[0].click('button:has-text("Start Game")')

    // Measure phase transition performance
    const phaseStartTime = Date.now()
    
    const phasePromises = playerPages.map(page =>
      page.waitForSelector('text=Phase: question')
    )
    await Promise.all(phasePromises)
    
    const phaseEndTime = Date.now()
    const phaseDuration = phaseEndTime - phaseStartTime
    
    // Phase transition should be fast (2 seconds)
    expect(phaseDuration).toBeLessThan(2000)

    // Test concurrent message sending
    const messageStartTime = Date.now()
    
    // Submit answers concurrently
    const answerPromises = playerPages.map((page, index) => {
      return page.fill('textarea[placeholder="Your answer..."]', `Answer ${index + 1}`)
        .then(() => page.click('button:has-text("Submit Answer")'))
    })
    await Promise.all(answerPromises)

    const messageEndTime = Date.now()
    const messageDuration = messageEndTime - messageStartTime
    
    // Concurrent operations should complete quickly (3 seconds)
    expect(messageDuration).toBeLessThan(3000)

    // Verify all answers were recorded (if DB enabled)
    if (USE_DB && supabase) {
      const { data: answers } = await supabase
        .from('answers')
        .select('*')
      
      expect(answers).toHaveLength(concurrentPlayers)
    }

    // Clean up
    for (const context of playerContexts) {
      await context.close()
    }
  }, 45000)

  test('should validate deployment environment configuration', async () => {
    // Test WebSocket server health endpoint
    const response = await fetch(`http://localhost:${TEST_PORT}/health`)
    expect(response.ok).toBe(true)
    
    const healthData = await response.json()
    expect(healthData.status).toBe('healthy')
    expect(healthData.uptime).toBeGreaterThan(0)

    // Test CORS configuration
    const corsResponse = await fetch(`http://localhost:${TEST_PORT}/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET'
      }
    })
    expect(corsResponse.ok).toBe(true)

    // Test WebSocket connection from browser
    await mockAuthentication(pages.chromium, 'test-user', 'Test User')
    await pages.chromium.goto(TEST_URL)
    
    // Check connection status indicator
    await pages.chromium.waitForSelector('[data-testid="connection-status"]')
    const connectionStatus = await pages.chromium.textContent('[data-testid="connection-status"]')
    expect(connectionStatus).toMatch(/(Connected|Connecting)/)

    // Test environment variable configuration
    expect(process.env.SUPABASE_URL).toBeTruthy()
    expect(process.env.SUPABASE_SERVICE_KEY).toBeTruthy()
    
    // Verify database connectivity (if DB enabled)
    if (USE_DB && supabase) {
      const { data, error } = await supabase
        .from('game_state')
        .select('*')
        .limit(1)
      
      expect(error).toBeNull()
      expect(data).toBeDefined()
    }
  }, 15000)

  test('should handle browser-specific WebSocket implementations', async () => {
    const browserTests = [
      { name: 'chromium', page: pages.chromium },
      { name: 'firefox', page: pages.firefox },
      { name: 'webkit', page: pages.webkit }
    ]

    for (const { name, page } of browserTests) {
      console.log(`Testing WebSocket in ${name}`)
      
      await mockAuthentication(page, `${name}-user`, `${name} User`)
      await page.goto(TEST_URL)
      
      // Wait for app to load
      await page.waitForSelector('h1:has-text("Imposter")')
      
      // Test WebSocket connection
      await page.click('button:has-text("Join Game")')
      
      // Verify connection works in this browser
      await page.waitForSelector('span:has-text("✓ Joined")', { timeout: 10000 })
      
      // Test message sending
      await page.evaluate(() => {
        // Send test message via WebSocket
        if (window.webSocketHook && window.webSocketHook.sendMessage) {
          window.webSocketHook.sendMessage('test', { browser: 'test' })
        }
      })
      
      // Verify no JavaScript errors
      const errors = []
      page.on('pageerror', error => errors.push(error))
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      expect(errors).toHaveLength(0)
      
      // Leave game to clean up
      await page.click('button:has-text("Leave Game")')
    }
  }, 30000)

  test('should handle network latency variations', async () => {
    // Simulate different network conditions
    const networkConditions = [
      { name: 'fast', downloadThroughput: 10000000, uploadThroughput: 10000000, latency: 10 },
      { name: 'slow', downloadThroughput: 100000, uploadThroughput: 100000, latency: 500 },
      { name: 'mobile', downloadThroughput: 500000, uploadThroughput: 250000, latency: 200 }
    ]

    for (const condition of networkConditions) {
      console.log(`Testing under ${condition.name} network conditions`)
      
      // Create new context with network conditions
      const context = await browsers.chromium.newContext()
      const page = await context.newPage()
      
      // Simulate network conditions
      await context.route('**/*', route => {
        setTimeout(() => route.continue(), condition.latency)
      })
      
      await mockAuthentication(page, `${condition.name}-user`, `${condition.name} User`)
      await page.goto(TEST_URL)
      
      // Measure connection time
      const startTime = Date.now()
      await page.waitForSelector('h1:has-text("Imposter")')
      
      // Join game
      await page.click('button:has-text("Join Game")')
      await page.waitForSelector('span:has-text("✓ Joined")')
      
      const endTime = Date.now()
      const connectionTime = endTime - startTime
      
      console.log(`${condition.name} network connection time: ${connectionTime}ms`)
      
      // Even slow networks should connect within reasonable time
      expect(connectionTime).toBeLessThan(15000)
      
      await context.close()
    }
  }, 60000)
})