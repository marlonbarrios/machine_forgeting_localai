/**
 * Local server: Vite sketch plus /api/chat (Ollama) and /api/audio (Kokoro, Supertonic).
 * Start with: node server.js
 * Chrome desktop window: node chrome-app.js
 */
import { config as dotenvConfig } from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { warmupKokoro } from './lib/kokoro.js';
import { warmupSupertonic } from './lib/supertonic/engine.js';

dotenvConfig();
dotenvConfig({ path: 'api/.env', override: false });

const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'gemma4:latest';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    const tags = await fetch(`${ollamaHost.replace(/\/$/, '')}/api/tags`);
    const data = tags.ok ? await tags.json() : null;
    const names = (data?.models || []).map((model) => model.name);
    res.json({
      ok: tags.ok,
      ollama: ollamaHost,
      model: ollamaModel,
      modelReady: names.some((name) => name === ollamaModel || name.startsWith(`${ollamaModel.split(':')[0]}:`)),
      speech: { en: 'kokoro', es: 'supertonic', fr: 'supertonic', pt: 'supertonic', ko: 'supertonic', de: 'supertonic' },
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.all('/api/chat', async (req, res) => {
  const { default: handler } = await import('./api/chat.js');
  return handler(req, res);
});
app.all('/api/audio', async (req, res) => {
  const { default: handler } = await import('./api/audio.js');
  return handler(req, res);
});

const vite = await createViteServer({ server: { middlewareMode: true } });
app.use(vite.middlewares);

function tryListen(port) {
  const server = app.listen(port, () => {
    const actual = server.address().port;
    console.log(`Dev server at http://localhost:${actual}`);
    console.log(`Text: ${ollamaHost.replace(/\/$/, '')}/api/chat (${ollamaModel})`);
    console.log('Speech: Kokoro for English, Supertonic for Spanish, French, Portuguese, Korean, and German');
    warmupKokoro().then(
      () => console.log('Kokoro is ready'),
      (error) => console.warn('Kokoro warmup failed:', error.message)
    );
    warmupSupertonic().then(
      () => console.log('Supertonic is ready'),
      (error) => console.warn('Supertonic warmup failed:', error.message)
    );
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1);
    } else {
      throw err;
    }
  });
}

// 5180 avoids localhost:5173, which is already taken by My LatentWelt on IPv6.
tryListen(Number(process.env.PORT) || 5180);
