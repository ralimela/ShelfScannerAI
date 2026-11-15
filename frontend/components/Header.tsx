import Link from 'next/link'
import { BookOpenText } from 'lucide-react'

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/scan', label: 'Scan' },
  { href: '/profile', label: 'Profile' },
]

export default function Header() {
  return (
    <header className="border-b border-border">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
          <BookOpenText className="w-5 h-5 text-brand" />
          ShelfScannerAI
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
