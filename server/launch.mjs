/**
 * One-command LAN play: `npm start`.
 *
 * Builds the game if there's no build yet, starts the combined game+relay
 * server, prints the address coworkers on the same wifi should open, and pops
 * the host's own browser. Pass --build to force a rebuild (after pulling new
 * changes), --no-open to skip launching the browser.
 */
import { existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');

if (!existsSync(join(ROOT, 'dist', 'index.html')) || process.argv.includes('--build')) {
  console.log('[launch] building the game first — takes a minute, happens once…');
  const result = spawnSync('npm run build', { stdio: 'inherit', cwd: ROOT, shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await import('./index.mjs'); // starts the http + websocket server

const port = Number(process.env.PORT ?? 8081);
const lanUrls = [];
for (const list of Object.values(networkInterfaces())) {
  for (const iface of list ?? []) {
    if (iface.family === 'IPv4' && !iface.internal) lanUrls.push(`http://${iface.address}:${port}`);
  }
}

// Open the LAN address rather than localhost: that way the host's address bar
// is already a link that works on other machines, so after CREATE MATCH it can
// be copied and sent as-is.
const gameUrl = lanUrls[0] ?? `http://localhost:${port}`;

console.log('\n─────────── OBSIDIAN PROTOCOL · LAN PLAY ───────────');
console.log(`  game       →  ${gameUrl}`);
for (const url of lanUrls.slice(1)) console.log(`  (also on)  →  ${url}`);
console.log('');
console.log('  1. CREATE MATCH in the browser that just opened');
console.log("  2. Copy the page URL from your address bar and send it —");
console.log('     clicking it drops them straight into your match');
console.log('  (if Windows Firewall asks, allow Node on private networks)');
console.log('────────────────────────────────────────────────────\n');

if (!process.argv.includes('--no-open')) {
  const url = gameUrl;
  const opener =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
}
