import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveIndex } from '../scripts/save-index.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-git-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git'), local = join(root, 'local'), other = join(root, 'other');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  mkdirSync(remote); git(remote, 'init', '--bare', '--initial-branch=main');
  git(root, 'clone', remote, local);
  for (const dir of [local]) { git(dir,'config','user.name','Test'); git(dir,'config','user.email','test@example.invalid'); }
  mkdirSync(join(local,'public/data'),{recursive:true});
  writeFileSync(join(local,'public/data/jobs.json'), JSON.stringify({updatedAt:'2026-01-01T00:00:00Z',jobs:[]}));
  writeFileSync(join(local,'README.md'),'original');
  git(local,'add','.');git(local,'commit','-m','initial');git(local,'push','origin','main');
  git(root,'clone',remote,other);git(other,'config','user.name','Other');git(other,'config','user.email','other@example.invalid');
  const output={updatedAt:'2026-02-01T00:00:00Z',jobs:[{id:'new'}]};
  writeFileSync(join(local,'public/data/jobs.json'),JSON.stringify(output));
  function advance(newIndex) {
    git(other,'pull','--ff-only','origin','main');
    writeFileSync(join(other,'README.md'),'concurrent user change');
    if(newIndex)writeFileSync(join(other,'public/data/jobs.json'),JSON.stringify(newIndex));
    git(other,'add','.');git(other,'commit','-m','concurrent');git(other,'push','origin','main');
  }
  return {git,local,other,advance,output};
}
test('save on stale checkout preserves remote source edits and generated results',t=>{
  const f=fixture(t);f.advance();const r=saveIndex({cwd:f.local});
  assert.equal(r.status,'saved');assert.equal(readFileSync(join(f.local,'README.md'),'utf8'),'concurrent user change');
  assert.deepEqual(JSON.parse(readFileSync(join(f.local,'public/data/jobs.json'),'utf8')),f.output);
  assert.equal(f.git(f.local,'status','--porcelain'),'');
});
test('remote push race retries without dropping concurrent commits',t=>{
  const f=fixture(t);const r=saveIndex({cwd:f.local,beforePush:n=>{if(n===1)f.advance()}});
  assert.equal(r.attempts,2);assert.equal(readFileSync(join(f.local,'README.md'),'utf8'),'concurrent user change');
  assert.deepEqual(JSON.parse(readFileSync(join(f.local,'public/data/jobs.json'),'utf8')),f.output);
});
test('older discovery result never overwrites a more recent remote index',t=>{
  const f=fixture(t);const newer={updatedAt:'2026-03-01T00:00:00Z',jobs:[{id:'newer'}]};f.advance(newer);
  assert.equal(saveIndex({cwd:f.local}).status,'current');
  assert.deepEqual(JSON.parse(readFileSync(join(f.local,'public/data/jobs.json'),'utf8')),newer);
});
test('save refuses unrelated local edits',t=>{
  const f=fixture(t);writeFileSync(join(f.local,'README.md'),'local user work');
  assert.throws(()=>saveIndex({cwd:f.local}),/clean checkout/);
  assert.equal(readFileSync(join(f.local,'README.md'),'utf8'),'local user work');
});
