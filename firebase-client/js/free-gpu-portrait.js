// Uses the existing authenticated Kaggle relay. No paid Runpod request, provider
// key, or account credential is sent from the browser.
export async function freeGpuPortrait({ api, relayFetch, prompt, seed, signal, onProgress = () => {},
  fetchImage = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, maxWaitMs = 20 * 60e3, jobId }) {
  const abort = () => { if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError'); };
  const job = jobId || `portrait-${now().toString(36)}-${crypto.randomUUID().replaceAll('-', '')}`;
  const call = async (action, body, query = '') => {
    const response = await relayFetch(`${api}/motion?action=${action}${query}`, {
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || `Free GPU ${response.status}`), {
      status: response.status, retryable: response.status >= 500 || response.status === 409,
      daily: !!data.daily || /used today|today.*free GPU jobs/i.test(data.error || '')
    });
    return data;
  };
  const file = (name, value) => ({ name, b64: btoa(unescape(encodeURIComponent(JSON.stringify(value)))) });
  let started = false;
  try {
    abort();
    const available = await call('gpu');
    if (!available.free) throw Object.assign(new Error('The free Kaggle GPU is currently busy.'), { status: 409, retryable: true });
    onProgress('Starting one free Kaggle GPU worker for a portrait test…');
    await call('start', { job, mode: 'turbo', parts: 1, first: true });
    started = true;
    await call('upload', { job, first: true, files: [
      file('paint.json', { format: '9:16', portraits: [{ id: 'portrait', seed, prompt, prompt2: prompt }], shots: [] }),
      // An empty motion plan lets the legacy worker finish without rendering video.
      file('motion.json', { format: '9:16', scenes: [], options: {} })
    ] });
    const began = now();let failures = 0;
    while (now() - began < maxWaitMs) {
      abort();
      onProgress(`Free Kaggle portrait test: waiting for the worker (${Math.floor((now() - began) / 60000)} min). No paid GPU is used.`);
      await sleep(15000);abort();
      let state;
      try { state = await call('status', null, `&job=${job}`);failures = 0; }
      catch (error) { if (error.daily || error.status === 401 || error.status === 403 || ++failures >= 3) throw error;continue; }
      if (state.unsafeChars?.includes('portrait')) throw Object.assign(new Error('The free GPU blocked this portrait.'), { unsafe: true });
      if (state.chars?.includes('portrait')) {
        const { url } = await call('clip', null, `&job=${job}&c=portrait`);
        const response = await fetchImage(url, { signal, credentials: 'omit' });
        if (!response.ok) throw new Error('The generated portrait could not be downloaded.');
        const image = await response.blob();
        if (!image.size || !image.type.startsWith('image/')) throw new Error('The free GPU returned no readable portrait.');
        return image;
      }
      if (/^(error|cancel|partial|complete)/.test(state.state)) throw new Error(state.failure || 'The free GPU stopped before producing a portrait.');
    }
    throw new Error('The free GPU portrait test timed out. No portrait was generated.');
  } finally {
    if (started) {
      // Do not reuse an already-aborted signal for the stop request.
      await relayFetch(`${api}/motion?action=cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job }), signal: AbortSignal.timeout(15000) }).catch(() => {});
    }
  }
}
