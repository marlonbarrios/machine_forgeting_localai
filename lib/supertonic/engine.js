import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'url';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.js');

let child = null;
let reader = null;
let chain = Promise.resolve();
let nextId = 1;

function startWorker() {
  if (child && !child.killed) return;
  child = spawn(process.execPath, [workerPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  });
  reader = new FrameReader();
  child.stdout.on('data', (chunk) => reader.push(chunk));
  child.on('exit', () => {
    child = null;
  });
}

class FrameReader {
  constructor() {
    this.buf = Buffer.alloc(0);
    this.waiters = [];
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    this.drain();
  }

  drain() {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      if (waiter.type === 'line') {
        const index = this.buf.indexOf(0x0a);
        if (index < 0) return;
        const line = this.buf.subarray(0, index).toString('utf8');
        this.buf = this.buf.subarray(index + 1);
        this.waiters.shift();
        waiter.resolve(line);
      } else if (this.buf.length < waiter.size) {
        return;
      } else {
        const data = Buffer.from(this.buf.subarray(0, waiter.size));
        this.buf = this.buf.subarray(waiter.size);
        this.waiters.shift();
        waiter.resolve(data);
      }
    }
  }

  line() {
    return new Promise((resolve) => {
      this.waiters.push({ type: 'line', resolve });
      this.drain();
    });
  }

  bytes(size) {
    return new Promise((resolve) => {
      this.waiters.push({ type: 'bytes', size, resolve });
      this.drain();
    });
  }
}

function request(payload) {
  const run = chain.then(async () => {
    startWorker();
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    const header = JSON.parse(await reader.line());
    if (!header.ok) throw new Error(header.error || 'Supertonic failed');
    if (!header.length) return Buffer.alloc(0);
    return reader.bytes(header.length);
  });
  chain = run.then(() => {}, () => {});
  return run;
}

export function warmupSupertonic() {
  return request({ warmup: true });
}

export function synthesizeSupertonic(text, lang) {
  return request({ text, lang });
}
