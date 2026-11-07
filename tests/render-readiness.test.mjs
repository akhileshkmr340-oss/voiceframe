import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {footageSummary} from '../firebase-client/js/generation-policy.js';
const source=fs.readFileSync(new URL('../firebase-client/js/app.js',import.meta.url),'utf8');
function extract(name,async=false){const start=source.indexOf(`${async?'async ':''}function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2)}
test('missing footage produces a persistent full-motion notice',()=>{
 const nodes=new Map();const context={P:{options:{motion:'full'},scenes:[{},{}],videos:{},title:'Test film'},footageSummary,relayHasMotion:()=>false,$:id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},classList:{toggle(){}}});return nodes.get(id)}};
 vm.createContext(context);vm.runInContext(extract('syncWorkspaceState'),context);context.syncWorkspaceState();
 assert.equal(nodes.get('#fullMotionBlock').hidden,false);assert.match(nodes.get('#fullMotionBlockText').textContent,/2 still need video/);assert.equal(nodes.get('#workspaceFootage').textContent,'0 / 2 video shots');
 context.P.videos={'scene-0':new Blob(['a']),'scene-1':new Blob(['b'])};context.syncWorkspaceState();assert.equal(nodes.get('#fullMotionBlock').hidden,true);
});
function importer(duration=4,error=false){let revoked=0;const video={duration,videoWidth:720,videoHeight:1280,load(){if(this.src)setTimeout(()=>error?this.onerror?.():this.onloadeddata?.(),0)},removeAttribute(){this.src=''}};const canvas={getContext:()=>({drawImage(){}}),toBlob:fn=>fn(new Blob(['poster']))};const context={Blob,Error,Math,Number,Cancelled:class Cancelled extends Error{},setTimeout,clearTimeout,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){revoked++}},document:{createElement:tag=>tag==='video'?video:canvas}};vm.createContext(context);vm.runInContext(extract('readImportedClip',true),context);return {read:context.readImportedClip,revoked:()=>revoked}}
test('valid imports produce a poster without calling any generation service',async()=>{const i=importer();const result=await i.read(new Blob(['video']));assert.equal(result.duration,4);assert.ok(result.poster.size);assert.equal(i.revoked(),1)});
test('invalid or undecodable uploads reject and release the temporary URL',async()=>{const empty=importer();await assert.rejects(empty.read(new Blob([])),/non-empty/);const bad=importer(4,true);await assert.rejects(bad.read(new Blob(['bad'])),/cannot read/);assert.equal(bad.revoked(),1);const noFrames=importer(0);await assert.rejects(noFrames.read(new Blob(['bad'])),/no readable/);assert.equal(noFrames.revoked(),1)});
