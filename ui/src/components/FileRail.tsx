import { useEffect, useRef } from 'react';
import { hasLineCounts, type ReviewFile } from '../lib/types';
import { shortenMiddle } from '../lib/path';
import { IconCheck, IconChevronDown, IconComment, IconStatus } from './Icons';
import { CountBadge, Counts, Kbd } from './ui';
import s from './FileRail.module.css';

const PATH_BUDGET = 30;

const STATUS_LABEL: Record<ReviewFile['status'], string> = {
  modified: 'Modified',
  added: 'New file',
  deleted: 'Deleted',
  renamed: 'Renamed',
  binary: 'Binary',
  generated: 'Generated',
};

interface FileRailProps {
  files: ReviewFile[];
  currentId: string;
  viewed: Set<string>;
  /** Files changed since they were last seen, marked with a dot. */
  updated?: Set<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onShowShortcuts?: () => void;
  /** Show the keyboard hint at the bottom. */
  hint?: boolean;
}

export function FileRail({
  files,
  currentId,
  viewed,
  updated,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onShowShortcuts,
  hint = true,
}: FileRailProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the current file's row in sight as the stack scrolls.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  return (
    <nav className={`${s.rail} ${collapsed ? s.collapsed : ''}`} aria-label="Changed files">
      <button
        type="button"
        className={s.head}
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show files' : 'Hide files'}
      >
        <span className={s.headTitle}>Changes</span>
        <CountBadge>{files.length}</CountBadge>
        <IconChevronDown className={s.headChevron} size="var(--size-icon-sm)" />
      </button>

      <ul ref={listRef} className={s.list}>
        {files.map((file) => {
          const { dir, name } = shortenMiddle(file.path, PATH_BUDGET);
          const isViewed = viewed.has(file.id);
          const classes = [
            s.row,
            isViewed && s.isViewed,
            file.status === 'deleted' && s.isDeleted,
            file.status === 'generated' && s.isGenerated,
            updated?.has(file.id) && s.isUpdated,
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={file.id}>
              <button
                type="button"
                className={classes}
                aria-current={file.id === currentId}
                onClick={() => onSelect(file.id)}
                title={file.prevPath ? `${file.prevPath} → ${file.path}` : file.path}
              >
                <span className={s.path}>
                  <span className={s.dir}>{dir}</span>
                  <span className={s.name}>{name}</span>
                  {updated?.has(file.id) && <span className={s.updated} aria-label="Updated" title="Changed since you last saw it" />}
                </span>
                <span className={s.meta}>
                  {file.comments > 0 && (
                    <span className={s.comments} aria-label={`${file.comments} comments`}>
                      <IconComment size="var(--size-icon-xs)" />
                      {file.comments}
                    </span>
                  )}
                  {hasLineCounts(file) && (
                    <span className={s.counts}>
                      <Counts small additions={file.additions} deletions={file.deletions} />
                    </span>
                  )}
                  <span
                    className={`${s.status} ${isViewed ? s.viewedCheck : s[`status-${file.status}`]}`}
                    title={isViewed ? 'Viewed' : STATUS_LABEL[file.status]}
                  >
                    {isViewed ? (
                      <IconCheck size="var(--size-icon-sm)" />
                    ) : (
                      <IconStatus status={file.status} size="var(--size-icon-sm)" />
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {hint && (
        <div className={s.footer}>
          <span className={s.hint}>
            <Kbd cap>J</Kbd>
            <Kbd cap>K</Kbd>
            <span className={s.hintLabel}>files</span>
          </span>
          <span className={s.hint}>
            <Kbd cap>N</Kbd>
            <Kbd cap>P</Kbd>
            <span className={s.hintLabel}>changes</span>
          </span>
          <button type="button" className={s.help} onClick={onShowShortcuts} title="Keyboard shortcuts (?)">
            <Kbd cap>?</Kbd>
          </button>
        </div>
      )}
    </nav>
  );
}
