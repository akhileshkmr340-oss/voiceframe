import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureBrowserModels } from '../firebase-client/js/browser-model-runtime.js';
const source = readFileSync(new URL('../firebase-client/js/ai.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function paintImage(');
const end = source.indexOf('// ---------------- picture check', start);
function painter(overrides = {}) {
  const calls = { request: 0, check: 0, wait: 0 };
  const deps = {
    warmSafety: async () => {}, paintersOut: () => false, Cancelled: class extends Error {},
    waitGate: async () => { calls.wait++; }, FREE_IMG: '/image',
    relayFetch: async () => { calls.request++; return new Response(new Blob(['image']), { headers: { 'content-type': 'image/jpeg' } }); },
    checkImage: async () => { calls.check++; }, unsafeOf: async () => null, relayRefusal: async () => null,
    ...overrides
  };
  const run = new Function('deps', `const {${Object.keys(deps).join(',')}}=deps; let busyRun=0,paintersOutUntil=0;const gate={image:0};return ${source.slice(start,end).replace('export ','')}`)(deps);
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
test('automatic mode still respects its cooldown', async () => {
  const {run,calls}=painter({paintersOut:()=>true});await assert.rejects(run('Portrait',{}),/temporarily unavailable/);assert.equal(calls.request,0);
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
