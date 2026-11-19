'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import FeedbackForm from '@/components/FeedbackForm'
import OnboardingForm from '@/components/OnboardingForm'
import PaceTimer from '@/components/PaceTimer'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Pill from '@/components/ui/Pill'
import { getUserProfile } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { getOrCreateUserId } from '@/lib/user'
import type { PaceSession, UserProfileResponse } from '@/lib/types'

function isNewUser(profile: UserProfileResponse): boolean {
  const { tasteProfile, totalBooksRead } = profile
  return (
    totalBooksRead === 0 &&
    tasteProfile.favoriteAuthors.length === 0 &&
    tasteProfile.favoriteGenres.length === 0 &&
    tasteProfile.writingStylePrefs.length === 0 &&
    tasteProfile.avoidThemes.length === 0
  )
}

function PaceChart({ sessions }: { sessions: PaceSession[] }) {
  const chronological = sessions.slice().reverse()
  const maxRate = Math.max(...chronological.map((s) => s.pagesPerHour), 1)

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">Recent pace (pages/hour)</p>
      <div className="flex items-end gap-1 h-16">
        {chronological.map((session, i) => (
          <div
            key={`${session.startedAt}-${i}`}
            title={`${session.pagesPerHour} pages/hour`}
            className="flex-1 bg-brand/70 rounded-t-sm min-h-1"
            style={{ height: `${Math.max((session.pagesPerHour / maxRate) * 100, 6)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function ClaimBanner() {
  const searchParams = useSearchParams()
  const books = searchParams.get('claimedBooks')
  const pace = searchParams.get('claimedPace')
  if (!books && !pace) return null

  return (
    <Card className="w-full max-w-md bg-brand/5 border-brand/20 text-sm">
      Welcome back — we brought over {books && `${books} logged book(s)`}
      {books && pace && ' and '}
      {pace && `${pace} pace session(s)`} to your new account.
    </Card>
  )
}

export default function ProfilePage() {
  const { user, idToken } = useAuth()
  const [anonymousUserId, setAnonymousUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const userId = user?.userId ?? anonymousUserId

  const loadProfile = useCallback(async (id: string, token: string | null) => {
    setError(null)
    try {
      const response = await getUserProfile(id, token)
      setProfile(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Loading profile failed')
    }
  }, [])

  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadProfile(user.userId, idToken)
      return
    }
    // localStorage isn't available during SSR, so this id must be read client-side in an effect.
    const id = getOrCreateUserId()
    setAnonymousUserId(id)
    loadProfile(id, null)
  }, [user, idToken, loadProfile])

  return (
    <main className="flex flex-col items-center gap-8 px-6 py-10 flex-1">
      <h1 className="text-2xl font-semibold">Your Taste Profile</h1>

      <Suspense fallback={null}>
        <ClaimBanner />
      </Suspense>

      {!user && (
        <Card className="w-full max-w-md flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Sign up to save this across devices.</p>
          <Link href="/login">
            <Button type="button" size="sm">
              Sign up
            </Button>
          </Link>
        </Card>
      )}

      {error && <p className="text-danger">{error}</p>}

      {profile && (
        <div className="w-full max-w-md flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <div className="flex gap-4">
              <div className="flex-1 flex flex-col">
                <span className="text-2xl font-semibold">{profile.totalBooksRead}</span>
                <span className="text-xs text-muted-foreground">books read</span>
              </div>
              <div className="flex-1 flex flex-col">
                <span className="text-2xl font-semibold">{profile.readingPace.avgPagesPerHour}</span>
                <span className="text-xs text-muted-foreground">pages/hour avg</span>
              </div>
              <div className="flex-1 flex flex-col">
                <span className="text-2xl font-semibold">{profile.readingPace.totalSessions}</span>
                <span className="text-xs text-muted-foreground">pace sessions</span>
              </div>
            </div>

            {profile.recentPaceSessions.length > 0 && <PaceChart sessions={profile.recentPaceSessions} />}

            {profile.tasteProfile.favoriteAuthors.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">Favorite Authors</p>
                <div className="flex flex-wrap gap-2">
                  {profile.tasteProfile.favoriteAuthors.map((author) => (
                    <Pill key={author}>{author}</Pill>
                  ))}
                </div>
              </div>
            )}

            {profile.tasteProfile.writingStylePrefs.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">Writing Style Preferences</p>
                <div className="flex flex-wrap gap-2">
                  {profile.tasteProfile.writingStylePrefs.map((pref) => (
                    <Pill key={pref}>{pref}</Pill>
                  ))}
                </div>
              </div>
            )}

            {profile.tasteProfile.avoidThemes.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">Themes to Avoid</p>
                <div className="flex flex-wrap gap-2">
                  {profile.tasteProfile.avoidThemes.map((theme) => (
                    <Pill key={theme}>{theme}</Pill>
                  ))}
                </div>
              </div>
            )}

            {profile.totalBooksRead === 0 && (
              <p className="text-sm text-muted-foreground">
                No feedback logged yet — submit one below to start building your taste profile.
              </p>
            )}
          </Card>

          {userId && (
            <Card>
              <PaceTimer userId={userId} idToken={idToken} onLogged={() => loadProfile(userId, idToken)} />
            </Card>
          )}

          {userId && isNewUser(profile) && (
            <OnboardingForm userId={userId} idToken={idToken} onSubmitted={() => loadProfile(userId, idToken)} />
          )}

          {profile.recentBooks.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Recent Books</p>
              {profile.recentBooks.map((book) => (
                <Card key={`${book.bookId}-${book.readAt}`} className="text-sm p-3">
                  <p className="font-medium">{book.title}</p>
                  <p className="text-muted-foreground">
                    {book.author} {book.rating && `· ${book.rating}/5`}
                  </p>
                </Card>
              ))}
            </div>
          )}

          {userId && (
            <FeedbackForm userId={userId} idToken={idToken} onSubmitted={() => loadProfile(userId, idToken)} />
          )}
        </div>
      )}
    </main>
  )
}
