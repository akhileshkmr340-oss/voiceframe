const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('dist/app.js','utf8');
const start = source.indexOf('async function exportVideo(){');
const end = source.indexOf("$('export').onclick=exportVideo;", start);
const code = source.slice(start,end);
async function run(renderer) {
 const locks=[], elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{value:id==='fileformat'?'mp4':id==='quality'?'1080':'',replaceChildren(){},hidden:false,textContent:''});return elements.get(id);};
 const context={scenes:[{}],status(){},voiceRec:null,window:{VideoEncoder(){},speechSynthesis:{cancel(){}}},stop(){},dictation:null,exporting:false,exportAborted:false,lock:value=>locks.push(value),$,configure(){},draw(){},audioURL:null,audioContext:null,canvas:{width:1920,height:1080},duration:()=>10,renderOffline:renderer,recordVideo:async()=>{context.exporting=true;locks.push(true);context.recorderStarted=true;},current:0,File:class{},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},result:null,resultURL:null,document:{createElement:()=>({})},navigator:{},fmt:()=> '00:10'};
 vm.createContext(context);vm.runInContext(code+'\nthis.run=exportVideo;',context);await context.run();return {context,locks};
}
(async()=>{
 const fallback=await run(async()=>null);
 assert.equal(fallback.context.recorderStarted,true);
 assert.equal(fallback.context.exporting,true,'Recorder fallback must retain export state until its stop event');
 assert.equal(fallback.locks.at(-1),true,'Recorder controls must remain locked after handoff');
 const completed=await run(async()=>({blob:{type:'video/mp4'}}));
 assert.equal(completed.context.exporting,false);
 assert.equal(completed.locks.at(-1),false);
 const cancelled=await run(async()=>({cancelled:true}));
 assert.equal(cancelled.context.exporting,false);
 const failed=await run(async()=>{throw Error('Encoder failed')});
 assert.equal(failed.context.exporting,false);
 assert.equal(failed.locks.at(-1),false);
 console.log('PASS: recorder fallback retains state; completion, cancellation and failure unlock correctly.');
})().catch(e=>{console.error(e);process.exitCode=1;});
