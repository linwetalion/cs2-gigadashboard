import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// One-command auto-commit + auto-deploy trigger.
//   npm run autopublish
//   npm run autopublish -- "Custom commit message"
//
// It stages everything that is not ignored, commits when there is something to
// commit, pushes to origin/main and then calls the Render deploy hook when
// RENDER_DEPLOY_HOOK_URL is present in the environment or in .env.

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryRun(command, args) {
  try {
    return run(command, args);
  } catch {
    return "";
  }
}

function deployHook() {
  if (process.env.RENDER_DEPLOY_HOOK_URL) return process.env.RENDER_DEPLOY_HOOK_URL.trim();
  if (!existsSync(".env")) return "";
  const line = tryRun("node", [
    "-e",
    "const fs=require('fs');const m=fs.readFileSync('.env','utf8').match(/^RENDER_DEPLOY_HOOK_URL=(.*)$/m);if(m)process.stdout.write(m[1].trim().replace(/^[\"']|[\"']$/g,''))",
  ]);
  return line;
}

const message =
  process.argv.slice(2).join(" ").trim() ||
  `Update ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

const branch = tryRun("git", ["rev-parse", "--abbrev-ref", "HEAD"]) || "main";

run("git", ["add", "-A"]);
const staged = tryRun("git", ["diff", "--cached", "--name-only"]);

if (staged) {
  run("git", ["commit", "-m", message]);
  console.log(`committed ${staged.split("\n").length} file(s): ${message}`);
} else {
  console.log("nothing to commit");
}

if (branch !== "main") {
  console.log(`on branch ${branch}; push manually: git push -u origin ${branch}`);
  process.exit(0);
}

run("git", ["push", "origin", "main"]);
console.log("pushed origin/main");

const hook = deployHook();
if (!hook) {
  console.log("no RENDER_DEPLOY_HOOK_URL — deploy manually: Render → Manual Deploy → Deploy latest commit");
  process.exit(0);
}

const response = await fetch(hook, { method: "POST" });
console.log(`render deploy hook: ${response.status} ${response.statusText}`);
if (!response.ok) process.exitCode = 1;
