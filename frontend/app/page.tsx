import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold">ShelfScannerAI</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Photograph a bookshelf and get a personalized, explainable recommendation
        from your reading taste — no manual cataloging required.
      </p>
      <Link
        href="/scan"
        className="rounded-full bg-black text-white px-6 py-3 font-medium"
      >
        Scan a Shelf
      </Link>
    </main>
  )
}
