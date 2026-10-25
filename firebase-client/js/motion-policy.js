// AI-video mode must never export an image-animation substitute.
export function requiresGeneratedVideo(project) {
  return project.options?.motion !== '3d';
}

export function missingVideoScenes(project) {
  if (!requiresGeneratedVideo(project)) return [];
  return (project.scenes || []).flatMap((_, i) => {
    const clip = project.videos?.['scene-' + i];
    return clip instanceof Blob && clip.size > 0 ? [] : [i];
  });
}

export function assertGeneratedVideo(project) {
  const missing = missingVideoScenes(project);
  if (missing.length) {
    const numbers = missing.map(i => i + 1).join(', ');
    throw new Error(`AI video is incomplete: scene ${numbers} still needs a generated clip. Completed clips are saved. Import videos in Scenes or use Flow assembly. Rendering uses your browser without generation credits. No photo-animation substitute was exported.`);
  }
}

// Play a clip forwards once across the scene. Never reverse a gesture or make a
// speaker's mouth run backwards to fill narration longer than the source clip.
export function forwardClipTime(localTime, sceneLength, clipLength) {
  if (!(sceneLength > 0) || !(clipLength > 0)) return 0;
  const progress = Math.min(1, Math.max(0, localTime / sceneLength));
  return progress * Math.max(0, clipLength - 1 / 1000);
}
