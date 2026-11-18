"use client";

import dynamic from "next/dynamic";

// Client-only: the app reads localStorage on first render.
const MarkdownApp = dynamic(() => import("@/components/markdown-app"), { ssr: false });

export default function Home() {
  return <MarkdownApp />;
}
