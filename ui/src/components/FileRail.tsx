import type { ReviewFile } from '../fixtures/diff';
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
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
}

export function FileRail({ files, currentId, viewed, collapsed, onToggleCollapsed, onSelect }: FileRailProps) {
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

      <ul className={s.list}>
        {files.map((file) => {
          const { dir, name } = shortenMiddle(file.path, PATH_BUDGET);
          const isViewed = viewed.has(file.id);
          const classes = [s.row, isViewed && s.isViewed, file.status === 'deleted' && s.isDeleted]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={file.id}>
              <button
                type="button"
                className={classes}
                aria-current={file.id === currentId}
                onClick={() => onSelect(file.id)}
                title={file.path}
              >
                <span className={s.path}>
                  <span className={s.dir}>{dir}</span>
                  <span className={s.name}>{name}</span>
                </span>
                <span className={s.meta}>
                  {file.comments > 0 && (
                    <span className={s.comments} aria-label={`${file.comments} comments`}>
                      <IconComment size="var(--size-icon-xs)" />
                      {file.comments}
                    </span>
                  )}
                  {file.status !== 'binary' && (
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

      <div className={s.footer}>
        <Kbd>J</Kbd>
        <Kbd>K</Kbd>
        <span>to move between files</span>
      </div>
    </nav>
  );
}
