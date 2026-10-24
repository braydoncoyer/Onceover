import { useState } from 'react';
import { Segmented } from '../components/ui';
import type { DiffStyle } from '../theme/diffs';
import { ReviewView } from '../components/ReviewView';
import { files, meta } from '../fixtures/diff';
import type { LiveStatus } from '../lib/live';
import { StatesView } from './StatesView';
import { TokensView } from './TokensView';
import s from './Playground.module.css';

type View = 'review' | 'states' | 'tokens';

/*
 * URL params for screenshots: view=review|states|tokens, viewed=<ids>,
 * diff=split, rail=collapsed, file=<id> (scroll to), chrome=0 (hide switcher),
 * updated=<ids> (changed since last seen), live=live|offline|paused.
 */
const params = new URLSearchParams(window.location.search);

export function Playground() {
  const [view, setView] = useState<View>((params.get('view') as View) ?? 'review');
  const showSwitcher = params.get('chrome') !== '0';

  return (
    <div className={s.app}>
      {view === 'review' && (
        <ReviewView
          meta={meta}
          files={files}
          initialViewed={params.get('viewed')?.split(',').filter(Boolean) ?? []}
          initialDiffStyle={(params.get('diff') as DiffStyle) ?? 'unified'}
          initialRailCollapsed={params.get('rail') === 'collapsed'}
          initialFile={params.get('file') ?? undefined}
          initialUpdated={params.get('updated')?.split(',').filter(Boolean) ?? []}
          live={(params.get('live') as LiveStatus | null) ?? undefined}
        />
      )}
      {view === 'states' && <StatesView />}
      {view === 'tokens' && <TokensView />}

      {showSwitcher && (
        <div className={s.switcher}>
          Playground
          <Segmented<View>
            label="Playground view"
            value={view}
            onChange={setView}
            options={[
              { value: 'review', label: 'Review' },
              { value: 'states', label: 'States' },
              { value: 'tokens', label: 'Tokens' },
            ]}
          />
        </div>
      )}
    </div>
  );
}
