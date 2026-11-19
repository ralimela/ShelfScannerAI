'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { BookMarked, BookOpen, Gauge, ListChecks, ShieldAlert, Users } from 'lucide-react'
import FeedbackForm from '@/components/FeedbackForm'
import OnboardingForm from '@/components/OnboardingForm'
import PaceSparkline from '@/components/PaceSparkline'
import PaceTimer from '@/components/PaceTimer'
import TagSection from '@/components/TagSection'
import TasteBackdrop from '@/components/TasteBackdrop'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { getUserProfile } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { getOrCreateUserId } from '@/lib/user'
import type { UserProfileResponse } from '@/lib/types'

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

function readingTagline(profile: UserProfileResponse): string | null {
  const topGenre = profile.tasteProfile.favoriteGenres[0]
  const topAuthor = profile.tasteProfile.favoriteAuthors[0]
  if (topGenre && topAuthor) return `${topGenre} reader, drawn to ${topAuthor}`
  if (topGenre) return `${topGenre} reader`
  if (topAuthor) return `Reads a lot of ${topAuthor}`
  return null
}

function StatTile({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof BookOpen
  value: string | number
  label: string
}) {
  return (
    <div className="flex-1 flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5 min-w-0">
      <Icon className="w-4 h-4 text-brand" />
      <span className="text-xl font-semibold leading-none truncate">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
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

  const tagline = profile ? readingTagline(profile) : null
  const avatarLetter = (user?.email ?? '?').charAt(0).toUpperCase()
  const backdropSignals = profile
    ? [...profile.tasteProfile.favoriteGenres, ...profile.tasteProfile.favoriteAuthors]
    : []

  return (
    <main className="relative flex flex-col items-center gap-8 px-6 py-10 flex-1">
      <TasteBackdrop seedKey={userId ?? 'guest'} signals={backdropSignals} />

      <h1 className="text-2xl font-semibold">Your Taste Profile</h1>

      <Suspense fallback={null}>
        <ClaimBanner />
      </Suspense>

      {!user && (
        <Card className="w-full max-w-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Sign up to save this across devices.</p>
          <Link href="/login" className="shrink-0">
            <Button type="button" size="sm" className="w-full sm:w-auto">
              Sign up
            </Button>
          </Link>
        </Card>
      )}

      {error && <p className="text-danger">{error}</p>}

      {profile && (
        <div className="w-full max-w-md flex flex-col gap-6">
          <Card className="relative overflow-hidden flex flex-col gap-4">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand to-accent" />

            <div className="flex items-center gap-3">
              <span className="w-10 h-10 shrink-0 rounded-full bg-brand/15 text-brand font-semibold flex items-center justify-center">
                {avatarLetter}
              </span>
              <div className="min-w-0">
                <p className="font-medium">Reading Profile</p>
                <p className="text-xs text-muted-foreground truncate">
                  {tagline ?? 'Log a book or two to start building your profile'}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <StatTile icon={BookOpen} value={profile.totalBooksRead} label="books read" />
              <StatTile icon={Gauge} value={profile.readingPace.avgPagesPerHour} label="pages/hr avg" />
              <StatTile icon={ListChecks} value={profile.readingPace.totalSessions} label="pace sessions" />
            </div>

            {profile.recentPaceSessions.length > 0 && <PaceSparkline sessions={profile.recentPaceSessions} />}

            <TagSection icon={BookMarked} title="Favorite Genres" items={profile.tasteProfile.favoriteGenres} variant="brand" />
            <TagSection icon={Users} title="Favorite Authors" items={profile.tasteProfile.favoriteAuthors} variant="accent" />
            <TagSection
              icon={Gauge}
              title="Writing Style & Themes"
              items={profile.tasteProfile.writingStylePrefs}
              variant="default"
            />
            <TagSection icon={ShieldAlert} title="Themes to Avoid" items={profile.tasteProfile.avoidThemes} variant="danger" />

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
