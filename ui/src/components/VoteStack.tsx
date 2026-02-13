import { formatCount } from "@/lib/format";

type VoteStackProps = {
  votes?: number;
  comments?: number;
};

export default function VoteStack({ votes = 0, comments = 0 }: VoteStackProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/10 bg-white/80 px-3 py-4 text-xs font-semibold">
      <span className="text-muted">▲</span>
      <span className="text-base text-foreground">{formatCount(votes)}</span>
      <span className="text-muted">▼</span>
      <span className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted">
        {formatCount(comments)}
      </span>
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
        replies
      </span>
    </div>
  );
}
