import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { requiresGeneratedVideo, missingVideoScenes, assertGeneratedVideo, forwardClipTime } from '../firebase-client/js/motion-policy.js';
import { Renderer } from '../firebase-client/js/renderer.js';

const clip = () => new Blob(['test video bytes'], {type:'video/mp4'});
const project = (n = 2) => ({options:{motion:'ai'},scenes:Array.from({length:n},()=>({})),images:{},videos:{},credits:{}});
test('AI mode reports missing and empty clips, and preserves explicit photo mode',()=>{
 const p=project(3);p.videos['scene-0']=clip();p.videos['scene-1']=new Blob([]);
 assert.equal(requiresGeneratedVideo(p),true);
 assert.deepEqual(missingVideoScenes(p),[1,2]);
 assert.throws(()=>assertGeneratedVideo(p),/scene 2, 3/);
 p.options.motion='3d';assert.deepEqual(missingVideoScenes(p),[]);assert.doesNotThrow(()=>assertGeneratedVideo(p));
});
test('all generated clips are required before constructing an AI renderer',()=>{
 const p=project(2);p.videos['scene-0']=clip();
 assert.throws(()=>new Renderer(p,[],{},720,1280),/scene 2/);
});
test('renderer cannot paint a missing AI clip as a moving still',()=>{
 const p=project(1);p.videos['scene-0']=clip();
 const r={p,tl:{scenes:[{start:0,end:8}]},images:[{width:100,height:100}],videos:[],W:720,H:1280};
 assert.throws(()=>Renderer.prototype.scene.call(r,{},0,2,1),/no playable AI video/);
});
test('AI video is drawn even when the old photo-camera flag is false',()=>{
 let draws=0;
 const p=project(1);p.videos['scene-0']=clip();
 const r={p,tl:{scenes:[{start:0,end:8}]},images:[{width:100,height:100}],videos:[{readyState:2,videoWidth:100,videoHeight:100}],W:720,H:1280,xf:1,o:{motion:false}};
 Renderer.prototype.scene.call(r,{drawImage(){draws++;}},0,2,1);
 assert.equal(draws,1);
});
test('long scenes advance clip time monotonically without reversed gestures',()=>{
 let previous=-1;
 for(let t=0;t<=45;t+=.05){const next=forwardClipTime(t,45,5);assert.ok(next>=previous);assert.ok(next<5);previous=next;}
 assert.equal(forwardClipTime(-10,45,5),0);
 assert.equal(forwardClipTime(4,0,5),0);
});

const source=fs.readFileSync(new URL('../firebase-client/js/app.js',import.meta.url),'utf8');
function functionSource(name){const start=source.indexOf('async function '+name+'(');if(start<0)throw Error(name);const end=source.indexOf('\n}',start)+2;return source.slice(start,end);}
function appContext(p,quota=true,provider=async()=>({blob:clip(),model:'LTX-Video'})){
 const calls=[];
 const context={P:p,Blob,Error,Cancelled:class Cancelled extends Error{},requiresGeneratedVideo,missingVideoScenes,assertGeneratedVideo,
  markLoading(){},renderSceneImage(){},save(){},setStatus(){},toast(){throw Error('Unexpected fallback toast');},
  videoQuotaLeft:()=>quota,quotaRefillText:()=> 'about 30 min',isQuotaError:e=>!!e.quota,motionPrompt:()=> 'test prompt',
  animateScene:async(...args)=>{calls.push(args);return provider(...args);}};
 vm.createContext(context);vm.runInContext(functionSource('animateOne')+'\n'+functionSource('doAnimate'),context);
 return {context,calls};
}
test('provider errors reject rather than pretending a scene animated',async()=>{
 const p=project(1);const {context}=appContext(p,true,async()=>{throw Error('Provider offline');});
 await assert.rejects(context.animateOne(0),/Scene 1 video generation failed/);
 assert.deepEqual(missingVideoScenes(p),[0]);
});
test('quota stops the pipeline and retains completed clips',async()=>{
 const p=project(2),completed=clip();p.images['scene-1']=clip();p.videos['scene-0']=completed;
 const {context}=appContext(p,true,async()=>{const e=Error('quota');e.quota=true;throw e;});
 await assert.rejects(context.doAnimate(),/quota exhausted/);
 assert.equal(p.videos['scene-0'],completed);
 assert.deepEqual(missingVideoScenes(p),[1]);
});
test('retry generates only missing clips and can run again after a previous failure',async()=>{
 const p=project(2),completed=clip();p.images['scene-1']=clip();p.videos['scene-0']=completed;
 const {context,calls}=appContext(p);
 await context.doAnimate();await context.doAnimate();
 assert.equal(calls.length,1);assert.equal(p.videos['scene-0'],completed);assert.deepEqual(missingVideoScenes(p),[]);
});
test('already completed films do not require remaining generation quota',async()=>{
 const p=project(1);p.videos['scene-0']=clip();const {context,calls}=appContext(p,false);
 await context.doAnimate();assert.equal(calls.length,0);
});
test('missing scene images cannot lead to successful AI completion',async()=>{
 const {context}=appContext(project(2));await assert.rejects(context.doAnimate(),/AI video is incomplete/);
});
