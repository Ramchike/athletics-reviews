class SoundTrigger extends AudioWorkletProcessor {
  enabled = false;
  quietSamples = 0;
  firstFrame = 0;

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      this.firstFrame = Math.ceil(data * sampleRate);
      this.quietSamples = 0;
      this.enabled = true;
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!this.enabled || !channel) return true;
    const quietWindow = Math.ceil(sampleRate * 0.05);
    for (let index = 0; index < channel.length; index++) {
      const frame = currentFrame + index;
      if (frame < this.firstFrame) continue;
      const level = Math.abs(channel[index]);
      if (level >= 0.3 && this.quietSamples >= quietWindow) {
        this.enabled = false;
        this.port.postMessage(frame / sampleRate);
        break;
      }
      this.quietSamples = level < 0.1 ? Math.min(quietWindow, this.quietSamples + 1) : 0;
    }
    return true;
  }
}

registerProcessor('stvor-sound-trigger', SoundTrigger);
