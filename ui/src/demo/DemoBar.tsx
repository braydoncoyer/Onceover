import { useEffect, useState } from 'react';
import { IconSparkle } from '../components/Icons';
import { Kbd } from '../components/ui';
import type { DemoServer } from './fakeServer';
import s from './DemoBar.module.css';

/**
 * The demo's own controls, floating apart from the app: plays the scripted
 * agent edits so live refresh has something to show, and starts over.
 */
export function DemoBar({ server }: { server: DemoServer }) {
  const [, rerender] = useState(0);
  useEffect(() => server.subscribe(() => rerender((n) => n + 1)), [server]);

  const next = server.nextLabel();
  const played = server.step();
  const total = server.steps();

  return (
    <div className={s.bar} role="region" aria-label="Demo controls">
      <span className={s.tag}>Demo</span>
      <span className={s.text}>
        Fake repo. Press <Kbd cap>?</Kbd> for shortcuts
      </span>
      <span className={s.divider} aria-hidden="true" />
      <button
        type="button"
        className={s.action}
        onClick={() => server.playNextEdit()}
        disabled={!next}
        title={next ? `The agent: ${next.toLowerCase()}` : 'The scripted edits have all played'}
      >
        <IconSparkle size="var(--size-icon-sm)" />
        {next ? 'Simulate an agent edit' : 'Agent finished'}
        <span className={s.count}>
          {played}/{total}
        </span>
      </button>
      <button type="button" className={s.reset} onClick={() => server.reset()} title="Start the demo over">
        Reset
      </button>
    </div>
  );
}
