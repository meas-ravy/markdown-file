"use client";

import { isValidElement, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, Maximize2, Minus, Plus, Scan, Workflow } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// Plain-text diagrams (box-drawing art) render with a font whose ─│┌┐ glyphs join up, and tight line spacing
// so vertical lines connect. Menlo/Consolas/DejaVu all draw full-cell box characters.
const DIAGRAM_FONT = { fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", ui-monospace, monospace', lineHeight: 1.15 };
const isDiagram = (lang: string | undefined, text: string) =>
  (!lang || ["text", "txt", "ascii", "plain", "plaintext", "diagram"].includes(lang)) &&
  /[─━│┃┌┐└┘├┤┬┴┼═║╔╗╚╝╭╮╯╰▶▼◀▲►◄]|\+-{3,}\+/.test(text);

const textOf = (n: ReactNode): string =>
  typeof n === "string" || typeof n === "number"
    ? String(n)
    : Array.isArray(n)
      ? n.map(textOf).join("")
      : isValidElement(n)
        ? textOf((n.props as { children?: ReactNode }).children)
        : "";

function useCopy(text: () => string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
}

/** Full-screen diagram viewer: zoom buttons, fit-to-screen, Ctrl/⌘ + scroll (or pinch) to zoom, drag to pan. */
function DiagramViewer({ text, open, onOpenChange }: { text: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const { copied, copy } = useCopy(() => text);
  const clamp = (z: number) => Math.min(4, Math.max(0.25, Math.round(z * 100) / 100));

  // Largest zoom at which the whole diagram fits the window.
  const fit = () => {
    const sc = scroller.current, el = pre.current;
    if (!sc || !el) return;
    const w = el.scrollWidth / zoom, h = el.scrollHeight / zoom, pad = 64;
    setZoom(clamp(Math.min((sc.clientWidth - pad) / w, (sc.clientHeight - pad) / h, 2)));
  };

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(fit); // fit once the dialog has laid out
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit only on open
  }, [open]);

  // Ctrl/⌘ + wheel (and trackpad pinch, which sends ctrl+wheel) zooms. Needs a non-passive listener.
  useEffect(() => {
    const sc = scroller.current;
    if (!open || !sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clamp(z * Math.exp(-e.deltaY / 300)));
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => sc.removeEventListener("wheel", onWheel);
  });

  // Drag to pan.
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sc = e.currentTarget;
    drag.current = { x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop };
    sc.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    e.currentTarget.scrollLeft = d.l - (e.clientX - d.x);
    e.currentTarget.scrollTop = d.t - (e.clientY - d.y);
  };

  const btn = "flex h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden border border-zinc-800 bg-[#0d1117] p-0 text-zinc-200 sm:max-w-[95vw]">
        <div className="flex items-center gap-1 border-b border-zinc-800 py-2 pr-12 pl-4">
          <DialogTitle className="mr-auto flex items-center gap-2 text-sm text-zinc-200"><Workflow className="size-4" /> Diagram</DialogTitle>
          <button className={btn} aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.2))}><Minus className="size-3.5" /></button>
          <button className={`${btn} w-14 justify-center tabular-nums`} title="Reset to 100%" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className={btn} aria-label="Zoom in" onClick={() => setZoom((z) => clamp(z * 1.2))}><Plus className="size-3.5" /></button>
          <button className={btn} onClick={fit}><Scan className="size-3.5" /> Fit</button>
          <button className={btn} onClick={copy}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}</button>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 cursor-grab overflow-auto active:cursor-grabbing"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
          {/* min-w/min-h + m-auto centers small diagrams and lets big ones scroll from their top-left corner */}
          <div className="flex min-h-full min-w-full w-max p-8">
            <pre ref={pre} className="m-auto select-none text-zinc-100" style={{ ...DIAGRAM_FONT, fontSize: 14 * zoom }}>{text}</pre>
          </div>
        </div>
        <div className="border-t border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-500">Drag to pan · Ctrl/⌘ + scroll or pinch to zoom · Esc to close</div>
      </DialogContent>
    </Dialog>
  );
}

// Code block with language label + copy button, like the GitHub-style preview.
// Text diagrams get a "Diagram" label, connected box lines, and an Expand button for the full-screen viewer.
function Pre({ children, ...props }: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const child = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string } };
  const lang = /language-(\w+)/.exec(child?.props?.className ?? "")?.[1];
  const text = textOf(children).replace(/\n$/, "");
  const diagram = isDiagram(lang, text);
  const { copied, copy } = useCopy(() => ref.current?.innerText ?? text);

  return (
    <div className="not-prose my-5 overflow-hidden rounded-lg border border-zinc-800 bg-[#0d1117] text-zinc-200">
      <div className="flex items-center justify-end gap-3 border-b border-zinc-800 px-4 py-1.5 text-xs text-zinc-400">
        {diagram ? (
          <span className="mr-auto flex items-center gap-1.5 font-semibold"><Workflow className="size-3.5" /> Diagram</span>
        ) : (
          lang && <span className="font-semibold uppercase">{lang}</span>
        )}
        {diagram && (
          <button onClick={() => setExpanded(true)} className="flex items-center gap-1 hover:text-zinc-100">
            <Maximize2 className="size-3.5" /> Expand
          </button>
        )}
        <button onClick={copy} className="flex items-center gap-1 hover:text-zinc-100">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref} {...props} style={diagram ? DIAGRAM_FONT : undefined}
        className="overflow-x-auto p-4 text-sm [&>code]:bg-transparent! [&>code]:p-0! [&>code]:[font:inherit]!">
        {children}
      </pre>
      {diagram && <DiagramViewer text={text} open={expanded} onOpenChange={setExpanded} />}
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
