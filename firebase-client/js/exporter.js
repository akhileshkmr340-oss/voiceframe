// MP4 export. Fast path: WebCodecs (H.264 + AAC/Opus) muxed with mp4-muxer,
// rendered faster than real time. Fallback: MediaRecorder in real time.
import { Cancelled } from './ai.js?v=63';

const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm';
// Background tabs throttle setTimeout to 1/s; a MessageChannel hop is not throttled,
// so rendering keeps full speed if the user switches tabs.
const yieldNow = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

export async function exportFilm({ renderer, audio, W, H, fps = 30, onProgress, signal }) {
  if ('VideoEncoder' in window && 'AudioEncoder' in window) {
    try { return await webcodecs({ renderer, audio, W, H, fps, onProgress, signal }); }
    catch (e) { if (e instanceof Cancelled) throw e; console.warn('WebCodecs export failed, using real-time recorder', e); }
  }
  return realtime({ renderer, audio, W, H, fps, onProgress, signal });
}

// YouTube's recommended upload rates (8-12 Mb/s at 1080p): grain, particles and
// camera moves need the headroom to stay sharp. Films over 5 minutes use the lower
// end so a 10-minute MP4 stays about 600 MB.
// Where the encoder supports it, every frame is encoded at a fixed quality
// (quantizer 18, near-transparent; 20 for films over 5 minutes) instead of a bitrate:
// hardware encoders were undershooting the bitrate target by more than half.
async function pickVideo(W, H, fps, seconds = 0) {
  const qp = seconds > 300 ? 20 : 18;
  for (const codec of ['avc1.640033', 'avc1.640028']) {
    const cfg = { codec, width: W, height: H, framerate: fps, bitrateMode: 'quantizer', latencyMode: 'quality', avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { ...cfg, qp }; } catch { /* try bitrate mode */ }
  }
  const full = W * H >= 1920 * 1080 * 0.9;
  const bitrate = seconds > 300 ? (full ? 8_000_000 : 5_000_000) : (full ? 12_000_000 : 7_500_000);
  for (const codec of ['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.42003e', 'avc1.42001f']) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* try next */ }
  }
  throw new Error('H.264 encoding not supported in this browser');
}
async function pickAudio(sampleRate) {
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* try next */ }
  }
  throw new Error('No audio encoder available');
}

async function webcodecs({ renderer, audio, W, H, fps, onProgress, signal }) {
  const { Muxer, ArrayBufferTarget, StreamTarget } = await import(MUXER);
  const vcfg = await pickVideo(W, H, fps, audio.duration);
  const acfg = await pickAudio(audio.sampleRate);
  // A film over 6 minutes is over a gigabyte: one block of memory that size can fail.
  // It is written as a fragmented MP4 instead, in order, piece by piece, into a file
  // the browser can keep on disk (YouTube and players read it the same).
  const long = audio.duration > 360;
  const parts = [];
  let written = 0;
  const target = long ? new StreamTarget({
    onData: (data, position) => {
      if (position !== written) throw new Error('MP4 pieces arrived out of order');
      parts.push(new Blob([data])); written += data.byteLength;
    }
  }) : new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    audio: { codec: acfg.mux, numberOfChannels: 2, sampleRate: audio.sampleRate },
    fastStart: long ? 'fragmented' : 'in-memory',
    ...(long ? { minFragmentDuration: 2 } : {}),
    firstTimestampBehavior: 'offset'
  });
  let failure = null;
  // Some hardware encoders tag full-range output with the sRGB curve, which players
  // read inconsistently; label it as standard HD video (BT.709), keeping its range.
  const tag = m => {
    const cs = m?.decoderConfig?.colorSpace;
    if (cs) m.decoderConfig.colorSpace = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: !!cs.fullRange };
    return m;
  };
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, tag(m)), error: e => { failure = e; } });
  const { qp, ...encCfg } = vcfg;
  venc.configure(encCfg);
  const frameOpts = qp ? { avc: { quantizer: qp } } : {};
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { failure = e; } });
  aenc.configure(acfg.cfg);

  // audio first: it is quick
  const L = audio.getChannelData(0), R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
  const block = 4800;
  for (let i = 0; i < L.length; i += block) {
    const n = Math.min(block, L.length - i);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / audio.sampleRate * 1e6), data });
    aenc.encode(ad); ad.close();
  }
  await aenc.flush();

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });
  const frames = Math.ceil(audio.duration * fps);
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    if (signal?.aborted) { venc.close(); aenc.close(); throw new Cancelled(); }
    if (failure) throw failure;
    await renderer.prepare?.(f / fps);
    renderer.draw(ctx, f / fps);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: f % (fps * 2) === 0, ...frameOpts });
    frame.close();
    while (venc.encodeQueueSize > 6 && !failure) {
      await new Promise(r => { venc.addEventListener('dequeue', r, { once: true }); setTimeout(r, 1000); });
    }
    if (f % 15 === 0) {
      const done = (f + 1) / frames, el = (performance.now() - t0) / 1000;
      onProgress?.(done, el / done - el);
      await yieldNow();
    }
  }
  await venc.flush();
  if (failure) throw failure;
  muxer.finalize();
  venc.close(); aenc.close();
  return new Blob(long ? parts : [target.buffer], { type: 'video/mp4' });
}

async function realtime({ renderer, audio, W, H, fps, onProgress, signal }) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  renderer.draw(ctx, 0);
  const ac = new AudioContext({ sampleRate: audio.sampleRate });
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = audio; src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const parts = [];
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start(1000);
  await ac.resume();
  const start = ac.currentTime + 0.05;
  src.start(start);
  await new Promise((resolve, reject) => {
    const tick = setInterval(() => {
      if (signal?.aborted) { clearInterval(tick); reject(new Cancelled()); return; }
      const t = ac.currentTime - start;
      if (t >= audio.duration) { clearInterval(tick); resolve(); return; }
      renderer.prepare?.(Math.max(0, t)); // best effort: real-time recording can't wait for seeks
      renderer.draw(ctx, Math.max(0, t));
      onProgress?.(t / audio.duration, audio.duration - t);
    }, 1000 / fps);
  }).finally(() => { try { rec.stop(); } catch { /* stopped */ } ac.close(); });
  await stopped;
  return new Blob(parts, { type: (mime || 'video/webm').split(';')[0] });
}
