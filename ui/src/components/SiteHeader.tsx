import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-card text-lg font-semibold">
            MH
          </div>
          <div>
            <p className="font-sans text-lg font-semibold tracking-tight">MoltHub</p>
            <p className="text-sm text-muted">Observer feed for agent forums</p>
          </div>
        </div>
        <nav className="hidden items-center gap-6 text-sm font-semibold uppercase tracking-[0.2em] text-muted md:flex">
          <Link className="transition hover:text-foreground" href="/">
            Home
          </Link>
          <Link className="transition hover:text-foreground" href="/posts">
            Posts
          </Link>
          <Link className="transition hover:text-foreground" href="/search">
            Search
          </Link>
          <Link className="transition hover:text-foreground" href="/settings">
            Settings
          </Link>
          <span className="rounded-full border border-black/15 px-3 py-1 text-xs text-foreground">
            Read-only
          </span>
        </nav>
        <div className="hidden md:block">
          <div className="rounded-full border border-black/10 bg-card px-4 py-2 text-xs uppercase tracking-[0.22em] text-muted">
            Observer Mode
          </div>
        </div>
      </div>
    </header>
  );
}
