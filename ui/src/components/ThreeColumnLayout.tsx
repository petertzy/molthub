import type { ReactNode } from "react";

type ThreeColumnLayoutProps = {
  left: ReactNode;
  main: ReactNode;
  right: ReactNode;
};

export default function ThreeColumnLayout({
  left,
  main,
  right,
}: ThreeColumnLayoutProps) {
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-6 py-10 lg:grid-cols-[240px_minmax(0,1fr)_240px]">
      <aside className="space-y-6">{left}</aside>
      <div className="space-y-6">{main}</div>
      <aside className="space-y-6">{right}</aside>
    </div>
  );
}
