"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import { Preview } from "@/components/preview";
import type { Highlight } from "@/app/actions";

const COLORS = { yellow: "bg-yellow-300", green: "bg-green-300", blue: "bg-sky-300", pink: "bg-pink-300" } as const;
const supported = typeof CSS !== "undefined" && "highlights" in CSS;

type Popup = { x: number; y: number } & ({ kind: "add"; text: string; prefix: string } | { kind: "remove"; id: string });

/** Offset of (node, offset) within root's plain text. Same text model as Range#toString. */
function offsetIn(root: Node, node: Node, offset: number) {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Builds a DOM Range covering text [start, end) of root. */
function rangeAt(root: Node, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0, startSet = false;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (!startSet && start <= pos + len) {
      range.setStart(n, start - pos);
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(n, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

/** Finds a highlight's text again, preferring the occurrence whose preceding text matches its prefix. */
function locate(full: string, h: Highlight) {
  let first = -1;
  for (let i = full.indexOf(h.text); i >= 0; i = full.indexOf(h.text, i + 1)) {
    if (full.slice(Math.max(0, i - h.prefix.length), i) === h.prefix) return i;
    if (first < 0) first = i;
  }
  return first; // -1 when the text was edited away: the highlight is just not shown
}

export function Reader({ content, highlights, onChange }: { content: string; highlights: Highlight[]; onChange: (h: Highlight[]) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const ranges = useRef(new Map<string, Range>());
  const [popup, setPopup] = useState<Popup | null>(null);

  // Paint highlights with the CSS Custom Highlight API: no DOM changes, so the markdown render stays untouched.
  useEffect(() => {
    if (!supported || !root.current) return;
    const full = root.current.textContent ?? "";
    ranges.current.clear();
    const byColor: Record<string, Range[]> = {};
    for (const h of highlights) {
      const i = locate(full, h);
      const r = i >= 0 && rangeAt(root.current, i, i + h.text.length);
      if (!r) continue;
      ranges.current.set(h.id, r);
      (byColor[h.color] ??= []).push(r);
    }
    for (const c of Object.keys(COLORS)) CSS.highlights.set(`hl-${c}`, new Highlight(...(byColor[c] ?? [])));
    return () => Object.keys(COLORS).forEach((c) => CSS.highlights.delete(`hl-${c}`));
  }, [content, highlights]);

  const onMouseUp = (e: MouseEvent) => {
    const sel = getSelection();
    const el = root.current!;
    if (sel && !sel.isCollapsed && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
      const r = sel.getRangeAt(0);
      const text = r.toString();
      if (!text.trim()) return setPopup(null);
      const start = offsetIn(el, r.startContainer, r.startOffset);
      const prefix = (el.textContent ?? "").slice(Math.max(0, start - 32), start);
      const rect = r.getBoundingClientRect();
      return setPopup({ kind: "add", text, prefix, x: rect.left + rect.width / 2, y: rect.top });
    }
    // Plain click: did it land on a highlight?
    const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const hit = pos && [...ranges.current].find(([, r]) => r.isPointInRange(pos.offsetNode, pos.offset));
    setPopup(hit ? { kind: "remove", id: hit[0], x: e.clientX, y: e.clientY - 8 } : null);
  };

  const add = (color: string) => {
    if (popup?.kind !== "add") return;
    onChange([...highlights, { id: crypto.randomUUID(), text: popup.text, prefix: popup.prefix, color }]);
    getSelection()?.removeAllRanges();
    setPopup(null);
  };

  const remove = () => {
    if (popup?.kind !== "remove") return;
    onChange(highlights.filter((h) => h.id !== popup.id));
    setPopup(null);
  };

  return (
    <div className="h-full overflow-auto" onScroll={() => setPopup(null)}>
      <div className="mx-auto max-w-3xl">
        {!supported && (
          <p className="mx-10 mt-6 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            Highlighting needs a newer browser (Chrome 105+, Safari 17.2+, Firefox 140+).
          </p>
        )}
        <div ref={root} onMouseUp={onMouseUp}>
          <Preview content={content} className="prose-lg" />
        </div>
      </div>

      {popup && (
        <div
          className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg"
          style={{ left: popup.x, top: popup.y - 6 }}
          onMouseDown={(e) => e.preventDefault()} // keep the text selection while clicking
        >
          {popup.kind === "add" ? (
            Object.entries(COLORS).map(([c, cls]) => (
              <button key={c} aria-label={`Highlight ${c}`} onClick={() => add(c)}
                className={`size-6 rounded-full ring-1 ring-black/10 hover:scale-110 ${cls}`} />
            ))
          ) : (
            <button onClick={remove} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent">
              <Trash2 className="size-4" /> Remove highlight
            </button>
          )}
        </div>
      )}
    </div>
  );
}
