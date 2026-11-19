import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoginPage from '@/app/login/page'

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const setTokensMock = jest.fn()
jest.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ setTokens: setTokensMock }),
}))

const signInMock = jest.fn()
const signUpMock = jest.fn()
jest.mock('@/lib/auth', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  signUp: (...args: unknown[]) => signUpMock(...args),
  confirmSignUp: jest.fn(),
  forgotPassword: jest.fn(),
  confirmPassword: jest.fn(),
  getGoogleAuthorizeUrl: jest.fn(),
  decodeIdToken: () => ({ sub: 'user-1', email: 'a@example.com', exp: 9999999999 }),
}))

const claimAnonymousDataOnceMock = jest.fn().mockResolvedValue(null)
jest.mock('@/lib/claim', () => ({
  claimAnonymousDataOnce: (...args: unknown[]) => claimAnonymousDataOnceMock(...args),
}))

function submitButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement
}

beforeEach(() => {
  pushMock.mockClear()
  setTokensMock.mockClear()
  signInMock.mockClear()
  signUpMock.mockClear()
  claimAnonymousDataOnceMock.mockClear()
})

describe('LoginPage', () => {
  it('defaults to the login tab and switches to sign up on click', () => {
    render(<LoginPage />)
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(screen.getByPlaceholderText(/min 8 characters/i)).toBeInTheDocument()
  })

  it('shows an error and never stores tokens when sign-in fails', async () => {
    signInMock.mockRejectedValueOnce(new Error('Incorrect username or password'))
    const { container } = render(<LoginPage />)

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrongpass' } })
    fireEvent.click(submitButton(container))

    await waitFor(() => expect(screen.getByText('Incorrect username or password')).toBeInTheDocument())
    expect(setTokensMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('signs in with the entered credentials and redirects to /profile on success', async () => {
    signInMock.mockResolvedValueOnce({
      idToken: 'fake.id.token',
      accessToken: 'fake-access',
      refreshToken: 'fake-refresh',
      expiresAt: Date.now() + 3600_000,
    })
    const { container } = render(<LoginPage />)

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'correctpass' } })
    fireEvent.click(submitButton(container))

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith('a@example.com', 'correctpass'))
    expect(setTokensMock).toHaveBeenCalled()
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/profile'))
  })

  it('redirects with claim details in the query string when guest data was migrated', async () => {
    signInMock.mockResolvedValueOnce({
      idToken: 'fake.id.token',
      accessToken: 'fake-access',
      refreshToken: 'fake-refresh',
      expiresAt: Date.now() + 3600_000,
    })
    claimAnonymousDataOnceMock.mockResolvedValueOnce({
      userId: 'user-1',
      claimed: true,
      booksRead: 2,
      paceSessions: 1,
      historyRows: 2,
    })
    const { container } = render(<LoginPage />)

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'correctpass' } })
    fireEvent.click(submitButton(container))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/profile?claimedBooks=2&claimedPace=1'))
  })
})
