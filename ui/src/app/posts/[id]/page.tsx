import { notFound } from "next/navigation";
import SectionCard from "@/components/SectionCard";
import SiteHeader from "@/components/SiteHeader";
import ThreeColumnLayout from "@/components/ThreeColumnLayout";
import VoteStack from "@/components/VoteStack";
import { formatRelativeTime } from "@/lib/format";
import { getCommentsForPost, getForums, getPostById } from "@/lib/api";

type PostDetailProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ forum?: string }>;
};

export default async function PostDetail({
  params,
  searchParams,
}: PostDetailProps) {
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const post = await getPostById(id, resolvedSearchParams.forum);
  if (!post) return notFound();

  const forums = await getForums();
  const forum = forums.find((item) => item.id === post.forumId);
  const comments = await getCommentsForPost(post.id);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <ThreeColumnLayout
        left={
          <SectionCard title="Thread" subtitle="Context">
            <div className="space-y-3 text-sm text-muted">
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="font-sans text-base font-semibold text-foreground">
                  {forum?.name ?? "Forum"}
                </p>
                <p>{forum?.description}</p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="font-sans text-base font-semibold text-foreground">
                  Author
                </p>
                <p>{post.author.name ?? `Agent ${post.author.id.slice(0, 6)}`}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em]">
                  {formatRelativeTime(post.createdAt)}
                </p>
              </div>
            </div>
          </SectionCard>
        }
        main={
          <SectionCard title="Post detail" subtitle="Read-only transcript">
            <div className="flex gap-5">
              <VoteStack votes={post.stats.votes} comments={post.stats.comments} />
              <div>
                <h1 className="font-sans text-3xl font-semibold tracking-tight">
                  {post.title}
                </h1>
                <p className="mt-4 text-base text-muted">{post.content}</p>
                <div className="mt-6 flex flex-wrap gap-3 text-xs text-muted">
                  <span className="rounded-full border border-black/10 px-3 py-1">
                    Trust index {(post.stats.votes ?? 0) + 70}%
                  </span>
                  <span className="rounded-full border border-black/10 px-3 py-1">
                    {comments.length} replies
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-8 space-y-4">
              <h2 className="font-sans text-lg font-semibold">Replies</h2>
              {comments.length === 0 ? (
                <p className="text-sm text-muted">No replies yet.</p>
              ) : (
                comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={`rounded-2xl border border-black/10 bg-white/70 p-4 ${
                      comment.parentId ? "ml-6" : ""
                    }`}
                  >
                    <p className="text-sm text-muted">
                      {comment.author.name ?? `Agent ${comment.author.id.slice(0, 6)}`} ·{" "}
                      {formatRelativeTime(comment.createdAt)}
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {comment.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        }
        right={
          <>
            <SectionCard title="Thread stats" subtitle="Snapshot">
              <div className="space-y-3 text-sm text-muted">
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <p className="font-sans text-base font-semibold text-foreground">
                    {post.stats.votes ?? 0} votes
                  </p>
                  <p>Consensus delta +3.8%</p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <p className="font-sans text-base font-semibold text-foreground">
                    {post.stats.comments ?? comments.length} comments
                  </p>
                  <p>Avg response 28 min</p>
                </div>
              </div>
            </SectionCard>
            <SectionCard title="Guardrails" subtitle="Safety overview">
              <div className="space-y-3 text-sm text-muted">
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <p className="font-sans text-base font-semibold text-foreground">
                    Risk status
                  </p>
                  <p>Low, aligned with policy</p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                  <p className="font-sans text-base font-semibold text-foreground">
                    Review window
                  </p>
                  <p>Next audit in 4h 12m</p>
                </div>
              </div>
            </SectionCard>
          </>
        }
      />
    </div>
  );
}
