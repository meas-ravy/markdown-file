"use client";

import { useRef, type KeyboardEvent, type Ref, type UIEventHandler } from "react";
import {
  Bold, ChevronDown, Code, FileCode, Heading, Italic, Link, List, ListChecks,
  ListOrdered, Minus, Quote, Redo2, Strikethrough, Table, Undo2, Image as ImageIcon,
} from "lucide-react";
import { IconBtn } from "@/components/icon-btn";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type Props = {
  value: string;
  onChange: (v: string) => void;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
};

export function Editor({ value, onChange, scrollRef, onScroll }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);

  // Replace a range through execCommand so the browser's native undo/redo stack keeps working.
  const replace = (start: number, end: number, text: string, selStart: number, selEnd: number) => {
    const t = ta.current!;
    t.focus();
    t.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, text)) onChange(t.value.slice(0, start) + text + t.value.slice(end));
    requestAnimationFrame(() => t.setSelectionRange(selStart, selEnd));
  };

  const sel = () => {
    const { selectionStart: s, selectionEnd: e, value: v } = ta.current!;
    return { s, e, v };
  };

  const wrap = (before: string, after = before, placeholder = "text") => {
    const { s, e, v } = sel();
    const text = v.slice(s, e) || placeholder;
    replace(s, e, before + text + after, s + before.length, s + before.length + text.length);
  };

  // Apply `fn` to every line touched by the selection.
  const lines = (fn: (line: string, i: number) => string) => {
    const { s, e, v } = sel();
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const le = v.indexOf("\n", e) < 0 ? v.length : v.indexOf("\n", e);
    const block = v.slice(ls, le).split("\n").map(fn).join("\n");
    replace(ls, le, block, ls + block.length, ls + block.length);
  };

  const block = (text: string) => {
    const { s, e, v } = sel();
    const lead = s > 0 && v[s - 1] !== "\n" ? "\n\n" : "";
    const out = `${lead}${text}\n`;
    replace(s, e, out, s + out.length, s + out.length);
  };

  const heading = (n: number) => lines((l) => `${"#".repeat(n)} ${l.replace(/^#+\s*/, "")}`);

  const onKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = ev.metaKey || ev.ctrlKey;
    const actions: Record<string, () => void> = { b: () => wrap("**"), i: () => wrap("_"), k: () => wrap("[", "](https://)", "link") };
    if (mod && actions[ev.key]) {
      ev.preventDefault();
      actions[ev.key]();
    } else if (ev.key === "Tab" && !mod) {
      ev.preventDefault();
      const { s, e } = sel();
      replace(s, e, "  ", s + 2, s + 2);
    }
  };

  const split = value.split("\n");

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-3 py-1.5">
        <IconBtn label="Undo" onClick={() => (ta.current?.focus(), document.execCommand("undo"))}><Undo2 /></IconBtn>
        <IconBtn label="Redo" onClick={() => (ta.current?.focus(), document.execCommand("redo"))}><Redo2 /></IconBtn>
        <Separator orientation="vertical" className="mx-1.5 h-5!" />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="Heading" className="text-muted-foreground" />}>
            <Heading /> <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <DropdownMenuItem key={n} onClick={() => heading(n)}>Heading {n}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconBtn label="Bold (⌘B)" onClick={() => wrap("**")}><Bold /></IconBtn>
        <IconBtn label="Italic (⌘I)" onClick={() => wrap("_")}><Italic /></IconBtn>
        <IconBtn label="Strikethrough" onClick={() => wrap("~~")}><Strikethrough /></IconBtn>
        <IconBtn label="Inline code" onClick={() => wrap("`", "`", "code")}><Code /></IconBtn>
        <Separator orientation="vertical" className="mx-1.5 h-5!" />
        <IconBtn label="Quote" onClick={() => lines((l) => `> ${l}`)}><Quote /></IconBtn>
        <IconBtn label="Bulleted list" onClick={() => lines((l) => `- ${l}`)}><List /></IconBtn>
        <IconBtn label="Numbered list" onClick={() => lines((l, i) => `${i + 1}. ${l}`)}><ListOrdered /></IconBtn>
        <IconBtn label="Task list" onClick={() => lines((l) => `- [ ] ${l}`)}><ListChecks /></IconBtn>
        <Separator orientation="vertical" className="mx-1.5 h-5!" />
        <IconBtn label="Link (⌘K)" onClick={() => wrap("[", "](https://)", "link")}><Link /></IconBtn>
        <IconBtn label="Image" onClick={() => wrap("![", "](https://)", "alt")}><ImageIcon /></IconBtn>
        <IconBtn label="Table" onClick={() => block("| Column | Column |\n| ------ | ------ |\n| Cell   | Cell   |\n")}><Table /></IconBtn>
        <IconBtn label="Code block" onClick={() => wrap("```\n", "\n```", "code")}><FileCode /></IconBtn>
        <IconBtn label="Horizontal rule" onClick={() => block("---\n")}><Minus /></IconBtn>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto">
        {/* Invisible mirror gives each logical line its wrapped height, so line numbers stay aligned. */}
        <div className="relative py-4 font-mono text-sm leading-6">
          {split.map((line, i) => (
            <div key={i} className="flex">
              <span className="w-14 shrink-0 select-none pr-4 text-right text-muted-foreground/50">{i + 1}</span>
              <span className="invisible flex-1 whitespace-pre-wrap break-words pr-6">{line || " "}</span>
            </div>
          ))}
          <textarea
            ref={ta}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            aria-label="Markdown editor"
            className="absolute inset-y-0 right-0 left-14 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent py-4 pr-6 caret-sky-500 outline-none"
          />
        </div>
      </div>
    </div>
  );
}
