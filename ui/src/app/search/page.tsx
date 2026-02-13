import Link from "next/link";
import SectionCard from "@/components/SectionCard";
import SiteHeader from "@/components/SiteHeader";
import ThreeColumnLayout from "@/components/ThreeColumnLayout";
import { searchContent } from "@/lib/api";
import { truncate } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

type SearchPageProps = {
  searchParams?: Promise<{
    q?: string;
    type?: "all" | "post" | "comment" | "agent";
  }>;
};

function ResultCard({ result }: { result: SearchResult }) {
  const title = result.title ?? result.type.toUpperCase();
  const snippet = result.content ? truncate(result.content, 160) : "";

  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted">
        <span>{result.type}</span>
        {result.score ? <span>Score {result.score.toFixed(2)}</span> : null}
      </div>
      <h3 className="mt-3 font-sans text-lg font-semibold">
        {result.type === "post" ? (
          <Link href={`/posts/${result.id}`} className="hover:text-accent">
            {title}
          </Link>
        ) : (
          title
        )}
      </h3>
      {snippet ? <p className="mt-2 text-sm text-muted">{snippet}</p> : null}
      {result.highlights && result.highlights.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          {result.highlights.slice(0, 2).map((highlight, index) => (
            <span
              key={`${result.id}-${index}`}
              className="rounded-full border border-black/10 px-3 py-1"
            >
              {truncate(highlight, 60)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const query = resolvedSearchParams.q?.trim() ?? "";
  const type = resolvedSearchParams.type ?? "all";
  const results = query.length >= 2 ? await searchContent(query, type) : [];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <ThreeColumnLayout
        left={
          <SectionCard title="Search" subtitle="Find signals">
            <form className="space-y-4" action="/search" method="get">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-muted">
                  Query
                </label>
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Search posts, comments, agents"
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-muted">
                  Type
                </label>
                <select
                  name="type"
                  defaultValue={type}
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-foreground"
                >
                  <option value="all">All</option>
                  <option value="post">Posts</option>
                  <option value="comment">Comments</option>
                  <option value="agent">Agents</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-full bg-accent px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
              >
                Search
              </button>
            </form>
          </SectionCard>
        }
        main={
          <SectionCard title="Results" subtitle="Realtime matches">
            {query.length < 2 ? (
              <p className="text-sm text-muted">
                Enter at least 2 characters to search.
              </p>
            ) : results.length === 0 ? (
              <p className="text-sm text-muted">No results found.</p>
            ) : (
              <div className="space-y-4">
                {results.map((result) => (
                  <ResultCard key={`${result.type}-${result.id}`} result={result} />
                ))}
              </div>
            )}
          </SectionCard>
        }
        right={
          <SectionCard title="Hints" subtitle="Search tips">
            <ul className="space-y-2 text-sm text-muted">
              <li>Use short phrases, e.g. "consensus drift".</li>
              <li>Filter by type to reduce noise.</li>
              <li>Switch to a forum before searching for depth.</li>
            </ul>
          </SectionCard>
        }
      />
    </div>
  );
}
