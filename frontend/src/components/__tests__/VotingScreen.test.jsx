import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { VotingScreen } from '../VotingScreen.jsx'

describe('VotingScreen Component', () => {
  const mockCurrentUser = {
    id: 'user-123',
    email: 'test@example.com',
    user_metadata: {
      full_name: 'Test User'
    }
  }

  const mockPlayers = [
    {
      id: 'user-123',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar1.jpg',
      status: 'online'
    },
    {
      id: 'user-456',
      name: 'Player Two',
      avatar_url: 'https://example.com/avatar2.jpg',
      status: 'online'
    },
    {
      id: 'user-789',
      name: 'Player Three',
      status: 'online'
    }
  ]

  const defaultProps = {
    players: mockPlayers,
    onVote: vi.fn(),
    votingProgress: { voted: 1, total: 3 },
    currentUser: mockCurrentUser,
    disabled: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Core Functionality', () => {
    test('should render voting screen with header', () => {
      render(<VotingScreen {...defaultProps} />)

      expect(screen.getByText('Who is the imposter?')).toBeInTheDocument()
      expect(screen.getByText('Select a player you believe is the imposter and cast your vote')).toBeInTheDocument()
    })

    test('should display voting progress', () => {
      render(<VotingScreen {...defaultProps} />)

      expect(screen.getByText('1 / 3 votes cast')).toBeInTheDocument()
      expect(screen.getByText('33% complete')).toBeInTheDocument()
    })

    test('should exclude current user from voting options', () => {
      render(<VotingScreen {...defaultProps} />)

      // Current user should not appear as voting option
      expect(screen.queryByRole('button', { name: /Test User/ })).not.toBeInTheDocument()
      
      // Other players should appear
      expect(screen.getByRole('button', { name: /Player Two/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Player Three/ })).toBeInTheDocument()
    })
  })

  describe('Player Selection', () => {
    test('should highlight selected player', () => {
      render(<VotingScreen {...defaultProps} />)

      const playerButton = screen.getByRole('button', { name: /Player Two/ })
      fireEvent.click(playerButton)

      // Should show confirmation modal
      expect(screen.getByText('Confirm Your Vote')).toBeInTheDocument()
      expect(screen.getByText(/Are you sure you want to vote for Player Two/)).toBeInTheDocument()
    })

    test('should show player avatars when available', () => {
      render(<VotingScreen {...defaultProps} />)

      const avatarImages = screen.getAllByRole('img')
      expect(avatarImages).toHaveLength(2) // Two players have avatar_url
      expect(avatarImages[0]).toHaveAttribute('src', 'https://example.com/avatar2.jpg')
    })

    test('should display player status', () => {
      render(<VotingScreen {...defaultProps} />)

      expect(screen.getAllByText('online')).toHaveLength(2) // Two voteable players
    })
  })

  describe('Vote Confirmation', () => {
    test('should show confirmation modal when player is selected', () => {
      render(<VotingScreen {...defaultProps} />)

      const playerButton = screen.getByRole('button', { name: /Player Two/ })
      fireEvent.click(playerButton)

      expect(screen.getByText('Confirm Your Vote')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirm Vote' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    test('should call onVote when vote is confirmed', () => {
      const mockOnVote = vi.fn()
      render(<VotingScreen {...defaultProps} onVote={mockOnVote} />)

      const playerButton = screen.getByRole('button', { name: /Player Two/ })
      fireEvent.click(playerButton)

      const confirmButton = screen.getByRole('button', { name: 'Confirm Vote' })
      fireEvent.click(confirmButton)

      expect(mockOnVote).toHaveBeenCalledWith('user-456')
    })

    test('should close modal when vote is cancelled', () => {
      render(<VotingScreen {...defaultProps} />)

      const playerButton = screen.getByRole('button', { name: /Player Two/ })
      fireEvent.click(playerButton)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      fireEvent.click(cancelButton)

      expect(screen.queryByText('Confirm Your Vote')).not.toBeInTheDocument()
    })

    test('should show vote submitted status after voting', () => {
      const mockOnVote = vi.fn()
      render(<VotingScreen {...defaultProps} onVote={mockOnVote} />)

      const playerButton = screen.getByRole('button', { name: /Player Two/ })
      fireEvent.click(playerButton)

      const confirmButton = screen.getByRole('button', { name: 'Confirm Vote' })
      fireEvent.click(confirmButton)

      expect(screen.getByText('✓ Vote submitted successfully')).toBeInTheDocument()
      expect(screen.getByText('Waiting for other players to vote...')).toBeInTheDocument()
    })
  })

  describe('Progress Display', () => {
    test('should calculate progress percentage correctly', () => {
      render(<VotingScreen {...defaultProps} votingProgress={{ voted: 2, total: 4 }} />)

      expect(screen.getByText('2 / 4 votes cast')).toBeInTheDocument()
      expect(screen.getByText('50% complete')).toBeInTheDocument()
    })

    test('should handle zero total players', () => {
      render(<VotingScreen {...defaultProps} votingProgress={{ voted: 0, total: 0 }} />)

      expect(screen.getByText('0 / 0 votes cast')).toBeInTheDocument()
      expect(screen.getByText('0% complete')).toBeInTheDocument()
    })

    test('should show progress bar with correct width', () => {
      render(<VotingScreen {...defaultProps} votingProgress={{ voted: 1, total: 4 }} />)

      const progressBar = document.querySelector('.bg-blue-600')
      expect(progressBar).toHaveStyle('width: 25%')
    })
  })

  describe('Disabled State', () => {
    test('should disable voting when disabled prop is true', () => {
      render(<VotingScreen {...defaultProps} disabled={true} />)

      const playerButtons = screen.getAllByRole('button')
      playerButtons.forEach(button => {
        expect(button).toBeDisabled()
      })
    })

    test('should disable voting after user has voted', async () => {
      const mockOnVote = vi.fn()
      render(<VotingScreen {...defaultProps} onVote={mockOnVote} />)

      // Vote for a player
      const playerButton = screen.getByRole('button', { name: /Player Two/ })
      fireEvent.click(playerButton)

      const confirmButton = screen.getByRole('button', { name: 'Confirm Vote' })
      fireEvent.click(confirmButton)

      // All player buttons should be disabled after voting
      await waitFor(() => {
        const playerButtons = screen.getAllByRole('button')
        const votingButtons = playerButtons.filter(btn => 
          btn.textContent.includes('Player Two') || btn.textContent.includes('Player Three')
        )
        votingButtons.forEach(button => {
          expect(button).toBeDisabled()
        })
      })
    })
  })

  describe('Empty State', () => {
    test('should show empty state when no voteable players', () => {
      const singlePlayerProps = {
        ...defaultProps,
        players: [mockCurrentUser] // Only current user
      }
      
      render(<VotingScreen {...singlePlayerProps} />)

      expect(screen.getByText('No other players available to vote for')).toBeInTheDocument()
    })
  })

  describe('WebSocket Integration', () => {
    test('should handle voting progress updates', () => {
      const { rerender } = render(<VotingScreen {...defaultProps} />)

      // Update voting progress
      rerender(
        <VotingScreen 
          {...defaultProps} 
          votingProgress={{ voted: 2, total: 3 }} 
        />
      )

      expect(screen.getByText('2 / 3 votes cast')).toBeInTheDocument()
      expect(screen.getByText('67% complete')).toBeInTheDocument()
    })

    test('should not call onVote if function is not provided', () => {
      render(<VotingScreen {...defaultProps} onVote={undefined} />)

      const playerButton = screen.getByRole('button', { name: /Player Two/ })
      fireEvent.click(playerButton)

      const confirmButton = screen.getByRole('button', { name: 'Confirm Vote' })
      fireEvent.click(confirmButton)

      // Should not throw error and should show voted state
      expect(screen.getByText('✓ Vote submitted successfully')).toBeInTheDocument()
    })
  })
})