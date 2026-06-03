'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { label: 'Projects', href: '/en/dashboard', icon: '⬡' },
  { label: 'Content', href: '/en/content', icon: '✦' },
  { label: 'Settings', href: '/en/settings', icon: '◎' },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 h-screen w-52 bg-zinc-950 flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-zinc-800">
        <span className="text-xs font-medium tracking-[0.25em] uppercase text-zinc-100">
          Abluo
        </span>
        <p className="text-[10px] text-zinc-500 tracking-wider mt-0.5">Admin</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ label, href, icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded text-xs tracking-wide transition-colors ${
                active
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <span className="text-[10px]">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-zinc-800">
        <p className="text-[10px] text-zinc-600 tracking-widest uppercase">
          thomas@tmz.it
        </p>
      </div>
    </aside>
  )
}
