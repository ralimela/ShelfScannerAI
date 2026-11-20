import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AskPage from '@/app/ask/page'
import { chatWithAgent } from '@/lib/api'

jest.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: null, idToken: null }),
}))
jest.mock('@/lib/user', () => ({ getOrCreateUserId: () => 'user_test' }))
jest.mock('@/lib/api', () => ({ chatWithAgent: jest.fn() }))
jest.mock('@/components/TasteBackdrop', () => () => null)

const mockedChat = chatWithAgent as jest.MockedFunction<typeof chatWithAgent>

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  mockedChat.mockReset()
  sessionStorage.clear()
})

const pick = {
  rank: 1,
  title: 'Pet Sematary',
  author: 'Stephen King',
  pageCount: 374,
  reasoning: 'King at his most unsettling.',
  matchScore: 0.4,
  matchedSignals: [],
  similarTo: { title: 'It', author: 'Stephen King', distance: 0.6 },
  estimatedHours: null,
}

describe('AskPage', () => {
  it('sends the typed message and shows the reply with its picks', async () => {
    mockedChat.mockResolvedValue({ reply: 'Start with Pet Sematary.', picks: [pick], mode: 'cold_start', hasTasteSignal: true, processingTimeMs: 900 })
    render(<AskPage />)

    const input = screen.getByLabelText('Message the reading companion')
    fireEvent.change(input, { target: { value: 'Pet Sematary or Hill House?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('Start with Pet Sematary.')).toBeInTheDocument()
    expect(screen.getByText('Pet Sematary or Hill House?')).toBeInTheDocument()
    expect(screen.getByText(/#1 Pet Sematary/)).toBeInTheDocument()
    expect(mockedChat).toHaveBeenCalledWith('user_test', [{ role: 'user', content: 'Pet Sematary or Hill House?' }], null)
  })

  it('carries earlier picks into the next request so follow-ups have context', async () => {
    mockedChat
      .mockResolvedValueOnce({ reply: 'Pet Sematary.', picks: [pick], mode: 'cold_start', hasTasteSignal: true, processingTimeMs: 900 })
      .mockResolvedValueOnce({ reply: 'It is about 374 pages.', picks: [], mode: 'cold_start', hasTasteSignal: true, processingTimeMs: 700 })
    render(<AskPage />)

    fireEvent.click(screen.getByText('Something creepy but under 300 pages'))
    await screen.findByText('Pet Sematary.')

    const input = screen.getByLabelText('Message the reading companion')
    fireEvent.change(input, { target: { value: 'How long is it?' } })
    fireEvent.click(screen.getByLabelText('Send'))
    await screen.findByText('It is about 374 pages.')

    const followUpMessages = mockedChat.mock.calls[1][1]
    expect(followUpMessages[1]).toEqual({ role: 'assistant', content: 'Pet Sematary.\n\n[Books shown: Pet Sematary]' })
    expect(followUpMessages[2]).toEqual({ role: 'user', content: 'How long is it?' })
  })

  it('nudges a reader with no taste data to sign up and hides the fake match score', async () => {
    mockedChat.mockResolvedValue({
      reply: 'Try Pride and Prejudice first.',
      picks: [{ ...pick, title: 'Pride and Prejudice', matchScore: null, similarTo: null }],
      mode: 'cold_start',
      hasTasteSignal: false,
      processingTimeMs: 800,
    })
    render(<AskPage />)

    fireEvent.click(screen.getByText('Dune or Project Hail Mary for a long weekend?'))
    await screen.findByText('Try Pride and Prejudice first.')

    expect(screen.queryByText(/% match/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Similar to/)).not.toBeInTheDocument()
    expect(screen.getByText('Create account')).toHaveAttribute('href', '/login')
    expect(screen.getByText('Set preferences')).toHaveAttribute('href', '/profile')
  })

  it('offers a retry when the agent call fails', async () => {
    mockedChat.mockRejectedValueOnce(new Error('Gateway timeout')).mockResolvedValueOnce({
      reply: 'Recovered.',
      picks: [],
      mode: 'cold_start',
      hasTasteSignal: true,
      processingTimeMs: 500,
    })
    render(<AskPage />)

    fireEvent.click(screen.getByText('Dune or Project Hail Mary for a long weekend?'))
    expect(await screen.findByText('Gateway timeout')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Try again'))
    await waitFor(() => expect(screen.getByText('Recovered.')).toBeInTheDocument())
    expect(mockedChat).toHaveBeenCalledTimes(2)
  })
})
