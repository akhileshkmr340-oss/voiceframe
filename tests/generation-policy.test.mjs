import test from 'node:test';
import assert from 'node:assert/strict';
import {missingFootage, assertFullFootage, footageSummary} from '../firebase-client/js/generation-policy.js';
const project=mode=>({options:{motion:mode},scenes:[{},{}],videos:{'scene-0':new Blob(['valid clip'])}});
test('full mode blocks incomplete footage and preserves completed clips',()=>{
 const p=project('full'),clip=p.videos['scene-0'];
 assert.deepEqual(missingFootage(p),[1]);
 assert.throws(()=>assertFullFootage(p),/shot\(s\).*\(2\)/);
 assert.equal(p.videos['scene-0'],clip);
 assert.equal(footageSummary(p).blocked,true);
});
test('empty and non-blob clip data do not count as footage',()=>{
 const p=project('full');p.videos={'scene-0':new Blob([]),'scene-1':'url'};
 assert.deepEqual(missingFootage(p),[0,1]);
});
test('complete full film can export',()=>{
 const p=project('full');p.videos['scene-1']=new Blob(['clip two']);
 assert.doesNotThrow(()=>assertFullFootage(p));assert.equal(footageSummary(p).ready,2);
});
test('basic and hybrid remain explicitly available',()=>{
 for(const mode of ['live','hero']) {const p=project(mode);assert.doesNotThrow(()=>assertFullFootage(p));assert.equal(footageSummary(p).blocked,false);}
});

test('title cards and maps do not require generated footage',()=>{ const p=project('full');p.scenes=[{}, {card:{kind:'chapter'}}, {map:{title:'India'}}]; assert.doesNotThrow(()=>assertFullFootage(p));assert.equal(footageSummary(p).total,1);assert.equal(footageSummary(p).ready,1); });
