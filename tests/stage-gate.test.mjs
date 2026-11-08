import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerifiedStage, storyProblems, audioProblems } from '../firebase-client/js/stage-gate.js';

test('a failed artifact retries its own stage, and later work waits for verification', async () => {
  const events = []; let attempts = 0;
  await runVerifiedStage({id:'images',run:async()=>{events.push('image');attempts++;},verify:async()=>{events.push('check');return attempts === 2 ? [] : ['missing'];}});
  events.push('audio');
  assert.deepEqual(events,['check','image','check','image','check','audio']);
});
test('a persistently failed stage blocks subsequent work and has a bounded retry cost', async () => {
  let attempts=0, next=false; const states=[];
  await assert.rejects(async()=>{await runVerifiedStage({id:'motion',maxAttempts:99,run:async()=>{attempts++;},verify:async()=>['bad hands'],onState:s=>states.push(s.state)});next=true;},/Later stages are blocked/);
  assert.equal(attempts,2); assert.equal(next,false); assert.equal(states.at(-1),'blocked');
});
test('verified current artifacts are reused, but stale saved pass flags are not consulted', async()=>{
  let calls=0;
  await runVerifiedStage({id:'images',run:async()=>{calls++;},verify:async()=>[]});
  assert.equal(calls,0);
  await assert.rejects(runVerifiedStage({id:'images',run:async()=>{calls++;},verify:async()=>['edited image']}));
  assert.equal(calls,2);
});
test('cancelled and resumable runs never start another GPU job', async()=>{
  for(const error of [Object.assign(new Error('status unavailable'),{resumable:true}),Object.assign(new Error('quota exhausted'),{status:429})]){
    let count=0;
    await assert.rejects(runVerifiedStage({id:'motion',run:async()=>{count++;throw error;},verify:async()=>['missing']}));
    assert.equal(count,1);
  }
  const controller=new AbortController();controller.abort();let count=0;
  await assert.rejects(runVerifiedStage({id:'motion',signal:controller.signal,run:async()=>{count++;},verify:async()=>['missing']}));assert.equal(count,0);
});
test('missing verdicts cannot pass and unknown story speakers block production',async()=>{
  await assert.rejects(runVerifiedStage({id:'check',run:async()=>{},verify:async()=>null}),/evidence/);
  assert.match(storyProblems({characters:[],scenes:[{visual:'Room',dialogue:[{character:'unknown',line:'Hello'}]}]}).join(),/unknown character/);
});
test('partial audio and invalid buffers fail; intentionally silent shots pass',()=>{
  const scene={narration:'Narration',dialogue:[{line:'Hello'}]}, segment={buffer:{length:24000,duration:1}};
  assert.ok(audioProblems([scene],[[segment]]).length);
  assert.deepEqual(audioProblems([scene],[[segment,segment]]),[]);
  assert.ok(audioProblems([scene],[[{buffer:{length:0,duration:NaN}}]]).length);
  assert.deepEqual(audioProblems([{}],[[]]),[]);
});
