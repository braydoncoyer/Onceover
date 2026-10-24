import { useEffect, useState } from 'react';
import s from './TokensView.module.css';

const GROUPS: Array<{ label: string; tokens: string[] }> = [
  {
    label: 'Gray layers',
    tokens: [
      'color-bg',
      'color-bg-chrome',
      'color-surface',
      'color-surface-hover',
      'color-surface-raised',
      'color-surface-raised-hover',
      'color-hairline-soft',
      'color-hairline',
      'color-hairline-strong',
    ],
  },
  {
    label: 'Text',
    tokens: ['color-text-strong', 'color-text', 'color-text-secondary', 'color-text-tertiary', 'color-text-quaternary'],
  },
  {
    label: 'Ember',
    tokens: ['ember-100', 'ember-200', 'ember-300', 'ember-400', 'ember-900'],
  },
  {
    label: 'Accent and status',
    tokens: ['color-accent', 'color-added', 'color-removed', 'color-renamed', 'color-warning'],
  },
  {
    label: 'Diff tints',
    tokens: [
      'color-diff-added-bg',
      'color-diff-added-word',
      'color-diff-added-bar',
      'color-diff-removed-bg',
      'color-diff-removed-word',
      'color-diff-removed-bar',
      'color-diff-line-number',
      'color-diff-separator',
    ],
  },
  {
    label: 'Syntax',
    tokens: [
      'syntax-foreground',
      'syntax-comment',
      'syntax-keyword',
      'syntax-modifier',
      'syntax-type',
      'syntax-function',
      'syntax-variable',
      'syntax-parameter',
      'syntax-string',
      'syntax-number',
      'syntax-tag',
      'syntax-punctuation',
    ],
  },
];

function useTokenValues() {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const group of GROUPS) {
      for (const token of group.tokens) next[token] = style.getPropertyValue(`--${token}`).trim();
    }
    setValues(next);
  }, []);
  return values;
}

const TYPE: Array<{ label: string; size: string; weight: string; font: string }> = [
  { label: 'UI 14 medium', size: 'var(--text-lg)', weight: 'var(--weight-medium)', font: 'var(--font-ui)' },
  { label: 'UI 13', size: 'var(--text-md)', weight: 'var(--weight-regular)', font: 'var(--font-ui)' },
  { label: 'UI 12', size: 'var(--text-sm)', weight: 'var(--weight-regular)', font: 'var(--font-ui)' },
  { label: 'UI 11 medium', size: 'var(--text-xs)', weight: 'var(--weight-medium)', font: 'var(--font-ui)' },
  { label: 'Mono 13', size: 'var(--text-code)', weight: 'var(--weight-regular)', font: 'var(--font-mono)' },
];

export function TokensView() {
  const values = useTokenValues();
  return (
    <div className={s.page}>
      <div className={s.inner}>
        {GROUPS.map((group) => (
          <section key={group.label} className={s.group}>
            <h2 className={s.label}>{group.label}</h2>
            <div className={s.swatches}>
              {group.tokens.map((token) => (
                <div key={token} className={s.swatch}>
                  <div className={s.chip} style={{ background: `var(--${token})` }} />
                  <div className={s.meta}>
                    <span className={s.name}>--{token}</span>
                    <span className={s.value}>{values[token]}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className={s.group}>
          <h2 className={s.label}>Type</h2>
          <div className={s.type}>
            {TYPE.map((row) => (
              <div key={row.label} className={s.typeRow}>
                <span className={s.value}>{row.label}</span>
                <span style={{ fontSize: row.size, fontWeight: row.weight, fontFamily: row.font }}>
                  useRideHistory.ts changed 4 of 9 files · +34 -18
                </span>
              </div>
            ))}
            <div className={s.typeRow}>
              <span className={s.value}>Syntax</span>
              <div className={s.code}>
                <span style={{ color: 'var(--syntax-modifier)' }}>export </span>
                <span style={{ color: 'var(--syntax-keyword)' }}>const </span>
                <span style={{ color: 'var(--syntax-variable)' }}>waitingStatusById</span>
                <span style={{ color: 'var(--syntax-punctuation)' }}>: </span>
                <span style={{ color: 'var(--syntax-type)' }}>Map</span>
                <span style={{ color: 'var(--syntax-punctuation)' }}>&lt;</span>
                <span style={{ color: 'var(--syntax-type)' }}>string</span>
                <span style={{ color: 'var(--syntax-punctuation)' }}>&gt; = </span>
                <span style={{ color: 'var(--syntax-function)' }}>useComputed</span>
                <span style={{ color: 'var(--syntax-punctuation)' }}>(() </span>
                <span style={{ color: 'var(--syntax-keyword)' }}>=&gt; </span>
                <span style={{ color: 'var(--syntax-string)' }}>"Driver en route"</span>
                <span style={{ color: 'var(--syntax-punctuation)' }}>); </span>
                <span style={{ color: 'var(--syntax-comment)' }}>// 3 min</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
