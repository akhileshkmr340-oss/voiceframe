// AI video clips for scenes: each scene picture becomes the first frame of a short
// moving clip made by an open video model (LTX-Video, with Wan 2.2 as backup) on
// Hugging Face's free ZeroGPU Spaces, called through their public Gradio queue API.
//
// ZeroGPU allowance is daily GPU processing time, shared across Spaces.
// Cache only reset times explicitly returned by the provider; never invent one.
import { Cancelled } from './ai.js?v=25';

const SPACES = [
  {
    name: 'LTX-Video', root: 'https://lightricks-ltx-video-distilled.hf.space', endpoint: 'image_to_video',
    args: (file, prompt, w, h, sec) => [prompt, 'worst quality, inconsistent motion, blurry, jittery, distorted, text, watermark',
      file, null, h, w, 'image-to-video', sec, 9, Math.floor(Math.random() * 1e9), false, 1, true],
    video: data => data[0]?.video?.url
  },
  {
    // asks for more GPU time than the anonymous allowance holds: only with a Hugging Face token
    name: 'Wan 2.2', needsToken: true, root: 'https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space', endpoint: 'generate_video',
    args: (file, prompt, w, h, sec) => [file, prompt, 6, 'static, blurry, distorted, text, watermark, low quality', Math.min(sec, 5), 1, 1, Math.floor(Math.random() * 1e9), false],
    video: data => (typeof data[0] === 'string' ? data[0] : data[0]?.url || data[0]?.video?.url)
  }
];

export const hfToken = () => localStorage.getItem('vf_hf_token') || '';
class QuotaError extends Error {}
export const isQuotaError = e => e instanceof QuotaError;

// Keep provider cooldowns per credential in this session. Legacy browser-wide
// timestamps guessed a 30-minute wait and incorrectly blocked newly added tokens.
// The provider remains authoritative after reloads and for unknown reset times.
const quotaByCredential = new Map();
const quotaState = () => quotaByCredential.get(hfToken());
const quotaUntil = () => quotaState()?.until || 0;
export const videoQuotaLeft = () => Date.now() >= quotaUntil();
export const quotaRefillText = () => {
  if (quotaState()?.unknown) return 'an unknown amount of time (Hugging Face did not supply a reset time)';
  const ms = quotaUntil() - Date.now();
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60000);
  return minutes >= 60 ? `about ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `about ${minutes} min`;
};
function noteQuota(message) {
  const m = /Try again in (\d+):(\d+):(\d+)/i.exec(message || '');
  const wait = m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 : 0;
  quotaByCredential.set(hfToken(), wait > 0
    ? { until: Date.now() + wait, unknown: false }
    : { until: 0, unknown: true });
}

function auth() {
  const t = hfToken();
  return t ? { Authorization: 'Bearer ' + t } : {};
}

// Clip size by film format: model-friendly multiples of 32, about 0.45 megapixels.
export function clipSize(format) {
  return format === '9:16' ? [512, 896] : format === '1:1' ? [640, 640] : [896, 512];
}

async function fnIndex(space, signal) {
  if (space.fn != null) return space.fn;
  const response = await fetch(space.root + '/config', { headers: auth(), signal });
  if (!response.ok) throw new Error(`${space.name} configuration failed (${response.status})`);
  const cfg = await response.json();
  const index = (cfg.dependencies || []).findIndex(d => d.api_name === space.endpoint);
  if (index < 0) throw new Error(`${space.name} changed its interface`);
  space.fn = cfg.dependencies[index].id ?? index;
  return space.fn;
}

async function runOn(space, blob, prompt, w, h, sec, signal, onStatus) {
  const api = space.root + '/gradio_api';
  const fd = new FormData();
  fd.append('files', blob, 'scene.jpg');
  const up = await fetch(api + '/upload', { method: 'POST', body: fd, headers: auth(), signal });
  if (!up.ok) throw new Error(`${space.name} upload failed (${up.status})`);
  const [path] = await up.json();
  const session = Math.random().toString(36).slice(2);
  const join = await fetch(api + '/queue/join', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({
      data: space.args({ path, meta: { _type: 'gradio.FileData' } }, prompt, w, h, sec),
      fn_index: await fnIndex(space, signal), session_hash: session, event_data: null, trigger_id: null
    })
  });
  if (!join.ok) throw new Error(`${space.name} busy (${join.status})`);
  // Server-sent events until the job completes
  const res = await fetch(`${api}/queue/data?session_hash=${session}`, { headers: auth(), signal });
  if (!res.ok || !res.body) throw new Error(`${space.name} queue connection failed (${res.status})`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let msg;
      try { msg = JSON.parse(line.slice(5)); } catch { continue; }
      if (msg.msg === 'estimation' && msg.rank > 0) onStatus?.(`${space.name}: ${msg.rank} in line ahead of you…`);
      if (msg.msg === 'process_starts') onStatus?.(`${space.name} is animating…`);
      if (msg.msg !== 'process_completed') continue;
      const out = msg.output || {};
      if (msg.success === false || out.error) {
        const text = String(out.error || msg.title || 'unknown error');
        if (/quota/i.test(text) || /quota/i.test(msg.title || '')) throw new QuotaError(text);
        throw new Error(`${space.name}: ${text.slice(0, 160)}`);
      }
      const url = space.video(out.data || []);
      if (!url) throw new Error(`${space.name} returned no video`);
      const videoURL = new URL(url, space.root);
      if (videoURL.protocol !== 'https:') throw new Error(`${space.name} returned an unsupported video URL`);
      const headers = videoURL.origin === new URL(space.root).origin ? auth() : {};
      const v = await fetch(videoURL.href, { headers, signal });
      if (!v.ok) throw new Error(`${space.name} video download failed (${v.status})`);
      const bytes = await v.arrayBuffer();
      if (!bytes.byteLength) throw new Error(`${space.name} returned an empty video`);
      return new Blob([bytes], { type: 'video/mp4' });
    }
  }
  throw new Error(`${space.name} closed the connection`);
}

const wait = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Cancelled()); }, { once: true });
});

// Returns { blob, model } or throws (QuotaError once the free allowance is used up).
export async function animateScene(blob, prompt, { format, seconds = 5, signal, onStatus }) {
  if (!videoQuotaLeft()) throw new QuotaError('Free video allowance used up');
  const [w, h] = clipSize(format);
  let lastErr;
  for (const space of SPACES) {
    if (space.needsToken && !hfToken()) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Cancelled();
      try {
        onStatus?.(`Sending the scene to ${space.name}…`);
        return { blob: await runOn(space, blob, prompt, w, h, seconds, signal, onStatus), model: space.name };
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError' || e instanceof Cancelled) throw new Cancelled();
        if (e instanceof QuotaError) { noteQuota(e.message); throw e; }
        console.warn(e.message);
        lastErr = e;
        if (attempt === 0) { onStatus?.(`${space.name} is busy, retrying…`); await wait(8000, signal); }
      }
    }
  }
  throw lastErr || new Error('No free video service answered');
}
