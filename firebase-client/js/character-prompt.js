// Keep the complete input in the character record. Summaries are model requests only.
export function promptChunks(text, size = 6000) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Invalid prompt chunk size');
  const parts = []; let rest = String(text);
  while (rest.length > size) {
    let end = rest.lastIndexOf(' ', size);
    if (end < size / 2) end = size;
    parts.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  if (rest) parts.push(rest);
  return parts;
}
export async function compactPrompt(text, { maxChars = 6000, summarize, signal, onProgress } = {}) {
  let value = String(text);
  for (let pass = 0; value.length > maxChars && pass < 4; pass++) {
    const parts = promptChunks(value, Math.max(6000, maxChars));
    const result = [];
    for (let i = 0; i < parts.length; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      onProgress?.(i + 1, parts.length);
      const summary = String(await summarize(parts[i], Math.min(1400, Math.floor(maxChars * .7)))).trim();
      if (!summary) throw new Error('The prompt writer returned no brief. Your full prompt is unchanged; retry later.');
      result.push(summary);
    }
    const next = result.join('\n');
    if (next.length >= value.length) throw new Error('The prompt writer could not shorten this request. Your full prompt is unchanged; retry later.');
    value = next;
  }
  if (value.length > maxChars) throw new Error('The prompt writer could not prepare a short enough brief. Your full prompt is unchanged.');
  return value;
}
