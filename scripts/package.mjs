import { cp, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist', 'extension');

const files = [
  'manifest.json',
  'service-worker.js',
  'content-chatgpt.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'help.html',
  'help.css',
  'planner.html',
  'planner.css',
  'planner.js',
  'offscreen.html',
  'offscreen.js'
];

const directories = [
  'icons',
  'lib'
];

await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of files) {
  await copyFile(path.join(root, file), path.join(out, file));
}

for (const directory of directories) {
  await cp(
    path.join(root, directory),
    path.join(out, directory),
    { recursive: true }
  );
}

const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
console.log(`Packaged ChatGPT Conversation Archiver ${manifest.version} -> dist/extension`);
