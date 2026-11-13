import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSupertonicAssets } from './download.js';
import { loadTextToSpeech, loadVoiceStyle, wavToBuffer } from './helper.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../models/supertonic-3');
const voiceName = process.env.SUPERTONIC_VOICE || 'F1';

let enginePromise;

export function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      await ensureSupertonicAssets(root);
      const tts = await loadTextToSpeech(path.join(root, 'onnx'), false);
      const style = loadVoiceStyle([path.join(root, 'voice_styles', `${voiceName}.json`)]);
      return { tts, style };
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export async function synthesizeSupertonic(text, lang) {
  const { tts, style } = await loadEngine();
  const steps = Number(process.env.SUPERTONIC_STEPS || 8);
  const { wav } = await tts.call(text, lang, style, steps, 1.05);
  return wavToBuffer(wav, tts.sampleRate);
}
