import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '../../');
const nodeModulesPath = path.join(projectRoot, 'node_modules');

function patchFile(relativePath, replacements) {
  const filePath = path.join(nodeModulesPath, relativePath);
  if (!fs.existsSync(filePath)) {
    console.warn(`[patchLiveKit] File not found, skipping: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const { pattern, replacement, description } of replacements) {
    if (content.includes(replacement)) {

      continue;
    }
    if (content.includes(pattern)) {
      content = content.split(pattern).join(replacement);
      changed = true;
      console.log(`[patchLiveKit]   Applied: ${description}`);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[patchLiveKit] ✓ Patched: ${relativePath}`);
  } else {
    console.log(`[patchLiveKit] ✓ Already patched: ${relativePath}`);
  }
}

try {

  patchFile('@livekit/rtc-node/dist/audio_frame.js', [
    {
      pattern:     'new Int16Array(data.buffer)',
      replacement: 'Int16Array.from(new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2))',
      description: 'audio_frame fromOwnedInfo: clone Int16Array with correct offset/length',
    },
    {
      pattern:     'new Uint8Array(this.data.buffer)',
      replacement: 'new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength)',
      description: 'audio_frame protoInfo: fix Uint8Array view offset/length',
    },
  ]);

  patchFile('@livekit/rtc-node/dist/audio_resampler.js', [
    {
      pattern:     'new Int16Array(outputData.buffer)',
      replacement: 'Int16Array.from(new Int16Array(outputData.buffer, outputData.byteOffset, outputData.byteLength / 2))',
      description: 'audio_resampler: clone Int16Array with correct offset/length',
    },
  ]);

  patchFile('@livekit/rtc-node/dist/video_frame.js', [
    {
      pattern:     'new Uint8Array(this.data.buffer)',
      replacement: 'new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength)',
      description: 'video_frame: fix Uint8Array view offset/length',
    },
  ]);
} catch (err) {
  console.error('[patchLiveKit] Failed to run patch:', err);
}
