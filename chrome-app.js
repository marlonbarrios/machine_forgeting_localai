/**
 * Opens Machine Forgetting as a desktop Chrome window (no browser tabs).
 * The local server keeps running in this process.
 *
 *   node chrome-app.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function findChrome() {
  const local = process.env.LOCALAPPDATA;
  const candidates = [
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

let opened = false;

function watch(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  const match = text.match(/http:\/\/localhost:\d+/);
  if (!match || opened) return;
  opened = true;
  const url = match[0];
  const chrome = findChrome();
  if (!chrome) {
    console.error(`Google Chrome was not found. Open ${url} and use Install page as app.`);
    return;
  }
  const child = spawn(chrome, [`--app=${url}`, '--window-size=1440,900', '--new-window'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log(`Chrome app window: ${url}`);
}

server.stdout.on('data', watch);
server.stderr.on('data', watch);
server.on('exit', (code) => {
  if (!opened) process.exit(code ?? 1);
});

process.on('SIGINT', () => {
  server.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.kill();
  process.exit(0);
});
