import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureBrowserModels } from '../firebase-client/js/browser-model-runtime.js';
import { ImageProviderPool } from '../firebase-client/js/image-providers.js';
const source = readFileSync(new URL('../firebase-client/js/ai.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function paintImage(');
const end = source.indexOf('// ---------------- picture check', start);
function painter(overrides = {}) {
  const calls = { request: 0, check: 0, wait: 0 };
  const deps = {
    imageProviders: new ImageProviderPool(),
    warmSafety: async () => {}, paintersOut: () => false, Cancelled: class extends Error {},
    waitGate: async () => { calls.wait++; }, FREE_IMG: '/image',
    relayFetch: async () => { calls.request++; return new Response(new Blob(['image']), { headers: { 'content-type': 'image/jpeg' } }); },
    checkImage: async () => { calls.check++; }, unsafeOf: async () => null, relayRefusal: async () => null,
    ...overrides
  };
  const run = new Function('deps', `const {${Object.keys(deps).join(',')}}=deps;return ${source.slice(start,end).replace('export ','')}`)(deps);
  return { run, calls };
}
test('browser model setup avoids blob module imports and shared-memory workers while retaining model cache', () => {
  const env = { useBrowserCache: true, backends: { onnx: { wasm: {} } } };
  configureBrowserModels(env);
  assert.equal(env.useWasmCache, false);assert.equal(env.backends.onnx.wasm.proxy, false);
  assert.equal(env.backends.onnx.wasm.numThreads, 1);assert.equal(env.useBrowserCache,true);
});
test('unavailable checker blocks before requesting an image', async () => {
  const {run,calls}=painter({warmSafety:async()=>{throw Error('checker unavailable');}});
  await assert.rejects(run('Fictional adult portrait',{}),/checker unavailable/);assert.equal(calls.request,0);
});
test('a named painter is not blocked by unrelated automatic-provider failures', async () => {
  const {run,calls}=painter({paintersOut:()=>true});
  assert.ok((await run('Fictional adult portrait',{painter:'nvidia'})).size);
  assert.equal(calls.request,1);assert.equal(calls.check,1);assert.equal(calls.wait,0);
});
test('automatic mode moves to a second image provider after a busy response', async () => {
  const providers=[];
  const {run}=painter({relayFetch:async(url,opts)=>{
    providers.push(JSON.parse(opts.body).painter);
    return providers.length===1 ? new Response('{}',{status:503}) : new Response(new Blob(['image']),{headers:{'content-type':'image/jpeg'}});
  }});
  assert.ok((await run('Portrait',{})).size);assert.deepEqual(providers,['nvidia','cloudflare-refs']);
});
test('invalid requests are not repeatedly submitted', async () => {
  let count=0;const {run}=painter({relayFetch:async()=>{count++;return new Response('{}',{status:400});}});
  await assert.rejects(run('Portrait',{}),e=>e.status===400);assert.equal(count,1);
});
test('a failed safety backend restarts in a new worker on retry',async()=>{
  const source=readFileSync(new URL('../firebase-client/js/safety.js',import.meta.url),'utf8')
    .replaceAll('export ','').replace('import.meta.url',JSON.stringify('https://example.test/js/safety.js'));
  const workers=[];
  class Worker { constructor(){workers.push(this);} terminate(){this.terminated=true;} postMessage(msg){queueMicrotask(()=>this.onmessage({data:workers.length===1?{id:msg.id,error:'backend initialization failed'}:{id:msg.id,ready:true}}));} }
  const warm=new Function('Worker','localStorage',source+'; return warmSafety;')(Worker,{getItem:()=>null});
  await assert.rejects(warm(),/Safety check unavailable/);await warm();assert.equal(workers.length,2);assert.equal(workers[0].terminated,true);
});
test('first character generation honors the provider and retries retain the brief and chosen name',async()=>{
  const source=readFileSync(new URL('../firebase-client/js/characters.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('async function designFromWords('),source.indexOf('function wireEditor()'));
  const ed={d:{name:'My character',ageYears:28,gender:'female',outfit:{id:'custom'}},briefFor:null};
  let writers=0,paints=0;const options=[];
  const deps={ed,$:()=>({value:'nvidia'}),ctx:{setStatus:()=>{}},preparePrompt:async t=>t,
    chat:async()=>{writers++;return '{"name":"Different name","appearance":"An adult wearing a navy jacket"}';},parseJSON:JSON.parse,
    ageOf:()=>28,ageClass:()=> 'adult',ensureFields:()=>{},renderEditor:()=>{},addVersion:()=>{},
    paint:async(view,change,opts)=>{options.push(opts);if(++paints===1)throw Error('provider busy');return new Blob(['portrait']);}};
  const run=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;return ${body}`)(deps);
  await assert.rejects(run('Original full character prompt'),/provider busy/);
  await run('Original full character prompt');
  assert.equal(writers,1);assert.equal(ed.d.name,'My character');assert.equal(ed.d.designPrompt,'Original full character prompt');
  assert.deepEqual(options,[{painter:'nvidia',format:'portrait'},{painter:'nvidia',format:'portrait'}]);
});
