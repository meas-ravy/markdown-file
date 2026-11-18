"use server";

import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isInside, pathError } from "@/lib/paths";


const DIR = path.join(process.cwd(), "data");

// Disk storage only where the server can write and isn't public: off on Vercel (read-only, public URL),
// where the client stores files in the visitor's browser instead (lib/storage.ts).
const DISK = !process.env.VERCEL;
function assertDisk() {
  if (!DISK) throw new Error("Disk storage is disabled on this deployment.");
}

export async function diskEnabled() {
  return DISK;
}

export type FileDoc = { name: string; content: string; updatedAt: number };

// Read-mode highlights live beside the files in one hidden JSON: { "<file name>": Highlight[] }.
// A highlight is stored as the quoted text plus a little preceding context (to tell repeats apart),
// so it survives small edits elsewhere in the file and never modifies the .md itself.
export type Highlight = { id: string; text: string; prefix: string; color: string };
const HL_FILE = path.join(DIR, ".highlights.json");
const COLORS = ["yellow", "green", "blue", "pink"];

// Trust boundary: paths come from the client. pathError rejects "..", leading dots, and odd characters,
// so every path stays inside data/.
function dirOf(p: string) {
  assertDisk();
  const err = pathError(String(p));
  if (err) throw new Error(err);
  return path.join(DIR, ...p.split("/"));
}
const fileOf = (name: string) => `${dirOf(name)}.md`;

// Relative "/"-separated paths of everything under data/, skipping hidden entries like .git.
async function walk() {
  assertDisk();
  await mkdir(DIR, { recursive: true });
  return (await readdir(DIR, { recursive: true, withFileTypes: true }))
    .map((e) => ({ e, rel: path.relative(DIR, path.join(e.parentPath, e.name)).split(path.sep).join("/") }))
    .filter(({ rel }) => !rel.split("/").some((seg) => seg.startsWith(".")));
}

// returns every file with its content in one call; lazy-load content if the vault gets big.
export async function listFiles(): Promise<FileDoc[]> {
  const files = (await walk()).filter(({ e, rel }) => e.isFile() && rel.endsWith(".md"));
  return Promise.all(
    files.map(async ({ rel }) => {
      const p = path.join(DIR, rel);
      const [content, s] = await Promise.all([readFile(p, "utf8"), stat(p)]);
      return { name: rel.slice(0, -3), content, updatedAt: s.mtimeMs };
    }),
  );
}

export async function listFolders(): Promise<string[]> {
  return (await walk()).filter(({ e }) => e.isDirectory()).map(({ rel }) => rel);
}

export async function createFolder(p: string) {
  await mkdir(dirOf(p), { recursive: true });
}

/** Deletes a folder with everything inside it, and their highlights. */
export async function deleteFolder(p: string) {
  await rm(dirOf(p), { recursive: true, force: true });
  await editHighlights((all) => Object.keys(all).forEach((k) => isInside(k, p) && delete all[k]));
}

/** Creates a new file (and its folders); fails if it already exists. */
export async function createFile(name: string, content: string) {
  const f = fileOf(name);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, content, { flag: "wx" });
}

export async function saveFile(name: string, content: string) {
  await writeFile(fileOf(name), content);
}

/** Renames and writes the latest content in one step, so no unsaved edit is lost. */
export async function renameFile(from: string, to: string, content: string) {
  await mkdir(path.dirname(fileOf(to)), { recursive: true });
  await writeFile(fileOf(to), content, { flag: "wx" }); // fails if target exists
  await unlink(fileOf(from)).catch(() => {});
  await editHighlights((all) => {
    if (all[from]) all[to] = all[from];
    delete all[from];
  });
}

export async function deleteFile(name: string) {
  await unlink(fileOf(name));
  await editHighlights((all) => void delete all[name]);
}

async function readHighlights(): Promise<Record<string, Highlight[]>> {
  try {
    return JSON.parse(await readFile(HL_FILE, "utf8"));
  } catch {
    return {}; // no highlights yet
  }
}

// ponytail: read-modify-write without a lock; fine because one browser's actions run sequentially.
async function editHighlights(fn: (all: Record<string, Highlight[]>) => void) {
  const all = await readHighlights();
  fn(all);
  await mkdir(DIR, { recursive: true });
  await writeFile(HL_FILE, JSON.stringify(all, null, 2));
}

export async function getHighlights() {
  assertDisk();
  return readHighlights();
}

export async function setHighlights(name: string, list: Highlight[]) {
  fileOf(name); // validates the name
  // Trust boundary: keep only well-formed entries.
  const clean = (Array.isArray(list) ? list : [])
    .filter((h) => h && typeof h.id === "string" && typeof h.text === "string" && typeof h.prefix === "string" && COLORS.includes(h.color))
    .map(({ id, text, prefix, color }) => ({ id: id.slice(0, 64), text: text.slice(0, 5000), prefix: prefix.slice(0, 64), color }));
  await editHighlights((all) => {
    if (clean.length) all[name] = clean;
    else delete all[name];
  });
}
