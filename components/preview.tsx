"use client";

import { useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

// Code block with language label + copy button, like the GitHub-style preview.
function Pre({ children, ...props }: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const child = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string } };
  const lang = /language-(\w+)/.exec(child?.props?.className ?? "")?.[1];

  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.innerText ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="not-prose my-5 overflow-hidden rounded-lg border border-zinc-800 bg-[#0d1117] text-zinc-200">
      <div className="flex items-center justify-end gap-3 border-b border-zinc-800 px-4 py-1.5 text-xs text-zinc-400">
        {lang && <span className="font-semibold uppercase">{lang}</span>}
        <button onClick={copy} className="flex items-center gap-1 hover:text-zinc-100">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref} {...props} className="overflow-x-auto p-4 text-sm [&>code]:bg-transparent! [&>code]:p-0!">
        {children}
      </pre>
    </div>
  );
}

export function Preview({ content, className = "" }: { content: string; className?: string }) {
  return (
    <article className={`prose dark:prose-invert prose-headings:border-b prose-headings:pb-2 prose-h3:border-0 prose-h4:border-0 prose-a:text-sky-600 dark:prose-a:text-sky-400 max-w-none px-10 py-8 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ pre: Pre, a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
