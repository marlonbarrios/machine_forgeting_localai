console.log = (...args) => console.error(...args);
const { loadEngine, synthesizeSupertonic } = await import('./runtime.js');

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(line) {
  const message = JSON.parse(line);
  try {
    if (message.warmup) {
      await loadEngine();
      writeMessage({ id: message.id, ok: true, length: 0 });
      return;
    }
    const wav = await synthesizeSupertonic(message.text, message.lang);
    writeMessage({ id: message.id, ok: true, length: wav.length });
    process.stdout.write(wav);
  } catch (error) {
    writeMessage({ id: message.id, ok: false, error: error.message || String(error) });
  }
}

let pending = '';
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  let newline = pending.indexOf('\n');
  while (newline !== -1) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (line.trim()) queue = queue.then(() => handle(line));
    newline = pending.indexOf('\n');
  }
});
