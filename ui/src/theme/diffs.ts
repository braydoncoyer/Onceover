import { registerCustomTheme, type FileDiffOptions } from '@pierre/diffs';
import type { CSSProperties } from 'react';

/*
 * Pierre's diff renderer lives in a shadow root. Custom properties inherit
 * through it, so every color and size below is a reference to a token in
 * styles/tokens.css. Nothing here holds a literal value.
 */

export const THEME_NAME = 'onceover-dark';

const v = (name: string) => `var(--syntax-${name})`;

const syntaxTheme = {
  name: THEME_NAME,
  type: 'dark' as const,
  colors: {
    'editor.foreground': v('foreground'),
    'editor.background': 'var(--color-diff-bg)',
  },
  tokenColors: [
    { settings: { foreground: v('foreground') } },
    {
      scope: ['comment', 'punctuation.definition.comment', 'comment.block.documentation'],
      settings: { foreground: v('comment') },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'keyword.operator.new',
        'keyword.operator.expression',
        'keyword.operator.type',
        'storage.type',
        'storage.type.function.arrow',
      ],
      settings: { foreground: v('keyword') },
    },
    {
      scope: [
        'storage.modifier',
        'keyword.control.export',
        'keyword.control.import',
        'keyword.control.from',
        'keyword.control.as',
        'keyword.control.default',
      ],
      settings: { foreground: v('modifier') },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.other.inherited-class',
        'support.type',
        'support.class',
        'support.type.primitive',
        'support.class.component',
        'entity.name.type.alias',
        'entity.name.type.interface',
      ],
      settings: { foreground: v('type') },
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'meta.function-call entity.name.function',
        'variable.function',
      ],
      settings: { foreground: v('function') },
    },
    {
      scope: [
        'meta.definition.variable variable.other.constant',
        'meta.definition.variable variable.other.readwrite',
        'variable.other.constant.ts',
        'variable.other.constant.tsx',
      ],
      settings: { foreground: v('variable') },
    },
    {
      scope: ['variable.parameter', 'meta.parameters variable'],
      settings: { foreground: v('parameter') },
    },
    {
      scope: [
        'variable.other.property',
        'variable.other.object.property',
        'meta.object-literal.key',
        'support.variable.property',
        'meta.object.member',
      ],
      settings: { foreground: v('property') },
    },
    {
      scope: ['string', 'punctuation.definition.string', 'string.template'],
      settings: { foreground: v('string') },
    },
    {
      scope: [
        'punctuation.definition.template-expression',
        'punctuation.section.embedded',
      ],
      settings: { foreground: v('keyword') },
    },
    { scope: ['constant.numeric'], settings: { foreground: v('number') } },
    {
      scope: ['constant.language', 'constant.character', 'support.constant'],
      settings: { foreground: v('constant') },
    },
    {
      scope: ['entity.name.tag', 'punctuation.definition.tag'],
      settings: { foreground: v('tag') },
    },
    { scope: ['entity.other.attribute-name'], settings: { foreground: v('attribute') } },
    {
      scope: [
        'punctuation',
        'meta.brace',
        'punctuation.separator',
        'punctuation.terminator',
        'punctuation.accessor',
      ],
      settings: { foreground: v('punctuation') },
    },
    {
      scope: ['keyword.operator', 'keyword.operator.assignment'],
      settings: { foreground: v('operator') },
    },
  ],
};

let registered = false;
export function registerSyntaxTheme() {
  if (registered) return;
  registered = true;
  registerCustomTheme(THEME_NAME, () => Promise.resolve(syntaxTheme));
}

/** Custom properties set on each diff host element. */
export const diffHostStyle = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-header-font-family': 'var(--font-ui)',
  '--diffs-font-size': 'var(--text-code)',
  '--diffs-line-height': 'var(--leading-code)',
  '--diffs-font-features': 'var(--font-features-mono)',
  '--diffs-gap-block': 'var(--space-2)',
  '--diffs-gap-inline': 'var(--space-3)',
  '--diffs-tab-size': '2',
  '--diffs-dark-bg': 'var(--color-diff-bg)',
  '--diffs-addition-color-override': 'var(--color-added)',
  '--diffs-deletion-color-override': 'var(--color-removed)',
  '--diffs-modified-color-override': 'var(--color-accent)',
  '--diffs-fg-number-override': 'var(--color-diff-line-number)',
  '--diffs-fg-number-addition-override': 'var(--color-diff-line-number-added)',
  '--diffs-fg-number-deletion-override': 'var(--color-diff-line-number-removed)',
  '--diffs-bg-context-override': 'var(--color-diff-context)',
  '--diffs-bg-separator-override': 'var(--color-diff-separator)',
  '--diffs-bg-buffer-override': 'var(--color-diff-buffer)',
  '--diffs-bg-addition-emphasis-override': 'var(--color-diff-added-word)',
  '--diffs-bg-deletion-emphasis-override': 'var(--color-diff-removed-word)',
  '--diffs-bg-selection-override': 'var(--color-accent)',
  '--diffs-selection-number-fg': 'var(--color-selected-number)',
} as CSSProperties;

/*
 * Structural overrides inside Pierre's shadow root. The `unsafe` layer wins
 * over Pierre's own layers, so these set the final look.
 */
const unsafeCSS = /* css */ `
  :host {
    background-color: var(--color-diff-bg);
    font-variant-numeric: var(--font-numeric);
  }

  pre, code, [data-gutter], [data-content] {
    background-color: var(--color-diff-bg);
  }

  [data-code] {
    padding-block: var(--space-2);
  }

  /* Line tints: flat, low-saturation, same tint across gutter and code. */
  [data-line][data-line-type=change-addition],
  [data-column-number][data-line-type=change-addition],
  [data-gutter-buffer][data-line-type=change-addition],
  [data-no-newline][data-line-type=change-addition] {
    --diffs-computed-diff-line-bg: var(--color-diff-added-bg);
  }
  [data-line][data-line-type=change-deletion],
  [data-column-number][data-line-type=change-deletion],
  [data-gutter-buffer][data-line-type=change-deletion],
  [data-no-newline][data-line-type=change-deletion] {
    --diffs-computed-diff-line-bg: var(--color-diff-removed-bg);
  }

  [data-line][data-hovered],
  [data-column-number][data-hovered] {
    --diffs-computed-hovered-line-bg: color-mix(in srgb, var(--diffs-computed-editor-active-line-bg), var(--color-text) 3%);
  }

  /* Gutter: dim numbers, no divider, the 2 px change bar at the far left. */
  [data-gutter] [data-gutter-buffer],
  [data-gutter] [data-column-number] {
    border-right: 0;
  }
  [data-column-number] {
    padding-left: var(--space-5);
    padding-right: var(--space-4);
    color: var(--color-diff-line-number);
  }
  [data-column-number][data-line-type=change-addition] {
    color: var(--color-diff-line-number-added);
  }
  [data-column-number][data-line-type=change-deletion] {
    color: var(--color-diff-line-number-removed);
  }
  /* Unified view: removed lines show a minus in place of the old line number, as in the mockup. */
  pre:not([data-diff-type=split]) [data-column-number][data-line-type=change-deletion] [data-line-number-content] {
    color: transparent;
  }
  pre:not([data-diff-type=split]) [data-column-number][data-line-type=change-deletion] [data-line-number-content]::after {
    content: '\\2212';
    position: absolute;
    inset-inline-end: 0;
    color: var(--color-diff-line-number-removed);
  }
  [data-indicators=bars] [data-line-type=change-addition][data-column-number]::before,
  [data-indicators=bars] [data-line-type=change-deletion][data-column-number]::before {
    width: var(--size-bar);
    background-image: none;
  }
  [data-indicators=bars] [data-line-type=change-addition][data-column-number]::before {
    background-color: var(--color-diff-added-bar);
  }
  [data-indicators=bars] [data-line-type=change-deletion][data-column-number]::before {
    background-color: var(--color-diff-removed-bar);
  }

  [data-line] {
    padding-inline: var(--space-1) var(--space-4);
  }

  /*
   * Word-level changes: a brighter rounded pill over the line tint. The pill
   * is drawn a little wider than its words, as in the Linear mockup, without
   * moving any text: it sits behind the line's text in its own layer.
   */
  [data-line] {
    isolation: isolate;
  }
  [data-diff-span] {
    position: relative;
    background-color: transparent;
  }
  [data-diff-span]::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset-block: var(--size-word-pill-block);
    inset-inline: calc(var(--size-word-pill-inline) * -1);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }
  [data-line-type=change-addition] [data-diff-span]::before {
    background-color: var(--color-diff-added-word);
  }
  [data-line-type=change-deletion] [data-diff-span]::before {
    background-color: var(--color-diff-removed-word);
  }

  /* Folded context. */
  [data-separator=line-info],
  [data-separator=line-info-basic] {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    background-color: var(--color-diff-bg);
  }
  [data-separator-content],
  [data-expand-button] {
    background-color: var(--color-diff-separator);
    color: var(--color-diff-separator-text);
    transition: color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out);
  }
  [data-expand-button] {
    border-color: var(--color-diff-bg);
  }

  [data-expand-button]:hover,
  [data-expand-index] [data-separator-content]:hover {
    color: var(--color-text);
    background-color: var(--color-surface-raised);
    text-decoration: none;
  }

  /*
   * Lines picked for a comment: a soft accent wash over the line's own tint,
   * an accent bar at the edge and bright numbers. The comment rows under them
   * keep the plain background, so the box reads as sitting below the code.
   */
  [data-line][data-selected-line],
  [data-column-number][data-selected-line],
  [data-gutter-buffer][data-selected-line] {
    --diffs-computed-selected-line-bg: color-mix(in srgb, var(--diffs-computed-diff-line-bg), var(--color-accent) var(--mix-selected-line));
  }
  [data-line-annotation][data-selected-line],
  [data-gutter-buffer=annotation][data-selected-line] {
    --diffs-computed-selected-line-bg: var(--diffs-computed-diff-line-bg);
  }
  [data-column-number][data-selected-line],
  pre:not([data-diff-type=split]) [data-column-number][data-selected-line] [data-line-number-content]::after {
    color: var(--color-selected-number);
  }
  [data-indicators=bars] [data-column-number][data-selected-line]::before {
    width: var(--size-bar);
    background-image: none;
    background-color: var(--color-selected-bar);
  }

  /* The + that opens a comment, shown on hovering a line number. */
  [data-utility-button] {
    width: var(--size-gutter-button);
    height: var(--size-gutter-button);
    margin-block: calc((var(--leading-code) - var(--size-gutter-button)) / 2);
    margin-right: calc(var(--size-gutter-button) * -1 + 1ch);
    border-radius: var(--radius-sm);
    background-color: var(--color-gutter-button);
    color: var(--color-text-on-accent);
    box-shadow: var(--shadow-card);
    transition: background-color var(--duration-fast) var(--ease-out);
  }
  [data-utility-button]:hover {
    background-color: var(--color-gutter-button-hover);
  }
  [data-utility-button] [data-icon] {
    width: var(--size-icon-xs);
    height: var(--size-icon-xs);
  }

  [data-code]::-webkit-scrollbar-thumb {
    background-color: transparent;
  }
  [data-diff]:hover [data-code]::-webkit-scrollbar-thumb,
  [data-file]:hover [data-code]::-webkit-scrollbar-thumb {
    background-color: var(--color-hairline-strong);
  }
`;

export type DiffStyle = 'unified' | 'split';

export function diffOptions<LAnnotation = undefined>(diffStyle: DiffStyle): FileDiffOptions<LAnnotation, undefined> {
  return {
    theme: THEME_NAME,
    themeType: 'dark',
    diffStyle,
    diffIndicators: 'bars',
    lineDiffType: 'word-alt',
    hunkSeparators: 'line-info',
    disableFileHeader: true,
    overflow: 'scroll',
    collapsedContextThreshold: 3,
    // Folds up to this size open in one click; bigger ones open in steps.
    expansionLineCount: 20,
    unsafeCSS,
  };
}
