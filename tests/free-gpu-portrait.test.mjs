import test from 'node:test';
import assert from 'node:assert/strict';
import { freeGpuPortrait } from '../firebase-client/js/free-gpu-portrait.js';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function setup(overrides = {}) {
  const calls=[];
  return {calls,options:{api:'https://relay.example/api',prompt:'A fictional fully clothed adult',seed:42,jobId:'portrait-test-job',sleep:async()=>{},
    relayFetch:async(url,options={})=>{
      const action=new URL(url).searchParams.get('action');calls.push({action,body:options.body&&JSON.parse(options.body),url});
      if(overrides[action])return overrides[action]();
      return json(action==='gpu'?{free:true}:action==='status'?{state:'complete',chars:['portrait']}:action==='clip'?{url:'https://images.example/portrait.jpg'}:{ok:true,started:1});
    },fetchImage:async()=>new Response(new Blob(['jpeg'],{type:'image/jpeg'}),{headers:{'content-type':'image/jpeg'}})}};
}
test('a single free worker generates a portrait with no video shots and then receives cancel',async()=>{
  const {calls,options}=setup();const image=await freeGpuPortrait(options);assert.equal(image.type,'image/jpeg');
  assert.deepEqual(calls.map(c=>c.action),['gpu','start','upload','status','clip','cancel']);
  assert.equal(calls[1].body.parts,1);
  const plans=calls[2].body.files.map(f=>({name:f.name,value:JSON.parse(Buffer.from(f.b64,'base64').toString())}));
  assert.equal(plans[0].value.portraits.length,1);assert.deepEqual(plans[0].value.shots,[]);assert.deepEqual(plans[1].value.scenes,[]);
  assert.ok(calls.every(c=>!c.url.includes('runpod')));
});
test('a busy free GPU does not start or cancel another film',async()=>{
  const {calls,options}=setup({gpu:()=>json({free:false})});await assert.rejects(freeGpuPortrait(options),/currently busy/);assert.deepEqual(calls.map(c=>c.action),['gpu']);
});
test('a rejected allowance never uploads or retries a job',async()=>{
  const {calls,options}=setup({start:()=>json({error:"You've used today's 4 free GPU jobs"},429)});
  await assert.rejects(freeGpuPortrait(options),e=>e.daily);assert.deepEqual(calls.map(c=>c.action),['gpu','start']);
});
test('worker safety rejection and failure stop the job without returning an image',async()=>{
  for(const state of [{state:'complete',unsafeChars:['portrait']},{state:'error',failure:'No GPU quota available'}]){
    const {calls,options}=setup({status:()=>json(state)});await assert.rejects(freeGpuPortrait(options));assert.equal(calls.at(-1).action,'cancel');assert.ok(!calls.some(c=>c.action==='clip'));
  }
});
test('cancellation still sends the stop request without the aborted signal',async()=>{
  const {calls,options}=setup();const controller=new AbortController();options.signal=controller.signal;
  options.sleep=async()=>controller.abort();await assert.rejects(freeGpuPortrait(options));assert.equal(calls.at(-1).action,'cancel');
});
