const PROVIDERS = ['nvidia', 'cloudflare-refs', 'cloudflare', 'pollinations', 'kaggle'];
export const providerName = id => ({ nvidia: 'NVIDIA FLUX', 'cloudflare-refs': 'Cloudflare FLUX.2', cloudflare: 'Cloudflare FLUX.1', pollinations: 'Pollinations', kaggle: 'Free Kaggle GPU' }[id] || id);
const cancelled = signal => {
  if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
};
const terminal = error => error.unsafe || error.safetyDown || error.signIn || error.daily
  || [400, 401, 403, 422].includes(error.status) || error.name === 'AbortError';

// One queue per provider prevents a four-character cast from sending four
// simultaneous requests to the same free endpoint. A failure only cools down
// that provider, not the whole designer.
export class ImageProviderPool {
  constructor({ now = Date.now } = {}) { this.now = now; this.cooldowns = new Map(); this.queues = new Map(); }
  allCoolingDown() { return PROVIDERS.every(id => (this.cooldowns.get(id) || 0) > this.now()); }
  async run({ painter = '', refs = [], lock = false, signal, request, onProgress = () => {} }) {
    const preserveIdentity = !!refs.length && (lock || !painter || painter === 'cloudflare-refs');
    const order = preserveIdentity ? ['cloudflare-refs'] : [...new Set([painter, ...PROVIDERS].filter(Boolean))];
    if (order.some(id => !PROVIDERS.includes(id))) throw Object.assign(new Error('Unknown image provider'), { status: 400 });
    const failures = [];
    for (const [index, provider] of order.entries()) {
      cancelled(signal);
      if ((this.cooldowns.get(provider) || 0) > this.now()) {
        failures.push(providerName(provider) + ': cooling down');
        onProgress(`${providerName(provider)} is cooling down; checking another provider.`);
        continue;
      }
      const previous = this.queues.get(provider) || Promise.resolve();
      const task = previous.catch(() => {}).then(async () => {
        cancelled(signal);
        if ((this.cooldowns.get(provider) || 0) > this.now()) throw Object.assign(new Error('Provider cooling down'), { cooldown: true, retryable: true });
        onProgress(`Trying ${providerName(provider)} (${index + 1}/${order.length})…`);
        return request(provider);
      });
      this.queues.set(provider, task);
      let abort;
      try {
        const stopped = signal && new Promise((_, reject) => {
          abort = () => reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
        });
        return await (stopped ? Promise.race([task, stopped]) : task);
      } catch (error) {
        cancelled(signal);
        if (terminal(error) || !error.retryable) throw error;
        if (!error.cooldown) {
          const duration = error.status === 429 ? 30 * 60e3 : 2 * 60e3;
          this.cooldowns.set(provider, this.now() + Math.max(duration, Math.min(error.retryAfterMs || 0, 60 * 60e3)));
        }
        failures.push(`${providerName(provider)}: ${error.status === 429 ? 'quota or rate limit' : 'unavailable'}`);
        onProgress(`${providerName(provider)} failed; switching to the next compatible provider…`);
      } finally {
        if (abort) signal.removeEventListener('abort', abort);
        // Keep queued work registered until it settles, including after cancellation.
        task.finally(() => { if (this.queues.get(provider) === task) this.queues.delete(provider); }).catch(() => {});
      }
    }
    const detail = preserveIdentity ? 'No compatible reference-image provider is available; the character reference was preserved.' : 'All configured image providers are unavailable or cooling down.';
    throw Object.assign(new Error(`${detail} Your prompt and completed characters are kept. ${failures.join(' · ')}`), { providersUnavailable: true, castOut: preserveIdentity });
  }
}
export const imageProviders = new ImageProviderPool();
