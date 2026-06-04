import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const TARGET_DIRS = [
  'tampermonkey-userscript-src',
  'scripts',
];
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.txt',
  '.css',
  '.html',
]);

function walk(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) {
    return files;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

let fixedCount = 0;
for (const dir of TARGET_DIRS) {
  const absDir = path.join(ROOT, dir);
  for (const filePath of walk(absDir)) {
    const data = fs.readFileSync(filePath);
    if (!data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
      continue;
    }
    fs.writeFileSync(filePath, data.subarray(3));
    fixedCount += 1;
    console.log(`[FIX_ENCODING][BOM_REMOVED] file=${filePath}`);
  }
}
console.log(`[FIX_ENCODING][DONE] fixed=${fixedCount}`);
