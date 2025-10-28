import { useState, useEffect, useRef } from 'react'

export function DiscussionBoard(props) {
  const messages = props.messages || []
  const onSendMessage = props.onSendMessage
  const timeRemaining = props.timeRemaining || 0
  const currentUser = props.currentUser
  const disabled = props.disabled || false
  const [messageInput, setMessageInput] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll to latest messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when component mounts and not disabled
  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus()
    }
  }, [disabled])

  const handleSubmit = (e) => {
    e.preventDefault()
    
    if (!messageInput.trim() || disabled || !onSendMessage) {
      return
    }

    // Send message through WebSocket
    onSendMessage(messageInput.trim())
    setMessageInput('')
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Format time remaining for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Determine timer color based on remaining time
  const getTimerColor = (seconds) => {
    if (seconds <= 10) return 'text-red-400'
    if (seconds <= 30) return 'text-yellow-400'
    return 'text-green-400'
  }

  return (
    <div className="flex flex-col h-96 bg-gray-800 rounded-lg">
      {/* Header with timer */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Discussion</h3>
        <div className={`text-xl font-mono ${getTimerColor(timeRemaining)}`}>
          {formatTime(timeRemaining)}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            No messages yet. Start the discussion!
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={message.id || index} className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-blue-400">
                  {message.playerName}
                </span>
                <span className="text-xs text-gray-500">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
                {message.playerId === currentUser?.id && (
                  <span className="text-xs text-gray-400">(you)</span>
                )}
              </div>
              <div className="text-gray-200 bg-gray-700 rounded-lg px-3 py-2 max-w-md">
                {message.message}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input form */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
        <div className="flex space-x-2">
          <input
            ref={inputRef}
            type="text"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={disabled ? "Discussion time has ended" : "Type your message..."}
            disabled={disabled}
            maxLength={200}
            className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={disabled || !messageInput.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {messageInput.length}/200 characters
        </div>
      </form>
    </div>
  )
}