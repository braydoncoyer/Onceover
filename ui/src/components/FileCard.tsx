import { FileDiff } from '@pierre/diffs/react';
import type { ReviewFile } from '../lib/types';
import { formatBytes, splitPath } from '../lib/path';
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
  /** Generated, deleted and binary files start folded. */
  revealed: boolean;
  onViewedChange: (viewed: boolean) => void;
  onToggleCollapsed: () => void;
  onReveal: () => void;
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
}: FileCardProps) {
  const { sentinel, stuck } = useStuck<HTMLDivElement>();
  const { dir, name } = splitPath(file.path);
  const excluded = file.status === 'generated';

  return (
    <section
      id={`file-${file.id}`}
      className={`${s.card} ${collapsed ? s.collapsedCard : ''}`}
      aria-label={file.path}
    >
      <div ref={sentinel} className={s.sentinel} aria-hidden="true" />
      <header className={`${s.header} ${stuck && !collapsed ? s.stuck : ''}`}>
        <div className={s.title}>
          <span className={s.icon}>
            <FileTypeIcon path={file.path} />
          </span>
          <span className={s.name}>{name}</span>
          {file.prevPath ? (
            <span className={s.rename}>
              <span className={s.renameFrom}>{splitPath(file.prevPath).name}</span>
              <IconArrowRight size="var(--size-icon-xs)" />
              <span>{dir}</span>
            </span>
          ) : (
            <span className={s.dir}>
              <bdi>{dir.replace(/\/$/, '')}</bdi>
            </span>
          )}
          <span className={s.badges}>
            <StatusBadge file={file} />
          </span>
        </div>

        <div className={s.actions}>
          {file.status !== 'binary' && (
            <span className={s.counts}>
              <Counts additions={file.additions} deletions={file.deletions} />
            </span>
          )}
          <Button variant="ghost" size="sm" iconOnly title="Comment on file" aria-label="Comment on file">
            <IconComment size="var(--size-icon-sm)" />
          </Button>
          {!excluded && <ViewedToggle checked={viewed} onChange={onViewedChange} />}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className={s.toggle}
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand file' : 'Collapse file'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <IconChevronDown size="var(--size-icon-sm)" />
          </Button>
        </div>
      </header>

      <div className={s.bodyWrap} aria-hidden={collapsed}>
        <div className={s.body}>
          <FileBody file={file} diffStyle={diffStyle} revealed={revealed} onReveal={onReveal} />
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ file }: { file: ReviewFile }) {
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
      return <Badge tone="muted">Generated</Badge>;
    default:
      return file.origin === 'uncommitted' ? <Badge tone="muted">Uncommitted</Badge> : null;
  }
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
  if (file.status === 'binary' && file.size) {
    return (
      <div className={s.folded}>
        <span className={s.foldedText}>
          Binary file
          <span className={s.sizeChange}>
            {formatBytes(file.size.before)} → {formatBytes(file.size.after)}
          </span>
        </span>
      </div>
    );
  }

  if (file.status === 'generated' && !revealed) {
    return (
      <div className={s.folded}>
        <span className={s.foldedText}>
          <strong>Generated file.</strong> Hidden from review and not counted toward viewed.
        </span>
        <Button variant="secondary" size="sm" onClick={onReveal}>
          Show diff
        </Button>
      </div>
    );
  }

  if (file.status === 'deleted' && !revealed) {
    return (
      <div className={s.folded}>
        <span className={s.foldedText}>
          <strong>File deleted.</strong> {file.deletions} lines removed.
        </span>
        <Button variant="secondary" size="sm" onClick={onReveal}>
          Show lines
        </Button>
      </div>
    );
  }

  if (file.large && !revealed) {
    return (
      <div className={s.folded}>
        <span className={s.foldedText}>
          <strong>Large diff.</strong>
          <span className={s.sizeChange}>{(file.additions + file.deletions).toLocaleString()}</span> changed lines are
          folded to keep scrolling smooth.
        </span>
        <Button variant="secondary" size="sm" onClick={onReveal}>
          Load diff
        </Button>
      </div>
    );
  }

  if (!file.diff) return null;

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
