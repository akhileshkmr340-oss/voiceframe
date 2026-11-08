import { qualityBlockers } from './clip-quality.js?v=66';
// Full motion requires actual video footage. Hero mode is explicitly a mixed film.
export const requiresFullFootage = project => project?.options?.motion === 'full';
export function missingFootage(project) {
  return (project?.scenes || []).flatMap((scene, i) => {
    // Title cards and maps are rendered graphics, not missing cinematic footage.
    if (scene?.card || scene?.map) return [];
    const clip = project.videos?.['scene-' + i];
    return clip instanceof Blob && clip.size > 0 ? [] : [i];
  });
}
export function assertFullFootage(project) {
  if (!requiresFullFootage(project)) return;
  const missing = missingFootage(project);
  if (!missing.length) {
    const review = qualityBlockers(project);
    if (review.length) throw new Error(`Full-motion export needs quality review for shot(s): ${review.map(i=>i+1).join(', ')}. Wait for checks, retry those shots, or explicitly Keep a reviewed clip. Completed footage is saved.`);
    return;
  }
  const shots = missing.slice(0, 12).map(i => i + 1).join(', ') + (missing.length > 12 ? '…' : '');
  throw new Error(`Full-motion film is incomplete: ${missing.length} shot(s) still need video (${shots}). Completed footage is saved. Retry the unfinished shots or explicitly select Basic motion. No still-image motion was exported as full-motion video.`);
}
export function footageSummary(project) {
  const total = (project?.scenes || []).filter(scene => !scene?.card && !scene?.map).length;
  const ready = total - missingFootage(project).length;
  const mode = project?.options?.motion || 'live';
  return {total,ready,mode,review:qualityBlockers(project).length,blocked:mode === 'full' && (ready < total || qualityBlockers(project).length > 0),label:mode === 'full' ? 'Full AI motion' : mode === 'hero' ? 'Hybrid motion' : 'Basic animation'};
}
