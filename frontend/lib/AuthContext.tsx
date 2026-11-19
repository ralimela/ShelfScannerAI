'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { decodeIdToken, refreshSession, type AuthTokens } from '@/lib/auth'

const STORAGE_KEY = 'shelfscannerai_auth_tokens'
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface AuthUser {
  userId: string
  email?: string
}

interface AuthContextValue {
  user: AuthUser | null
  idToken: string | null
  isLoading: boolean
  setTokens: (tokens: AuthTokens) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AuthTokens) : null
  } catch {
    return null
  }
}

function writeStoredTokens(tokens: AuthTokens | null) {
  try {
    if (tokens) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // localStorage can throw in private browsing / blocked storage - auth
    // simply won't persist across reloads in that case.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokensState] = useState<AuthTokens | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // localStorage isn't available during SSR, so this must run client-side.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTokensState(readStoredTokens())
    setIsLoading(false)
  }, [])

  const setTokens = useCallback((next: AuthTokens) => {
    setTokensState(next)
    writeStoredTokens(next)
  }, [])

  const signOut = useCallback(() => {
    setTokensState(null)
    writeStoredTokens(null)
  }, [])

  useEffect(() => {
    if (!tokens) return undefined

    let email: string | undefined
    try {
      email = decodeIdToken(tokens.idToken).email
    } catch {
      email = undefined
    }
    if (!email) return undefined

    const doRefresh = () => {
      refreshSession(email as string, tokens.refreshToken)
        .then(setTokens)
        .catch(() => signOut())
    }

    const msUntilRefresh = tokens.expiresAt - REFRESH_MARGIN_MS - Date.now()
    if (msUntilRefresh <= 0) {
      doRefresh()
      return undefined
    }
    const timer = setTimeout(doRefresh, msUntilRefresh)
    return () => clearTimeout(timer)
  }, [tokens, setTokens, signOut])

  const user: AuthUser | null = useMemo(() => {
    if (!tokens) return null
    try {
      const decoded = decodeIdToken(tokens.idToken)
      return { userId: decoded.sub, email: decoded.email }
    } catch {
      return null
    }
  }, [tokens])

  const value = useMemo(
    () => ({ user, idToken: tokens?.idToken ?? null, isLoading, setTokens, signOut }),
    [user, tokens, isLoading, setTokens, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
