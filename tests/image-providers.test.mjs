import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageProviderPool } from '../firebase-client/js/image-providers.js';
const unavailable=(status=503)=>Object.assign(new Error('unavailable'),{status,retryable:true});
test('preferred provider fails over once per provider and stops on success',async()=>{
  const pool=new ImageProviderPool(),calls=[],progress=[];
  const result=await pool.run({painter:'cloudflare',onProgress:s=>progress.push(s),request:async id=>{calls.push(id);if(calls.length<3)throw unavailable();return 'portrait';}});
  assert.equal(result,'portrait');assert.deepEqual(calls,['cloudflare','nvidia','cloudflare-refs']);assert.ok(progress.some(s=>s.includes('switching')));
});
test('an unavailable provider is skipped for later characters until cooldown expires',async()=>{
  let now=0;const pool=new ImageProviderPool({now:()=>now}),calls=[];
  const request=async id=>{calls.push(id);if(id==='nvidia')throw unavailable(429);return 'image';};
  await pool.run({request});await pool.run({request});assert.equal(calls.filter(id=>id==='nvidia').length,1);
  now=31*60e3;await pool.run({request});assert.equal(calls.filter(id=>id==='nvidia').length,2);
});
test('reference-locked requests never fall back to a text-only provider',async()=>{
  const calls=[];await assert.rejects(new ImageProviderPool().run({refs:['portrait'],lock:true,request:async id=>{calls.push(id);throw unavailable();}}),/reference was preserved/);
  assert.deepEqual(calls,['cloudflare-refs']);
});
test('safety, authentication and user allowance failures stop without switching providers',async()=>{
  for(const error of [Object.assign(new Error('unsafe'),{unsafe:true}),Object.assign(new Error('checker unavailable'),{safetyDown:true}),Object.assign(new Error('daily allowance'),{daily:true}),Object.assign(new Error('sign in'),{status:401})]){
    let calls=0;await assert.rejects(new ImageProviderPool().run({request:async()=>{calls++;throw error;}}));assert.equal(calls,1);
  }
});
test('all failed providers stop at five calls and an immediate retry makes no new calls',async()=>{
  let calls=0;const pool=new ImageProviderPool();const request=async()=>{calls++;throw unavailable();};
  await assert.rejects(pool.run({request}),/All configured/);assert.equal(calls,5);assert.equal(pool.allCoolingDown(),true);
  await assert.rejects(pool.run({request}),/All configured/);assert.equal(calls,5);
});
test('concurrent characters never make simultaneous requests to the same provider',async()=>{
  const pool=new ImageProviderPool();let active=0,max=0;
  const request=async()=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,5));active--;return 'image';};
  await Promise.all([pool.run({request}),pool.run({request}),pool.run({request})]);assert.equal(max,1);
});
test('cancellation prevents fallback and unknown provider names are rejected',async()=>{
  const c=new AbortController();let calls=0;
  await assert.rejects(new ImageProviderPool().run({signal:c.signal,request:async()=>{calls++;c.abort();throw unavailable();}}));assert.equal(calls,1);
  await assert.rejects(new ImageProviderPool().run({painter:'invented',request:async()=>{calls++;}}),/Unknown/);assert.equal(calls,1);
});
