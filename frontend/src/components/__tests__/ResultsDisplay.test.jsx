import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { ResultsDisplay } from '../ResultsDisplay.jsx'

describe('ResultsDisplay Component', () => {
  const mockPlayers = [
    {
      id: 'user-123',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar1.jpg'
    },
    {
      id: 'user-456',
      name: 'Player Two',
      avatar_url: 'https://example.com/avatar2.jpg'
    },
    {
      id: 'user-789',
      name: 'Player Three'
    }
  ]

  const defaultProps = {
    voteResults: {
      'user-456': 2,
      'user-789': 1
    },
    imposter: 'user-456',
    players: mockPlayers,
    onNewGame: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Core Functionality', () => {
    test('should render results display with game outcome', () => {
      render(<ResultsDisplay {...defaultProps} />)

      expect(screen.getByText('🎉 Players Win!')).toBeInTheDocument()
      expect(screen.getByText(/Players win! The imposter Player Two was successfully voted out!/)).toBeInTheDocument()
    })

    test('should display imposter reveal section', () => {
      render(<ResultsDisplay {...defaultProps} />)

      expect(screen.getByText('🎭 Imposter Revealed')).toBeInTheDocument()
      expect(screen.getByText('Player Two')).toBeInTheDocument()
      expect(screen.getByText('was the imposter')).toBeInTheDocument()
    })

    test('should show vote results section', () => {
      render(<ResultsDisplay {...defaultProps} />)

      expect(screen.getByText('📊 Vote Results')).toBeInTheDocument()
      expect(screen.getByText('Total votes cast: 3')).toBeInTheDocument()
    })
  })

  describe('Game Outcome Calculations', () => {
    test('should show players win when imposter is voted out', () => {
      render(<ResultsDisplay {...defaultProps} />)

      expect(screen.getByText('🎉 Players Win!')).toBeInTheDocument()
      expect(screen.getByText(/Players win! The imposter Player Two was successfully voted out!/)).toBeInTheDocument()
    })

    test('should show imposter wins when innocent player is voted out', () => {
      const imposterWinsProps = {
        ...defaultProps,
        voteResults: {
          'user-123': 2, // Innocent player gets most votes
          'user-456': 1  // Imposter gets fewer votes
        },
        imposter: 'user-456'
      }

      render(<ResultsDisplay {...imposterWinsProps} />)

      expect(screen.getByText('😈 Imposter Wins!')).toBeInTheDocument()
      expect(screen.getByText(/Imposter wins! An innocent player Test User was voted out./)).toBeInTheDocument()
    })

    test('should show imposter wins on tie vote', () => {
      const tieProps = {
        ...defaultProps,
        voteResults: {
          'user-123': 1,
          'user-456': 1, // Imposter tied
          'user-789': 1
        },
        imposter: 'user-456'
      }

      render(<ResultsDisplay {...tieProps} />)

      expect(screen.getByText('😈 Imposter Wins!')).toBeInTheDocument()
      expect(screen.getByText(/Imposter wins! The vote was tied and the imposter survived./)).toBeInTheDocument()
    })

    test('should show imposter wins when tie excludes imposter', () => {
      const tieNoImposterProps = {
        ...defaultProps,
        voteResults: {
          'user-123': 2, // Tied for most votes
          'user-789': 2, // Tied for most votes
          'user-456': 1  // Imposter has fewer votes
        },
        imposter: 'user-456'
      }

      render(<ResultsDisplay {...tieNoImposterProps} />)

      expect(screen.getByText('😈 Imposter Wins!')).toBeInTheDocument()
      expect(screen.getByText(/Imposter wins! The vote was tied and no one was eliminated./)).toBeInTheDocument()
    })
  })

  describe('Vote Tally Display', () => {
    test('should display vote tallies sorted by vote count', () => {
      render(<ResultsDisplay {...defaultProps} />)

      const voteItems = screen.getAllByText(/votes?$/)
      expect(voteItems[0]).toHaveTextContent('2') // Player Two with most votes first
      expect(voteItems[1]).toHaveTextContent('1') // Player Three with fewer votes second
    })

    test('should highlight imposter in vote results', () => {
      render(<ResultsDisplay {...defaultProps} />)

      expect(screen.getByText('IMPOSTER')).toBeInTheDocument()
    })

    test('should show player avatars in vote results when available', () => {
      render(<ResultsDisplay {...defaultProps} />)

      const avatarImages = screen.getAllByRole('img')
      expect(avatarImages.length).toBeGreaterThan(0)
      
      // Check imposter reveal avatar
      const imposterAvatar = avatarImages.find(img => 
        img.getAttribute('alt')?.includes('Player Two')
      )
      expect(imposterAvatar).toHaveAttribute('src', 'https://example.com/avatar2.jpg')
    })

    test('should handle empty vote results', () => {
      const emptyVotesProps = {
        ...defaultProps,
        voteResults: {}
      }

      render(<ResultsDisplay {...emptyVotesProps} />)

      expect(screen.getByText('No votes were cast')).toBeInTheDocument()
      expect(screen.getByText('Total votes cast: 0')).toBeInTheDocument()
    })

    test('should calculate vote percentages correctly', () => {
      render(<ResultsDisplay {...defaultProps} />)

      // Check that progress bars are rendered (they use inline styles)
      const progressBars = document.querySelectorAll('.bg-red-500, .bg-blue-500')
      expect(progressBars.length).toBeGreaterThan(0)
    })
  })

  describe('Imposter Reveal', () => {
    test('should show imposter player information', () => {
      render(<ResultsDisplay {...defaultProps} />)

      expect(screen.getByText('Player Two')).toBeInTheDocument()
      expect(screen.getByText('was the imposter')).toBeInTheDocument()
    })

    test('should handle unknown imposter', () => {
      const unknownImposterProps = {
        ...defaultProps,
        imposter: 'unknown-id'
      }

      render(<ResultsDisplay {...unknownImposterProps} />)

      expect(screen.getByText('Unknown')).toBeInTheDocument()
      expect(screen.getByText('was the imposter')).toBeInTheDocument()
    })

    test('should display imposter avatar when available', () => {
      render(<ResultsDisplay {...defaultProps} />)

      const imposterAvatar = screen.getByAltText('Player Two avatar')
      expect(imposterAvatar).toHaveAttribute('src', 'https://example.com/avatar2.jpg')
    })
  })

  describe('New Game Functionality', () => {
    test('should show new game and return to lobby buttons', () => {
      render(<ResultsDisplay {...defaultProps} />)

      expect(screen.getByText('🎮 Start New Game')).toBeInTheDocument()
      expect(screen.getByText('🏠 Return to Lobby')).toBeInTheDocument()
    })

    test('should show confirmation modal when starting new game', () => {
      render(<ResultsDisplay {...defaultProps} />)

      const newGameButton = screen.getByText('🎮 Start New Game')
      fireEvent.click(newGameButton)

      expect(screen.getByText('Start New Game?')).toBeInTheDocument()
      expect(screen.getByText(/This will reset the current game and return all players to the waiting lobby/)).toBeInTheDocument()
    })

    test('should call onNewGame when confirmed', async () => {
      const mockOnNewGame = vi.fn().mockResolvedValue()
      
      render(<ResultsDisplay {...defaultProps} onNewGame={mockOnNewGame} />)

      const newGameButton = screen.getByText('🎮 Start New Game')
      fireEvent.click(newGameButton)

      const confirmButton = screen.getByText('Yes, Start New Game')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockOnNewGame).toHaveBeenCalled()
      })
    })

    test('should close modal when cancelled', () => {
      render(<ResultsDisplay {...defaultProps} />)

      const newGameButton = screen.getByText('🎮 Start New Game')
      fireEvent.click(newGameButton)

      const cancelButton = screen.getByText('Cancel')
      fireEvent.click(cancelButton)

      expect(screen.queryByText('Start New Game?')).not.toBeInTheDocument()
    })

    test('should handle return to lobby action', async () => {
      const mockOnNewGame = vi.fn().mockResolvedValue()
      
      render(<ResultsDisplay {...defaultProps} onNewGame={mockOnNewGame} />)

      const lobbyButton = screen.getByText('🏠 Return to Lobby')
      fireEvent.click(lobbyButton)

      await waitFor(() => {
        expect(mockOnNewGame).toHaveBeenCalled()
      })
    })

    test('should show loading state during reset', async () => {
      const mockOnNewGame = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 100))
      )
      
      render(<ResultsDisplay {...defaultProps} onNewGame={mockOnNewGame} />)

      const lobbyButton = screen.getByText('🏠 Return to Lobby')
      fireEvent.click(lobbyButton)

      expect(screen.getByText('⏳ Returning...')).toBeInTheDocument()
      
      await waitFor(() => {
        expect(screen.queryByText('⏳ Returning...')).not.toBeInTheDocument()
      })
    })

    test('should handle new game errors gracefully', async () => {
      const mockOnNewGame = vi.fn().mockRejectedValue(new Error('Network error'))
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      
      render(<ResultsDisplay {...defaultProps} onNewGame={mockOnNewGame} />)

      const newGameButton = screen.getByText('🎮 Start New Game')
      fireEvent.click(newGameButton)

      const confirmButton = screen.getByText('Yes, Start New Game')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('Failed to start new game. Please try again.')
      })

      alertSpy.mockRestore()
    })

    test('should disable buttons during loading', async () => {
      const mockOnNewGame = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 100))
      )
      
      render(<ResultsDisplay {...defaultProps} onNewGame={mockOnNewGame} />)

      const newGameButton = screen.getByText('🎮 Start New Game')
      const lobbyButton = screen.getByText('🏠 Return to Lobby')
      
      fireEvent.click(lobbyButton)

      expect(newGameButton).toBeDisabled()
      expect(lobbyButton).toBeDisabled()
      
      await waitFor(() => {
        expect(newGameButton).not.toBeDisabled()
        expect(lobbyButton).not.toBeDisabled()
      })
    })
  })

  describe('Edge Cases', () => {
    test('should handle missing onNewGame prop', () => {
      const propsWithoutCallback = {
        ...defaultProps,
        onNewGame: undefined
      }

      render(<ResultsDisplay {...propsWithoutCallback} />)

      const newGameButton = screen.getByText('🎮 Start New Game')
      fireEvent.click(newGameButton)

      const confirmButton = screen.getByText('Yes, Start New Game')
      fireEvent.click(confirmButton)

      // Should not throw error
      expect(screen.getByText('🎮 Start New Game')).toBeInTheDocument()
    })

    test('should handle empty players array', () => {
      const emptyPlayersProps = {
        ...defaultProps,
        players: []
      }

      render(<ResultsDisplay {...emptyPlayersProps} />)

      expect(screen.getByText('Unknown')).toBeInTheDocument() // Imposter name fallback
    })

    test('should handle missing vote results', () => {
      const noVotesProps = {
        ...defaultProps,
        voteResults: null
      }

      render(<ResultsDisplay {...noVotesProps} />)

      expect(screen.getByText('No votes were cast')).toBeInTheDocument()
    })
  })
})