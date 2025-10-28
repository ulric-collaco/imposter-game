import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Custom hook for WebSocket connection management with authentication
 * Provides automatic reconnection logic with exponential backoff
 * Manages game state and real-time updates
 */
export function useWebSocket(url, user) {
  const [socket, setSocket] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('disconnected') // 'connecting', 'connected', 'disconnected', 'error'
  const [gameState, setGameState] = useState(null)
  const [players, setPlayers] = useState([])
  const [messages, setMessages] = useState([])
  const [error, setError] = useState(null)
  const [joinedSuccessfully, setJoinedSuccessfully] = useState(false)
  const [myPlayerId, setMyPlayerId] = useState(null)

  // Refs for managing reconnection
  const reconnectTimeoutRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttempts = 10
  const baseReconnectDelay = 1000 // 1 second
  const maxReconnectDelay = 30000 // 30 seconds

  // Calculate exponential backoff delay
  const getReconnectDelay = useCallback(() => {
    const delay = Math.min(
      baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
      maxReconnectDelay
    )
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000
  }, [])

  // Send message through WebSocket
  const sendMessage = useCallback((type, payload) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const message = {
        type,
        payload,
        timestamp: Date.now()
      }
      socket.send(JSON.stringify(message))
      return true
    }
    return false
  }, [socket])

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data)
      
      switch (message.type) {
        case 'connection_established':
          console.log('Connection established:', message.payload)
          setJoinedSuccessfully(false)
          break
        case 'join_success':
          console.log('Join successful:', message.payload)
          if (message.payload.gameState) {
            setGameState(message.payload.gameState)
          }
          if (message.payload.playerData?.id) {
            setMyPlayerId(message.payload.playerData.id)
          }
          setJoinedSuccessfully(true)
          break
        case 'game_state':
          setGameState(message.payload)
          break
        case 'player_update':
        case 'player_list_update':
          setPlayers(message.payload.players || [])
          break
        case 'game_starting':
          console.log('Game starting:', message.payload.message)
          // You could add a toast notification or countdown here
          break
        case 'chat_message':
        case 'chat_broadcast':
          setMessages(prev => [...prev, message.payload])
          break
        case 'phase_change':
          setGameState(prev => ({
            ...prev,
            phase: message.payload.phase,
            phaseData: message.payload.phaseData
          }))
          break
        case 'vote_progress':
          setGameState(prev => ({
            ...prev,
            votesReceived: message.payload.votesReceived,
            totalPlayers: message.payload.totalPlayers,
            allVotesReceived: message.payload.allVotesReceived
          }))
          break
        case 'ping':
          // Respond to server ping with pong
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: 'pong',
              payload: {},
              timestamp: Date.now()
            }))
          }
          break
        case 'pong':
          // Server responded to our ping
          break
        case 'error':
          setError(message.payload.message)
          break
        default:
          console.warn('Unknown message type:', message.type)
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err)
      setError('Failed to parse server message')
    }
  }, [])

  // Connect to WebSocket server
  const connect = useCallback(() => {
    if (!url) return

    setConnectionStatus('connecting')
    setError(null)

    try {
      const ws = new WebSocket(url)
      
      ws.onopen = () => {
        console.log('WebSocket connected')
        setConnectionStatus('connected')
        setSocket(ws)
        reconnectAttemptsRef.current = 0
        
        // Don't automatically join - wait for user to click "Join Game"
        console.log('WebSocket ready for game actions')
      }

      ws.onmessage = handleMessage

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason)
        setSocket(null)
        setConnectionStatus('disconnected')
        
        // Attempt reconnection if not a clean close
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = getReconnectDelay()
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`)
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++
            connect()
          }, delay)
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError('Failed to reconnect after maximum attempts')
          setConnectionStatus('error')
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        setError('WebSocket connection error')
        setConnectionStatus('error')
      }

    } catch (err) {
      console.error('Failed to create WebSocket connection:', err)
      setError('Failed to create WebSocket connection')
      setConnectionStatus('error')
    }
  }, [url, handleMessage, getReconnectDelay])

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    
    if (socket) {
      // Send leave message before closing if we had joined
      if (socket.readyState === WebSocket.OPEN && joinedSuccessfully) {
        const leaveMessage = {
          type: 'leave',
          payload: { },
          timestamp: Date.now()
        }
        socket.send(JSON.stringify(leaveMessage))
      }
      
      socket.close(1000, 'User disconnected')
      setSocket(null)
    }
    
    setConnectionStatus('disconnected')
    setJoinedSuccessfully(false)
    reconnectAttemptsRef.current = 0
  }, [socket])

  // Connect when user is authenticated and URL is available
  useEffect(() => {
    if (url) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [url])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [])

  // Public API
  return {
    socket,
    connectionStatus,
    gameState,
    players,
    messages,
    error,
    sendMessage,
    connect,
    disconnect,
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting',
    joinedSuccessfully,
    myPlayerId
  }
}