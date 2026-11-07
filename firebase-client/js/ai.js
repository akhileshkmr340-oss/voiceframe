// The AI services, all through the site's relay (open models only): writers, painters,
// voices, transcription and the free GPU jobs; plus Openverse public-domain photos as
// the last-resort picture.
import { idToken } from './auth.js?v=52';
import { checkImage, Unsafe, SafetyDown } from './safety.js?v=57';
export { Unsafe, SafetyDown };

export const API = (window.VF_CONFIG?.apiBase || 'api').replace(/\/$/, '');
const FREE_TEXT = API + '/text';
const FREE_IMG = API + '/image';
const RELAY_DOWN = 'The free AI service is not reachable right now. Try again in a few minutes.';
export const SIGN_IN_NEEDED = 'Please sign in again to use the free AI services.';

// Every call to the relay's AI services carries the signed-in person's Firebase ID token
// (the relay checks it, and counts each person's use against fair limits). Device-only
// accounts (local testing) have no token and send none.
export async function relayFetch(url, init = {}) {
  const token = await Promise.resolve(idToken()).catch(() => null);
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, { ...init, headers });
}
// The relay's own refusals that are never retried: sign-in needed (401), today's fair-use
// limit reached (429 with daily). Returns the error to throw, or null.
async function relayRefusal(r) {
  if (r.status !== 401 && r.status !== 429) return null;
  const j = await r.clone().json().catch(() => ({}));
  if (r.status === 401) return Object.assign(new Error(j.error || SIGN_IN_NEEDED), { signIn: true });
  if (j.daily) return Object.assign(new Error(j.error || 'You have reached today\'s free limit. It resets at midnight (UTC).'), { daily: true });
  return null;
}

let relayMotion = false;
// A network blip while the page loads must not switch features off for the whole visit.
export const relayStatus = (async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const j = await fetch(API + '/status').then(r => r.json());
      relayMotion = !!j.motion;
      return;
    } catch { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
  }
})();
// The relay can run AI motion clips on the owner's free Kaggle GPU. Asked again when
// an automatic film starts, so a tab opened before motion was set up still gets it.
export const relayHasMotion = () => relayMotion;
export async function refreshRelayMotion() {
  try { relayMotion = !!(await fetch(API + '/status').then(r => r.json())).motion; } catch { /* keep what we knew */ }
  return relayMotion;
}
// Whether Cloudflare (the painter that draws the cast from their portraits) has allowance left today.
export async function relayCanPaintCast() {
  try { return !!(await fetch(API + '/status').then(r => r.json())).cloudflare; } catch { return true; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const gate = { text: 0, image: 0 };
// The next request goes out at once; on the free tier the relay answers "wait N s"
// (402) and the request is retried then, so a keyed relay is never slowed down.
const gap = () => 0;

export class Cancelled extends Error { constructor() { super('Cancelled'); } }
// The relay's safety filter refused the request (422): it is never retried (Unsafe lives in
// safety.js, which also throws it for pictures the checker on this device blocks).
async function unsafeOf(r) {
  if (r.status !== 422) return null;
  const j = await r.clone().json().catch(() => ({}));
  return j.unsafe ? new Unsafe(j.error) : null;
}

async function waitGate(kind, onWait, signal) {
  while (Date.now() < gate[kind]) {
    if (signal?.aborted) throw new Cancelled();
    onWait?.(Math.ceil((gate[kind] - Date.now()) / 1000));
    await sleep(500);
  }
}

function retryAfter(msg) {
  const m = /(?:after|wait)\s+(\d+)/i.exec(msg || '');
  return m ? +m[1] + 1 : 46;
}

// ---------------- text ----------------
export async function chat(messages, { onWait, signal, temperature = 0.9, maxTokens = 0 } = {}) {
  // Always through the relay: open-weight writers only (Gemma 4, Llama, GPT-OSS).
  let unreachable = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    await waitGate('text', onWait, signal);
    onWait?.(0);
    let r;
    // The relay tries two Cloudflare models before the free writer, all within
    // Vercel's 120 s; give up on a request after 115 s and ask again.
    const timeout = AbortSignal.timeout(115000);
    try {
      r = await relayFetch(FREE_TEXT, {
        method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'Content-Type': 'application/json' },
        // a shorter answer (maxTokens) leaves the free writers more room for the next request
        body: JSON.stringify(maxTokens ? { messages, max_tokens: maxTokens } : { messages })
      });
    } catch (e) {
      if (signal?.aborted) throw new Cancelled();
      if (timeout.aborted) { gate.text = Date.now() + 2000; continue; }
      if (++unreachable >= 2) throw new Error(RELAY_DOWN);
      gate.text = Date.now() + 5000; continue;
    }
    if (r.ok) {
      gate.text = Date.now() + gap('text');
      const j = await r.json();
      const content = j.choices?.[0]?.message?.content || '';
      // a credit / limit notice instead of an answer: wait a little and ask again
      if (!content.includes('{') && /credit|top.?up|limit|quota/i.test(content)) { gate.text = Date.now() + 15000; continue; }
      return content;
    }
    if (r.status === 404 || r.status === 405 || r.status === 403) throw new Error(RELAY_DOWN);
    const blocked = await unsafeOf(r) || await relayRefusal(r);
    if (blocked) throw blocked;
    const body = await r.text();
    gate.text = Date.now() + (r.status === 402 || r.status === 429 ? retryAfter(body) * 1000 : 8000);
  }
  throw new Error('The free story writer is busy right now. Wait a minute and try again.');
}

export function parseJSON(text) {
  let s = String(text).replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{');
  if (a < 0) throw new Error('No JSON in reply');
  s = s.slice(a).replace(/,\s*([}\]])/g, '$1');
  // Small models often forget to close an array before the next key, or stop
  // early. Patch the spot JSON.parse complains about and try again.
  let err;
  for (let i = 0; i < 12; i++) {
    try { return JSON.parse(s); } catch (e) {
      err = e;
      const m = /position (\d+)/.exec(e.message) || /line 1 column (\d+)/.exec(e.message);
      const pos = m ? (/column/.test(m[0]) ? +m[1] - 1 : +m[1]) : s.length;
      if (pos >= s.trimEnd().length || /end of (JSON|data)/i.test(e.message)) { s = closeOpen(s); continue; }
      // a complete answer followed by chatter or a second copy: keep the first one
      if (/after JSON|unexpected non-whitespace/i.test(e.message)) { s = s.slice(0, pos); continue; }
      if (/array element/i.test(e.message)) {
        const k = s[pos] === ':' ? s.lastIndexOf(',', pos) : pos;
        if (k < 0) break;
        s = s.slice(0, k) + ']' + s.slice(k); continue;
      }
      if (/property value/i.test(e.message)) { s = s.slice(0, pos) + '}' + s.slice(pos); continue; }
      if (s[pos] !== undefined && s.lastIndexOf('}') > pos) { s = s.slice(0, s.lastIndexOf('}') + 1); continue; }
      break;
    }
  }
  throw err;
}

function closeOpen(s) {
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s + (inStr ? '"' : '');
  out = out.replace(/[,:]\s*$/, '');
  return out + stack.reverse().map(c => c === '{' ? '}' : ']').join('');
}

// ---------------- images ----------------
// Returns a Blob. The relay tries its painters in turn (Cloudflare FLUX.2 with the
// cast's portraits, NVIDIA's free FLUX.1 schnell, Cloudflare FLUX.1, Pollinations) and
// answers within about a minute; when every painter is busy it says so and the picture
// is asked for again a little later, so a long film never stalls on one picture.
// refs: up to four base64 JPEG portraits (under 512 px) that keep faces and clothes the same.
// After a run of "all painters busy" answers the painters are taken as out for ten
// minutes: pictures fail at once (the film uses a public-domain photo, or the GPU paints).
let busyRun = 0, paintersOutUntil = 0;
export const paintersOut = () => Date.now() < paintersOutUntil;
// lock: a shot with the cast waits for the painter that sees their portraits instead of
// going to painters that would invent new faces; throws an error with castOut when that
// painter is out for the day (the caller decides what to do).
// painter: one named free painter only ('cloudflare-refs' sees the references; 'nvidia',
// 'cloudflare', 'pollinations' paint from the words alone), as the character editor's picker asks.
export async function paintImage(prompt, { width, height, seed, onWait, signal, refs, lock = false, painter = '' }) {
  lock = lock && !!refs?.length && !painter;
  if (paintersOut() && !lock) throw new Error('Every free picture service is out for now');
  const body = JSON.stringify({ prompt: prompt.slice(0, 1800), width, height, seed, ...(refs?.length ? { refs } : {}), ...(lock ? { lock: true } : {}), ...(painter ? { painter } : {}) });
  let last = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitGate('image', onWait, signal);
    let r;
    const timeout = AbortSignal.timeout(110000);
    try {
      r = await relayFetch(FREE_IMG, { method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { 'Content-Type': 'application/json' }, body });
    } catch (e) {
      if (signal?.aborted) throw new Cancelled();
      last = 'unreachable'; gate.image = Math.max(gate.image, Date.now() + 5000); continue;
    }
    if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) {
      busyRun = 0;
      const blob = await r.blob();
      // fail closed: a picture the checker on this device blocks (Unsafe, with .picture) or
      // can't check (SafetyDown) is never handed to the film
      await checkImage(blob);
      return blob;
    }
    const blocked = await unsafeOf(r) || await relayRefusal(r);
    if (blocked) throw blocked;
    if (lock && r.status === 503) {
      const j = await r.clone().json().catch(() => ({}));
      if (j.castOut) throw Object.assign(new Error('The cast painter is out for today'), { castOut: true });
    }
    // one named painter that is out or busy says so after two tries (the others are not counted as out)
    if (r.status === 503 && painter) { if (attempt >= 1) throw Object.assign(new Error(`That painter is busy or out for today. Try “Auto” or another painter.`), { painterOut: true }); }
    else if (r.status === 503 && !lock && ++busyRun >= 8) paintersOutUntil = Date.now() + 600000;
    if (paintersOut()) throw new Error('Every free picture service is out for now');
    last = r.status + ' ' + (await r.text().catch(() => '')).slice(0, 160);
    // every painter busy: all pictures wait together (20, 40, 60 s), not each on its own
    gate.image = Math.max(gate.image, Date.now() + (r.status === 503 || r.status === 429 ? 20000 * (attempt + 1) : 6000));
  }
  throw new Error('Image service is busy (' + last + ')');
}

// ---------------- picture check ----------------
// An open-weight vision model on the relay compares a painted picture with the script
// (and the cast portraits). Returns {ok, unsafe, problems, people, model}, or null when no
// checker answers. unsafe: true means the picture must never be used (nudity, gore…).
export async function checkPicture({ image, refs = [], expect, signal }) {
  try {
    const r = await relayFetch(API + '/look', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      body: JSON.stringify({ image, refs, expect })
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    if (signal?.aborted) throw new Cancelled();
    return null;
  }
}

// ---------------- public-domain stock (Openverse) ----------------
// Only CC0 and Public Domain Mark: no attribution or licence conditions to break.
export async function stockImage(query, aspect, usedIds = new Set(), signal) {
  const ar = aspect === '9:16' ? 'tall' : aspect === '1:1' ? 'square' : 'wide';
  const tries = [query, query.split(/\s+/).slice(0, 2).join(' ')].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of tries) {
    for (const extra of [`&aspect_ratio=${ar}`, '']) {
      const api = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm&mature=false&page_size=12${extra}`;
      let list = [];
      try {
        const r = await fetch(api, { signal });
        if (r.ok) list = (await r.json()).results || [];
      } catch (e) { if (signal?.aborted) throw new Cancelled(); }
      for (const it of list) {
        if (usedIds.has(it.id) || (it.width && it.width < 640)) continue;
        try {
          // Flickr and Wikimedia photos come straight from their hosts; any other host is read
          // through Openverse's own image proxy (the site's CSP allows only known hosts)
          const direct = /^https:\/\/(live\.staticflickr\.com|farm\d+\.staticflickr\.com|upload\.wikimedia\.org)\//.test(it.url || '');
          const src = direct ? it.url : `https://api.openverse.org/v1/images/${encodeURIComponent(it.id)}/thumb/?full_size=true&compressed=false`;
          const r = await fetch(src, { signal, mode: 'cors' });
          if (!r.ok) continue;
          const blob = await r.blob();
          if (!blob.type.startsWith('image/') || blob.size < 20000) continue;
          // fail closed: SafetyDown stops here (no unchecked photo); a blocked one is skipped
          try { await checkImage(blob); } catch (e) { if (e.safetyDown) throw e; continue; }
          usedIds.add(it.id);
          return {
            blob,
            credit: {
              kind: 'stock', id: it.id, title: it.title || 'Untitled', creator: it.creator || 'Unknown',
              license: (it.license || '').toUpperCase() + (it.license_version ? ' ' + it.license_version : ''),
              licenseUrl: it.license_url, source: it.foreign_landing_url || it.url, provider: it.source || it.provider
            }
          };
        } catch (e) { if (signal?.aborted) throw new Cancelled(); if (e.safetyDown) throw e; }
      }
    }
  }
  throw new Error(`No public-domain photo found for “${query}”.`);
}
