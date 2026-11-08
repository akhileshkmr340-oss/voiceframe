// A stage is complete only after its validator explicitly returns no problems.
// Every invocation checks current artifacts again; saved status is never proof.
export async function runVerifiedStage({ id, run, verify, signal, onState = async () => {}, maxAttempts = 2, alwaysRun = false }) {
  const abort = () => { if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError'); };
  const check = async () => {
    abort();
    const result = await verify();
    if (!Array.isArray(result)) throw new Error(`${id}: validator did not return evidence.`);
    return result;
  };
  let problems = alwaysRun ? ['Stage needs to run'] : await check();
  const limit = Math.max(1, Math.min(2, maxAttempts));
  for (let attempt = 1; problems.length && attempt <= limit; attempt++) {
    abort();
    await onState({ id, state: 'running', attempt, problems });
    try {
      await run({ attempt, problems });
      problems = await check();
    } catch (error) {
      // Reconnecting to an existing GPU run must not create a duplicate paid job.
      const terminal = signal?.aborted || error.name === 'AbortError' || error.unsafe || error.safetyDown || error.resumable
        || [400, 401, 403, 422, 429].includes(error.status) || /quota|credits?|payment|sign.in|multiple speakers/i.test(error.message);
      problems = [error.message || 'Stage failed'];
      if (terminal || attempt === limit) {
        await onState({ id, state: signal?.aborted ? 'cancelled' : 'blocked', attempt, problems });
        throw error;
      }
    }
  }
  abort();
  if (problems.length) {
    await onState({ id, state: 'blocked', attempt: limit, problems });
    throw new Error(`${id} is incomplete: ${problems.join(' · ')}. Later stages are blocked. Completed work is saved.`);
  }
  await onState({ id, state: 'passed', problems: [], checkedAt: Date.now() });
}

export function storyProblems(project) {
  const scenes = project?.scenes || [], cast = new Set((project?.characters || []).map(c => c.id));
  if (!scenes.length) return ['No story shots'];
  return scenes.flatMap((scene, i) => {
    const issues = [];
    if (!scene.card && !scene.map && !String(scene.visual || '').trim()) issues.push(`Shot ${i + 1}: missing visual direction`);
    if ((scene.characters || []).some(id => !cast.has(id)) || (scene.dialogue || []).some(d => d.line && !cast.has(d.character))) issues.push(`Shot ${i + 1}: unknown character`);
    return issues;
  });
}

export function audioProblems(scenes, audio, { dialogueMode = 'voiced', sourceAudio = false } = {}) {
  if (!Array.isArray(audio) || audio.length !== scenes.length) return ['Audio is missing for one or more shots'];
  return scenes.flatMap((scene, i) => {
    const expected = (scene.narration?.trim() ? 1 : 0) + (dialogueMode === 'off' ? 0 : (scene.dialogue || []).filter(d => d.line?.trim()).length);
    const segments = audio[i];
    if (!Array.isArray(segments)) return [`Shot ${i + 1}: no audio result`];
    const valid = segments.filter(s => s?.buffer?.length > 0 && Number.isFinite(s.buffer.duration) && s.buffer.duration > 0);
    const count = scene.clipSound || sourceAudio ? Math.min(1, expected) : expected;
    return valid.length < count || valid.length !== segments.length ? [`Shot ${i + 1}: missing or unreadable speech`] : [];
  });
}
