import { execFileSync } from "node:child_process";

// One-command auto-commit + auto-deploy trigger.
//   npm run autopublish
//   npm run autopublish -- "Custom commit message"
//
// It stages everything that is not ignored, commits when there is something to
// commit, and pushes to origin/main. The push is what Render watches (directly
// or through the GitHub Action that calls the Render deploy hook).

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

if (branch === "main") {
  run("git", ["push", "origin", "main"]);
  console.log("pushed origin/main — Render deploy hook / autoDeploy will pick it up");
} else {
  console.log(`on branch ${branch}; push manually: git push -u origin ${branch}`);
}
