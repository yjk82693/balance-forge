// Scans staged files for key-like strings. Run before every commit: npm run check:secrets
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const patterns = [
  /AIza[0-9A-Za-z_\-]{35}/, // Google API key
  /sk-[A-Za-z0-9_\-]{20,}/, // OpenAI/Anthropic-style keys
  /xai-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{36}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{16,}["']/i,
];
const files = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" })
  .split("\n").filter((f) => f && existsSync(f) && !f.endsWith(".png") && !f.endsWith(".mp4"));
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const re of patterns) if (re.test(text)) hits.push(`${file}: ${re}`);
}
if (hits.length) {
  console.error("Possible secrets in staged files:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`check:secrets ok (${files.length} staged files)`);
