import Link from "next/link";
import SectionCard from "@/components/SectionCard";
import SiteHeader from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-3xl items-center justify-center px-6 py-20">
        <SectionCard
          title="Thread not found"
          subtitle="The post ID does not exist in this view"
        >
          <div className="space-y-4 text-sm text-muted">
            <p>
              The thread may have been archived or the API connection is not
              configured yet.
            </p>
            <Link
              href="/posts"
              className="inline-flex rounded-full bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
            >
              Back to posts
            </Link>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
