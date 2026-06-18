import logger from '../utils/logger.js';

export const INT16_MAX  =  32767;
export const INT16_MIN  = -32768;

export function stereoToMono(stereo) {
  const mono = new Int16Array(stereo.length >>> 1);
  for (let i = 0, j = 0; i < stereo.length; i += 2, j++) {

    mono[j] = Math.round((stereo[i] + stereo[i + 1]) / 2);
  }
  return mono;
}

export function downmixToMono(interleaved, channels) {
  if (channels === 1) return interleaved;
  const mono = new Int16Array(Math.floor(interleaved.length / channels));
  for (let i = 0, j = 0; i < interleaved.length; i += channels, j++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += interleaved[i + c];
    }

    mono[j] = Math.round(sum / channels);
  }
  return mono;
}

export function float32ToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {

    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? (clamped * 32768) : (clamped * 32767);
  }
  return int16;
}

export function int16ToFloat32(int16) {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {

    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;

  const ratio      = fromRate / toRate;
  const outLength  = Math.round(samples.length / ratio);
  const out        = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac   = srcPos - srcIdx;

    if (frac === 0 || srcIdx + 1 >= samples.length) {

      out[i] = samples[Math.min(srcIdx, samples.length - 1)];
    } else {

      const a = samples[srcIdx];
      const b = samples[srcIdx + 1];
      out[i]  = Math.round(a + frac * (b - a));
    }
  }

  return out;
}

export function normaliseFrame(frame) {
  let data = frame.data;

  if (frame.channels > 1) {
    data = downmixToMono(data, frame.channels);
  }

  if (frame.sampleRate !== 16000) {
    data = resample(data, frame.sampleRate, 16000);
  }

  return data;
}

export function encodeWAV(samples, sampleRate = 16000) {
  if (!samples || samples.length === 0) {
    const log = logger.child({ module: 'AudioUtils' });
    log.warn('encodeWAV called with empty or undefined samples — returning empty wav buffer');

    const emptyBuffer = Buffer.alloc(44);
    emptyBuffer.write('RIFF', 0);
    emptyBuffer.writeUInt32LE(36, 4);
    emptyBuffer.write('WAVE', 8);
    emptyBuffer.write('fmt ', 12);
    emptyBuffer.writeUInt32LE(16, 16);
    emptyBuffer.writeUInt16LE(1, 20);
    emptyBuffer.writeUInt16LE(1, 22);
    emptyBuffer.writeUInt32LE(sampleRate, 24);
    const byteRate = sampleRate * 1 * (16 / 8);
    emptyBuffer.writeUInt32LE(byteRate, 28);
    emptyBuffer.writeUInt16LE(2, 32);
    emptyBuffer.writeUInt16LE(16, 34);
    emptyBuffer.write('data', 36);
    emptyBuffer.writeUInt32LE(0, 40);
    return emptyBuffer;
  }

  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign    = numChannels * (bitsPerSample / 8);
  const dataSize      = samples.length * (bitsPerSample / 8);
  const buffer        = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16,            16);
  buffer.writeUInt16LE(1,             20);
  buffer.writeUInt16LE(numChannels,   22);
  buffer.writeUInt32LE(sampleRate,    24);
  buffer.writeUInt32LE(byteRate,      28);
  buffer.writeUInt16LE(blockAlign,    32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buffer;
}

export function concatInt16Arrays(arrays) {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result      = new Int16Array(totalLength);
  let   offset      = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function durationMs(samples, sampleRate = 16000) {
  return (samples.length / sampleRate) * 1000;
}
