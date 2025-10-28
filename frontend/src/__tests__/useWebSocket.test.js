import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../hooks/useWebSocket'
import { vi } from 'vitest'

// Simple WebSocket mock for testing core functionality
class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = WebSocket.CONNECTING
    this.onopen = null
    this.onclose = null
    this.onmessage = null
    this.onerror = null
    this.sentMessages = []
    
    // Store instance for test access
    MockWebSocket.lastInstance = this
    
    // Auto-connect after a short delay to simulate real behavior
    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      if (this.onopen) {
        this.onopen()
      }
    }, 10)
  }
  
  send(data) {
    if (this.readyState === WebSocket.OPEN) {
      this.sentMessages.push(JSON.parse(data))
    }
  }
  
  close(code = 1000, reason = '') {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }
  
  // Test helper methods
  simulateMessage(message) {
    if (this.onmessage && this.readyState === WebSocket.OPEN) {
      this.onmessage({ data: JSON.stringify(message) })
    }
  }
  
  simulateError() {
    if (this.onerror) {
      this.onerror(new Error('Connection error'))
    }
  }
  
  simulateClose(code = 1006, reason = 'Connection lost') {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }
}

// Mock WebSocket globally
global.WebSocket = MockWebSocket
WebSocket.CONNECTING = 0
WebSocket.OPEN = 1
WebSocket.CLOSING = 2
WebSocket.CLOSED = 3

describe('useWebSocket Integration Tests', () => {
  const mockUrl = 'ws://localhost:8080'
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    user_metadata: {
      full_name: 'Test User',
      avatar_url: 'https://example.com/avatar.jpg'
    }
  }

  beforeEach(() => {
    MockWebSocket.lastInstance = null
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('Connection Establishment', () => {
    test('should establish WebSocket connection when user and url are provided', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      // Initially connecting
      expect(result.current.connectionStatus).toBe('connecting')
      expect(result.current.isConnecting).toBe(true)
      expect(result.current.isConnected).toBe(false)
      expect(MockWebSocket.lastInstance).toBeTruthy()
      expect(MockWebSocket.lastInstance.url).toBe(mockUrl)

      // Wait for auto-connection
      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      // Should be connected
      expect(result.current.connectionStatus).toBe('connected')
      expect(result.current.isConnected).toBe(true)
      expect(result.current.isConnecting).toBe(false)
    })

    test('should send authentication message on connection', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      // Wait for connection
      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      expect(result.current.isConnected).toBe(true)

      const sentMessages = MockWebSocket.lastInstance.sentMessages
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toEqual({
        type: 'join',
        payload: {
          playerId: mockUser.id,
          playerName: mockUser.user_metadata.full_name,
          avatarUrl: mockUser.user_metadata.avatar_url
        },
        playerId: mockUser.id,
        timestamp: expect.any(Number)
      })
    })

    test('should not connect when user is not provided', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, null))

      expect(result.current.connectionStatus).toBe('disconnected')
      expect(result.current.isConnected).toBe(false)
      expect(MockWebSocket.lastInstance).toBeFalsy()
    })

    test('should not connect when url is not provided', () => {
      const { result } = renderHook(() => useWebSocket(null, mockUser))

      expect(result.current.connectionStatus).toBe('disconnected')
      expect(result.current.isConnected).toBe(false)
      expect(MockWebSocket.lastInstance).toBeFalsy()
    })
  })

  describe('Message Handling', () => {
    test('should handle game_state messages', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      // Wait for connection
      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      const gameState = {
        phase: 'discussion',
        players: ['player1', 'player2'],
        imposter: 'player1'
      }

      act(() => {
        MockWebSocket.lastInstance.simulateMessage({
          type: 'game_state',
          payload: gameState
        })
      })

      expect(result.current.gameState).toEqual(gameState)
    })

    test('should handle player_update messages', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      const players = [
        { id: 'player1', name: 'Player 1' },
        { id: 'player2', name: 'Player 2' }
      ]

      act(() => {
        MockWebSocket.lastInstance.simulateMessage({
          type: 'player_update',
          payload: { players }
        })
      })

      expect(result.current.players).toEqual(players)
    })

    test('should handle chat_message messages', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      const chatMessage = {
        id: 'msg1',
        playerId: 'player1',
        playerName: 'Player 1',
        message: 'Hello everyone!',
        timestamp: Date.now()
      }

      act(() => {
        MockWebSocket.lastInstance.simulateMessage({
          type: 'chat_message',
          payload: chatMessage
        })
      })

      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0]).toEqual(chatMessage)
    })

    test('should handle error messages', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      act(() => {
        MockWebSocket.lastInstance.simulateMessage({
          type: 'error',
          payload: { message: 'Game not found' }
        })
      })

      expect(result.current.error).toBe('Game not found')
    })

    test('should handle invalid JSON messages gracefully', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      // Simulate invalid JSON message directly
      act(() => {
        if (MockWebSocket.lastInstance.onmessage) {
          MockWebSocket.lastInstance.onmessage({ data: 'invalid json' })
        }
      })

      expect(result.current.error).toBe('Failed to parse server message')
    })
  })

  describe('Reconnection Scenarios', () => {
    test('should attempt reconnection on unexpected disconnect', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      // Wait for initial connection
      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      expect(result.current.isConnected).toBe(true)

      // Simulate unexpected disconnect
      act(() => {
        MockWebSocket.lastInstance.simulateClose(1006, 'Connection lost')
      })

      expect(result.current.connectionStatus).toBe('disconnected')

      // Should schedule reconnection - advance timers to trigger it
      await act(async () => {
        vi.advanceTimersByTime(2000) // Base delay + jitter
      })

      // Should be attempting to reconnect (new WebSocket instance created)
      expect(result.current.connectionStatus).toBe('connecting')
    })

    test('should not reconnect on clean disconnect', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      expect(result.current.isConnected).toBe(true)

      // Simulate clean disconnect (code 1000)
      act(() => {
        MockWebSocket.lastInstance.simulateClose(1000, 'Normal closure')
      })

      expect(result.current.connectionStatus).toBe('disconnected')

      // Should not attempt reconnection even after waiting
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      expect(result.current.connectionStatus).toBe('disconnected')
    })
  })

  describe('Authentication Integration', () => {
    test('should include user information in join message', async () => {
      const userWithMetadata = {
        id: 'user-456',
        email: 'john@example.com',
        user_metadata: {
          full_name: 'John Doe',
          avatar_url: 'https://example.com/john.jpg'
        }
      }

      const { result } = renderHook(() => useWebSocket(mockUrl, userWithMetadata))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      const sentMessages = MockWebSocket.lastInstance.sentMessages
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].payload).toEqual({
        playerId: userWithMetadata.id,
        playerName: userWithMetadata.user_metadata.full_name,
        avatarUrl: userWithMetadata.user_metadata.avatar_url
      })
    })

    test('should fallback to email when full_name is not available', async () => {
      const userWithoutName = {
        id: 'user-789',
        email: 'jane@example.com',
        user_metadata: {}
      }

      const { result } = renderHook(() => useWebSocket(mockUrl, userWithoutName))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      const sentMessages = MockWebSocket.lastInstance.sentMessages
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].payload.playerName).toBe(userWithoutName.email)
    })

    test('should disconnect when user becomes null', async () => {
      const { result, rerender } = renderHook(
        ({ url, user }) => useWebSocket(url, user),
        { initialProps: { url: mockUrl, user: mockUser } }
      )

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      expect(result.current.isConnected).toBe(true)

      // Update user to null (logout)
      rerender({ url: mockUrl, user: null })

      expect(result.current.connectionStatus).toBe('disconnected')
      expect(result.current.isConnected).toBe(false)
    })

    test('should send leave message on manual disconnect', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      expect(result.current.isConnected).toBe(true)

      // Clear previous messages
      MockWebSocket.lastInstance.sentMessages = []

      // Manually disconnect
      act(() => {
        result.current.disconnect()
      })

      const sentMessages = MockWebSocket.lastInstance.sentMessages
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toEqual({
        type: 'leave',
        payload: { playerId: mockUser.id },
        playerId: mockUser.id,
        timestamp: expect.any(Number)
      })
    })
  })

  describe('Message Sending', () => {
    test('should send messages when connected', async () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(20)
      })

      expect(result.current.isConnected).toBe(true)

      // Clear join message
      MockWebSocket.lastInstance.sentMessages = []

      const success = result.current.sendMessage('chat', { message: 'Hello!' })

      expect(success).toBe(true)
      expect(MockWebSocket.lastInstance.sentMessages).toHaveLength(1)
      expect(MockWebSocket.lastInstance.sentMessages[0]).toEqual({
        type: 'chat',
        payload: { message: 'Hello!' },
        playerId: mockUser.id,
        timestamp: expect.any(Number)
      })
    })

    test('should not send messages when disconnected', () => {
      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      // Don't wait for connection - test while still connecting
      const success = result.current.sendMessage('chat', { message: 'Hello!' })

      expect(success).toBe(false)
    })
  })
})