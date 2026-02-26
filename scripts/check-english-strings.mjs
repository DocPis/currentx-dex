import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGET_DIRS = ["src", "api", "scripts"];
const IGNORED_RELATIVE_PATHS = new Set(["scripts/check-english-strings.mjs"]);
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
]);

const ITALIAN_WORD_RE =
  /\b(abilita|aggiorna(?:re|to|ta|ti)?|attiv[aoi]|compreso|coerent[ei]|deve|impossibil[ei]|massim[ao]|minim[oa]|ribilanciament[oi]|seleziona|strategia|vuoto|questa|necessari[oa]|soglia|valore|primari[oa])\b/iu;
const ACCENT_RE = /[À-ÖØ-öø-ÿ]/u;

const shouldScanFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  const rel = path.relative(ROOT, filePath).replace(/\\/gu, "/");
  if (IGNORED_RELATIVE_PATHS.has(rel)) return false;
  return true;
};

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(abs)));
      continue;
    }
    if (entry.isFile() && shouldScanFile(abs)) {
      out.push(abs);
    }
  }
  return out;
};

const scanFile = async (filePath) => {
  const relativePath = path.relative(ROOT, filePath).replace(/\\/gu, "/");
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/gu);
  const matches = [];

  lines.forEach((line, index) => {
    if (ITALIAN_WORD_RE.test(line) || ACCENT_RE.test(line)) {
      matches.push({
        file: relativePath,
        line: index + 1,
        text: line.trim().slice(0, 180),
      });
    }
  });
  return matches;
};

const run = async () => {
  const existingDirs = [];
  for (const relDir of TARGET_DIRS) {
    const absDir = path.join(ROOT, relDir);
    try {
      const stat = await fs.stat(absDir);
      if (stat.isDirectory()) existingDirs.push(absDir);
    } catch {
      // ignore missing directories
    }
  }

  const files = [];
  for (const dir of existingDirs) {
    files.push(...(await walk(dir)));
  }

  const violations = [];
  for (const filePath of files) {
    const found = await scanFile(filePath);
    if (found.length) violations.push(...found);
  }

  if (!violations.length) {
    console.log("English string check passed.");
    return;
  }

  console.error("Italian/non-English strings detected:");
  for (const violation of violations.slice(0, 200)) {
    console.error(`- ${violation.file}:${violation.line} -> ${violation.text}`);
  }
  if (violations.length > 200) {
    console.error(`...and ${violations.length - 200} more`);
  }
  process.exit(1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
