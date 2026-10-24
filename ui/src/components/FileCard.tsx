import { FileDiff } from '@pierre/diffs/react';
import type { ReactNode } from 'react';
import { hasLineCounts, type ReviewFile } from '../lib/types';
import { formatByteDelta, formatBytes, modeName, splitPath } from '../lib/path';
import { useStuck } from '../lib/useStuck';
import { diffHostStyle, diffOptions, type DiffStyle } from '../theme/diffs';
import { FileTypeIcon, IconArrowRight, IconChevronDown, IconComment } from './Icons';
import { Badge, Button, Counts, ViewedToggle } from './ui';
import s from './FileCard.module.css';

interface FileCardProps {
  file: ReviewFile;
  diffStyle: DiffStyle;
  viewed: boolean;
  collapsed: boolean;
  /** Generated, deleted and very large files start folded until revealed. */
  revealed: boolean;
  onViewedChange: (viewed: boolean) => void;
  onToggleCollapsed: () => void;
  onReveal: () => void;
  /** Changed since the reader last saw it. */
  updated?: boolean;
  /** Bumped each time the file changes, to replay the card's highlight. */
  pulse?: number;
}

export function FileCard({
  file,
  diffStyle,
  viewed,
  collapsed,
  revealed,
  onViewedChange,
  onToggleCollapsed,
  onReveal,
  updated = false,
  pulse = 0,
}: FileCardProps) {
  const { sentinel, stuck } = useStuck<HTMLDivElement>();
  const excluded = file.status === 'generated';

  return (
    <section
      id={`file-${file.id}`}
      className={`${s.card} ${collapsed ? s.collapsedCard : ''} ${viewed ? s.viewedCard : ''}`}
      aria-label={file.path}
      data-file-card
      data-collapsed={collapsed || undefined}
    >
      <div ref={sentinel} className={s.sentinel} aria-hidden="true" />
      {/* Remounted on every change, so the ring plays once each time. */}
      {pulse > 0 && <span key={pulse} className={s.pulse} aria-hidden="true" />}
      <header className={`${s.header} ${stuck && !collapsed ? s.stuck : ''}`}>
        <div className={s.title} title={file.prevPath ? `${file.prevPath} → ${file.path}` : file.path}>
          <span className={s.icon}>
            <FileTypeIcon path={file.path} />
          </span>
          <FileTitle file={file} />
          <span className={s.badges}>
            {updated && (
              <Badge tone="accent" title="Changed since you last saw it">
                Updated
              </Badge>
            )}
            <StatusBadge file={file} />
            {file.mode && <ModeBadge before={file.mode.before} after={file.mode.after} />}
            {file.uncommitted && file.status !== 'generated' && (
              <Badge tone="muted" title="Some of these changes aren't committed yet">
                Uncommitted
              </Badge>
            )}
          </span>
        </div>

        <div className={s.actions}>
          {hasLineCounts(file) && (
            <span className={`${s.counts} ${excluded ? s.countsMuted : ''}`}>
              <Counts additions={file.additions} deletions={file.deletions} />
            </span>
          )}
          <Button variant="ghost" size="sm" iconOnly title="Comment on file" aria-label="Comment on file">
            <IconComment size="var(--size-icon-sm)" />
          </Button>
          {/* Generated files don't count toward viewed. A hidden toggle keeps every header's controls lined up. */}
          <span className={excluded ? s.placeholder : undefined} aria-hidden={excluded || undefined}>
            <ViewedToggle checked={viewed} onChange={onViewedChange} disabled={excluded} />
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className={s.toggle}
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand file' : 'Collapse file'}
            title={collapsed ? 'Unfold (Z)' : 'Fold (Z)'}
          >
            <IconChevronDown size="var(--size-icon-sm)" />
          </Button>
        </div>
      </header>

      <div className={s.bodyWrap} aria-hidden={collapsed}>
        <div className={s.body} inert={collapsed}>
          <FileBody file={file} diffStyle={diffStyle} revealed={revealed} onReveal={onReveal} />
        </div>
      </div>
    </section>
  );
}

/** File name, then its folder dimmed. A renamed file reads `old/path → new/path`. */
function FileTitle({ file }: { file: ReviewFile }) {
  const next = splitPath(file.path);
  if (!file.prevPath) {
    return (
      <span className={s.path}>
        <span className={s.name}>{next.name}</span>
        {next.dir && (
          <span className={s.dir}>
            <bdi>{next.dir.replace(/\/$/, '')}</bdi>
          </span>
        )}
      </span>
    );
  }

  const prev = splitPath(file.prevPath);
  // Same folder: only the name changed, so show the folder once.
  if (prev.dir === next.dir) {
    return (
      <span className={s.path}>
        <span className={s.prevName}>{prev.name}</span>
        <IconArrowRight className={s.renameArrow} size="var(--size-icon-xs)" />
        <span className={s.name}>{next.name}</span>
        {next.dir && (
          <span className={s.dir}>
            <bdi>{next.dir.replace(/\/$/, '')}</bdi>
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={s.path}>
      <span className={s.prevPath}>
        <bdi>
          {prev.dir}
          <span className={s.prevPathName}>{prev.name}</span>
        </bdi>
      </span>
      <IconArrowRight className={s.renameArrow} size="var(--size-icon-xs)" />
      <span className={s.nextPath}>
        <span className={s.nextDir}>{next.dir}</span>
        <span className={s.name}>{next.name}</span>
      </span>
    </span>
  );
}

function StatusBadge({ file }: { file: ReviewFile }) {
  if (file.submodule) return <Badge>Submodule</Badge>;
  switch (file.status) {
    case 'added':
      return <Badge tone="added">New</Badge>;
    case 'deleted':
      return <Badge tone="removed">Deleted</Badge>;
    case 'renamed':
      return <Badge tone="renamed">Renamed</Badge>;
    case 'binary':
      return <Badge>Binary</Badge>;
    case 'generated':
      return (
        <Badge tone="muted" title="Lockfiles, minified files and files marked linguist-generated">
          Generated
        </Badge>
      );
    default:
      return null;
  }
}

function ModeBadge({ before, after }: { before: string; after: string }) {
  return (
    <Badge mono title={`Mode changed from ${modeName(before)} to ${modeName(after)}`}>
      {before}
      <IconArrowRight size="var(--size-icon-xs)" />
      {after}
    </Badge>
  );
}

function FileBody({
  file,
  diffStyle,
  revealed,
  onReveal,
}: {
  file: ReviewFile;
  diffStyle: DiffStyle;
  revealed: boolean;
  onReveal: () => void;
}) {
  if (file.status === 'generated' && !revealed) {
    return (
      <Folded action={<RevealButton onClick={onReveal}>Show diff</RevealButton>}>
        <strong>Generated file.</strong> Folded and left out of viewed progress.
      </Folded>
    );
  }

  if (file.submodule) return <SubmoduleBody before={file.submodule.before} after={file.submodule.after} />;
  if (file.size) return <BinaryBody before={file.size.before} after={file.size.after} />;

  if (file.status === 'deleted' && !revealed && file.deletions > 0) {
    return (
      <Folded action={<RevealButton onClick={onReveal}>Show lines</RevealButton>}>
        <strong>File deleted.</strong> <span className={s.figure}>{plural(file.deletions, 'line')}</span> removed.
      </Folded>
    );
  }

  if (file.large && !revealed) {
    return (
      <Folded action={<RevealButton onClick={onReveal}>Load diff</RevealButton>}>
        <strong>Large diff.</strong>{' '}
        <span className={s.figure}>{plural(file.additions + file.deletions, 'changed line')}</span> folded to keep
        scrolling smooth.
      </Folded>
    );
  }

  if (!file.diff || file.diff.hunks.length === 0) return <NoLineChanges file={file} />;

  return (
    <FileDiff
      className={s.diff}
      fileDiff={file.diff}
      options={diffOptions(diffStyle)}
      style={diffHostStyle}
      disableWorkerPool
    />
  );
}

/** A file whose change has no lines to show: an empty file, a pure rename or a mode change. */
function NoLineChanges({ file }: { file: ReviewFile }) {
  const mode = file.mode ? modeSentence(file.mode.before, file.mode.after) : null;
  if (file.status === 'added') return <Folded>{mode ?? <><strong>Empty file.</strong> Nothing in it yet.</>}</Folded>;
  if (file.status === 'deleted') return <Folded><strong>Empty file deleted.</strong></Folded>;
  if (file.status === 'renamed') {
    return (
      <Folded>
        <strong>Moved without changes.</strong>
        {mode && <> {mode}</>}
      </Folded>
    );
  }
  return <Folded>{mode ?? <strong>No line changes.</strong>}</Folded>;
}

function modeSentence(before: string, after: string): ReactNode {
  const from = modeName(before);
  const to = modeName(after);
  const words = from === before || to === after ? null : (
    <>
      {' '}
      It was {article(from)} {from} and is now {article(to)} {to}.
    </>
  );
  return (
    <>
      <strong>Mode changed</strong> from <code className={s.code}>{before}</code> to{' '}
      <code className={s.code}>{after}</code>.{words}
    </>
  );
}

function BinaryBody({ before, after }: { before: number | null; after: number | null }) {
  const delta = before !== null && after !== null ? formatByteDelta(before, after) : null;
  return (
    <Folded>
      <strong>{before === null ? 'New binary file.' : after === null ? 'Binary file deleted.' : 'Binary file.'}</strong>{' '}
      <span className={s.figure}>
        {before !== null && formatBytes(before)}
        {before !== null && after !== null && <IconArrowRight className={s.inlineArrow} size="var(--size-icon-xs)" />}
        {after !== null && formatBytes(after)}
      </span>
      {delta && <span className={after! > before! ? s.grew : s.shrank}> {delta}</span>}
    </Folded>
  );
}

function SubmoduleBody({ before, after }: { before: string | null; after: string | null }) {
  const sha = (value: string) => <code className={s.code}>{value.slice(0, 7)}</code>;
  if (before && after) {
    return (
      <Folded>
        <strong>Submodule moved</strong> from {sha(before)} to {sha(after)}.
      </Folded>
    );
  }
  if (after) {
    return (
      <Folded>
        <strong>Submodule added</strong> at {sha(after)}.
      </Folded>
    );
  }
  return (
    <Folded>
      <strong>Submodule removed</strong>
      {before && <> from {sha(before)}</>}.
    </Folded>
  );
}

function Folded({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.folded}>
      <p className={s.foldedText}>{children}</p>
      {action}
    </div>
  );
}

function RevealButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}
