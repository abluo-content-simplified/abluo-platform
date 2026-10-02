// Platform root — served when no tenant domain is matched (e.g. localhost:3000/)
// The admin dashboard lives at /[locale]/admin/dashboard

export default function PlatformRoot() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-300">
        Abluo
      </p>
    </main>
  )
}
