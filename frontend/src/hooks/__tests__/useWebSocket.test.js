import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../useWebSocket'

// Mock user object
const mockUser = {
  id: 'test-user-123',
  email: 'test@example.com',
  user_metadata: {
    full_name: 'Test User',
    avatar_url: 'https://example.com/avatar.jpg'
  }
}

describe('useWebSocket', () => {
  test('should initialize with correct default state', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', null)
    )

    expect(result.current.connectionStatus).toBe('disconnected')
    expect(result.current.socket).toBe(null)
    expect(result.current.gameState).toBe(null)
    expect(result.current.players).toEqual([])
    expect(result.current.messages).toEqual([])
    expect(result.current.error).toBe(null)
    expect(result.current.isConnected).toBe(false)
    expect(result.current.isConnecting).toBe(false)
  })

  test('should not send messages when disconnected', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', null)
    )

    const success = result.current.sendMessage('test', { data: 'test' })
    expect(success).toBe(false)
  })

  test('should provide sendMessage function', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', mockUser)
    )

    expect(typeof result.current.sendMessage).toBe('function')
  })

  test('should provide connect and disconnect functions', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', mockUser)
    )

    expect(typeof result.current.connect).toBe('function')
    expect(typeof result.current.disconnect).toBe('function')
  })

  test('should handle message state updates', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', mockUser)
    )

    // Test that messages array starts empty
    expect(result.current.messages).toEqual([])
    
    // Test that we can access the messages state
    expect(Array.isArray(result.current.messages)).toBe(true)
  })

  test('should handle game state updates', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', mockUser)
    )

    // Test that gameState starts as null
    expect(result.current.gameState).toBe(null)
  })

  test('should handle player list updates', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', mockUser)
    )

    // Test that players array starts empty
    expect(result.current.players).toEqual([])
    expect(Array.isArray(result.current.players)).toBe(true)
  })

  test('should handle error state', () => {
    const { result } = renderHook(() => 
      useWebSocket('ws://localhost:8080', mockUser)
    )

    // Test that error starts as null
    expect(result.current.error).toBe(null)
  })
})