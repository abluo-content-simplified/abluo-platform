import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <main className="flex flex-col items-center gap-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <span className="text-2xl font-bold">A</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Welcome to Abluo
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Content management platform for modern teams.
        </p>
        <Link
          href="/admin"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go to Admin Dashboard
        </Link>
      </main>
    </div>
  );
}
