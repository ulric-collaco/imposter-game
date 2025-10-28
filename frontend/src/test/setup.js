import '@testing-library/jest-dom'

// Mock WebSocket for testing
global.WebSocket = class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = WebSocket.CONNECTING
    this.onopen = null
    this.onclose = null
    this.onmessage = null
    this.onerror = null
    
    // Simulate connection after a short delay
    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      if (this.onopen) this.onopen()
    }, 10)
  }
  
  send(data) {
    // Mock send - can be overridden in tests
  }
  
  close(code = 1000, reason = '') {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) this.onclose({ code, reason })
  }
}

WebSocket.CONNECTING = 0
WebSocket.OPEN = 1
WebSocket.CLOSING = 2
WebSocket.CLOSED = 3