import type { LiveStatus } from '../lib/live';
import s from './LiveIndicator.module.css';

const LABEL: Record<LiveStatus, string> = {
  live: 'Live',
  offline: 'Offline',
  paused: 'Not watching',
};

const TITLE: Record<LiveStatus, string> = {
  live: 'Watching for changes. Edits show up here as they land.',
  offline: "Can't reach Onceover. Run it again in the repo and this tab picks it back up.",
  paused: "Couldn't watch this repo for changes. Reload to see new edits.",
};

/** Whether the page keeps up with the repo on its own: a dot and a word, in the header. */
export function LiveIndicator({ status, synced = 0 }: { status: LiveStatus; synced?: number }) {
  return (
    <span className={s.live} data-status={status} title={TITLE[status]} role="status">
      <span className={s.liveDot} aria-hidden="true">
        {/* Remounted on every refresh, so its ring plays once each time. */}
        {status === 'live' && synced > 0 && <span key={synced} className={s.ripple} />}
      </span>
      {LABEL[status]}
    </span>
  );
}
