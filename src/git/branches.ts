import { runGit } from './exec.ts';
import type { RepoInfo } from './repo.ts';

export interface Branches {
  /** Short names like `main`, most recent commit first. */
  local: string[];
  /** Short names like `origin/main`, most recent commit first, without symbolic refs like `origin/HEAD`. */
  remote: string[];
}

/** Local and remote-tracking branches, for picking a base. Read-only. */
export async function listBranches(repo: RepoInfo): Promise<Branches> {
  const { stdout } = await runGit(
    [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)%00%(symref)',
      'refs/heads',
      'refs/remotes',
    ],
    { cwd: repo.root },
  );
  const local: string[] = [];
  const remote: string[] = [];
  for (const line of stdout.toString('utf8').split('\n')) {
    const [ref, symref] = line.split('\0');
    if (!ref || symref) continue;
    if (ref.startsWith('refs/heads/')) local.push(ref.slice('refs/heads/'.length));
    else if (ref.startsWith('refs/remotes/')) remote.push(ref.slice('refs/remotes/'.length));
  }
  return { local, remote };
}
