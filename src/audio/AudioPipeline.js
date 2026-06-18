import logger from '../utils/logger.js';

const log = logger.child({ module: 'AudioPipeline' });

export function createAudioPipeline(config) {
  const { stage, groqApiKey, sttMinRms } = config;

  let audioBuffer = null;
  let vad         = null;
  let segmenter   = null;
  let stt         = null;

  async function init() {
    log.info({ stage }, `Initialising Audio Pipeline (Stage: ${stage === 0 ? 'DISABLED' : stage})`);

    if (stage >= 1) {
      const { createAudioBuffer } = await import('./AudioBuffer.js');
      audioBuffer = createAudioBuffer();
      audioBuffer.init();
      log.debug('✓ AudioBuffer');
    }

    if (stage >= 2) {
      const { createVADProcessor } = await import('./VADProcessor.js');
      vad = createVADProcessor();
      vad.init();
      log.debug('✓ VADProcessor');
    }

    if (stage >= 3) {
      const { createSpeechSegmenter } = await import('./SpeechSegmenter.js');
      segmenter = createSpeechSegmenter();
      segmenter.init();
      log.debug('✓ SpeechSegmenter');
    }

    if (stage >= 4) {
      const { createSTTService } = await import('../stt/STTService.js');
      stt = createSTTService({
        groqApiKey,
        sttMinRms,
      });
      await stt.init();
      log.debug('✓ STTService');
    }
  }

  function destroy() {
    log.debug('Destroying Audio Pipeline');
    stt?.destroy();
    segmenter?.destroy();
    vad?.destroy();
    audioBuffer?.destroy();
  }

  return { init, destroy };
}
