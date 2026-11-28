import type { Node, ReactApi } from './page.js'

/** The props the sidebar panel list hands to its icon. */
export interface PanelIconProps {
  size?: number
  active?: boolean
}

/**
 * Build the sidebar entry icon.
 *
 * The rail paints it at one uniform size beside the shipped panels, so the
 * drawing stays inside a square viewBox and inherits the row's colour instead of
 * carrying its own.
 */
export function createStatsIcon(React: ReactApi): (props: PanelIconProps) => Node {
  const h = React.createElement
  const bar = (x: number, y: number, height: number, key: string): Node =>
    h('rect', { key, x, y, width: 3, height, rx: 1, fill: 'currentColor' })

  return function StatsIcon(props: PanelIconProps): Node {
    const size = props.size ?? 16
    return h(
      'svg',
      {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block', opacity: props.active === false ? 0.72 : 1 },
      },
      bar(2, 8.5, 5.5, 'two'),
      bar(6.5, 5.5, 8.5, 'one'),
      bar(11, 2.5, 11.5, 'three'),
    )
  }
}
