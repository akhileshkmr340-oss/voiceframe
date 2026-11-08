// Independent checks must never clear one another's findings.
export async function inspectClipQuality({ technical = '', cast, motion, timeout = 120000 }) {
  const bounded = async fn => { let timer; try { return await Promise.race([Promise.resolve().then(fn), new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Quality check timed out')),timeout);})]); } finally {clearTimeout(timer);} };
  const checks = await Promise.allSettled([bounded(cast), bounded(motion)]);
  const problems = technical ? ['Video: ' + technical] : [];
  const [identity, movement] = checks;
  if (identity.status === 'rejected') problems.push('Character consistency check unavailable; review this clip.');
  else if (identity.value && !identity.value.ok) problems.push(...(identity.value.problems?.length ? identity.value.problems.map(x => 'Cast: ' + x) : ['Character consistency check failed.']));
  if (movement.status === 'rejected') problems.push('Movement check unavailable; review this clip.');
  else if (movement.value) problems.push('Motion: ' + movement.value);
  return { state: problems.length ? 'review' : 'passed', problems, approved: false };
}
export function qualityBlockers(project) {
  return (project?.scenes || []).flatMap((scene, i) => {
    const key = 'scene-' + i;
    if (scene?.card || scene?.map || !project.videos?.[key]) return [];
    const q = project.clipQuality?.[key];
    if (q?.state === 'pending') return [i];
    if (q?.approved) return [];
    return q?.state === 'review' || project.clipIssues?.[key] ? [i] : [];
  });
}
export function retryShots(project, missing) {
  return [...new Set([...missing, ...qualityBlockers(project)])]
    .filter(i => project.clipQuality?.['scene-' + i]?.state !== 'pending').sort((a,b)=>a-b);
}
export function requireSingleSpeaker(segments, shot) {
  const speakers = new Set(segments.filter(s => s.buffer && s.speaker).map(s => s.speaker));
  if (speakers.size > 1) throw new Error(`Shot ${shot + 1} has multiple speakers. Split their lines into separate shots before lip-sync; the current worker supports one speaker per clip.`);
}

export function motionReference(project, i) {
  const key = 'scene-' + i;
  return project.credits?.[key]?.kind === 'clip' ? (project.images?.['motion-source-' + i] || project.images?.['prev-' + i] || project.images?.[key]) : project.images?.[key];
}
