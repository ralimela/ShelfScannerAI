import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PreferencesEditor from '@/components/PreferencesEditor'
import { submitOnboarding } from '@/lib/api'
import type { TasteProfile } from '@/lib/types'

jest.mock('@/lib/api', () => ({ submitOnboarding: jest.fn() }))
const mockedSubmit = submitOnboarding as jest.MockedFunction<typeof submitOnboarding>

const profile: TasteProfile = {
  favoriteGenres: ['Horror', 'Thriller'],
  favoriteAuthors: ['Stephen King'],
  dislikedGenres: ['Romance'],
  preferredPacing: null,
  preferredLength: null,
  writingStylePrefs: ['Atmospheric dread', 'Strong climax-driven storytelling'],
  avoidThemes: [],
  lastUpdated: '2026-11-19T00:00:00Z',
}

beforeEach(() => mockedSubmit.mockReset())

describe('PreferencesEditor', () => {
  it('pre-fills saved preferences and saves edits without dropping untouched ones', async () => {
    mockedSubmit.mockResolvedValue({ userId: 'u1', tasteProfile: profile })
    const onSaved = jest.fn()
    render(<PreferencesEditor userId="u1" initial={profile} variant="edit" onSaved={onSaved} />)

    expect(screen.getByText('Horror')).toBeInTheDocument()
    expect(screen.getByText('Atmospheric dread')).toBeInTheDocument()

    const genres = screen.getByLabelText('Favorite genres')
    fireEvent.change(genres, { target: { value: 'Science fiction' } })
    fireEvent.keyDown(genres, { key: 'Enter' })

    const authors = screen.getByLabelText('Favorite authors')
    fireEvent.change(authors, { target: { value: 'Shirley Jackson, horror' } })
    fireEvent.blur(authors)

    fireEvent.click(screen.getByLabelText('Remove Strong climax-driven storytelling'))
    fireEvent.click(screen.getByText('Save preferences'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mockedSubmit).toHaveBeenCalledWith(
      'u1',
      {
        favoriteGenres: ['Horror', 'Thriller', 'Science fiction'],
        favoriteAuthors: ['Stephen King', 'Shirley Jackson', 'horror'],
        writingStylePrefs: ['Atmospheric dread'],
        dislikedGenres: ['Romance'],
        avoidThemes: [],
      },
      null
    )
  })

  it('ignores duplicate tags regardless of case and removes the last tag on backspace', () => {
    render(<PreferencesEditor userId="u1" initial={profile} variant="edit" onSaved={jest.fn()} />)
    const genres = screen.getByLabelText('Favorite genres')

    fireEvent.change(genres, { target: { value: 'HORROR' } })
    fireEvent.keyDown(genres, { key: 'Enter' })
    expect(screen.getAllByText(/^horror$/i)).toHaveLength(1)

    fireEvent.keyDown(genres, { key: 'Backspace' })
    expect(screen.queryByText('Thriller')).not.toBeInTheDocument()
  })

  it('shows save errors and offers no cancel during onboarding', async () => {
    mockedSubmit.mockRejectedValue(new Error('Network down'))
    render(<PreferencesEditor userId="u1" initial={null} variant="onboarding" onSaved={jest.fn()} />)

    expect(screen.getByText('Tell us what you like')).toBeInTheDocument()
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Save preferences'))
    expect(await screen.findByText('Network down')).toBeInTheDocument()
  })
})
