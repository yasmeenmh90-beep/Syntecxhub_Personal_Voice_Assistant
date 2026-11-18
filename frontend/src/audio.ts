export type Capture = {
  finish: () => Promise<Blob>;
  cancel: () => Promise<void>;
};
export async function capture(
  device: string,
  onLevel: (value: number) => void,
  onSamples?: (samples: number[]) => void,
): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Microphone capture requires localhost and a supported browser.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: device ? { deviceId: { exact: device } } : true,
  });
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let silent: GainNode | undefined;
  const chunks: Float32Array[] = [];
  let closed = false;
  let finalized = false;
  let sampleCount = 0;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (processor) processor.onaudioprocess = null;
      processor?.disconnect();
      source?.disconnect();
      silent?.disconnect();
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close();
    }
  }
  try {
    context = new AudioContext();
    await context.resume();
    source = context.createMediaStreamSource(stream);
    // ScriptProcessor is used for broad local browser support; capture is limited to 15 seconds.
    processor = context.createScriptProcessor(4096, 1, 1);
    silent = context.createGain();
    silent.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (closed) return;
      // Bound retained audio even if a background-tab timer is delayed.
      const remaining = Math.max(0, context!.sampleRate * 15 - sampleCount);
      if (!remaining) return;
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0).subarray(0, remaining));
      chunks.push(chunk);
      sampleCount += chunk.length;
      onLevel(Math.sqrt(chunk.reduce((n, x) => n + x * x, 0) / chunk.length));
      // 64 consecutive PCM samples: an actual short time-domain waveform.
      onSamples?.(Array.from(chunk.subarray(0, 64)));
    };
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);
  } catch (error) {
    await close().catch((cleanupError) =>
      console.error("Microphone cleanup failed", cleanupError),
    );
    throw error;
  }
  return {
    cancel: async () => {
      finalized = true;
      try { await close(); } finally { chunks.length = 0; }
    },
    finish: async () => {
      if (finalized) throw new Error("Recording is already closed.");
      finalized = true;
      const rate = context!.sampleRate;
      await close();
      const length = chunks.reduce((n, c) => n + c.length, 0);
      if (length < rate / 4)
        throw new Error("Recording too short. Please speak and try again.");
      const buffer = new ArrayBuffer(44 + length * 2);
      const view = new DataView(buffer);
      const str = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++)
          view.setUint8(offset + i, value.charCodeAt(i));
      };
      str(0, "RIFF");
      view.setUint32(4, 36 + length * 2, true);
      str(8, "WAVE");
      str(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      str(36, "data");
      view.setUint32(40, length * 2, true);
      let offset = 44;
      for (const chunk of chunks)
        for (const value of chunk) {
          view.setInt16(offset, Math.max(-1, Math.min(1, value)) * 32767, true);
          offset += 2;
        }
      chunks.length = 0;
      return new Blob([buffer], { type: "audio/wav" });
    },
  };
}
