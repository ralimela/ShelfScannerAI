'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  confirmPassword as cognitoConfirmPassword,
  confirmSignUp,
  decodeIdToken,
  forgotPassword,
  getGoogleAuthorizeUrl,
  signIn,
  signUp,
} from '@/lib/auth'
import { useAuth } from '@/lib/AuthContext'
import { claimAnonymousDataOnce } from '@/lib/claim'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'

type Mode = 'login' | 'signup' | 'confirm' | 'forgot' | 'reset'

const GOOGLE_SIGNIN_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED === 'true'

export default function LoginPage() {
  const router = useRouter()
  const { setTokens } = useAuth()

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const finishSignIn = async (tokens: Awaited<ReturnType<typeof signIn>>) => {
    setTokens(tokens)
    const { sub } = decodeIdToken(tokens.idToken)
    const claimResult = await claimAnonymousDataOnce(sub, tokens.idToken)
    if (claimResult?.claimed) {
      router.push(`/profile?claimedBooks=${claimResult.booksRead}&claimedPace=${claimResult.paceSessions}`)
    } else {
      router.push('/profile')
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const tokens = await signIn(email, password)
      await finishSignIn(tokens)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await signUp(email, password)
      setMode('confirm')
      setInfo('Check your email for a verification code.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await confirmSignUp(email, code)
      const tokens = await signIn(email, password)
      await finishSignIn(tokens)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await forgotPassword(email)
      setMode('reset')
      setInfo('Check your email for a reset code.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start password reset')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await cognitoConfirmPassword(email, code, newPassword)
      setMode('login')
      setPassword('')
      setInfo('Password updated - log in with your new password.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    try {
      const redirectUri = `${window.location.origin}/auth/callback`
      const url = await getGoogleAuthorizeUrl(redirectUri)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in is unavailable')
    }
  }

  return (
    <main className="flex flex-col items-center px-6 py-10 flex-1">
      <Card className="w-full max-w-sm flex flex-col gap-4">
        {(mode === 'login' || mode === 'signup') && (
          <div className="flex rounded-full border border-border p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login')
                setError(null)
                setInfo(null)
              }}
              className={`flex-1 rounded-full py-1.5 text-sm font-medium transition-colors ${
                mode === 'login' ? 'bg-brand text-brand-foreground' : 'text-muted-foreground'
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup')
                setError(null)
                setInfo(null)
              }}
              className={`flex-1 rounded-full py-1.5 text-sm font-medium transition-colors ${
                mode === 'signup' ? 'bg-brand text-brand-foreground' : 'text-muted-foreground'
              }`}
            >
              Sign up
            </button>
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => {
                setMode('forgot')
                setError(null)
                setInfo(null)
              }}
              className="text-xs text-muted-foreground underline underline-offset-2 w-fit"
            >
              Forgot password?
            </button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Log in'}
            </Button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="flex flex-col gap-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input
              type="password"
              placeholder="Password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        )}

        {mode === 'confirm' && (
          <form onSubmit={handleConfirm} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Enter the verification code sent to {email}.</p>
            <Input type="text" placeholder="Verification code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Verifying…' : 'Verify & continue'}
            </Button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="flex flex-col gap-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send reset code'}
            </Button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleReset} className="flex flex-col gap-3">
            <Input type="text" placeholder="Reset code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <Input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </form>
        )}

        {GOOGLE_SIGNIN_ENABLED && (mode === 'login' || mode === 'signup') && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex-1 h-px bg-border" />
              or
              <div className="flex-1 h-px bg-border" />
            </div>
            <Button type="button" variant="outline" onClick={handleGoogle}>
              Continue with Google
            </Button>
          </>
        )}

        {info && <p className="text-sm text-muted-foreground">{info}</p>}
        {error && <p className="text-danger text-sm">{error}</p>}
      </Card>
    </main>
  )
}
