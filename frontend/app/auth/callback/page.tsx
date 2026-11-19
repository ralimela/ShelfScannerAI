'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { decodeIdToken, exchangeCodeForTokens } from '@/lib/auth'
import { useAuth } from '@/lib/AuthContext'
import { claimAnonymousDataOnce } from '@/lib/claim'

function CallbackHandler() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setTokens } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (!code || !state) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Missing sign-in parameters')
      return
    }

    const redirectUri = `${window.location.origin}/auth/callback`

    exchangeCodeForTokens(code, state, redirectUri)
      .then(async (tokens) => {
        setTokens(tokens)
        const { sub } = decodeIdToken(tokens.idToken)
        const claimResult = await claimAnonymousDataOnce(sub, tokens.idToken)
        if (claimResult?.claimed) {
          router.replace(`/profile?claimedBooks=${claimResult.booksRead}&claimedPace=${claimResult.paceSessions}`)
        } else {
          router.replace('/profile')
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Google sign-in failed'))
    // Intentionally run once on mount - searchParams/router/setTokens are stable for this page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="flex flex-col items-center justify-center flex-1 px-6 py-10">
      {error ? <p className="text-danger text-sm">{error}</p> : <p className="text-muted-foreground text-sm">Signing you in…</p>}
    </main>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackHandler />
    </Suspense>
  )
}
