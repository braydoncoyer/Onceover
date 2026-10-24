import { useState } from 'react';
import { Segmented } from '../components/ui';
import type { DiffStyle } from '../theme/diffs';
import { ReviewView } from './ReviewView';
import { StatesView } from './StatesView';
import { TokensView } from './TokensView';
import s from './Playground.module.css';

type View = 'review' | 'states' | 'tokens';

/*
 * URL params for screenshots: view=review|states|tokens, viewed=<ids>,
 * diff=split, rail=collapsed, file=<id> (scroll to), chrome=0 (hide switcher).
 */
const params = new URLSearchParams(window.location.search);

export function Playground() {
  const [view, setView] = useState<View>((params.get('view') as View) ?? 'review');
  const showSwitcher = params.get('chrome') !== '0';

  return (
    <div className={s.app}>
      {view === 'review' && (
        <ReviewView
          initialViewed={params.get('viewed')?.split(',').filter(Boolean) ?? []}
          initialDiffStyle={(params.get('diff') as DiffStyle) ?? 'unified'}
          initialRailCollapsed={params.get('rail') === 'collapsed'}
          initialFile={params.get('file') ?? undefined}
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
