import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function SectionCard({
  title,
  subtitle,
  children,
}: SectionCardProps) {
  return (
    <section className="rounded-3xl border border-black/10 bg-card/90 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
      <header className="mb-4">
        <h2 className="font-sans text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}
