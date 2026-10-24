import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { processFile } from '@pierre/diffs';

import {
  BaseNotFoundError,
  NoCommitsError,
  NoMergeBaseError,
  NotAGitRepoError,
  detectBase,
  findRepo,
  loadReview,
  type ChangedFile,
  type Review,
} from '../src/git/index.ts';
import { TestRepo, snapshot, tempDir } from './helpers/repo.ts';

function file(review: Review, path: string): ChangedFile {
  const found = review.files.find((f) => f.path === path);
  assert.ok(found, `expected ${path} in ${review.files.map((f) => f.path).join(', ')}`);
  return found;
}

/** A clone with `origin/main`, on a `feature` branch. */
function featureRepo(files: Record<string, string | Buffer>): TestRepo {
  const origin = TestRepo.init(files);
  const repo = TestRepo.clone(origin);
  repo.git('switch', '--quiet', '-c', 'feature');
  return repo;
}

describe('findRepo', () => {
  it('finds the root and branch from a nested folder', async () => {
    const repo = TestRepo.init({ 'src/deep/file.ts': 'export {};\n' });
    const info = await findRepo(repo.path('src/deep'));
    assert.equal(info.root, repo.dir);
    assert.equal(info.branch, 'main');
    assert.equal(info.gitDir, repo.path('.git'));
    assert.equal(info.commonDir, repo.path('.git'));
    assert.equal(info.isLinkedWorktree, false);
    assert.equal(info.head, repo.git('rev-parse', 'HEAD'));
  });

  it('fails clearly outside a git repo', async () => {
    await assert.rejects(findRepo(tempDir('plain')), NotAGitRepoError);
  });

  it('fails clearly before the first commit', async () => {
    const repo = TestRepo.init({});
    await assert.rejects(findRepo(repo.dir), NoCommitsError);
  });

  it('reports a detached HEAD with its short SHA', async () => {
    const repo = TestRepo.init();
    repo.git('switch', '--quiet', '--detach');
    const info = await findRepo(repo.dir);
    assert.equal(info.branch, null);
    assert.equal(info.shortHead, repo.git('rev-parse', '--short', 'HEAD'));
  });
});

describe('detectBase', () => {
  it('uses origin/HEAD first', async () => {
    const repo = featureRepo({ 'a.txt': 'a\n' });
    const base = await detectBase(await findRepo(repo.dir));
    assert.deepEqual(base, { ref: 'origin/main', sha: repo.git('rev-parse', 'origin/main'), source: 'origin-head' });
  });

  it('follows origin/HEAD to a branch not named main', async () => {
    const origin = TestRepo.init();
    origin.git('branch', '--move', 'main', 'trunk');
    const repo = TestRepo.clone(origin);
    const base = await detectBase(await findRepo(repo.dir));
    assert.equal(base.ref, 'origin/trunk');
    assert.equal(base.source, 'origin-head');
  });

  it('prefers origin/main over a stale local main when origin/HEAD is missing', async () => {
    const repo = featureRepo({ 'a.txt': 'a\n' });
    repo.git('remote', 'set-head', 'origin', '--delete');
    // Local main moves on its own, so the two candidates point at different commits.
    repo.git('switch', '--quiet', 'main');
    repo.write({ 'local.txt': 'only local\n' }).commitAll('Local only');
    repo.git('switch', '--quiet', 'feature');

    const base = await detectBase(await findRepo(repo.dir));
    assert.equal(base.ref, 'origin/main');
    assert.equal(base.source, 'fallback');
    assert.equal(base.sha, repo.git('rev-parse', 'origin/main'));
  });

  it('falls back to a local master', async () => {
    const repo = TestRepo.init();
    repo.git('branch', '--move', 'main', 'master');
    repo.git('switch', '--quiet', '-c', 'feature');
    const base = await detectBase(await findRepo(repo.dir));
    assert.equal(base.ref, 'master');
  });

  it('lists every branch it tried when none exist', async () => {
    const repo = TestRepo.init();
    repo.git('branch', '--move', 'main', 'feature');
    const error = await detectBase(await findRepo(repo.dir)).catch((e: unknown) => e);
    assert.ok(error instanceof BaseNotFoundError);
    assert.deepEqual(error.tried, ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']);
  });

  it('uses a given base exactly as typed', async () => {
    const repo = featureRepo({ 'a.txt': 'a\n' });
    repo.git('branch', 'dev', 'main');
    const info = await findRepo(repo.dir);
    const base = await detectBase(info, 'dev');
    assert.deepEqual(base, { ref: 'dev', sha: repo.git('rev-parse', 'dev'), source: 'option' });
    await assert.rejects(detectBase(info, 'nope'), BaseNotFoundError);
    await assert.rejects(detectBase(info, '--all'), BaseNotFoundError);
  });
});

describe('loadReview', () => {
  it('shows committed, staged, unstaged and untracked changes in one diff', async () => {
    const repo = featureRepo({
      'committed.ts': 'export const a = 1;\n',
      'staged.ts': 'export const b = 1;\n',
      'unstaged.ts': 'export const c = 1;\n',
      'both.ts': 'one\ntwo\nthree\n',
    });
    repo.write({ 'committed.ts': 'export const a = 2;\n', 'both.ts': 'one\n2\nthree\n' }).commitAll('Commit');
    repo.write({ 'staged.ts': 'export const b = 2;\n' }).git('add', 'staged.ts');
    repo.write({ 'unstaged.ts': 'export const c = 2;\n', 'both.ts': 'one\n2\n3\n' });
    repo.write({ 'src/untracked.ts': 'export const d = 1;\n' });

    const review = await loadReview({ cwd: repo.dir });
    assert.equal(review.repo.branch, 'feature');
    assert.equal(review.base.ref, 'origin/main');
    assert.equal(review.mergeBase, repo.git('rev-parse', 'origin/main'));
    assert.deepEqual(
      review.files.map((f) => [f.path, f.status, f.origin]),
      [
        ['both.ts', 'modified', 'uncommitted'],
        ['committed.ts', 'modified', 'committed'],
        ['src/untracked.ts', 'added', 'new'],
        ['staged.ts', 'modified', 'uncommitted'],
        ['unstaged.ts', 'modified', 'uncommitted'],
      ],
    );

    const committed = file(review, 'committed.ts');
    assert.equal(committed.oldContents, 'export const a = 1;\n');
    assert.equal(committed.newContents, 'export const a = 2;\n');
    assert.deepEqual([committed.additions, committed.deletions], [1, 1]);
    assert.match(committed.patch, /^diff --git a\/committed\.ts b\/committed\.ts\n/);
    assert.match(committed.patch, /\n-export const a = 1;\n\+export const a = 2;\n$/);

    const both = file(review, 'both.ts');
    assert.deepEqual(both.origins, ['committed', 'uncommitted']);
    assert.equal(both.oldContents, 'one\ntwo\nthree\n');
    assert.equal(both.newContents, 'one\n2\n3\n');

    const untracked = file(review, 'src/untracked.ts');
    assert.equal(untracked.oldContents, null);
    assert.equal(untracked.newContents, 'export const d = 1;\n');
    assert.equal(untracked.oldMode, null);
    assert.equal(untracked.newMode, '100644');
    assert.deepEqual([untracked.additions, untracked.deletions], [1, 0]);
    assert.match(untracked.patch, /new file mode 100644\n/);
  });

  it('keeps commits made on the base after branching out of the view', async () => {
    const origin = TestRepo.init({ 'a.txt': 'a\n' });
    const repo = TestRepo.clone(origin);
    repo.git('switch', '--quiet', '-c', 'feature');
    repo.write({ 'mine.txt': 'mine\n' }).commitAll('Mine');
    origin.write({ 'theirs.txt': 'theirs\n', 'a.txt': 'changed on main\n' }).commitAll('Theirs');
    repo.git('fetch', '--quiet');

    const review = await loadReview({ cwd: repo.dir });
    assert.notEqual(review.mergeBase, review.base.sha);
    assert.deepEqual(
      review.files.map((f) => f.path),
      ['mine.txt'],
    );
  });

  it('shows renames, committed and with plain mv, with their old paths', async () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const repo = featureRepo({ 'old/name.ts': body, 'moved.ts': body.replace(/line/g, 'row') });
    repo.write({ 'new/name.ts': body.replace('line 3', 'line three') }).remove('old/name.ts').commitAll('Rename');
    // An agent moving a file without git: a deletion plus an untracked file.
    repo.write({ 'elsewhere/moved.ts': repo.read('moved.ts') }).remove('moved.ts');

    const review = await loadReview({ cwd: repo.dir });
    assert.equal(review.files.length, 2);

    const committed = file(review, 'new/name.ts');
    assert.equal(committed.status, 'renamed');
    assert.equal(committed.prevPath, 'old/name.ts');
    assert.ok(committed.similarity! >= 90);
    assert.equal(committed.origin, 'committed');
    assert.equal(committed.oldContents, body);
    assert.equal(committed.newContents, body.replace('line 3', 'line three'));
    assert.deepEqual([committed.additions, committed.deletions], [1, 1]);

    const moved = file(review, 'elsewhere/moved.ts');
    assert.equal(moved.status, 'renamed');
    assert.equal(moved.prevPath, 'moved.ts');
    assert.equal(moved.similarity, 100);
    assert.equal(moved.origin, 'uncommitted');
    assert.equal(moved.oldContents, moved.newContents);
  });

  it('shows deletions, committed and unstaged, with old contents only', async () => {
    const repo = featureRepo({ 'gone.ts': 'bye\n', 'also-gone.ts': 'later\n', 'kept.ts': 'hi\n' });
    repo.git('rm', '--quiet', 'gone.ts');
    repo.commitAll('Delete');
    repo.remove('also-gone.ts');

    const review = await loadReview({ cwd: repo.dir });
    for (const [path, origin, contents] of [
      ['gone.ts', 'committed', 'bye\n'],
      ['also-gone.ts', 'uncommitted', 'later\n'],
    ]) {
      const deleted = file(review, path);
      assert.equal(deleted.status, 'deleted');
      assert.equal(deleted.origin, origin);
      assert.equal(deleted.oldContents, contents);
      assert.equal(deleted.newContents, null);
      assert.equal(deleted.newMode, null);
      assert.equal(deleted.newSize, null);
      assert.equal(deleted.deletions, 1);
    }
  });

  it('marks binary files and reports sizes without contents', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const repo = featureRepo({ 'logo.png': png });
    repo.write({ 'logo.png': Buffer.concat([png, png]), 'icon.bin': Buffer.from([0, 1, 2, 3, 0]) });

    const review = await loadReview({ cwd: repo.dir });
    const changed = file(review, 'logo.png');
    assert.equal(changed.binary, true);
    assert.equal(changed.status, 'modified');
    assert.equal(changed.oldContents, null);
    assert.equal(changed.newContents, null);
    assert.deepEqual([changed.oldSize, changed.newSize], [png.length, png.length * 2]);
    assert.deepEqual([changed.additions, changed.deletions], [0, 0]);
    assert.match(changed.patch, /Binary files a\/logo\.png and b\/logo\.png differ\n$/);

    const added = file(review, 'icon.bin');
    assert.equal(added.binary, true);
    assert.equal(added.origin, 'new');
    assert.deepEqual([added.oldSize, added.newSize], [null, 5]);
  });

  it('diffs a linked worktree against its own branch, not the main checkout', async () => {
    const origin = TestRepo.init({ 'shared.ts': 'shared\n' });
    const main = TestRepo.clone(origin);
    const worktreeDir = join(tempDir('worktrees'), 'feature-wt');
    main.git('worktree', 'add', '--quiet', '-b', 'agent/feature', worktreeDir);
    const worktree = new TestRepo(worktreeDir);

    // Changes in the main checkout must not leak into the worktree's review.
    main.write({ 'shared.ts': 'edited in main\n', 'main-only.ts': 'main\n' });
    worktree.write({ 'agent.ts': 'agent\n' }).commitAll('Agent work');
    worktree.write({ 'shared.ts': 'edited by agent\n', 'scratch.ts': 'wip\n' });

    const review = await loadReview({ cwd: worktree.path('.') });
    assert.equal(review.repo.root, worktreeDir);
    assert.equal(review.repo.branch, 'agent/feature');
    assert.equal(review.repo.isLinkedWorktree, true);
    assert.equal(review.repo.commonDir, main.path('.git'));
    assert.equal(review.repo.gitDir, main.path('.git/worktrees/feature-wt'));
    assert.equal(review.repo.name, main.dir.split('/').pop());
    assert.equal(review.base.ref, 'origin/main');
    assert.deepEqual(
      review.files.map((f) => [f.path, f.origin]),
      [
        ['agent.ts', 'committed'],
        ['scratch.ts', 'new'],
        ['shared.ts', 'uncommitted'],
      ],
    );
    assert.equal(file(review, 'shared.ts').newContents, 'edited by agent\n');
  });

  it('reports mode changes and symlinks', async () => {
    const repo = featureRepo({ 'run.sh': 'echo hi\n', 'target.txt': 'target\n' });
    repo.chmod('run.sh', 0o755);
    repo.symlink('target.txt', 'link.txt');

    const review = await loadReview({ cwd: repo.dir });
    const script = file(review, 'run.sh');
    assert.equal(script.status, 'modified');
    assert.deepEqual([script.oldMode, script.newMode], ['100644', '100755']);
    assert.deepEqual([script.additions, script.deletions], [0, 0]);
    assert.equal(script.oldContents, script.newContents);

    const link = file(review, 'link.txt');
    assert.equal(link.newMode, '120000');
    assert.equal(link.newContents, 'target.txt');
  });

  it('flags lockfiles, minified files and linguist-generated files', async () => {
    const repo = featureRepo({ 'readme.md': 'hi\n' });
    repo.write({
      '.gitattributes': 'gen/** linguist-generated\nvendor/app.min.js linguist-generated=false\n',
      'package-lock.json': '{}\n',
      'web/app.min.js': 'x\n',
      'vendor/app.min.js': 'y\n',
      'gen/api.ts': 'export {};\n',
      'src/app.ts': 'export {};\n',
    });

    const review = await loadReview({ cwd: repo.dir });
    const generated = review.files.filter((f) => f.generated).map((f) => f.path);
    assert.deepEqual(generated, ['gen/api.ts', 'package-lock.json', 'web/app.min.js']);
  });

  it('handles paths with spaces, unicode and glob characters', async () => {
    const repo = featureRepo({ 'readme.md': 'hi\n' });
    const paths = ['docs/read me.md', 'src/ünïcode.ts', 'src/[id]/page.tsx', 'src/*.ts'];
    repo.write(Object.fromEntries(paths.map((p) => [p, `${p}\n`])));
    // A glob-looking name must not pull in its neighbours when marked intent-to-add.
    repo.write({ 'src/other.ts': 'other\n' });

    const review = await loadReview({ cwd: repo.dir });
    for (const path of paths) assert.equal(file(review, path).newContents, `${path}\n`);
    assert.equal(review.files.length, paths.length + 1);
  });

  it('keeps every file lined up in a diff of 150 files', async () => {
    const files = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`src/file-${i}.ts`, `export const v = ${i};\n`]));
    const repo = featureRepo(files);
    for (let i = 0; i < 120; i += 2) repo.write({ [`src/file-${i}.ts`]: `export const v = ${i + 1000};\n` });
    repo.commitAll('Edit half');
    for (let i = 1; i < 120; i += 2) repo.write({ [`src/file-${i}.ts`]: `export const v = ${i + 1000};\n` });
    for (let i = 0; i < 30; i++) repo.write({ [`new/file-${i}.ts`]: `export const n = ${i};\n` });

    const review = await loadReview({ cwd: repo.dir });
    assert.equal(review.files.length, 150);
    for (const changed of review.files) {
      const i = Number(changed.path.match(/(\d+)\.ts$/)![1]);
      if (changed.path.startsWith('new/')) {
        assert.equal(changed.newContents, `export const n = ${i};\n`);
        assert.equal(changed.origin, 'new');
      } else {
        assert.equal(changed.oldContents, `export const v = ${i};\n`);
        assert.equal(changed.newContents, `export const v = ${i + 1000};\n`);
        assert.equal(changed.origin, i % 2 === 0 ? 'committed' : 'uncommitted');
      }
      assert.ok(changed.patch.startsWith(`diff --git a/${changed.path} b/${changed.path}\n`));
    }
  });

  it('shows a file with merge conflicts as it sits on disk', async () => {
    const repo = featureRepo({ 'a.txt': 'base\n' });
    repo.write({ 'a.txt': 'feature\n' }).commitAll('Feature');
    repo.git('switch', '--quiet', '-c', 'other', 'main');
    repo.write({ 'a.txt': 'other\n' }).commitAll('Other');
    repo.git('switch', '--quiet', 'feature');
    assert.throws(() => repo.git('merge', 'other'));

    const review = await loadReview({ cwd: repo.dir });
    const conflicted = file(review, 'a.txt');
    assert.equal(conflicted.status, 'modified');
    assert.equal(conflicted.oldContents, 'base\n');
    assert.match(conflicted.newContents!, /^<<<<<<< HEAD\nfeature\n=======\nother\n>>>>>>> other\n$/);
  });

  it('returns no files when nothing changed', async () => {
    const repo = featureRepo({ 'a.txt': 'a\n' });
    const review = await loadReview({ cwd: repo.dir });
    assert.deepEqual(review.files, []);
  });

  it('respects .gitignore for untracked files', async () => {
    const repo = featureRepo({ '.gitignore': 'dist/\n*.log\n' });
    repo.write({ 'dist/bundle.js': 'x\n', 'debug.log': 'x\n', 'kept.ts': 'x\n' });
    const review = await loadReview({ cwd: repo.dir });
    assert.deepEqual(
      review.files.map((f) => f.path),
      ['kept.ts'],
    );
  });

  it('fails clearly when the branch shares no history with the base', async () => {
    const repo = featureRepo({ 'a.txt': 'a\n' });
    repo.git('switch', '--quiet', '--orphan', 'unrelated');
    repo.write({ 'b.txt': 'b\n' }).commitAll('Unrelated');
    await assert.rejects(loadReview({ cwd: repo.dir }), NoMergeBaseError);
  });

  it('never writes to the index, work tree, refs or objects', async () => {
    const origin = TestRepo.init({ 'a.ts': 'a\n', 'b.ts': 'b\n', 'c.ts': 'c\n' });
    const repo = TestRepo.clone(origin);
    const worktreeDir = join(tempDir('worktrees'), 'wt');
    repo.git('worktree', 'add', '--quiet', '-b', 'feature', worktreeDir);
    const worktree = new TestRepo(worktreeDir);
    worktree.write({ 'a.ts': 'a2\n' }).commitAll('Edit a');
    worktree.write({ 'b.ts': 'b2\n' }).git('add', 'b.ts');
    worktree.write({ 'new.ts': 'new\n', 'moved.ts': 'c\n' }).remove('c.ts');

    // `git status` refreshes the index, so it runs before the snapshots, not between them.
    const status = worktree.git('status', '--porcelain');
    const before = { repo: snapshot(repo.dir), worktree: snapshot(worktreeDir) };
    const scratchBefore = readdirSync(tmpdir()).filter((name) => name.startsWith('onceover-') && !name.startsWith('onceover-test-'));

    const review = await loadReview({ cwd: worktreeDir });
    assert.equal(review.files.length, 4);
    await loadReview({ cwd: repo.dir });

    assert.deepEqual(snapshot(repo.dir), before.repo);
    assert.deepEqual(snapshot(worktreeDir), before.worktree);
    assert.equal(worktree.git('status', '--porcelain'), status);
    const scratchAfter = readdirSync(tmpdir()).filter((name) => name.startsWith('onceover-') && !name.startsWith('onceover-test-'));
    assert.deepEqual(scratchAfter, scratchBefore);
  });

  it('gives Pierre everything it needs to render each file', async () => {
    const repo = featureRepo({ 'src/view.tsx': 'export const A = () => <div>a</div>;\n'.repeat(12) });
    repo.write({ 'src/view.tsx': repo.read('src/view.tsx').replace('<div>a</div>', '<div>b</div>') }).commitAll('Edit');
    repo.write({ 'src/new.ts': 'export const n = 1;\n' });

    const review = await loadReview({ cwd: repo.dir });
    for (const changed of review.files) {
      const diff = processFile(changed.patch, {
        isGitDiff: true,
        throwOnError: true,
        oldFile: changed.oldContents === null ? undefined : { name: changed.prevPath ?? changed.path, contents: changed.oldContents },
        newFile: changed.newContents === null ? undefined : { name: changed.path, contents: changed.newContents },
      });
      assert.ok(diff, `Pierre couldn't parse ${changed.path}`);
      assert.equal(diff.name, changed.path);
      const added = diff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0);
      const removed = diff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0);
      assert.deepEqual([added, removed], [changed.additions, changed.deletions]);
    }
  });
});
