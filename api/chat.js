import { config as dotenvConfig } from 'dotenv';

dotenvConfig();
dotenvConfig({ path: 'api/.env', override: false });

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:latest';
const OLLAMA_CHAT_URL = `${OLLAMA_HOST}/api/chat`;

function cleanText(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
      }
    }

    const prompt = body?.prompt;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const started = Date.now();
    console.log(`Gemma request (${prompt.length} chars)...`);
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\nReply with only the text itself. No title, no quotation marks, no explanation.`,
          },
        ],
        options: {
          temperature: 0.7,
          num_predict: 420,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Ollama returned ${response.status}`);
    }

    const data = await response.json();
    const generatedText = cleanText(data.message?.content);
    if (!generatedText) {
      throw new Error(`Ollama model ${OLLAMA_MODEL} returned empty text`);
    }

    const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    console.log(`Gemma wrote ${generatedText.length} chars in ${seconds}s: ${generatedText.slice(0, 80)}`);
    return res.status(200).json({ text: generatedText, model: OLLAMA_MODEL, seconds });
  } catch (error) {
    const refused = error?.cause?.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed/i.test(error.message || '');
    console.error('Error generating text:', error);
    return res.status(refused ? 503 : 500).json({
      error: refused
        ? 'Ollama is not running on port 11434. Start Ollama, then press space again.'
        : (error.message || 'Failed to generate text'),
    });
  }
}
