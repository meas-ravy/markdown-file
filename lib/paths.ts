// File ids are "/"-separated paths without the .md extension, e.g. "plan/sub/api".
// Shared by the server (trust boundary) and the client (friendly errors + tree).

export function pathError(p: string): string | null {
  const segs = p.split("/");
  if (!p || p.length > 500 || segs.length > 10) return "Name is empty, too long, or nested too deep.";
  for (const s of segs) {
    if (!s.trim() || s.startsWith(".") || s.length > 200 || /[\\\0:*?"<>|]/.test(s))
      return `Invalid name "${s}". Don't use \\ : * ? " < > | or a leading dot.`;
  }
  return null;
}

export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirName = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
export const isInside = (p: string, folder: string) => p.startsWith(`${folder}/`);

export type TreeNode = { name: string; path: string; folders: TreeNode[]; files: string[] };

/** Builds a sorted folder tree from file paths plus explicit (possibly empty) folder paths. */
export function buildTree(files: string[], folders: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", folders: [], files: [] };
  const folderAt = (p: string): TreeNode => {
    if (!p) return root;
    const parent = folderAt(dirName(p));
    let node = parent.folders.find((f) => f.path === p);
    if (!node) parent.folders.push((node = { name: baseName(p), path: p, folders: [], files: [] }));
    return node;
  };
  folders.forEach(folderAt);
  files.forEach((f) => folderAt(dirName(f)).files.push(f));
  const sort = (n: TreeNode) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => baseName(a).localeCompare(baseName(b)));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}
