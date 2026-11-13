import { KokoroTTS } from 'kokoro-js';

const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const voice = process.env.KOKORO_VOICE || 'af_heart';

let ttsPromise;
let queue = Promise.resolve();

function loadKokoro() {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(modelId, {
      dtype: 'q8',
      device: 'cpu',
    }).catch((error) => {
      ttsPromise = null;
      throw error;
    });
  }
  return ttsPromise;
}

export function warmupKokoro() {
  return loadKokoro();
}

function floatWavToPcm16(wav) {
  const input = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  if (input.length < 44 || input.toString('ascii', 0, 4) !== 'RIFF') return input;
  if (input.readUInt16LE(20) !== 3) return input;
  const rate = input.readUInt32LE(24);
  const sampleCount = Math.floor(input.readUInt32LE(40) / 4);
  const pcm = Buffer.alloc(44 + sampleCount * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(36 + sampleCount * 2, 4);
  pcm.write('WAVE', 8);
  pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.max(-1, Math.min(1, input.readFloatLE(44 + i * 4)));
    pcm.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, 44 + i * 2);
  }
  return pcm;
}

export function synthesizeKokoro(text) {
  const run = queue.then(async () => {
    const started = Date.now();
    console.log(`Kokoro generating (${text.length} chars)...`);
    const tts = await loadKokoro();
    const audio = await tts.generate(text, { voice });
    const raw = typeof audio.toWav === 'function'
      ? Buffer.from(audio.toWav())
      : Buffer.from(await audio.toBlob().arrayBuffer());
    const buffer = floatWavToPcm16(raw);
    console.log(`Kokoro done in ${((Date.now() - started) / 1000).toFixed(1)}s (${buffer.length} bytes, pcm16)`);
    return buffer;
  });
  queue = run.then(() => {}, () => {});
  return run;
}
