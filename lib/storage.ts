"use client";

import * as disk from "@/app/actions";
import type { FileDoc, Highlight } from "@/app/actions";

// One interface, two backends: data/ on disk (local server) or IndexedDB in the visitor's browser (deployed).
export type Store = Pick<
  typeof disk,
  | "listFiles" | "createFile" | "saveFile" | "renameFile" | "deleteFile" | "getHighlights" | "setHighlights"
  | "listFolders" | "createFolder" | "deleteFolder"
>;

// Each file is one IndexedDB record keyed by its path; its highlights ride along, so rename/delete carry them.
// Explicit folders are records keyed "path/" (a trailing slash never collides with a file path).
type Rec = FileDoc & { highlights?: Highlight[]; folder?: true };
const files = (all: Rec[]) => all.filter((r) => !r.folder);

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () =>
  (dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open("md-viewer", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "name" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

/** Runs fn inside one transaction and resolves once it has committed. */
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T>) {
  const t = (await db()).transaction("files", mode);
  const done = new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = t.onabort = () => rej(t.error ?? new Error("Storage transaction failed"));
  });
  const out = await fn(t.objectStore("files"));
  await done;
  return out;
}

const get = (s: IDBObjectStore, name: string) => req<Rec | undefined>(s.get(name));
const missing = (name: string) => new Error(`"${name}" not found.`);

export const browserStore: Store = {
  listFiles: () =>
    tx("readonly", async (s) => files(await req<Rec[]>(s.getAll())).map(({ name, content, updatedAt }) => ({ name, content, updatedAt }))),

  listFolders: () =>
    tx("readonly", async (s) => (await req<Rec[]>(s.getAll())).filter((r) => r.folder).map((r) => r.name.slice(0, -1))),

  createFolder: (p) =>
    tx("readwrite", async (s) => void (await req(s.put({ name: `${p}/`, content: "", updatedAt: Date.now(), folder: true } satisfies Rec)))),

  deleteFolder: (p) =>
    tx("readwrite", async (s) => {
      // "p/" is the folder record itself; "p/..." are its files and subfolders
      const keys = (await req(s.getAllKeys())).filter((k) => String(k).startsWith(`${p}/`));
      await Promise.all(keys.map((k) => req(s.delete(k))));
    }),

  createFile: (name, content) =>
    tx("readwrite", async (s) => void (await req(s.add({ name, content, updatedAt: Date.now() } satisfies Rec)))), // add() fails if it exists

  saveFile: (name, content) =>
    tx("readwrite", async (s) => {
      const r = await get(s, name);
      await req(s.put({ ...r, name, content, updatedAt: Date.now() })); // keeps highlights
    }),

  renameFile: (from, to, content) =>
    tx("readwrite", async (s) => {
      const r = await get(s, from);
      if (!r) throw missing(from);
      await req(s.add({ ...r, name: to, content, updatedAt: Date.now() })); // fails if target exists
      await req(s.delete(from));
    }),

  deleteFile: (name) => tx("readwrite", async (s) => void (await req(s.delete(name)))),

  getHighlights: () =>
    tx("readonly", async (s) =>
      Object.fromEntries(files(await req<Rec[]>(s.getAll())).filter((r) => r.highlights?.length).map((r) => [r.name, r.highlights!])),
    ),

  setHighlights: (name, list) =>
    tx("readwrite", async (s) => {
      const r = await get(s, name);
      if (!r) throw missing(name);
      await req(s.put({ ...r, highlights: list }));
    }),
};

/** Disk when the server allows it (local), otherwise this browser. */
export async function pickStore(): Promise<{ store: Store; kind: "disk" | "browser" }> {
  if (await disk.diskEnabled().catch(() => false)) return { store: disk, kind: "disk" };
  navigator.storage?.persist?.(); // ask the browser not to evict our files under storage pressure
  return { store: browserStore, kind: "browser" };
}
