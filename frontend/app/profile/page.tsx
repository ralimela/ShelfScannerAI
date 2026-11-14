'use client'

import { useCallback, useEffect, useState } from 'react'
import FeedbackForm from '@/components/FeedbackForm'
import OnboardingForm from '@/components/OnboardingForm'
import { getUserProfile } from '@/lib/api'
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

function Pill({ label }: { label: string }) {
  return (
    <span className="text-xs rounded-full border px-3 py-1 text-zinc-600 dark:text-zinc-400">
      {label}
    </span>
  )
}

export default function ProfilePage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadProfile = useCallback(async (id: string) => {
    setError(null)
    try {
      const response = await getUserProfile(id)
      setProfile(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Loading profile failed')
    }
  }, [])

  useEffect(() => {
    const id = getOrCreateUserId()
    // localStorage isn't available during SSR, so this id must be read client-side in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(id)
    loadProfile(id)
  }, [loadProfile])

  return (
    <main className="min-h-screen flex flex-col items-center gap-8 p-8">
      <h1 className="text-2xl font-semibold">Your Taste Profile</h1>

      {error && <p className="text-red-600">{error}</p>}

      {profile && (
        <div className="w-full max-w-md flex flex-col gap-6">
          <div className="border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex justify-between text-sm text-gray-500">
              <span>{profile.totalBooksRead} books read</span>
              <span>{profile.readingPace.avgPagesPerHour} pages/hour avg</span>
            </div>

            {profile.tasteProfile.favoriteAuthors.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-gray-400">Favorite Authors</p>
                <div className="flex flex-wrap gap-2">
                  {profile.tasteProfile.favoriteAuthors.map((author) => (
                    <Pill key={author} label={author} />
                  ))}
                </div>
              </div>
            )}

            {profile.tasteProfile.writingStylePrefs.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-gray-400">Writing Style Preferences</p>
                <div className="flex flex-wrap gap-2">
                  {profile.tasteProfile.writingStylePrefs.map((pref) => (
                    <Pill key={pref} label={pref} />
                  ))}
                </div>
              </div>
            )}

            {profile.tasteProfile.avoidThemes.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-gray-400">Themes to Avoid</p>
                <div className="flex flex-wrap gap-2">
                  {profile.tasteProfile.avoidThemes.map((theme) => (
                    <Pill key={theme} label={theme} />
                  ))}
                </div>
              </div>
            )}

            {profile.totalBooksRead === 0 && (
              <p className="text-sm text-gray-500">
                No feedback logged yet — submit one below to start building your taste profile.
              </p>
            )}
          </div>

          {userId && isNewUser(profile) && (
            <OnboardingForm userId={userId} onSubmitted={() => loadProfile(userId)} />
          )}

          {profile.recentBooks.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-gray-500">Recent Books</p>
              {profile.recentBooks.map((book) => (
                <div key={`${book.bookId}-${book.readAt}`} className="border rounded-xl p-3 text-sm">
                  <p className="font-medium">{book.title}</p>
                  <p className="text-gray-500">
                    {book.author} {book.rating && `· ${book.rating}/5`}
                  </p>
                </div>
              ))}
            </div>
          )}

          {userId && <FeedbackForm userId={userId} onSubmitted={() => loadProfile(userId)} />}
        </div>
      )}
    </main>
  )
}
