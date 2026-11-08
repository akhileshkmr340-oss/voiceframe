export function waitVideoEvent(video, name, {signal, timeout = 15000} = {}) {
  return new Promise((resolve,reject) => {
    let timer;
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener(name,ok);video.removeEventListener('error',bad);signal?.removeEventListener('abort',abort);};
    const ok=()=>{cleanup();resolve();};
    const bad=()=>{cleanup();reject(new Error('Video could not be decoded'));};
    const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};
    if(signal?.aborted){abort();return;}
    video.addEventListener(name,ok,{once:true});video.addEventListener('error',bad,{once:true});signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{cleanup();reject(new Error('Video frame decoding timed out'));},timeout);
  });
}
export async function seekVideo(video, time, options) {
  if (Math.abs(video.currentTime-time)<.001 && video.readyState>=2) return;
  if (!Number.isFinite(time) || time < 0) throw new Error('Invalid video frame time');
  const ready=waitVideoEvent(video,'seeked',options);video.currentTime=time;await ready;
}
