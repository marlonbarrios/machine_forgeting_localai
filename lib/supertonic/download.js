import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const BASE = 'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/main';

const FILES = [
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/vector_estimator.onnx',
  'onnx/vocoder.onnx',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
  'voice_styles/F1.json',
];

export async function ensureSupertonicAssets(root) {
  for (const rel of FILES) {
    const dest = path.join(root, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const url = `${BASE}/${rel}`;
    console.log(`Downloading Supertonic asset ${rel}...`);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Could not download ${rel} (${response.status})`);
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(dest));
    console.log(`Saved ${dest}`);
  }
}
