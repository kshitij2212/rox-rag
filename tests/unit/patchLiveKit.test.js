import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');
const nodeModulesPath = path.join(projectRoot, 'node_modules');

describe('LiveKit Patcher', () => {
  test('should successfully patch audio_frame.js', () => {
    const filePath = path.join(nodeModulesPath, '@livekit/rtc-node/dist/audio_frame.js');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('new Int16Array(data.buffer),');
      expect(content).not.toContain('new Uint8Array(this.data.buffer),');
      expect(content).toContain('Int16Array.from(new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2))');
      expect(content).toContain('new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength)');
    }
  });

  test('should successfully patch audio_resampler.js', () => {
    const filePath = path.join(nodeModulesPath, '@livekit/rtc-node/dist/audio_resampler.js');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('new Int16Array(outputData.buffer),');
      expect(content).toContain('Int16Array.from(new Int16Array(outputData.buffer, outputData.byteOffset, outputData.byteLength / 2))');
    }
  });

  test('should successfully patch video_frame.js', () => {
    const filePath = path.join(nodeModulesPath, '@livekit/rtc-node/dist/video_frame.js');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('new Uint8Array(this.data.buffer));');
      expect(content).toContain('new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength)');
    }
  });
});
