import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { DiscussionBoard } from '../DiscussionBoard.jsx'

describe('DiscussionBoard Component', () => {
  const mockCurrentUser = {
    id: 'user-123',
    email: 'test@example.com',
    user_metadata: {
      full_name: 'Test User'
    }
  }

  const mockMessages = [
    {
      id: 'msg1',
      playerId: 'user-123',
      playerName: 'Test User',
      message: 'Hello everyone!',
      timestamp: Date.now() - 60000
    },
    {
      id: 'msg2',
      playerId: 'user-456',
      playerName: 'Other Player',
      message: 'Hi there!',
      timestamp: Date.now() - 30000
    }
  ]

  const defaultProps = {
    messages: [],
    onSendMessage: vi.fn(),
    timeRemaining: 60,
    currentUser: mockCurrentUser,
    disabled: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Core Functionality', () => {
    test('should render discussion board with timer', () => {
      render(<DiscussionBoard {...defaultProps} />)

      expect(screen.getByText('Discussion')).toBeInTheDocument()
      expect(screen.getByText('1:00')).toBeInTheDocument()
    })

    test('should display messages', () => {
      render(
        <DiscussionBoard 
          {...defaultProps} 
          messages={mockMessages} 
        />
      )

      expect(screen.getByText('Hello everyone!')).toBeInTheDocument()
      expect(screen.getByText('Hi there!')).toBeInTheDocument()
    })

    test('should show empty state when no messages', () => {
      render(<DiscussionBoard {...defaultProps} />)

      expect(screen.getByText('No messages yet. Start the discussion!')).toBeInTheDocument()
    })
  })

  describe('Timer Functionality', () => {
    test('should display timer in MM:SS format', () => {
      render(<DiscussionBoard {...defaultProps} timeRemaining={125} />)

      expect(screen.getByText('2:05')).toBeInTheDocument()
    })

    test('should handle zero time remaining', () => {
      render(<DiscussionBoard {...defaultProps} timeRemaining={0} />)

      expect(screen.getByText('0:00')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    test('should call onSendMessage when form is submitted', () => {
      const mockOnSendMessage = vi.fn()
      
      render(
        <DiscussionBoard 
          {...defaultProps} 
          onSendMessage={mockOnSendMessage} 
        />
      )

      const input = screen.getByPlaceholderText('Type your message...')
      const sendButton = screen.getByText('Send')

      fireEvent.change(input, { target: { value: 'Test message' } })
      fireEvent.click(sendButton)

      expect(mockOnSendMessage).toHaveBeenCalledWith('Test message')
    })

    test('should not send empty messages', () => {
      const mockOnSendMessage = vi.fn()
      
      render(
        <DiscussionBoard 
          {...defaultProps} 
          onSendMessage={mockOnSendMessage} 
        />
      )

      const sendButton = screen.getByText('Send')
      fireEvent.click(sendButton)
      
      expect(mockOnSendMessage).not.toHaveBeenCalled()
    })

    test('should clear input after sending message', () => {
      const mockOnSendMessage = vi.fn()
      
      render(
        <DiscussionBoard 
          {...defaultProps} 
          onSendMessage={mockOnSendMessage} 
        />
      )

      const input = screen.getByPlaceholderText('Type your message...')
      const sendButton = screen.getByText('Send')

      fireEvent.change(input, { target: { value: 'Test message' } })
      fireEvent.click(sendButton)

      expect(input.value).toBe('')
    })
  })

  describe('Disabled State', () => {
    test('should disable input and button when disabled', () => {
      render(<DiscussionBoard {...defaultProps} disabled={true} />)

      const input = screen.getByPlaceholderText('Discussion time has ended')
      const sendButton = screen.getByText('Send')

      expect(input).toBeDisabled()
      expect(sendButton).toBeDisabled()
    })
  })
})