'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import FeedbackForm from '@/components/FeedbackForm'
import OnboardingForm from '@/components/OnboardingForm'
import PaceTimer from '@/components/PaceTimer'
import ReaderProfile from '@/components/ReaderProfile'
import ReadingScene from '@/components/ReadingScene'
import RecentBooks from '@/components/RecentBooks'
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

  const avatarLetter = (user?.email ?? '?').charAt(0).toUpperCase()
  const backdropSignals = profile
    ? [...profile.tasteProfile.favoriteGenres, ...profile.tasteProfile.favoriteAuthors]
    : []
  const sceneWords = profile ? [...backdropSignals, ...profile.tasteProfile.writingStylePrefs] : []
  const seedKey = userId ?? 'guest'

  return (
    <main className="flex flex-col items-center gap-8 px-6 pb-10 flex-1">
      <TasteBackdrop seedKey={seedKey} signals={backdropSignals} />

      <div className="w-full flex flex-col items-center gap-6 pb-4">
        <ReadingScene seedKey={seedKey} signals={backdropSignals} words={sceneWords} />

        <h1 className="-mt-12 font-serif text-4xl tracking-tight">Your Taste Profile</h1>

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

        {profile && <ReaderProfile profile={profile} avatarLetter={avatarLetter} />}
      </div>

      {profile && (
        <div className="w-full max-w-md flex flex-col gap-6">
          {userId && (
            <Card>
              <PaceTimer userId={userId} idToken={idToken} onLogged={() => loadProfile(userId, idToken)} />
            </Card>
          )}

          {userId && isNewUser(profile) && (
            <OnboardingForm userId={userId} idToken={idToken} onSubmitted={() => loadProfile(userId, idToken)} />
          )}

          {profile.recentBooks.length > 0 && <RecentBooks books={profile.recentBooks} />}

          {userId && (
            <FeedbackForm userId={userId} idToken={idToken} onSubmitted={() => loadProfile(userId, idToken)} />
          )}
        </div>
      )}
    </main>
  )
}
