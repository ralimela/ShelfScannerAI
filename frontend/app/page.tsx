import Link from 'next/link'
import { Camera, Sparkles, Timer } from 'lucide-react'
import { buttonClasses } from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const FEATURES = [
  {
    icon: Camera,
    title: 'Scan your shelf',
    description: 'Snap a photo of any bookshelf and we extract every title, author, and genre automatically.',
  },
  {
    icon: Sparkles,
    title: 'Get AI picks grounded in your taste',
    description: 'Recommendations are reasoned from your own reading history or stated preferences — never generic praise.',
  },
  {
    icon: Timer,
    title: 'Track your pace, know what you’ll finish',
    description: 'Log reading sessions and we estimate how long each pick will actually take you.',
  },
]

export default function Home() {
  return (
    <main className="flex flex-col items-center">
      <section className="w-full max-w-5xl flex flex-col items-center gap-6 px-6 py-20 text-center">
        <span className="rounded-full bg-brand/10 text-brand text-xs font-medium px-3 py-1 border border-brand/20">
          AI-powered reading companion
        </span>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-2xl">
          Point your camera at a bookshelf. Get your next read.
        </h1>
        <p className="max-w-md text-muted-foreground">
          Photograph a bookshelf and get a personalized, explainable recommendation
          from your reading taste — no manual cataloging required.
        </p>
        <div className="flex gap-4 pt-2">
          <Link href="/scan" className={buttonClasses('primary')}>
            Scan a Shelf
          </Link>
          <Link href="/profile" className={buttonClasses('outline')}>
            Your Profile
          </Link>
        </div>
      </section>

      <section className="w-full max-w-5xl grid sm:grid-cols-3 gap-4 px-6 pb-20">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <Card key={title} className="flex flex-col gap-3">
            <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
              <Icon className="w-5 h-5 text-brand" />
            </div>
            <h2 className="font-medium">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </Card>
        ))}
      </section>
    </main>
  )
}
