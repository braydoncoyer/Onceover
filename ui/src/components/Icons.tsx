import type { CSSProperties, SVGProps } from 'react';

/*
 * One icon set on a 16 px grid: 1.5 px strokes with round joins, and a soft
 * tinted fill under the main shape so glyphs carry weight like Linear's.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

/** The low-opacity fill under an icon's main shape. */
const tint: CSSProperties = { fill: 'currentColor', fillOpacity: 'var(--opacity-icon-fill)' };

function Svg({ size = 'var(--size-icon)', children, style, ...rest }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconBranch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.5" cy="3.25" r="1.75" />
    <path d="M4.5 5v8.75" />
    <path d="M7.25 3.25h1.5a2.75 2.75 0 0 1 2.75 2.75v3.25" />
    <circle cx="11.5" cy="11" r="1.75" />
  </Svg>
);

export const IconCommit = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.5" style={tint} />
    <circle cx="8" cy="8" r="2.5" />
    <path d="M1.75 8h3.75M10.5 8h3.75" />
  </Svg>
);

export const IconRepo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.25 3.5a2 2 0 0 1 2-2h7.5V11H5.25a2 2 0 0 0-2 2V3.5Z" style={tint} />
    <path d="M3.25 12.75V3.5a2 2 0 0 1 2-2h7.5V11H5.25a1.75 1.75 0 0 0 0 3.5h7.5" />
    <path d="M6.25 4.75h3.5" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.25 3.75 10.5 8l-4.25 4.25" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.75 6.25 8 10.5l4.25-4.25" />
  </Svg>
);

export const IconCaretDown = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M4.4 6.25h7.2c.45 0 .68.54.36.86l-3.6 3.65a.5.5 0 0 1-.72 0L4.04 7.1a.5.5 0 0 1 .36-.86Z" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.75 8h10.5M9.25 4l4 4-4 4" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p} strokeWidth="1.75">
    <path d="M3.25 8.5 6.5 11.75 12.75 4.75" />
  </Svg>
);

export const IconComment = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M2.25 4.5a2.25 2.25 0 0 1 2.25-2.25h7a2.25 2.25 0 0 1 2.25 2.25v4.75a2.25 2.25 0 0 1-2.25 2.25H7.5l-3.25 2.5V11.5h0a2 2 0 0 1-2-2V4.5Z"
      style={tint}
    />
    <path d="M2.25 4.5a2.25 2.25 0 0 1 2.25-2.25h7a2.25 2.25 0 0 1 2.25 2.25v4.75a2.25 2.25 0 0 1-2.25 2.25H7.5l-3.25 2.5V11.5h0a2 2 0 0 1-2-2V4.5Z" />
  </Svg>
);

export const IconSidebar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 2.25h2.25v11.5H4A1.75 1.75 0 0 1 2.25 12V4A1.75 1.75 0 0 1 4 2.25Z" style={tint} />
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.75" />
    <path d="M6.25 2.25v11.5" />
  </Svg>
);

export const IconUnified = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" style={tint} />
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" />
    <path d="M5.25 6h5.5M5.25 8.5h5.5M5.25 11h3" />
  </Svg>
);

export const IconSplit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 2.25H8v11.5H4.5a2.25 2.25 0 0 1-2.25-2.25v-7A2.25 2.25 0 0 1 4.5 2.25Z" style={tint} />
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" />
    <path d="M8 2.25v11.5" />
  </Svg>
);

export const IconExpand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6 8 3l3 3M5 10l3 3 3-3" />
  </Svg>
);

export const IconCollapse = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 2.75 8 5.75l3-3M5 13.25l3-3 3 3" />
  </Svg>
);

export const IconPlusCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" style={tint} />
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5.5v5M5.5 8h5" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" style={tint} />
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" />
    <circle cx="5.75" cy="6.25" r="1" fill="currentColor" stroke="none" />
    <path d="m2.75 11.5 3.25-2.75 2.25 1.75 2-1.5 3 2.25" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.75" style={tint} />
    <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.75" />
    <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.98 2.6a1.17 1.17 0 0 1 2.04 0l5.06 9.1a1.17 1.17 0 0 1-1.02 1.73H2.94a1.17 1.17 0 0 1-1.02-1.73l5.06-9.1Z" style={tint} />
    <path d="M6.98 2.6a1.17 1.17 0 0 1 2.04 0l5.06 9.1a1.17 1.17 0 0 1-1.02 1.73H2.94a1.17 1.17 0 0 1-1.02-1.73l5.06-9.1Z" />
    <path d="M8 6.25v2.75" />
    <circle cx="8" cy="11" r=".9" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconSparkle = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M8 1.75c.3 0 .55.2.62.49l.6 2.42a2.25 2.25 0 0 0 1.62 1.62l2.42.6a.64.64 0 0 1 0 1.24l-2.42.6a2.25 2.25 0 0 0-1.62 1.62l-.6 2.42a.64.64 0 0 1-1.24 0l-.6-2.42a2.25 2.25 0 0 0-1.62-1.62l-2.42-.6a.64.64 0 0 1 0-1.24l2.42-.6a2.25 2.25 0 0 0 1.62-1.62l.6-2.42A.64.64 0 0 1 8 1.75Z" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" style={tint} />
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Svg>
);

/** Status glyph for a changed file: a tinted rounded square with a solid mark. */
export function IconStatus({
  status,
  ...p
}: IconProps & { status: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary' | 'generated' }) {
  return (
    <Svg {...p}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="3" style={tint} />
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="3" />
      {status === 'added' && <path d="M8 5.5v5M5.5 8h5" />}
      {status === 'deleted' && <path d="M5.5 8h5" />}
      {status === 'renamed' && <path d="M5.25 8h5.25M8.5 5.75 10.75 8 8.5 10.25" />}
      {(status === 'modified' || status === 'binary' || status === 'generated') && (
        <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
      )}
    </Svg>
  );
}

/** Solid language badge, after the Linear mockup's TS icon. */
export function FileTypeIcon({ path, size = 'var(--size-icon)' }: { path: string; size?: string }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png' || ext === 'jpg' || ext === 'gif' || ext === 'webp') return <IconImage size={size} />;
  if (path.endsWith('lock.json') || path.endsWith('.lock') || path.endsWith('lock.yaml')) {
    return <IconLock size={size} />;
  }
  const label = ext === 'tsx' ? 'TSX' : ext === 'ts' ? 'TS' : ext === 'json' ? '{}' : ext.slice(0, 3).toUpperCase();
  const long = label.length > 2;
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <rect x="1" y="1" width="14" height="14" rx="2.5" fill="currentColor" />
      <text
        x="13.9"
        y="13.6"
        textAnchor="end"
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: long ? 5.6 : 7.6,
          fontWeight: 700,
          letterSpacing: long ? '-0.04em' : '-0.03em',
          fill: 'var(--color-surface)',
        }}
      >
        {label}
      </text>
    </svg>
  );
}
