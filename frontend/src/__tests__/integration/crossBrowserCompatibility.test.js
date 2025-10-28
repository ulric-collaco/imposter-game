import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../hooks/useWebSocket'

// Browser compatibility test suite
describe('Cross-Browser WebSocket Compatibility', () => {
  const mockUrl = 'ws://localhost:8080'
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    user_metadata: {
      full_name: 'Test User',
      avatar_url: 'https://example.com/avatar.jpg'
    }
  }

  // Mock different browser WebSocket implementations
  class ChromeWebSocket {
    constructor(url) {
      this.url = url
      this.readyState = 0 // CONNECTING
      this.protocol = ''
      this.extensions = ''
      this.bufferedAmount = 0
      this.binaryType = 'blob'
      
      // Chrome-specific behavior
      this.onopen = null
      this.onclose = null
      this.onmessage = null
      this.onerror = null
      
      ChromeWebSocket.instances.push(this)
      
      // Simulate Chrome's connection behavior
      setTimeout(() => {
        this.readyState = 1 // OPEN
        if (this.onopen) {
          this.onopen(new Event('open'))
        }
      }, 50)
    }
    
    send(data) {
      if (this.readyState !== 1) {
        throw new Error('WebSocket is not open')
      }
      // Chrome handles large messages well
      this.sentMessages = this.sentMessages || []
      this.sentMessages.push(data)
    }
    
    close(code = 1000, reason = '') {
      this.readyState = 3 // CLOSED
      if (this.onclose) {
        this.onclose({ code, reason, wasClean: code === 1000 })
      }
    }
    
    static instances = []
    static clear() { this.instances = [] }
  }

  class FirefoxWebSocket {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.protocol = ''
      this.extensions = ''
      this.bufferedAmount = 0
      this.binaryType = 'blob'
      
      this.onopen = null
      this.onclose = null
      this.onmessage = null
      this.onerror = null
      
      FirefoxWebSocket.instances.push(this)
      
      // Firefox has slightly different timing
      setTimeout(() => {
        this.readyState = 1
        if (this.onopen) {
          this.onopen(new Event('open'))
        }
      }, 80)
    }
    
    send(data) {
      if (this.readyState !== 1) {
        throw new Error('InvalidStateError: WebSocket connection is not open')
      }
      // Firefox is more strict about message size
      if (data.length > 65536) {
        throw new Error('Message too large')
      }
      this.sentMessages = this.sentMessages || []
      this.sentMessages.push(data)
    }
    
    close(code = 1000, reason = '') {
      this.readyState = 3
      if (this.onclose) {
        this.onclose({ code, reason, wasClean: code === 1000 })
      }
    }
    
    static instances = []
    static clear() { this.instances = [] }
  }

  class SafariWebSocket {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.protocol = ''
      this.extensions = ''
      this.bufferedAmount = 0
      this.binaryType = 'blob'
      
      this.onopen = null
      this.onclose = null
      this.onmessage = null
      this.onerror = null
      
      SafariWebSocket.instances.push(this)
      
      // Safari can be slower to connect
      setTimeout(() => {
        this.readyState = 1
        if (this.onopen) {
          this.onopen(new Event('open'))
        }
      }, 120)
    }
    
    send(data) {
      if (this.readyState !== 1) {
        throw new Error('InvalidStateError')
      }
      // Safari has conservative message handling
      if (data.length > 32768) {
        // Split large messages
        const chunks = []
        for (let i = 0; i < data.length; i += 32768) {
          chunks.push(data.slice(i, i + 32768))
        }
        this.sentMessages = this.sentMessages || []
        this.sentMessages.push(...chunks)
      } else {
        this.sentMessages = this.sentMessages || []
        this.sentMessages.push(data)
      }
    }
    
    close(code = 1000, reason = '') {
      this.readyState = 3
      if (this.onclose) {
        this.onclose({ code, reason, wasClean: code === 1000 })
      }
    }
    
    static instances = []
    static clear() { this.instances = [] }
  }

  class EdgeWebSocket {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.protocol = ''
      this.extensions = ''
      this.bufferedAmount = 0
      this.binaryType = 'blob'
      
      this.onopen = null
      this.onclose = null
      this.onmessage = null
      this.onerror = null
      
      EdgeWebSocket.instances.push(this)
      
      // Edge connection timing
      setTimeout(() => {
        this.readyState = 1
        if (this.onopen) {
          this.onopen(new Event('open'))
        }
      }, 60)
    }
    
    send(data) {
      if (this.readyState !== 1) {
        throw new Error('InvalidStateError: WebSocket connection is not open')
      }
      this.sentMessages = this.sentMessages || []
      this.sentMessages.push(data)
    }
    
    close(code = 1000, reason = '') {
      this.readyState = 3
      if (this.onclose) {
        this.onclose({ code, reason, wasClean: code === 1000 })
      }
    }
    
    static instances = []
    static clear() { this.instances = [] }
  }

  // WebSocket constants
  const WS_CONSTANTS = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
  }

  beforeEach(() => {
    ChromeWebSocket.clear()
    FirefoxWebSocket.clear()
    SafariWebSocket.clear()
    EdgeWebSocket.clear()
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test('should work with Chrome WebSocket implementation', async () => {
    global.WebSocket = ChromeWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    expect(result.current.connectionStatus).toBe('connecting')

    // Chrome connects relatively quickly
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.isConnected).toBe(true)

    // Test message sending
    const success = result.current.sendMessage('test', { data: 'chrome test' })
    expect(success).toBe(true)

    const ws = ChromeWebSocket.instances[0]
    expect(ws.sentMessages).toHaveLength(2) // join + test message
  })

  test('should work with Firefox WebSocket implementation', async () => {
    global.WebSocket = FirefoxWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    expect(result.current.connectionStatus).toBe('connecting')

    // Firefox takes slightly longer to connect
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Test Firefox's message size limitations
    const success = result.current.sendMessage('test', { 
      data: 'firefox test',
      largeData: 'x'.repeat(1000) // Within Firefox limits
    })
    expect(success).toBe(true)

    const ws = FirefoxWebSocket.instances[0]
    expect(ws.sentMessages).toHaveLength(2)
  })

  test('should handle Firefox large message restrictions', async () => {
    global.WebSocket = FirefoxWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Try to send a message that exceeds Firefox limits
    const largeMessage = 'x'.repeat(70000) // Exceeds 65536 limit
    
    // This should fail gracefully without crashing the connection
    const success = result.current.sendMessage('large_test', { data: largeMessage })
    
    // The hook should handle the error and return false
    expect(success).toBe(false)
    expect(result.current.connectionStatus).toBe('connected') // Connection should remain stable
  })

  test('should work with Safari WebSocket implementation', async () => {
    global.WebSocket = SafariWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    expect(result.current.connectionStatus).toBe('connecting')

    // Safari takes longer to connect
    await act(async () => {
      vi.advanceTimersByTime(150)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Test Safari's message chunking behavior
    const success = result.current.sendMessage('test', { 
      data: 'safari test',
      mediumData: 'x'.repeat(40000) // Will be chunked by Safari
    })
    expect(success).toBe(true)

    const ws = SafariWebSocket.instances[0]
    // Safari may split the large message into chunks
    expect(ws.sentMessages.length).toBeGreaterThanOrEqual(2)
  })

  test('should work with Edge WebSocket implementation', async () => {
    global.WebSocket = EdgeWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    expect(result.current.connectionStatus).toBe('connecting')

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Test Edge compatibility
    const success = result.current.sendMessage('test', { data: 'edge test' })
    expect(success).toBe(true)

    const ws = EdgeWebSocket.instances[0]
    expect(ws.sentMessages).toHaveLength(2)
  })

  test('should handle browser-specific connection errors gracefully', async () => {
    // Test with a browser that fails to connect
    class FailingWebSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        this.onopen = null
        this.onclose = null
        this.onmessage = null
        this.onerror = null
        
        // Simulate connection failure
        setTimeout(() => {
          this.readyState = 3
          if (this.onerror) {
            this.onerror(new Error('Browser-specific connection error'))
          }
        }, 100)
      }
      
      send() { throw new Error('Connection failed') }
      close() {}
    }

    global.WebSocket = FailingWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(result.current.connectionStatus).toBe('disconnected')
    expect(result.current.error).toBeTruthy()
  })

  test('should handle different browser event object formats', async () => {
    class CustomEventWebSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        this.onopen = null
        this.onclose = null
        this.onmessage = null
        this.onerror = null
        
        setTimeout(() => {
          this.readyState = 1
          // Different browsers may have different event formats
          if (this.onopen) {
            this.onopen({
              type: 'open',
              target: this,
              currentTarget: this,
              bubbles: false,
              cancelable: false
            })
          }
        }, 50)
      }
      
      send(data) {
        this.sentMessages = this.sentMessages || []
        this.sentMessages.push(data)
        
        // Simulate receiving a message with browser-specific format
        if (this.onmessage) {
          setTimeout(() => {
            this.onmessage({
              type: 'message',
              data: JSON.stringify({ type: 'echo', payload: JSON.parse(data) }),
              origin: 'ws://localhost:8080',
              lastEventId: '',
              source: null,
              ports: []
            })
          }, 10)
        }
      }
      
      close(code = 1000, reason = '') {
        this.readyState = 3
        if (this.onclose) {
          this.onclose({
            type: 'close',
            code,
            reason,
            wasClean: code === 1000,
            target: this,
            currentTarget: this
          })
        }
      }
    }

    global.WebSocket = CustomEventWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Send a message and verify it handles the custom event format
    const success = result.current.sendMessage('test', { data: 'custom event test' })
    expect(success).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(50)
    })

    // Should handle the echo message without errors
    expect(result.current.connectionStatus).toBe('connected')
  })

  test('should handle browser-specific close code behaviors', async () => {
    const closeCodeTests = [
      { browser: 'Chrome', code: 1006, shouldReconnect: true },
      { browser: 'Firefox', code: 1001, shouldReconnect: true },
      { browser: 'Safari', code: 1000, shouldReconnect: false },
      { browser: 'Edge', code: 1011, shouldReconnect: true }
    ]

    for (const testCase of closeCodeTests) {
      class BrowserSpecificWebSocket {
        constructor(url) {
          this.url = url
          this.readyState = 0
          this.onopen = null
          this.onclose = null
          this.onmessage = null
          this.onerror = null
          
          setTimeout(() => {
            this.readyState = 1
            if (this.onopen) this.onopen(new Event('open'))
          }, 50)
        }
        
        send(data) {
          this.sentMessages = this.sentMessages || []
          this.sentMessages.push(data)
        }
        
        close(code = 1000, reason = '') {
          this.readyState = 3
          if (this.onclose) {
            this.onclose({ 
              code, 
              reason, 
              wasClean: code === 1000,
              type: 'close'
            })
          }
        }
        
        simulateDisconnect() {
          this.close(testCase.code, `${testCase.browser} disconnect`)
        }
      }

      global.WebSocket = BrowserSpecificWebSocket
      Object.assign(global.WebSocket, WS_CONSTANTS)

      const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      expect(result.current.connectionStatus).toBe('connected')

      // Simulate browser-specific disconnect
      const ws = new BrowserSpecificWebSocket(mockUrl)
      act(() => {
        ws.simulateDisconnect()
      })

      if (testCase.shouldReconnect) {
        // Should attempt reconnection for abnormal closures
        await act(async () => {
          vi.advanceTimersByTime(2000)
        })
        expect(result.current.connectionStatus).toBe('connecting')
      } else {
        // Should not reconnect for normal closures
        expect(result.current.connectionStatus).toBe('disconnected')
      }
    }
  })

  test('should handle browser-specific WebSocket feature detection', async () => {
    // Test with limited WebSocket support (older browsers)
    class LimitedWebSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        // Missing some modern properties
        this.protocol = undefined
        this.extensions = undefined
        this.binaryType = 'blob' // Default only
        
        this.onopen = null
        this.onclose = null
        this.onmessage = null
        this.onerror = null
        
        setTimeout(() => {
          this.readyState = 1
          if (this.onopen) this.onopen(new Event('open'))
        }, 50)
      }
      
      send(data) {
        // Limited send functionality
        if (typeof data !== 'string') {
          throw new Error('Only string data supported')
        }
        this.sentMessages = this.sentMessages || []
        this.sentMessages.push(data)
      }
      
      close(code, reason) {
        // Limited close functionality
        this.readyState = 3
        if (this.onclose) {
          this.onclose({ code: code || 1000, reason: reason || '' })
        }
      }
    }

    global.WebSocket = LimitedWebSocket
    Object.assign(global.WebSocket, WS_CONSTANTS)

    const { result } = renderHook(() => useWebSocket(mockUrl, mockUser))

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.connectionStatus).toBe('connected')

    // Should work even with limited WebSocket implementation
    const success = result.current.sendMessage('test', { data: 'limited browser test' })
    expect(success).toBe(true)
  })
})