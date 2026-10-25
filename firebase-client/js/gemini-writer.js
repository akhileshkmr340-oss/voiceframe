// Optional direct story requests. Keys stay in this tab's session storage.
// This never uses Flow credits and never provisions billing or buys quota.
export const usesGemini = () => localStorage.getItem('vf_story_writer') === 'gemini';
export async function geminiStoryChat(messages, {signal, json = true} = {}) {
  const key = sessionStorage.getItem('vf_gemini_key') || '';
  if (!key) throw new Error('Add your free-tier Gemini API key in Settings. Your Google Flow login cannot authorise Gemini API requests.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  signal?.addEventListener('abort', cancel, {once:true});
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90000);
  try {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({role:m.role === 'assistant' ? 'model' : 'user',parts:[{text:m.content}]}));
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent', {
      method:'POST', signal:controller.signal,
      headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{responseMimeType:json ? 'application/json' : 'text/plain',maxOutputTokens:8192,temperature:0.7}})
    });
    if (response.status === 429) throw new Error('Gemini quota reached. No automatic paid fallback was used. Retry after your free quota resets, or choose the shared writer in Settings.');
    if ([400,401,403].includes(response.status)) throw new Error('Gemini rejected the request. Check your API key, API restrictions and free-tier project access in Settings.');
    if (!response.ok) throw new Error(`Gemini is unavailable (${response.status}). No automatic retry or paid fallback was used.`);
    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error('Gemini did not finish a complete story response. Try a shorter story.');
    const reply = candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    if (!reply) throw new Error('Gemini returned no story text. Try rephrasing the idea.');
    return reply;
  } catch (e) {
    if (timedOut) throw new Error('Gemini story request timed out. No automatic retry was made.');
    throw e;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
