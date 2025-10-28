import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../hooks/useWebSocket'
import WebSocket from 'ws'

// Mock WebSocket for network simulation
class NetworkSimulatorWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = WebSocket.CONNECTING
    this.onopen = null
    this.onclose = null
    this.onmessage = null
    this.onerror = null
    this.sentMessages = []
    
    // Network simulation properties
    this.networkDelay = 0
    this.packetLoss = 0
    this.shouldFailConnection = false
    this.shouldDropConnection = false
    
    NetworkSimulatorWebSocket.instances.push(this)
    
    // Simulate connection with network conditions
    setTimeout(() => {
      if (this.shouldFailConnection) {
        this.readyState = WebSocket.CLOSED
        if (this.onerror) {
          this.onerror(new Error('Connection failed'))
        }
        return
      }
      
      this.readyState = WebSocket.OPEN
      if (this.onopen) {
        this.onopen()
      }
    }, this.networkDelay)
  }
  
  send(data) {
    if (this.readyState !== WebSocket.OPEN) return
    
    // Simulate packet loss
    if (Math.random() < this.packetLoss) {
      console.log('Packet lost:', data)
      return
    }
    
    // Simulate network delay
    setTimeout(() => {
      this.sentMessages.push(JSON.parse(data))
    }, this.networkDelay)
  }
  
  close(code = 1000, reason = '') {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }
  
  // Test utilities
  simulateMessage(message) {
    if (this.onmessage && this.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        this.onmessage({ data: JSON.stringify(message) })
      }, this.networkDelay)
    }
  }
  
  simulateNetworkInterruption(duration = 5000) {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code: 1006, reason: 'Network interruption' })
    }
    
    // Restore connection after duration
    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      if (this.onopen) {
        this.onopen()
      }
    }, duration)
  }
  
  simulateSlowNetwork(delay = 2000) {
    this.networkDelay = delay
  }
  
  simulatePacketLoss(lossRate = 0.1) {
    this.packetLoss = lossRate
  }
  
  static instances = []
  static getLastInstance() {
    return this.instances[this.instances.length - 1]
  }
  
  static clearInstances() {
    this.instances = []
  }
}

// Mock global WebSocket
global.WebSocket = NetworkSimulatorWebSocket
WebSocket.CONNECTING = 0
WebSocket.OPEN = 1
WebSocket.CLOSING = 2
WebSocket.CLOSED = 3

describe('Network Resilience Tests', () => {
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
    NetworkSimulatorWebSocket.clearInstances()
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test('should handle network interruptions with automatic reconnection', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    // Wait for initial connection
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.isConnected).toBe(true)

    const ws = NetworkSimulatorWebSocket.getLastInstance()

    // Simulate network interruption
    act(() => {
      ws.simulateNetworkInterruption(3000)
    })

    expect(result.current.connectionStatus).toBe('disconnected')
    expect(result.current.isConnected).toBe(false)

    // Should attempt reconnection after delay
    await act(async () => {
      vi.advanceTimersByTime(2000) // Base reconnection delay
    })

    expect(result.current.connectionStatus).toBe('connecting')

    // Complete reconnection
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.isConnected).toBe(true)
  })

  test('should implement exponential backoff for reconnection attempts', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    // Initial connection
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Simulate multiple connection failures
    for (let attempt = 0; attempt < 3; attempt++) {
      const ws = NetworkSimulatorWebSocket.getLastInstance()
      
      // Force connection failure
      act(() => {
        ws.shouldFailConnection = true
        ws.simulateNetworkInterruption(0)
      })

      expect(result.current.connectionStatus).toBe('disconnected')

      // Calculate expected delay (exponential backoff)
      const expectedDelay = Math.min(1000 * Math.pow(2, attempt), 30000)
      
      // Advance time by less than expected delay - should still be disconnected
      await act(async () => {
        vi.advanceTimersByTime(expectedDelay - 100)
      })

      expect(result.current.connectionStatus).toBe('disconnected')

      // Advance past the delay - should attempt reconnection
      await act(async () => {
        vi.advanceTimersByTime(200)
      })

      expect(result.current.connectionStatus).toBe('connecting')
    }
  })

  test('should handle slow network conditions gracefully', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    // Simulate slow network (2 second delay)
    const ws = NetworkSimulatorWebSocket.getLastInstance()
    ws.simulateSlowNetwork(2000)

    // Should still be connecting due to network delay
    expect(result.current.connectionStatus).toBe('connecting')

    // Advance time to complete slow connection
    await act(async () => {
      vi.advanceTimersByTime(2100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Test message sending with slow network
    const success = result.current.sendMessage('test', { data: 'test' })
    expect(success).toBe(true)

    // Message should be queued but not immediately processed due to delay
    expect(ws.sentMessages).toHaveLength(1) // Join message
    
    // Advance time to process the test message
    await act(async () => {
      vi.advanceTimersByTime(2100)
    })

    expect(ws.sentMessages).toHaveLength(2) // Join + test message
  })

  test('should handle packet loss scenarios', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    const ws = NetworkSimulatorWebSocket.getLastInstance()
    
    // Simulate 50% packet loss
    ws.simulatePacketLoss(0.5)

    // Send multiple messages
    const messagesSent = []
    for (let i = 0; i < 10; i++) {
      const success = result.current.sendMessage('test', { messageId: i })
      expect(success).toBe(true)
      messagesSent.push(i)
    }

    // Advance time to process messages
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    // Due to packet loss, not all messages should be received
    // (Note: This is a simulation - in real scenarios, TCP would handle retransmission)
    const receivedMessages = ws.sentMessages.filter(msg => msg.type === 'test')
    expect(receivedMessages.length).toBeLessThan(10)
    expect(receivedMessages.length).toBeGreaterThan(0)
  })

  test('should maintain connection stability under high message volume', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    const ws = NetworkSimulatorWebSocket.getLastInstance()
    
    // Send high volume of messages rapidly
    const messageCount = 100
    const sentMessages = []
    
    for (let i = 0; i < messageCount; i++) {
      const success = result.current.sendMessage('bulk_test', { 
        messageId: i,
        timestamp: Date.now() + i
      })
      expect(success).toBe(true)
      sentMessages.push(i)
    }

    // Process all messages
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // Connection should remain stable
    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.isConnected).toBe(true)

    // All messages should be queued (join message + bulk messages)
    expect(ws.sentMessages).toHaveLength(messageCount + 1)
  })

  test('should handle connection timeout scenarios', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    const ws = NetworkSimulatorWebSocket.getLastInstance()
    
    // Simulate connection that never completes
    ws.shouldFailConnection = true
    ws.networkDelay = 10000 // 10 second delay

    // Should remain in connecting state
    expect(result.current.connectionStatus).toBe('connecting')

    // Advance time but not enough to complete connection
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.connectionStatus).toBe('connecting')

    // Advance time to trigger connection failure
    await act(async () => {
      vi.advanceTimersByTime(6000)
    })

    expect(result.current.connectionStatus).toBe('disconnected')
    expect(result.current.error).toBeTruthy()
  })

  test('should handle server-side connection drops', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    const ws = NetworkSimulatorWebSocket.getLastInstance()

    // Simulate server dropping connection (code 1006 - abnormal closure)
    act(() => {
      ws.close(1006, 'Server dropped connection')
    })

    expect(result.current.connectionStatus).toBe('disconnected')

    // Should attempt automatic reconnection
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.connectionStatus).toBe('connecting')

    // Complete reconnection
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')
  })

  test('should not reconnect on clean disconnection', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    const ws = NetworkSimulatorWebSocket.getLastInstance()

    // Simulate clean disconnection (code 1000)
    act(() => {
      ws.close(1000, 'Normal closure')
    })

    expect(result.current.connectionStatus).toBe('disconnected')

    // Should not attempt reconnection after clean close
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.connectionStatus).toBe('disconnected')
  })

  test('should stop reconnection attempts after maximum retries', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    // Simulate repeated connection failures
    for (let attempt = 0; attempt < 12; attempt++) { // More than max attempts (10)
      const ws = NetworkSimulatorWebSocket.getLastInstance()
      ws.shouldFailConnection = true

      if (attempt === 0) {
        // Initial connection
        await act(async () => {
          vi.advanceTimersByTime(100)
        })
      } else {
        // Reconnection attempts
        await act(async () => {
          vi.advanceTimersByTime(2000 * Math.pow(2, Math.min(attempt - 1, 5)))
        })
      }

      if (attempt < 10) {
        expect(result.current.connectionStatus).toBe('connecting')
      }
    }

    // After max attempts, should give up
    expect(result.current.connectionStatus).toBe('error')
    expect(result.current.error).toContain('maximum attempts')
  })

  test('should handle message ordering under network delays', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    const ws = NetworkSimulatorWebSocket.getLastInstance()
    ws.simulateSlowNetwork(1000)

    // Send messages in sequence
    const messages = []
    for (let i = 0; i < 5; i++) {
      result.current.sendMessage('sequence_test', { 
        sequenceId: i,
        timestamp: Date.now() + i * 100
      })
      messages.push(i)
    }

    // Process messages with network delay
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Verify messages were sent in order (excluding join message)
    const sequenceMessages = ws.sentMessages
      .filter(msg => msg.type === 'sequence_test')
      .map(msg => msg.payload.sequenceId)

    expect(sequenceMessages).toEqual([0, 1, 2, 3, 4])
  })

  test('should handle network jitter and variable latency', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    const ws = NetworkSimulatorWebSocket.getLastInstance()
    
    // Simulate network jitter with variable delays
    const jitterDelays = [100, 500, 50, 300, 150]
    const messageResults = []

    for (let i = 0; i < jitterDelays.length; i++) {
      ws.networkDelay = jitterDelays[i]
      
      const startTime = Date.now()
      const success = result.current.sendMessage('jitter_test', { 
        messageId: i,
        expectedDelay: jitterDelays[i]
      })
      
      expect(success).toBe(true)
      messageResults.push({ messageId: i, startTime })
      
      // Advance time to process this message
      await act(async () => {
        vi.advanceTimersByTime(jitterDelays[i] + 50)
      })
    }

    // Connection should remain stable despite jitter
    expect(result.current.connectionStatus).toBe('connected')
    expect(ws.sentMessages.length).toBe(jitterDelays.length + 1) // +1 for join message
  })

  test('should handle intermittent connectivity issues', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Simulate intermittent connectivity - multiple short disconnections
    for (let i = 0; i < 3; i++) {
      const ws = NetworkSimulatorWebSocket.getLastInstance()
      
      // Short disconnection
      act(() => {
        ws.simulateNetworkInterruption(1000) // 1 second outage
      })

      expect(result.current.connectionStatus).toBe('disconnected')

      // Wait for reconnection
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(result.current.connectionStatus).toBe('connected')

      // Send a test message to verify connection works
      const success = result.current.sendMessage('connectivity_test', { 
        testId: i,
        timestamp: Date.now()
      })
      expect(success).toBe(true)

      // Brief stable period
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
    }

    // Final state should be connected
    expect(result.current.connectionStatus).toBe('connected')
  })

  test('should handle bandwidth limitations gracefully', async () => {
    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    const ws = NetworkSimulatorWebSocket.getLastInstance()
    
    // Simulate low bandwidth with high delays
    ws.simulateSlowNetwork(3000) // 3 second delay simulates very slow connection
    
    // Send multiple messages rapidly
    const messageCount = 5
    const sentMessages = []
    
    for (let i = 0; i < messageCount; i++) {
      const success = result.current.sendMessage('bandwidth_test', {
        messageId: i,
        data: 'x'.repeat(1000), // 1KB message
        timestamp: Date.now()
      })
      expect(success).toBe(true)
      sentMessages.push(i)
    }

    // Connection should remain stable even with slow processing
    expect(result.current.connectionStatus).toBe('connected')

    // Process messages slowly
    await act(async () => {
      vi.advanceTimersByTime(4000)
    })

    // All messages should eventually be processed
    expect(ws.sentMessages.length).toBe(messageCount + 1) // +1 for join
    expect(result.current.connectionStatus).toBe('connected')
  })

  test('should handle DNS resolution delays', async () => {
    class DNSDelayWebSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        this.onopen = null
        this.onclose = null
        this.onmessage = null
        this.onerror = null
        
        // Simulate DNS resolution delay
        setTimeout(() => {
          this.readyState = 1
          if (this.onopen) {
            this.onopen(new Event('open'))
          }
        }, 2000) // 2 second DNS delay
      }
      
      send(data) {
        this.sentMessages = this.sentMessages || []
        this.sentMessages.push(data)
      }
      
      close(code = 1000, reason = '') {
        this.readyState = 3
        if (this.onclose) {
          this.onclose({ code, reason })
        }
      }
    }

    global.WebSocket = DNSDelayWebSocket
    Object.assign(global.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    // Should remain in connecting state during DNS resolution
    expect(result.current.connectionStatus).toBe('connecting')

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // Still connecting after 1 second
    expect(result.current.connectionStatus).toBe('connecting')

    await act(async () => {
      vi.advanceTimersByTime(1500)
    })

    // Should be connected after DNS resolution completes
    expect(result.current.connectionStatus).toBe('connected')
  })

  test('should handle proxy and firewall interference', async () => {
    class ProxyInterferenceWebSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        this.onopen = null
        this.onclose = null
        this.onmessage = null
        this.onerror = null
        
        // Simulate proxy connection issues
        setTimeout(() => {
          // Random chance of proxy blocking connection
          if (Math.random() < 0.3) {
            this.readyState = 3
            if (this.onerror) {
              this.onerror(new Error('Proxy connection refused'))
            }
          } else {
            this.readyState = 1
            if (this.onopen) {
              this.onopen(new Event('open'))
            }
          }
        }, 500)
      }
      
      send(data) {
        // Simulate proxy filtering certain message types
        const message = JSON.parse(data)
        if (message.type === 'blocked_type') {
          // Proxy blocks this message type
          return
        }
        
        this.sentMessages = this.sentMessages || []
        this.sentMessages.push(data)
      }
      
      close(code = 1000, reason = '') {
        this.readyState = 3
        if (this.onclose) {
          this.onclose({ code, reason })
        }
      }
    }

    global.WebSocket = ProxyInterferenceWebSocket
    Object.assign(global.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // Connection may succeed or fail depending on proxy simulation
    const finalStatus = result.current.connectionStatus
    expect(['connected', 'disconnected']).toContain(finalStatus)

    if (finalStatus === 'connected') {
      // Test that certain message types might be blocked by proxy
      const normalSuccess = result.current.sendMessage('normal', { data: 'test' })
      const blockedSuccess = result.current.sendMessage('blocked_type', { data: 'blocked' })
      
      expect(normalSuccess).toBe(true)
      expect(blockedSuccess).toBe(true) // Hook doesn't know about proxy filtering
    }
  })
})