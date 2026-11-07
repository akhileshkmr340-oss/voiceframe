import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {requiresFullFootage,assertFullFootage} from '../firebase-client/js/generation-policy.js';
import {Renderer} from '../firebase-client/js/renderer.js';
const source=fs.readFileSync(new URL('../firebase-client/js/app.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('function '+name+'(');assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2)};
function decoder(mode,good=false){
 let revoked=0, released=0;
 const video={duration:good?4:0,removeAttribute(){this.src='';released++},load(){}};
 const ctx={P:{options:{motion:mode}},requiresFullFootage,Error,Number,Promise,console:{warn(){}},setTimeout:()=>1,clearTimeout(){},URL:{createObjectURL:()=> 'blob:qa',revokeObjectURL(){revoked++}},document:{createElement:()=>video}};
 vm.createContext(ctx);vm.runInContext(extract('openClip'),ctx);
 return {ctx,video,revoked:()=>revoked,released:()=>released};
}
test('full motion rejects an unreadable clip and releases its URL',async()=>{
 const d=decoder('full'),p=d.ctx.openClip(new Blob(['bad']),2);d.video.onerror();
 await assert.rejects(p,/Shot 3.*unreadable/);assert.equal(d.revoked(),1);assert.equal(d.released(),1);
});
test('only explicit basic or hybrid mode permits decoder fallback',async()=>{
 for(const mode of ['live','hero']){const d=decoder(mode),p=d.ctx.openClip(new Blob(['bad']),0);d.video.onerror();assert.equal(await p,null);assert.equal(d.revoked(),1);}
});
test('readable full-motion footage retains its playable element',async()=>{
 const d=decoder('full',true),p=d.ctx.openClip(new Blob(['clip']),0);d.video.onloadeddata();assert.equal(await p,d.video);assert.equal(d.revoked(),0);
});
test('default clip playback stays forward through a long shot',()=>{
 const r={p:{scenes:[{}]},tl:{scenes:[{start:0,end:45}]},media:{video:()=>({duration:5})},xf:0,frozen:(_,t)=>t};
 let previous=-1;for(let t=0;t<=45;t+=.05){const next=Renderer.prototype.clipTime.call(r,0,t);assert.ok(next>=previous);assert.ok(next<5);previous=next;}
});
function exportContext(p,prepare){
 const ctx={P:p,assertFullFootage,renderJob:false,runJob:fn=>fn(new AbortController().signal),player:{pause(){}},clipStop:null,mixBuf:null,allPainted:()=>false,ensureFilmParts:prepare,$:()=>({hidden:false})};
 vm.createContext(ctx);const start=source.indexOf('const renderFull = () => runJob('),end=source.indexOf("\n$('#dlVideo')",start);vm.runInContext(source.slice(start,end)+'\nthis.exportFilm=renderFull;',ctx);return ctx;
}
test('incomplete full motion is rejected before export preparation',async()=>{
 let called=0;const ctx=exportContext({options:{motion:'full'},scenes:[{}],videos:{}},async()=>called++);
 await assert.rejects(ctx.exportFilm(),/incomplete/);assert.equal(called,0);assert.equal(ctx.renderJob,false);
});
test('preparation failure unlocks export for a later retry',async()=>{
 const ctx=exportContext({options:{motion:'full'},scenes:[{}],videos:{'scene-0':new Blob(['clip'])}},async()=>{throw Error('voice unavailable')});
 await assert.rejects(ctx.exportFilm(),/voice unavailable/);assert.equal(ctx.renderJob,false);
 await assert.rejects(ctx.exportFilm(),/voice unavailable/);assert.equal(ctx.renderJob,false);
});
