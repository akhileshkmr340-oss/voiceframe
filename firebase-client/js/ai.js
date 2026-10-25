// Free AI services: Pollinations (text + images) and Openverse (public-domain photos).
// Pollinations rejects keyless calls made straight from a browser, so the free
// tier goes through the site's own proxy (api/*.php). It allows ~1 text reply / 30 s
// and 1 image / 45 s, so requests go through a paced queue that retries on FREE_LIMIT.
export const API = (window.VF_CONFIG?.apiBase || 'api').replace(/\/$/, '');
const FREE_TEXT = API + '/text';
const FREE_IMG = API + '/image';
const GEN = 'https://gen.pollinations.ai';
const RELAY_DOWN = 'The free AI service is not reachable right now. Try again in a few minutes, or add a Pollinations key in Settings.';

export const getKey = () => localStorage.getItem('vf_pollen_key') || '';

// When the relay holds a Pollinations key there is no free-tier pacing: requests
// go out at once and images paint in parallel.
let relayKeyed = false;
export const relayStatus = fetch(API + '/status').then(r => r.json()).then(j => { relayKeyed = !!j.keyed; }).catch(() => {});
export const hasKey = () => !!getKey() || relayKeyed;
export const relayHasKey = () => relayKeyed;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const gate = { text: 0, image: 0 };
// The next request goes out at once; on the free tier the relay answers "wait N s"
// (402) and the request is retried then, so a keyed relay is never slowed down.
const gap = () => 0;
let lastImageOk = 0;
let imageChain = Promise.resolve();

export class Cancelled extends Error { constructor() { super('Cancelled'); } }

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
export async function chat(messages, { onWait, signal, temperature = 0.9 } = {}) {
  const key = getKey();
  if (key) {
    try {
      const r = await fetch(GEN + '/v1/chat/completions', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'openai/gpt-5.4-nano', messages, temperature })
      });
      if (r.ok) return (await r.json()).choices[0].message.content;
      console.warn('Keyed text failed', r.status, await r.text());
    } catch (e) { if (signal?.aborted) throw new Cancelled(); console.warn(e); }
  }
  let unreachable = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    await waitGate('text', onWait, signal);
    onWait?.(0);
    let r;
    // The free writer occasionally stalls; give up on a request after 65 s and ask again.
    const timeout = AbortSignal.timeout(65000);
    try {
      r = await fetch(FREE_TEXT, {
        method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
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
// Returns a Blob. Calls are serialised in keyless mode so the pace stays legal.
export function paintImage(prompt, { width, height, seed, onWait, signal }) {
  const key = getKey();
  if (key) return fetchKeyedImage(prompt, width, height, seed, key, signal)
    .catch(e => { if (e instanceof Cancelled) throw e; console.warn('Keyed image failed, using free tier', e); return queued(); });
  return queued();

  function queued() {
    if (relayKeyed) return fetchFreeImage(prompt, width, height, seed, onWait, signal); // relay has a key: no queue
    const run = imageChain.then(() => fetchFreeImage(prompt, width, height, seed, onWait, signal));
    imageChain = run.catch(() => {});
    return run;
  }
}

async function fetchKeyedImage(prompt, w, h, seed, key, signal) {
  const url = `${GEN}/image/${encodeURIComponent(prompt.slice(0, 1800))}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
  let r;
  try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + key }, signal }); }
  catch (e) { if (signal?.aborted) throw new Cancelled(); throw e; }
  if (!r.ok) throw new Error('Image ' + r.status);
  return r.blob();
}

async function fetchFreeImage(prompt, w, h, seed, onWait, signal) {
  const url = `${FREE_IMG}?prompt=${encodeURIComponent(prompt.slice(0, 1500))}&width=${w}&height=${h}&seed=${seed}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    await waitGate('image', onWait, signal);
    let r;
    try { r = await fetch(url, { signal }); }
    catch (e) {
      if (signal?.aborted) throw new Cancelled();
      gate.image = Date.now() + 6000; continue;
    }
    if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) {
      // Two images inside the free tier's 45 s window means the relay has a key.
      if (Date.now() - lastImageOk < 40000) relayKeyed = true;
      lastImageOk = Date.now();
      gate.image = Date.now() + gap('image');
      return r.blob();
    }
    const body = await r.text().catch(() => '');
    gate.image = Date.now() + (r.status === 402 || r.status === 429 ? retryAfter(body) * 1000 : 10000);
  }
  throw new Error('Image service is busy. Try again in a minute.');
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
          const r = await fetch(it.url, { signal, mode: 'cors' });
          if (!r.ok) continue;
          const blob = await r.blob();
          if (!blob.type.startsWith('image/') || blob.size < 20000) continue;
          usedIds.add(it.id);
          return {
            blob,
            credit: {
              kind: 'stock', id: it.id, title: it.title || 'Untitled', creator: it.creator || 'Unknown',
              license: (it.license || '').toUpperCase() + (it.license_version ? ' ' + it.license_version : ''),
              licenseUrl: it.license_url, source: it.foreign_landing_url || it.url, provider: it.source || it.provider
            }
          };
        } catch (e) { if (signal?.aborted) throw new Cancelled(); }
      }
    }
  }
  throw new Error(`No public-domain photo found for “${query}”.`);
}
