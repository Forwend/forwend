// Fails when a file in apps/web/public/images has no entry in docs/images.md (slot, prompt, date).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const imagesDir = join(root, "apps/web/public/images");
const ledger = readFileSync(join(root, "docs/images.md"), "utf8");

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.startsWith(".") ? [] : [path];
  });
}

const rows = ledger.split("\n").filter((line) => line.startsWith("|"));
const missing = files(imagesDir)
  .map((path) => relative(join(root, "apps/web/public"), path))
  .filter((path) => {
    const row = rows.find((line) => line.includes(`\`${path}\``));
    // slot | file | prompt | date: each cell must be filled.
    return (
      !row ||
      row
        .split("|")
        .slice(1, -1)
        .some((cell) => cell.trim() === "")
    );
  });

if (missing.length > 0) {
  console.error(
    `Images without a complete docs/images.md row (slot, file, prompt, date):\n${missing.join("\n")}`,
  );
  process.exit(1);
}
console.log(`images-check: ${files(imagesDir).length} image(s), all recorded in docs/images.md`);
