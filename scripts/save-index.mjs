import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = 'public/data/jobs.json';

// Create each candidate commit directly on the fetched remote tip. A temporary
// Git index ensures retries never reset the checkout or overwrite unrelated files.
export function saveIndex({ cwd = process.cwd(), beforePush } = {}) {
  const git = (args, options = {}) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
  }).trim();
  const generated = readFileSync(join(cwd, file), 'utf8');
  const generatedAt = Date.parse(JSON.parse(generated).updatedAt);
  if (!Number.isFinite(generatedAt)) throw new Error('Generated index must have a valid updatedAt');
  const changed = git(['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean);
  if (changed.some(name => name !== file)) throw new Error('Save requires a clean checkout except for the generated job index');
  if (git(['diff', '--cached', '--name-only'])) throw new Error('Save requires an empty staging area');
  const temp = mkdtempSync(join(tmpdir(), 'career-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'index') };
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      git(['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
      const parent = git(['rev-parse', 'refs/remotes/origin/main']);
      const existing = git(['show', `${parent}:${file}`]);
      const existingAt = Date.parse(JSON.parse(existing).updatedAt);
      if (existing === generated.trim() || (Number.isFinite(existingAt) && existingAt >= generatedAt)) {
        // This file is the generated output owned by this step, not user work.
        git(['restore', '--source=HEAD', '--', file]);
        git(['merge', '--ff-only', parent]);
        console.log('Remote index is already as recent; preserved it and synchronized checkout.');
        return { status: 'current', attempts: attempt };
      }
      git(['read-tree', parent], { env });
      const blob = git(['hash-object', '-w', '--stdin'], { input: generated });
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], { env });
      const tree = git(['write-tree'], { env });
      const commit = git(['commit-tree', tree, '-p', parent, '-m', 'chore: refresh public job discovery index']);
      beforePush?.(attempt);
      const push = spawnSync('git', ['push', 'origin', `${commit}:refs/heads/main`], { cwd, encoding: 'utf8' });
      if (push.status === 0) {
        git(['restore', '--source=HEAD', '--', file]);
        git(['merge', '--ff-only', commit]);
        console.log(`Public index saved without force-push (attempt ${attempt}).`);
        return { status: 'saved', attempts: attempt };
      }
      const error = push.stderr || push.stdout || 'Unknown Git push failure';
      if (!/fetch first|non-fast-forward|remote contains work|failed to update ref|cannot lock ref/i.test(error)) {
        throw new Error(error);
      }
      console.log(`Remote advanced during save; rebuilding on its latest commit (${attempt}/3).`);
    }
    throw new Error('Remote kept advancing after three attempts; index was not published. Run the workflow again.');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { saveIndex(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
