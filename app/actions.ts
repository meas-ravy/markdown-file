"use server";

import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// ponytail: no auth — fine for a local app. Server Functions are public POST endpoints,
// so add auth before deploying anywhere others can reach it.
const DIR = path.join(process.cwd(), "data");

export type FileDoc = { name: string; content: string; updatedAt: number };

// Read-mode highlights live beside the files in one hidden JSON: { "<file name>": Highlight[] }.
// A highlight is stored as the quoted text plus a little preceding context (to tell repeats apart),
// so it survives small edits elsewhere in the file and never modifies the .md itself.
export type Highlight = { id: string; text: string; prefix: string; color: string };
const HL_FILE = path.join(DIR, ".highlights.json");
const COLORS = ["yellow", "green", "blue", "pink"];

// Trust boundary: names come from the client. Allow a plain file name only, never a path.
function fileOf(name: string) {
  const n = String(name).trim();
  if (!n || n.length > 200 || /[/\\\0:*?"<>|]/.test(n) || n.startsWith(".")) throw new Error(`Invalid file name: ${n}`);
  return path.join(DIR, `${n}.md`);
}

// ponytail: returns every file with its content in one call; lazy-load content if the vault gets big.
export async function listFiles(): Promise<FileDoc[]> {
  await mkdir(DIR, { recursive: true });
  const names = (await readdir(DIR)).filter((f) => f.endsWith(".md"));
  return Promise.all(
    names.map(async (f) => {
      const p = path.join(DIR, f);
      const [content, s] = await Promise.all([readFile(p, "utf8"), stat(p)]);
      return { name: f.slice(0, -3), content, updatedAt: s.mtimeMs };
    }),
  );
}

/** Creates a new file; fails if it already exists. */
export async function createFile(name: string, content: string) {
  await mkdir(DIR, { recursive: true });
  await writeFile(fileOf(name), content, { flag: "wx" });
}

export async function saveFile(name: string, content: string) {
  await writeFile(fileOf(name), content);
}

/** Renames and writes the latest content in one step, so no unsaved edit is lost. */
export async function renameFile(from: string, to: string, content: string) {
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
