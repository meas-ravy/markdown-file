"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode, type UIEvent } from "react";
import {
  BookOpen, BookOpenText, Check, ChevronDown, ChevronRight, Clipboard, Clock, Columns2, Download, Eye, FilePlus, FileUp,
  Folder, FolderOpen, FolderPlus, FolderUp,
  MoreVertical, PanelLeft, Pencil, Pilcrow, Plus, Search, Star, Trash2, Type, X,
} from "lucide-react";
import { Editor } from "@/components/editor";
import { Preview } from "@/components/preview";
import { IconBtn } from "@/components/icon-btn";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { Highlight } from "@/app/actions";
import { browserStore, pickStore, type Store } from "@/lib/storage";
import { baseName, buildTree, dirName, isInside, joinPath, pathError, type TreeNode } from "@/lib/paths";
import { Reader } from "@/components/reader";

// id === name === path without .md, e.g. "plan/api" (data/plan/api.md on disk).
type Doc = { id: string; name: string; content: string; updatedAt: number; fav?: boolean };
type State = { docs: Doc[]; openIds: string[]; activeId: string | null };
type Ui = { openIds: string[]; activeId: string | null; favs: string[] };
type View = "edit" | "split" | "preview" | "read";
type Picked = { file: File; path: string }; // an imported file and its path inside the picked/dropped folder
type DeleteTarget = { kind: "file"; doc: Doc } | { kind: "folder"; path: string; count: number };
const DRAG_TYPE = "text/x-md-path"; // internal drag of a file onto a folder (move)

const UI_KEY = "md-viewer:ui";

const newDoc = (name: string, content = ""): Doc => ({ id: name, name, content, updatedAt: Date.now() });

function loadUi(): Ui {
  try {
    const u = JSON.parse(localStorage.getItem(UI_KEY) ?? "") as Ui;
    if (Array.isArray(u.openIds)) return { ...u, favs: u.favs ?? [] };
  } catch {}
  return { openIds: [], activeId: null, favs: [] };
}

// "Untitled" → "Untitled 2" → "Untitled 3"… until it doesn't clash with an existing file.
function uniqueName(base: string, taken: Doc[]) {
  const names = new Set(taken.map((d) => d.name.toLowerCase()));
  let name = base, i = 2;
  while (names.has(name.toLowerCase())) name = `${base} ${i++}`;
  return name;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function download(filename: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const stripExt = (n: string) => n.replace(/\.(md|markdown|txt)$/i, "");

// Dropped items can be folders: walk them recursively to get every file inside, keeping its folder path.
const fromInput = (files: FileList): Picked[] => [...files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

function filesFromDrop(dt: DataTransfer): Promise<Picked[]> {
  const walk = async (entry: FileSystemEntry | File | null): Promise<Picked[]> => {
    if (entry instanceof File) return [{ file: entry, path: entry.name }];
    if (!entry || entry.name.startsWith(".")) return [];
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      return [{ file, path: entry.fullPath.replace(/^\//, "") }]; // "/plan/api.md" → "plan/api.md"
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries: FileSystemEntry[] = [];
    // readEntries returns batches (Chrome: ≤100) until an empty one
    for (let batch; (batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))).length; ) entries.push(...batch);
    return (await Promise.all(entries.map(walk))).flat();
  };
  // webkitGetAsEntry must be called synchronously, before the DataTransfer expires.
  const roots = [...dt.items].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry() ?? i.getAsFile());
  return Promise.all(roots.map(walk)).then((r) => r.flat());
}

export default function MarkdownApp() {
  const [ui] = useState(loadUi);
  const [state, setState] = useState<State>({ docs: [], openIds: ui.openIds, activeId: ui.activeId });
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const pending = useRef(new Map<string, string>()); // file name → unsaved content
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [view, setView] = useState<View>("split");
  const store = useRef<Store>(browserStore); // set on load: data/ on disk locally, this browser when deployed
  const [storageKind, setStorageKind] = useState<"disk" | "browser">("browser");
  const [highlights, setHl] = useState<Record<string, Highlight[]>>({}); // file name → read-mode highlights
  const [sidebar, setSidebar] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DeleteTarget | null>(null);
  const [folders, setFolders] = useState<string[]>([]); // explicit folders (may be empty); others come from file paths
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [draftFolderIn, setDraftFolderIn] = useState<string | null>(null); // parent path showing a "new folder" input
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const importDir = useRef(""); // folder that the next upload goes into ("" = top level)
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const editorScroll = useRef<HTMLDivElement>(null);
  const previewScroll = useRef<HTMLDivElement>(null);

  const { docs, openIds, activeId } = state;
  const active = docs.find((d) => d.id === activeId) ?? null;

  // Load every .md file from data/ on the server. First run: empty, nothing is seeded.
  useEffect(() => {
    (async () => {
      const picked = await pickStore();
      store.current = picked.store;
      setStorageKind(picked.kind);
      const [files, dirs, hl] = await Promise.all([store.current.listFiles(), store.current.listFolders(), store.current.getHighlights()]);
      setHl(hl);
      setFolders(dirs);
      const docs: Doc[] = files.map((f) => ({ ...f, id: f.name, fav: ui.favs.includes(f.name) }));
      const ids = new Set(docs.map((d) => d.id));
      const openIds = ui.openIds.filter((id) => ids.has(id));
      if (!openIds.length && docs.length) openIds.push(docs[0].id);
      setState({ docs, openIds, activeId: ui.activeId && ids.has(ui.activeId) ? ui.activeId : (openIds[0] ?? null) });
      setLoaded(true);
    })().catch((e) => alert(`Could not load files: ${errMsg(e)}`));
  }, [ui]);

  // Remember open tabs / active file / favorites (UI state only).
  useEffect(() => {
    if (!loaded) return;
    const u: Ui = { openIds: state.openIds, activeId: state.activeId, favs: state.docs.filter((d) => d.fav).map((d) => d.name) };
    try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch {}
  }, [state, loaded]);

  // Warn before closing the tab while edits are still on their way to disk.
  useEffect(() => {
    if (status === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [status]);

  // Debounced autosave: batch edits, write them to disk, and keep failed ones queued for retry.
  const flush = async () => {
    const batch = [...pending.current];
    pending.current.clear();
    try {
      await Promise.all(batch.map(([name, content]) => store.current.saveFile(name, content)));
      setStatus(pending.current.size ? "saving" : "saved");
    } catch {
      for (const [n, c] of batch) if (!pending.current.has(n)) pending.current.set(n, c);
      setStatus("error");
    }
  };
  const queueSave = (name: string, content: string) => {
    pending.current.set(name, content);
    setStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 500);
  };

  const update = (fn: (s: State) => State) => setState(fn);
  const patch = (id: string, p: Partial<Doc>) =>
    update((s) => ({ ...s, docs: s.docs.map((d) => (d.id === id ? { ...d, ...p } : d)) }));
  const setContent = (d: Doc, content: string) => {
    update((s) => ({ ...s, docs: s.docs.map((x) => (x.id === d.id ? { ...x, content, updatedAt: new Date().getTime() } : x)) }));
    queueSave(d.name, content);
  };

  const open = (id: string) =>
    update((s) => ({ ...s, activeId: id, openIds: s.openIds.includes(id) ? s.openIds : [...s.openIds, id] }));

  const add = (...ds: Doc[]) => {
    if (!ds.length) return;
    // Open only the first new file as a tab; a folder import can bring in dozens.
    update((s) => ({ docs: [...s.docs, ...ds], openIds: [...s.openIds, ds[0].id], activeId: ds[0].id }));
  };

  // Writes new files to disk (unique names), then shows them.
  const createDocs = async (items: { name: string; content: string }[]) => {
    const made: Doc[] = [];
    try {
      for (const it of items) {
        const d = newDoc(uniqueName(it.name, [...docs, ...made]), it.content);
        await store.current.createFile(d.name, d.content);
        made.push(d);
      }
    } catch (e) {
      alert(`Could not create file: ${errMsg(e)}`);
    }
    add(...made);
    return made;
  };

  // Un-collapse a folder and all its parents.
  const expand = (dir: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      for (let p = dir; p; p = dirName(p)) next.delete(p);
      return next;
    });
  const toggle = (dir: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(dir)) next.add(dir);
      return next;
    });

  const create = async (dir = "") => {
    expand(dir);
    const [d] = await createDocs([{ name: joinPath(dir, "Untitled"), content: "# Untitled\n\n" }]);
    if (d) setRenaming(d.id);
  };

  const folderExists = (p: string) => folders.includes(p) || docs.some((d) => isInside(d.name, p));
  const startFolder = (parent: string) => {
    expand(parent);
    setDraftFolderIn(parent);
  };
  const addFolder = async (parent: string, input: string) => {
    setDraftFolderIn(null);
    const name = input.trim();
    if (!name) return;
    const p = joinPath(parent, name);
    const err = name.includes("/") ? "Folder names can't contain /." : pathError(p);
    if (err) return alert(err);
    if (folderExists(p)) return alert(`Folder "${p}" already exists.`);
    try {
      await store.current.createFolder(p);
    } catch (e) {
      return alert(`Could not create folder: ${errMsg(e)}`);
    }
    setFolders((f) => [...f, p]);
  };

  // Renames a folder in place: every file, tab, favorite and highlight under it moves to the new path.
  const renameFolder = async (from: string, input: string) => {
    setRenamingFolder(null);
    const name = input.trim();
    if (!name || name === baseName(from)) return;
    const to = joinPath(dirName(from), name);
    const err = name.includes("/") ? "Folder names can't contain /." : pathError(to);
    if (err) return alert(err);
    if (folderExists(to) || docs.some((d) => d.name === to)) return alert(`"${to}" already exists.`);
    try {
      clearTimeout(saveTimer.current);
      await flush(); // write pending edits first so a late save can't recreate the old path
      await store.current.renameFolder(from, to);
    } catch (e) {
      return alert(`Could not rename folder: ${errMsg(e)}`);
    }
    const re = (p: string) => (p === from || isInside(p, from) ? to + p.slice(from.length) : p);
    update((s) => ({
      docs: s.docs.map((d) => (isInside(d.name, from) ? { ...d, id: re(d.id), name: re(d.name) } : d)),
      openIds: s.openIds.map(re),
      activeId: s.activeId && re(s.activeId),
    }));
    setFolders((f) => f.map(re));
    setCollapsed((c) => new Set([...c].map(re)));
    setHl((h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [re(k), v])));
  };

  const upload = (dir: string, kind: "files" | "folder") => {
    importDir.current = dir;
    (kind === "files" ? fileInput : folderInput).current?.click();
  };

  const close = (id: string) =>
    update((s) => {
      const i = s.openIds.indexOf(id);
      const openIds = s.openIds.filter((x) => x !== id);
      return { ...s, openIds, activeId: s.activeId === id ? (openIds[Math.max(0, i - 1)] ?? null) : s.activeId };
    });

  // Every delete goes through the confirm dialog: remove()/removeFolder() only ask, confirmRemove() deletes.
  const remove = (d: Doc) => setToDelete({ kind: "file", doc: d });
  const removeFolder = (path: string) =>
    setToDelete({ kind: "folder", path, count: docs.filter((d) => isInside(d.name, path)).length });
  const confirmRemove = async (t: DeleteTarget) => {
    setToDelete(null);
    const gone = (name: string) => (t.kind === "file" ? name === t.doc.name : isInside(name, t.path));
    try {
      for (const n of [...pending.current.keys()]) if (gone(n)) pending.current.delete(n);
      if (t.kind === "file") await store.current.deleteFile(t.doc.name);
      else await store.current.deleteFolder(t.path);
    } catch (e) {
      return alert(`Could not delete: ${errMsg(e)}`);
    }
    update((s) => {
      const openIds = s.openIds.filter((id) => !gone(id));
      return { docs: s.docs.filter((d) => !gone(d.name)), openIds, activeId: s.activeId && gone(s.activeId) ? (openIds[0] ?? null) : s.activeId };
    });
    if (t.kind === "folder") setFolders((f) => f.filter((p) => p !== t.path && !isInside(p, t.path)));
    setHl((h) => Object.fromEntries(Object.entries(h).filter(([k]) => !gone(k)))); // store already dropped them
  };

  const saveHighlights = (name: string, list: Highlight[]) => {
    setHl((h) => ({ ...h, [name]: list }));
    store.current.setHighlights(name, list).catch((e) => alert(`Could not save highlight: ${errMsg(e)}`));
  };

  const rename = (d: Doc, input: string) => {
    setRenaming(null);
    const base = stripExt(input.trim());
    if (!base) return;
    if (base.includes("/")) return alert("Names can't contain /. Drag the file onto a folder to move it.");
    move(d, joinPath(dirName(d.name), base));
  };

  // Rename and move are the same operation: give the file a new path.
  const move = async (d: Doc, to: string) => {
    if (to === d.name) return;
    const err = pathError(to); // mirrors the server check (the server stays the real guard)
    if (err) return alert(err);
    if (docs.some((x) => x !== d && x.name.toLowerCase() === to.toLowerCase())) return alert(`"${to}" already exists.`);
    try {
      clearTimeout(saveTimer.current);
      await flush(); // write pending edits first so a late save can't recreate the old file
      await store.current.renameFile(d.name, to, d.content);
    } catch (e) {
      return alert(`Could not rename: ${errMsg(e)}`);
    }
    const swap = (id: string | null) => (id === d.id ? to : id);
    update((s) => ({
      docs: s.docs.map((x) => (x.id === d.id ? { ...x, id: to, name: to } : x)),
      openIds: s.openIds.map((id) => swap(id)!),
      activeId: swap(s.activeId),
    }));
    setHl(({ [d.name]: list, ...rest }) => (list ? { ...rest, [to]: list } : rest)); // server already moved them
  };

  // Accepts loose files or whole folders (picker or drop) and keeps their folder structure, e.g. plan/api.md.
  // Only markdown is kept; anything inside hidden folders like .git is skipped.
  const importFiles = async (items: Picked[]) => {
    const dir = importDir.current;
    importDir.current = "";
    const md = items.filter(({ path }) => /\.(md|markdown)$/i.test(path) && !path.split("/").some((p) => p.startsWith(".")));
    if (!md.length) return items.length && alert("No .md files found.");
    const all = await Promise.all(
      md.map(async ({ file, path }) => ({ name: joinPath(dir, path.replace(/\.(md|markdown)$/i, "")), content: await file.text() })),
    );
    const ok = all.filter((it) => !pathError(it.name));
    if (ok.length < all.length) alert(`Skipped ${all.length - ok.length} file(s) with unsupported names.`);
    expand(dir);
    await createDocs(ok);
  };

  const exportHtml = async (d: Doc) => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const body = renderToStaticMarkup(<Preview content={d.content} />);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${d.name}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:auto;line-height:1.6}pre{background:#f6f8fa;padding:1rem;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.4rem .8rem}button{display:none}</style></head><body>${body}</body></html>`;
    download(`${baseName(d.name)}.html`, html, "text/html");
  };

  // ponytail: proportional sync scroll, one-way (editor → preview). Line-anchored sync if it drifts on long docs.
  const syncScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget, p = previewScroll.current;
    if (!p) return;
    p.scrollTop = (el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)) * (p.scrollHeight - p.clientHeight);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    importFiles(await filesFromDrop(e.dataTransfer));
  };

  // Internal drag: drop a file onto a folder (or the empty list area = top level) to move it there.
  const onTreeDragOver = (e: DragEvent, dir: string) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(dir);
  };
  const onTreeDrop = (e: DragEvent, dir: string) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const d = docs.find((x) => x.id === e.dataTransfer.getData(DRAG_TYPE));
    if (d && dirName(d.name) !== dir) {
      expand(dir);
      move(d, joinPath(dir, baseName(d.name)));
    }
  };

  const byId = new Map(docs.map((d) => [d.id, d]));
  const tree = buildTree(docs.map((d) => d.name), folders);
  const countFiles = (n: TreeNode): number => n.files.length + n.folders.reduce((sum, f) => sum + countFiles(f), 0);
  const flat = filter !== "all" || !!query; // search / Recent / Favs show a flat list with folder paths
  const listed = docs
    .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
    .filter((d) => filter !== "favs" || d.fav)
    .sort((a, b) => (filter === "recent" ? b.updatedAt - a.updatedAt : a.name.localeCompare(b.name)));

  const words = active?.content.trim().split(/\s+/).filter(Boolean).length ?? 0;

  const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 });

  const fileRow = (d: Doc, depth: number, showDir = false) => (
    <li key={d.id} draggable={renaming !== d.id} style={indent(depth)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, d.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setDropTarget(null)}
      className={cn("group flex items-center gap-2 rounded-md py-1.5 pr-1 text-sm hover:bg-accent/60", d.id === activeId && "bg-accent")}>
      <BookOpen className="ml-5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
      {renaming === d.id ? (
        <input autoFocus defaultValue={baseName(d.name)} className="min-w-0 flex-1 rounded bg-background px-1 outline-none ring-1 ring-ring"
          onFocus={(e) => e.target.select()}
          onBlur={(e) => rename(d, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(null);
          }} />
      ) : (
        <button className="min-w-0 flex-1 truncate text-left" title={d.name} onClick={() => open(d.id)} onDoubleClick={() => setRenaming(d.id)}>
          {baseName(d.name)}
          {showDir && dirName(d.name) && <span className="ml-1.5 text-xs text-muted-foreground">{dirName(d.name)}</span>}
        </button>
      )}
      {d.fav && <Star className="size-3.5 shrink-0 fill-yellow-400 text-yellow-400" />}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="File actions" className="opacity-0 group-hover:opacity-100 data-popup-open:opacity-100" />}>
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setRenaming(d.id)}>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={() => patch(d.id, { fav: !d.fav })}>{d.fav ? "Unfavorite" : "Favorite"}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => download(`${baseName(d.name)}.md`, d.content, "text/markdown")}>Download .md</DropdownMenuItem>
          {dirName(d.name) && <DropdownMenuItem onClick={() => move(d, baseName(d.name))}>Move to top level</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => remove(d)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );

  // Inline "new folder" name input, shown inside `parent`.
  const draftRow = (parent: string, depth: number) =>
    draftFolderIn === parent && (
      <li key={`draft:${parent}`} style={indent(depth)} className="flex items-center gap-1.5 py-1 pr-1 text-sm">
        <Folder className="ml-5 size-4 shrink-0 text-amber-500" />
        <input autoFocus placeholder="Folder name" aria-label="New folder name"
          className="min-w-0 flex-1 rounded bg-background px-1 outline-none ring-1 ring-ring"
          onBlur={(e) => addFolder(parent, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraftFolderIn(null);
          }} />
      </li>
    );

  const folderRow = (n: TreeNode, depth: number): ReactNode => {
    const isOpen = !collapsed.has(n.path);
    return (
      <li key={`dir:${n.path}`}>
        <div style={indent(depth)}
          onDragOver={(e) => onTreeDragOver(e, n.path)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => onTreeDrop(e, n.path)}
          className={cn("group flex items-center gap-1 rounded-md py-1 pr-1 text-sm hover:bg-accent/60",
            dropTarget === n.path && "bg-sky-500/15 ring-1 ring-sky-500")}>
          {renamingFolder === n.path ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
              <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground", isOpen && "rotate-90")} />
              <Folder className="size-4 shrink-0 text-amber-500" />
              <input autoFocus defaultValue={n.name} aria-label="Folder name"
                className="min-w-0 flex-1 rounded bg-background px-1 outline-none ring-1 ring-ring"
                onFocus={(e) => e.target.select()}
                onBlur={(e) => renameFolder(n.path, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenamingFolder(null);
                }} />
            </div>
          ) : (
            <button className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left" aria-expanded={isOpen}
              title={`${n.path} — double-click to rename`}
              onClick={() => toggle(n.path)} onDoubleClick={() => setRenamingFolder(n.path)}>
              <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              {isOpen ? <FolderOpen className="size-4 shrink-0 text-amber-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />}
              <span className="truncate">{n.name}</span>
            </button>
          )}
          <span className="px-1 text-xs text-muted-foreground group-hover:hidden group-has-[[data-popup-open]]:hidden">{countFiles(n)}</span>
          <div className="hidden items-center group-hover:flex group-has-[[data-popup-open]]:flex">
            <IconBtn label="New file in folder" className="size-6" onClick={() => create(n.path)}><FilePlus /></IconBtn>
            <IconBtn label="New subfolder" className="size-6" onClick={() => startFolder(n.path)}><FolderPlus /></IconBtn>
          </div>
          {/* Always visible so rename/delete are easy to find. */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Folder actions" className="text-muted-foreground" />}>
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setRenamingFolder(n.path)}><Pencil /> Rename folder</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => removeFolder(n.path)}><Trash2 /> Delete folder</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => create(n.path)}><FilePlus /> New file</DropdownMenuItem>
                <DropdownMenuItem onClick={() => startFolder(n.path)}><FolderPlus /> New subfolder</DropdownMenuItem>
                <DropdownMenuItem onClick={() => upload(n.path, "files")}><FileUp /> Upload files here</DropdownMenuItem>
                <DropdownMenuItem onClick={() => upload(n.path, "folder")}><FolderUp /> Upload folder here</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isOpen && (
          <ul className="space-y-0.5">
            {draftRow(n.path, depth + 1)}
            {n.folders.map((f) => folderRow(f, depth + 1))}
            {n.files.map((id) => fileRow(byId.get(id)!, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const editor = active && (
    <Editor
      key={active.id}
      value={active.content}
      onChange={(content) => setContent(active, content)}
      scrollRef={editorScroll}
      onScroll={syncScroll}
    />
  );
  const preview = active && (
    <div ref={previewScroll} className="h-full overflow-auto">
      <Preview content={active.content} />
    </div>
  );

  return (
    <div
      className="relative flex h-screen flex-col bg-background text-foreground"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return; // only OS files/folders, not internal moves
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" multiple hidden
        onChange={(e) => (e.target.files && importFiles(fromInput(e.target.files)), (e.target.value = ""))} />
      <input ref={folderInput} type="file" hidden {...{ webkitdirectory: "" }}
        onChange={(e) => (e.target.files && importFiles(fromInput(e.target.files)), (e.target.value = ""))} />

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="leading-tight">
          <div className="font-semibold">Markdown Viewer</div>
          <div className="text-xs text-muted-foreground">Write. Preview. Share.</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <IconBtn label="Editor only" active={view === "edit"} onClick={() => setView("edit")}><Pencil /></IconBtn>
            <IconBtn label="Split view" active={view === "split"} onClick={() => setView("split")}><Columns2 /></IconBtn>
            <IconBtn label="Preview only" active={view === "preview"} onClick={() => setView("preview")}><Eye /></IconBtn>
            <IconBtn label="Read mode (select text to highlight)" active={view === "read"} onClick={() => setView("read")}><BookOpenText /></IconBtn>
          </div>
          <IconBtn label="New file" onClick={() => create()} className="border"><Plus /></IconBtn>
          <IconBtn label="Open .md file" onClick={() => upload("", "files")} className="border"><FileUp /></IconBtn>
          <IconBtn label="Open folder of .md files" onClick={() => upload("", "folder")} className="border"><FolderUp /></IconBtn>
          <IconBtn label="Copy markdown" disabled={!active} onClick={() => active && navigator.clipboard.writeText(active.content)} className="border"><Clipboard /></IconBtn>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!active} className="border text-muted-foreground" />}>
              <Download /> <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => active && download(`${baseName(active.name)}.md`, active.content, "text/markdown")}>Markdown (.md)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => active && exportHtml(active)}>HTML (.html)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        {sidebar && view !== "read" && (
          <aside className="flex w-72 shrink-0 flex-col border-r">
            <div className="flex h-11 items-center border-b px-3">
              <span className="text-sm font-semibold">Explorer</span>
              <div className="ml-auto flex">
                <IconBtn label="New file" onClick={() => create()}><FilePlus /></IconBtn>
                <IconBtn label="New folder" onClick={() => startFolder("")}><FolderPlus /></IconBtn>
                <IconBtn label="Upload files" onClick={() => upload("", "files")}><FileUp /></IconBtn>
                <IconBtn label="Upload folder" onClick={() => upload("", "folder")}><FolderUp /></IconBtn>
                <IconBtn label="Delete active file" disabled={!active} onClick={() => active && remove(active)}><Trash2 /></IconBtn>
              </div>
            </div>
            <div className="space-y-3 p-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" className="pl-8" />
              </div>
              <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
                <TabsList className="w-full">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="recent">Recent</TabsTrigger>
                  <TabsTrigger value="favs">Favs</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex items-baseline justify-between px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
              FILES {!flat && <span className="font-normal tracking-normal">Drag files onto a folder to move</span>}
            </div>
            <ul
              className={cn("flex-1 space-y-0.5 overflow-auto px-2 pb-4", dropTarget === "" && "bg-sky-500/5 ring-1 ring-inset ring-sky-500")}
              onDragOver={(e) => onTreeDragOver(e, "")}
              onDragLeave={(e) => e.currentTarget === e.target && setDropTarget(null)}
              onDrop={(e) => onTreeDrop(e, "")}
            >
              {flat ? (
                listed.map((d) => fileRow(d, 0, true))
              ) : (
                <>
                  {draftRow("", 0)}
                  {tree.folders.map((f) => folderRow(f, 0))}
                  {tree.files.map((id) => fileRow(byId.get(id)!, 0))}
                </>
              )}
              {(flat ? !listed.length : !docs.length && !tree.folders.length && draftFolderIn === null) && (
                <li className="px-2 py-4 text-center text-xs text-muted-foreground">No files</li>
              )}
            </ul>
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              {docs.length} file{docs.length === 1 ? "" : "s"}
            </div>
          </aside>
        )}

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-stretch border-b">
            {view !== "read" && (
              <div className="flex items-center border-r px-2">
                <IconBtn label="Toggle sidebar" onClick={() => setSidebar(!sidebar)}><PanelLeft /></IconBtn>
              </div>
            )}
            <div className="flex min-w-0 flex-1 overflow-x-auto">
              {openIds.map((id) => docs.find((d) => d.id === id)).filter((d): d is Doc => !!d).map((d) => (
                <div key={d.id} onClick={() => open(d.id)}
                  className={cn("group flex max-w-52 cursor-pointer items-center gap-2 border-r px-3 text-sm text-muted-foreground",
                    d.id === activeId && "border-b-2 border-b-sky-500 bg-accent/40 text-sky-600 dark:text-sky-400")}>
                  <BookOpen className="size-4 shrink-0" />
                  <span className="truncate" title={d.name}>{baseName(d.name)}</span>
                  <button aria-label={`Close ${baseName(d.name)}`} className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
                    onClick={(e) => (e.stopPropagation(), close(d.id))}><X className="size-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center border-l px-2">
              <IconBtn label="New file" onClick={() => create()}><Plus /></IconBtn>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {!loaded ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">Loading files…</div>
            ) : !active ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <p>No file open. Create one, or drop .md files or a folder here.</p>
                <div className="flex gap-2">
                  <Button onClick={() => create()}><Plus /> New file</Button>
                  <Button variant="outline" onClick={() => upload("", "files")}><FileUp /> Open file</Button>
                  <Button variant="outline" onClick={() => upload("", "folder")}><FolderUp /> Open folder</Button>
                </div>
              </div>
            ) : view === "split" ? (
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize="50" minSize="20">{editor}</ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="50" minSize="20">{preview}</ResizablePanel>
              </ResizablePanelGroup>
            ) : view === "read" ? (
              <Reader key={active.id} content={active.content} highlights={highlights[active.name] ?? []}
                onChange={(list) => saveHighlights(active.name, list)} />
            ) : view === "edit" ? editor : preview}
          </div>
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex h-8 shrink-0 items-center border-t px-4 text-xs text-muted-foreground">
        <div className="mx-auto flex gap-6">
          <span className="flex items-center gap-1"><Clock className="size-3.5" /> {Math.max(1, Math.ceil(words / 200))} Min Read</span>
          <span className="flex items-center gap-1"><Pilcrow className="size-3.5" /> {words.toLocaleString()} Words</span>
          <span className="flex items-center gap-1"><Type className="size-3.5" /> {(active?.content.length ?? 0).toLocaleString()} Chars</span>
        </div>
        <span className={cn("flex items-center gap-1", status === "error" ? "text-destructive" : status === "saved" && "text-emerald-600 dark:text-emerald-400")}>
          {status === "error" ? "Save failed — will retry on next edit" : status === "saved" ? <><Check className="size-3.5" /> {storageKind === "disk" ? "Saved to data/" : "Saved in this browser"}</> : "Saving…"}
        </span>
      </footer>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {toDelete?.kind === "folder" ? "folder " : ""}&ldquo;{toDelete && (toDelete.kind === "file" ? baseName(toDelete.doc.name) : toDelete.path)}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.kind === "folder"
                ? <>This permanently deletes the folder and the {toDelete.count} file{toDelete.count === 1 ? "" : "s"} inside it{" "}
                    {storageKind === "disk" ? <>(<code>data/{toDelete.path}/</code>) from disk.</> : "from this browser."}</>
                : storageKind === "disk"
                  ? <>This permanently deletes <code>data/{toDelete?.kind === "file" && toDelete.doc.name}.md</code> from disk.</>
                  : <>This permanently deletes it from this browser. Download it first if you want a copy.</>}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => toDelete && confirmRemove(toDelete)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-sky-500 bg-background/80 text-lg">
          Drop .md files or folders to import
        </div>
      )}
    </div>
  );
}
