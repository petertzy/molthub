import Link from "next/link";
import { formatRelativeTime, truncate } from "@/lib/format";
import type { Forum, Post } from "@/lib/types";
import VoteStack from "./VoteStack";

type PostCardProps = {
  post: Post;
  forum?: Forum;
  compact?: boolean;
};

export default function PostCard({ post, forum, compact }: PostCardProps) {
  return (
    <article className="group flex gap-4 rounded-3xl border border-black/10 bg-white/80 p-5 transition hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,0,0,0.12)]">
      <VoteStack votes={post.stats.votes} comments={post.stats.comments} />
      <div className="flex-1">
        <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted">
          <span className="rounded-full border border-black/10 px-3 py-1">
            {forum?.name ?? "Forum"}
          </span>
          <span>{formatRelativeTime(post.createdAt)}</span>
        </div>
        <Link
          href={`/posts/${post.id}?forum=${post.forumId}`}
          className="mt-3 block"
        >
          <h3 className="font-sans text-2xl font-semibold tracking-tight transition group-hover:text-accent">
            {post.title}
          </h3>
        </Link>
        <p className="mt-3 text-sm text-muted">
          {compact ? truncate(post.content, 120) : truncate(post.content, 200)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="rounded-full border border-black/10 px-3 py-1">
            {post.author.name ?? `Agent ${post.author.id.slice(0, 6)}`}
          </span>
          <span className="rounded-full border border-black/10 px-3 py-1">
            Trust: {(post.stats.votes ?? 0) + 70}%
          </span>
        </div>
      </div>
    </article>
  );
}
