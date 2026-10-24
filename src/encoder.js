import {Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, canEncodeVideo, canEncodeAudio, Quality} from 'mediabunny';
export async function renderOffline({canvas, seconds, format, bitrate, audioBuffer, draw, onProgress, aborted}) {
 const vcodec=format==='mp4'?'avc':'vp9',acodec=format==='mp4'?'aac':'opus';
 if(!await canEncodeVideo(vcodec,{width:canvas.width,height:canvas.height,frameRate:30,quality:new Quality({bitrate})}))return null;
 if(audioBuffer&&!await canEncodeAudio(acodec,{numberOfChannels:audioBuffer.numberOfChannels,sampleRate:audioBuffer.sampleRate}))return null;
 const output=new Output({format:format==='mp4'?new Mp4OutputFormat({fastStart:'in-memory'}):new WebMOutputFormat(),target:new BufferTarget()});
 const video=new CanvasSource(canvas,{codec:vcodec,quality:new Quality({bitrate}),keyFrameInterval:2});
 output.addVideoTrack(video,{frameRate:30});
 let audio;
 if(audioBuffer){audio=new AudioBufferSource({codec:acodec,quality:new Quality({bitrate:192000})});output.addAudioTrack(audio);}
 try {
  await output.start();
  if(audio){await audio.add(audioBuffer);audio.close();}
  const frames=Math.round(seconds*30);
  for(let f=0;f<frames;f++){
   if(aborted()) {await output.cancel();return {cancelled:true};}
   draw(f/30);await video.add(f/30,1/30);
   if(f%6===0){onProgress(f/frames*100);await new Promise(r=>setTimeout(r,0));}
  }
  video.close();await output.finalize();onProgress(100);
  return {blob:new Blob([output.target.buffer],{type:format==='mp4'?'video/mp4':'video/webm'})};
 }catch(e){await output.cancel().catch(()=>{});throw e;}
}
