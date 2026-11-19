'use client'

import { useState, type ReactNode } from 'react'
import PaceSparkline from '@/components/PaceSparkline'
import { hueForGenre } from '@/lib/backdrop'
import type { UserProfileResponse } from '@/lib/types'

const EYEBROW = 'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'

function tagline(profile: UserProfileResponse): string {
  const genre = profile.tasteProfile.favoriteGenres[0]
  const author = profile.tasteProfile.favoriteAuthors[0]
  if (genre) {
    const article = /^[aeiou]/i.test(genre) ? 'An' : 'A'
    const reader = `${article} ${genre.toLowerCase()} reader`
    return author ? `${reader}, drawn to ${author}.` : `${reader}.`
  }
  if (author) return `Drawn to ${author}.`
  return 'A story still being written.'
}

function NaturalList({ items }: { items: string[] }) {
  return items.map((item, i) => (
    <span key={item}>
      {i > 0 && (i === items.length - 1 ? ' & ' : ', ')}
      <span className="whitespace-nowrap">{item}</span>
    </span>
  ))
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 sm:px-5 first:pl-0">
      <span className="text-3xl sm:text-4xl font-semibold tracking-tight leading-none">{value}</span>
      <span className={`${EYEBROW} whitespace-nowrap`}>{label}</span>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border/70 py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-5">
      <dt className={`${EYEBROW} sm:pt-1.5`}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function InlineList({ items, limit = 5, struck = false }: { items: string[]; limit?: number; struck?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, limit)
  const hiddenCount = items.length - visible.length

  return (
    <ul className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm text-foreground/85">
      {visible.map((item) => (
        <li key={item} className="flex min-w-0 items-baseline gap-2">
          <span
            className={`h-1 w-1 shrink-0 -translate-y-0.5 rounded-full ${struck ? 'bg-danger/70' : 'bg-brand/80'}`}
          />
          <span className={struck ? 'text-muted-foreground line-through decoration-danger/70' : undefined}>{item}</span>
        </li>
      ))}
      {hiddenCount > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs font-medium text-brand underline-offset-4 hover:underline"
          >
            +{hiddenCount} more
          </button>
        </li>
      )}
      {expanded && items.length > limit && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            Show less
          </button>
        </li>
      )}
    </ul>
  )
}

interface ReaderProfileProps {
  profile: UserProfileResponse
  avatarLetter: string
}

export default function ReaderProfile({ profile, avatarLetter }: ReaderProfileProps) {
  const { tasteProfile, readingPace, totalBooksRead } = profile
  const genres = tasteProfile.favoriteGenres

  return (
    <section className="w-full max-w-md overflow-hidden rounded-card border border-border bg-surface/80 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.55)] backdrop-blur-xl">
      <div className="h-0.5 bg-gradient-to-r from-brand via-accent to-transparent" />

      <div className="flex flex-col gap-7 p-6 sm:p-8">
        <header className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/15 font-serif text-xl text-brand ring-1 ring-brand/30">
            {avatarLetter}
          </span>
          <div className="min-w-0">
            <p className={EYEBROW}>Reader profile</p>
            <h2 className="mt-1 font-serif text-[1.75rem] leading-[1.15] text-balance">{tagline(profile)}</h2>
          </div>
        </header>

        <div className="grid grid-cols-3 divide-x divide-border">
          <Stat value={totalBooksRead} label={totalBooksRead === 1 ? 'Book read' : 'Books read'} />
          <Stat value={Math.round(readingPace.avgPagesPerHour)} label="Pages / hr" />
          <Stat value={readingPace.totalSessions} label={readingPace.totalSessions === 1 ? 'Session' : 'Sessions'} />
        </div>

        {profile.recentPaceSessions.length > 1 && <PaceSparkline sessions={profile.recentPaceSessions} />}

        {(genres.length > 0 ||
          tasteProfile.favoriteAuthors.length > 0 ||
          tasteProfile.writingStylePrefs.length > 0 ||
          tasteProfile.avoidThemes.length > 0) && (
          <dl className="-mb-4">
            {genres.length > 0 && (
              <Row label="Genres">
                <p className="font-serif text-2xl leading-snug">
                  {genres.map((genre, i) => (
                    <span key={genre}>
                      {i > 0 && (
                        <span className="text-xl text-muted-foreground">{i === genres.length - 1 ? ' & ' : ', '}</span>
                      )}
                      <span style={{ color: `hsl(${hueForGenre(genre, 152)} 70% var(--genre-lightness))` }}>{genre}</span>
                    </span>
                  ))}
                </p>
              </Row>
            )}

            {tasteProfile.favoriteAuthors.length > 0 && (
              <Row label="Authors">
                <p className="font-serif text-xl italic leading-snug">
                  <NaturalList items={tasteProfile.favoriteAuthors} />
                </p>
              </Row>
            )}

            {tasteProfile.writingStylePrefs.length > 0 && (
              <Row label="Drawn to">
                <InlineList items={tasteProfile.writingStylePrefs} />
              </Row>
            )}

            {tasteProfile.avoidThemes.length > 0 && (
              <Row label="Avoids">
                <InlineList items={tasteProfile.avoidThemes} struck />
              </Row>
            )}
          </dl>
        )}

        {totalBooksRead === 0 && (
          <p className="text-sm text-muted-foreground">
            Log a finished book below and this page starts to fill itself in.
          </p>
        )}
      </div>
    </section>
  )
}
