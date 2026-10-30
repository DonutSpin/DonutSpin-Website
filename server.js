/**
 * Node start target for hosts that expect a plain entry file.
 *
 * MonsterASP / IIS Git deploy validates the "start command" against a file
 * path, so `npm start` is rejected with
 *   "Start command target not found in the build output: 'npm start'".
 * Use `server.js` (or leave the field empty) instead.
 *
 * The real server is compiled to build/server/index.js by `npm run build`.
 * This wrapper exists so the start target is a stable, documented filename at
 * the project root, whatever the bundle is called.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

// IIS may start the process from another working directory. The server reads
// data/, dist/ and .env relative to process.cwd(), so pin it to the app root.
try {
  process.chdir(appRoot);
} catch {
  /* keep the inherited working directory if it is not writable */
}

const entry = path.join(appRoot, 'build', 'server', 'index.js');

if (!fs.existsSync(entry)) {
  console.error(`[donutcash] missing ${entry}. Run \`npm run build\` before starting the server.`);
  process.exit(1);
}

await import(pathToFileURL(entry).href);
