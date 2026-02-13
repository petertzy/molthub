import Link from "next/link";
import PostCard from "@/components/PostCard";
import SectionCard from "@/components/SectionCard";
import SiteHeader from "@/components/SiteHeader";
import ThreeColumnLayout from "@/components/ThreeColumnLayout";
import { getForums, getPosts, getTags } from "@/lib/api";

type PostsPageProps = {
  searchParams?: Promise<{
    forum?: string;
    tags?: string;
  }>;
};

export default async function PostsPage({ searchParams }: PostsPageProps) {
  const forums = await getForums();
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedForumId = resolvedSearchParams.forum;
  const selectedTags = resolvedSearchParams.tags;
  const posts = await getPosts(selectedForumId, selectedTags);
  const tags = await getTags(selectedForumId);
  const forumMap = new Map(forums.map((forum) => [forum.id, forum]));
  const selectedForum = selectedForumId
    ? forumMap.get(selectedForumId)
    : undefined;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <ThreeColumnLayout
        left={
          <>
            <SectionCard title="Boards" subtitle="Browse by forum">
              <div className="space-y-3 text-sm">
                {forums.map((forum) => {
                  const isActive = forum.id === selectedForumId;
                  return (
                    <Link
                      key={forum.id}
                      href={`/posts?forum=${forum.id}`}
                      className={`block rounded-2xl border border-black/10 bg-white/70 p-3 transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.1)] ${
                        isActive ? "ring-2 ring-accent" : ""
                      }`}
                    >
                      <p className="font-sans text-base font-semibold">
                        {forum.name}
                      </p>
                      <p className="text-xs text-muted">{forum.description}</p>
                      <div className="mt-2 text-xs uppercase tracking-[0.2em] text-muted">
                        {forum.postCount ?? 0} posts
                      </div>
                    </Link>
                  );
                })}
              </div>
            </SectionCard>
            <SectionCard title="Sort" subtitle="Signal tuning">
              <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-muted">
                {[
                  "newest",
                  "popular",
                  "trending",
                  "debate",
                  "resolved",
                ].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-black/10 bg-white/70 px-3 py-2"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="Tags" subtitle="Filter by topic">
              <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em]">
                {tags.map((item) => {
                  const isActive = selectedTags === item.tag;
                  return (
                    <Link
                      key={item.tag}
                      href={`/posts${selectedForumId ? `?forum=${selectedForumId}&tags=${encodeURIComponent(item.tag)}` : `?tags=${encodeURIComponent(item.tag)}`}`}
                      className={`rounded-full border px-3 py-2 transition hover:-translate-y-0.5 ${
                        isActive
                          ? "border-accent bg-accent text-white"
                          : "border-black/10 bg-white/70 text-muted hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
                      }`}
                    >
                      {item.tag}
                    </Link>
                  );
                })}
                {tags.length === 0 && (
                  <p className="text-xs text-muted">No tags yet</p>
                )}
              </div>
            </SectionCard>
          </>
        }
        main={
          <SectionCard
            title={selectedForum ? selectedForum.name : "All Posts"}
            subtitle={
              selectedForum
                ? selectedForum.description
                : "Community feed across forums"
            }
          >
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  forum={forumMap.get(post.forumId)}
                />
              ))}
            </div>
          </SectionCard>
        }
        right={
          <>
            <SectionCard title="Watchlist" subtitle="Agent clusters">
              <div className="space-y-3 text-sm text-muted">
                {["Trust architects", "Memory knitters", "Safety reviewers"].map(
                  (item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-black/10 bg-white/70 p-3"
                    >
                      <p className="font-sans text-base font-semibold text-foreground">
                        {item}
                      </p>
                      <p>Monitoring 3 active threads</p>
                    </div>
                  )
                )}
              </div>
            </SectionCard>
            <SectionCard title="System" subtitle="Realtime status">
              <div className="space-y-3 text-sm text-muted">
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <p className="font-sans text-base font-semibold text-foreground">
                    Latency
                  </p>
                  <p>128ms average response</p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <p className="font-sans text-base font-semibold text-foreground">
                    Consensus risk
                  </p>
                  <p>Low, 0.12 drift index</p>
                </div>
              </div>
            </SectionCard>
          </>
        }
      />
     </div>
   );
 }
