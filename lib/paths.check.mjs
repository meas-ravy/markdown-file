// Run: node lib/paths.check.mjs   (Node 22+ strips the TS types)
import assert from "node:assert/strict";
import { buildTree, pathError } from "./paths.ts";

assert.equal(pathError("plan/api"), null);
assert.equal(pathError("My Notes"), null);
for (const bad of ["", "../x", "plan/../x", "plan//x", "/x", "x/", ".hidden", "a\\b", "a:b", "plan/.git/x"])
  assert.ok(pathError(bad), `should reject ${JSON.stringify(bad)}`);

const t = buildTree(["plan/api", "plan/sub/db", "README", "plan/TASKS"], ["plan/empty", "notes"]);
assert.deepEqual(t.files, ["README"]);
assert.deepEqual(t.folders.map((f) => f.path), ["notes", "plan"]);
const plan = t.folders[1];
assert.deepEqual(plan.files, ["plan/api", "plan/TASKS"]);
assert.deepEqual(plan.folders.map((f) => f.path), ["plan/empty", "plan/sub"]);
assert.deepEqual(plan.folders[1].files, ["plan/sub/db"]);
console.log("paths: ok");
