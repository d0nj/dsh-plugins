import type { DayRow, ModelRow, SessionRow, StatsPayload } from '../summary.js'
import { columnHeights, donutArcs, fractions, groupSmall, hitZones } from './chart.js'
import { formatBasis, formatDate, formatDayLabel, formatModel, formatMoment, formatPercent, formatPrice, formatTokens, formatUsd } from './format.js'

/** The slice of React a client half receives from the module envelope. */
export interface ReactApi {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void]
  useEffect(effect: () => undefined | (() => void), deps?: readonly unknown[]): void
}

/** A node the shell can render. */
export type Node = unknown

/** The pointer fields the time chart reads to map a cursor to a day. */
interface PointerLike {
  clientX: number
  currentTarget: { getBoundingClientRect(): { left: number; width: number } }
}

const ROUTE = 'd0nj-stats/summary'

const COLOR_LABEL = 'var(--dsw-alias-label-primary)'
const COLOR_MUTED = 'var(--dsw-alias-label-secondary)'
const COLOR_LINE = 'var(--dsw-alias-border-l1)'
const COLOR_LINE_SOFT = 'var(--dsw-alias-border-l2)'
const COLOR_SURFACE = 'var(--dsw-alias-bg-layer-1)'
const COLOR_ACCENT = 'var(--dsw-alias-brand-primary)'
const COLOR_WARN = 'var(--dsw-alias-state-warn-primary)'
const RADIUS = 'var(--d0nj-radius-md, 8px)'

const CLASS_SERIES = [
  { key: 'cacheRead', label: 'Cached input', color: 'var(--dsw-alias-brand-primary)' },
  { key: 'uncachedInput', label: 'Input', color: 'var(--dsw-alias-state-success-primary)' },
  { key: 'output', label: 'Output', color: 'var(--dsw-alias-state-warn-primary)' },
  { key: 'cacheWrite', label: 'Cache write', color: 'var(--dsw-alias-state-idle-primary)' },
] as const

const MODEL_COLORS = [
  'var(--dsw-alias-brand-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-button-info-fill)',
  'var(--dsw-alias-state-idle-primary)',
  'var(--dsw-alias-label-secondary)',
]

const MODEL_COLUMNS = 'minmax(0, 1fr) 82px 74px 88px 128px'
const SESSION_COLUMNS = 'minmax(0, 1fr) 68px 84px 78px'

/**
 * Build the page component.
 *
 * The component owns its request state: it reads the Host route on mount and on
 * every Refresh, and keeps the last payload while a newer one loads so numbers
 * never blank out under the user.
 */
export function createStatsPage(React: ReactApi): () => Node {
  const h = React.createElement

  const container: Record<string, unknown> = {
    display: 'flex',
    flexDirection: 'column',
    gap: '26px',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '960px',
    margin: '0 auto',
    padding: '30px 32px 64px',
    height: '100%',
    overflowY: 'auto',
    color: COLOR_LABEL,
    fontFamily: 'inherit',
  }

  const text = (value: string, style: Record<string, unknown>): Node =>
    h('div', { style: { minWidth: 0, ...style } }, value)

  const truncated = (value: string, style: Record<string, unknown>): Node =>
    h(
      'div',
      { title: value, style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style } },
      value,
    )

  const tile = (label: string, value: string, hint?: string, accent?: boolean): Node =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          padding: '13px 15px',
          background: COLOR_SURFACE,
          border: '1px solid ' + COLOR_LINE,
          borderRadius: RADIUS,
        },
      },
      text(label, { fontSize: '12px', color: COLOR_MUTED }),
      text(value, {
        fontSize: '21px',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        fontVariantNumeric: 'tabular-nums',
        color: accent === true ? COLOR_ACCENT : COLOR_LABEL,
      }),
      hint === undefined ? null : text(hint, { fontSize: '11px', color: COLOR_MUTED }),
    )

  const card = (title: string, body: Node): Node =>
    h(
      'section',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minWidth: 0,
          padding: '15px 16px 16px',
          border: '1px solid ' + COLOR_LINE,
          borderRadius: RADIUS,
        },
      },
      h('h2', { style: { margin: 0, fontSize: '12px', fontWeight: 600, color: COLOR_LABEL } }, title),
      body,
    )

  const swatch = (color: string): Node =>
    h('span', {
      style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: color, flex: '0 0 auto' },
    })

  const mixOf = (tokens: StatsPayload['totals']): readonly number[] =>
    CLASS_SERIES.map((series) => tokens[series.key])

  const tipCard = (title: string, lines: readonly string[], leftPercent: number): Node =>
    h(
      'div',
      {
        style: {
          position: 'absolute',
          left: Math.min(90, Math.max(10, leftPercent)) + '%',
          bottom: 'calc(100% + 8px)',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          padding: '7px 10px',
          borderRadius: 'var(--d0nj-radius-sm, 6px)',
          background: 'var(--dsw-alias-bg-overlay)',
          border: '1px solid ' + COLOR_LINE,
          color: COLOR_LABEL,
          fontSize: '11px',
          lineHeight: '1.45',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 5,
        },
      },
      h('div', { style: { fontWeight: 600 } }, title),
      ...lines.map((line, index) =>
        h('div', { key: String(index), style: { color: COLOR_MUTED, fontVariantNumeric: 'tabular-nums' } }, line),
      ),
    )

  const miniBar = (values: readonly number[], height: number): Node => {
    const segments = fractions(CLASS_SERIES.map((series, index) => ({ key: series.key, value: values[index] ?? 0 })))
    if (segments.length === 0) {
      return h('div', { style: { height: height + 'px', borderRadius: '3px', background: COLOR_LINE } })
    }
    return h(
      'div',
      {
        style: {
          display: 'flex',
          height: height + 'px',
          width: '100%',
          overflow: 'hidden',
          borderRadius: '3px',
          background: COLOR_LINE,
        },
      },
      ...segments.map((segment) => {
        const index = CLASS_SERIES.findIndex((series) => series.key === segment.key)
        return h('div', {
          key: segment.key,
          title: (CLASS_SERIES[index]?.label ?? segment.key) + ' · ' + formatTokens(segment.value) + ' · ' + formatPercent(segment.to - segment.from),
          style: {
            width: (segment.to - segment.from) * 100 + '%',
            background: CLASS_SERIES[index]?.color ?? COLOR_MUTED,
            borderRight: '1px solid ' + COLOR_SURFACE,
          },
        })
      }),
    )
  }

  const MixBar = (props: { values: readonly number[]; height: number; round: boolean; legend: boolean }): Node => {
    const [hover, setHover] = React.useState<string | undefined>(undefined)
    const total = props.values.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0)
    const segments = fractions(CLASS_SERIES.map((series, index) => ({ key: series.key, value: props.values[index] ?? 0 })))
    const active = segments.find((segment) => segment.key === hover)
    const activeClass = CLASS_SERIES.find((series) => series.key === hover)
    const radius = props.round ? props.height / 2 : 3
    const clear = (): void => setHover(undefined)
    const bar =
      segments.length === 0
        ? h('div', { style: { height: props.height + 'px', borderRadius: radius + 'px', background: COLOR_LINE } })
        : h(
            'div',
            {
              style: {
                display: 'flex',
                height: props.height + 'px',
                width: '100%',
                overflow: 'hidden',
                borderRadius: radius + 'px',
                background: COLOR_LINE,
              },
            },
            ...segments.map((segment) => {
              const series = CLASS_SERIES.find((candidate) => candidate.key === segment.key)
              return h('div', {
                key: segment.key,
                style: {
                  width: (segment.to - segment.from) * 100 + '%',
                  background: series?.color ?? COLOR_MUTED,
                  borderRight: '1px solid ' + COLOR_SURFACE,
                  filter: hover !== undefined && hover !== segment.key ? 'brightness(0.7)' : undefined,
                },
              })
            }),
          )
    return h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      h(
        'div',
        { style: { position: 'relative', width: '100%' } },
        bar,
        h(
          'div',
          { style: { position: 'absolute', left: 0, right: 0, top: '-9px', bottom: '-9px' } },
          ...hitZones(segments, 0.05).map((zone) =>
            h('div', {
              key: zone.key,
              onMouseEnter: () => setHover(zone.key),
              onMouseLeave: clear,
              style: {
                position: 'absolute',
                left: zone.from * 100 + '%',
                width: (zone.to - zone.from) * 100 + '%',
                top: 0,
                bottom: 0,
              },
            }),
          ),
        ),
        active === undefined || activeClass === undefined
          ? null
          : tipCard(
              activeClass.label,
              [formatTokens(active.value) + ' tokens', formatPercent(active.to - active.from) + ' of ' + formatTokens(total)],
              ((active.from + active.to) / 2) * 100,
            ),
      ),
      props.legend
        ? h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: '2px 14px' } },
            ...CLASS_SERIES.map((series, index) => {
              const value = props.values[index] ?? 0
              return h(
                'div',
                {
                  key: series.key,
                  onMouseEnter: () => setHover(series.key),
                  onMouseLeave: clear,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    padding: '2px 0',
                    cursor: 'default',
                    opacity: hover === undefined || hover === series.key ? 1 : 0.55,
                  },
                },
                swatch(series.color),
                h('span', { style: { color: COLOR_LABEL } }, series.label),
                h(
                  'span',
                  { style: { color: COLOR_MUTED, fontVariantNumeric: 'tabular-nums' } },
                  formatTokens(value) + ' · ' + formatPercent(total > 0 ? value / total : 0),
                ),
              )
            }),
          )
        : null,
    )
  }

  const DayChart = (props: { days: readonly DayRow[] }): Node => {
    const [hover, setHover] = React.useState<string | undefined>(undefined)
    const days = props.days
    const width = 320
    const height = 104
    const slot = width / Math.max(days.length, 1)
    const heights = columnHeights(days.map((day) => day.costUsd), height - 8)
    const activeIndex = days.findIndex((day) => day.date === hover)
    const active = activeIndex < 0 ? undefined : days[activeIndex]
    const labels = [days[0], days[Math.floor(days.length / 3)], days[Math.floor((days.length * 2) / 3)], days[days.length - 1]]
    return h(
      'div',
      { style: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px' } },
      active === undefined
        ? null
        : tipCard(
            formatDayLabel(active.date),
            [
              formatUsd(active.costUsd) + ' · ' + formatTokens(active.tokens.total) + ' tokens',
              active.sessions === 1 ? '1 session' : active.sessions + ' sessions',
            ],
            ((activeIndex + 0.5) / Math.max(days.length, 1)) * 100,
          ),
      h(
        'svg',
        {
          viewBox: '0 0 ' + width + ' ' + height,
          width: '100%',
          height: height,
          preserveAspectRatio: 'none',
          role: 'img',
          'aria-label': 'Estimated spend by day',
        },
        ...days.map((day, index) => {
          const dayHeight = heights[index] ?? 0
          const visible = dayHeight > 0 ? Math.max(dayHeight, 1.5) : 0
          const columnWidth = Math.max(slot * 0.68, 1.5)
          const dimmed = hover !== undefined && hover !== day.date
          return h('rect', {
            key: day.date,
            x: slot * index + (slot - columnWidth) / 2,
            y: height - 4 - visible,
            width: columnWidth,
            height: visible,
            rx: 1.5,
            fill: COLOR_ACCENT,
            opacity: hover === day.date ? 1 : dimmed ? 0.28 : index === days.length - 1 ? 1 : 0.6,
          })
        }),
        h('line', { x1: 0, y1: height - 3, x2: width, y2: height - 3, stroke: COLOR_LINE, strokeWidth: 1 }),
        h('rect', {
          x: 0,
          y: 0,
          width,
          height,
          fill: 'transparent',
          pointerEvents: 'all',
          onMouseMove: (event: PointerLike) => {
            const box = event.currentTarget.getBoundingClientRect()
            const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0
            const index = Math.min(days.length - 1, Math.max(0, Math.floor(ratio * days.length)))
            const day = days[index]
            setHover(day === undefined ? undefined : day.date)
          },
          onMouseLeave: () => setHover(undefined),
        }),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: COLOR_MUTED } },
        ...labels.map((day, index) => h('span', { key: String(index) }, day === undefined ? '' : formatDayLabel(day.date))),
      ),
    )
  }

  const ModelDonut = (props: { items: readonly { label: string; value: number; color: string }[]; center: string }): Node => {
    const [hover, setHover] = React.useState<string | undefined>(undefined)
    const items = props.items
    const total = items.reduce((sum, item) => sum + item.value, 0)
    const segments = fractions(items.map((item) => ({ key: item.label, value: item.value })))
    const arcs = donutArcs(segments, 56)
    const colors = new Map(items.map((item) => [item.label, item.color]))
    const active = items.find((item) => item.label === hover)
    return h(
      'div',
      { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 } },
      active === undefined
        ? null
        : tipCard(
            active.label,
            [formatUsd(active.value), formatPercent(total > 0 ? active.value / total : 0) + ' of ' + formatUsd(total)],
            24,
          ),
      h(
        'svg',
        { viewBox: '0 0 160 160', width: 148, height: 148, role: 'img', 'aria-label': 'Estimated spend by model', style: { flex: '0 0 auto' } },
        h('circle', { cx: 80, cy: 80, r: 56, fill: 'none', stroke: COLOR_LINE, strokeWidth: 15 }),
        h(
          'g',
          { transform: 'rotate(-90 80 80)' },
          ...arcs.map((arc) =>
            h('circle', {
              key: arc.key,
              cx: 80,
              cy: 80,
              r: 56,
              fill: 'none',
              stroke: colors.get(arc.key) ?? COLOR_MUTED,
              strokeWidth: hover === arc.key ? 18 : 15,
              strokeDasharray: arc.length + ' ' + Math.max(0, arc.circumference - arc.length),
              strokeDashoffset: -arc.offset,
              opacity: hover === undefined || hover === arc.key ? 1 : 0.35,
            }),
          ),
          ...donutArcs(hitZones(segments, 0.04), 56).map((arc) =>
            h('circle', {
              key: 'hit-' + arc.key,
              cx: 80,
              cy: 80,
              r: 56,
              fill: 'none',
              stroke: 'transparent',
              strokeWidth: 26,
              strokeDasharray: arc.length + ' ' + Math.max(0, arc.circumference - arc.length),
              strokeDashoffset: -arc.offset,
              pointerEvents: 'all',
              onMouseEnter: () => setHover(arc.key),
              onMouseLeave: () => setHover(undefined),
            }),
          ),
        ),
        h('text', { x: 80, y: 75, textAnchor: 'middle', fill: COLOR_MUTED, fontSize: 10 }, 'Estimated'),
        h('text', { x: 80, y: 94, textAnchor: 'middle', fill: COLOR_LABEL, fontSize: 17, fontWeight: 600 }, props.center),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '7px', minWidth: 0, flex: '1 1 auto' } },
        ...items.map((item) =>
          h(
            'div',
            {
              key: item.label,
              onMouseEnter: () => setHover(item.label),
              onMouseLeave: () => setHover(undefined),
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                minWidth: 0,
                opacity: hover === undefined || hover === item.label ? 1 : 0.55,
              },
            },
            swatch(item.color),
            h(
              'span',
              { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: COLOR_LABEL } },
              item.label,
            ),
            h(
              'span',
              { style: { color: COLOR_MUTED, fontVariantNumeric: 'tabular-nums' } },
              formatUsd(item.value) + ' · ' + formatPercent(total > 0 ? item.value / total : 0),
            ),
          ),
        ),
      ),
    )
  }

  const table = <T,>(
    columns: readonly string[],
    template: string,
    rightAligned: ReadonlySet<number>,
    items: readonly T[],
    keyOf: (item: T) => string,
    renderRow: (item: T) => readonly Node[],
  ): Node =>
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column' } },
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: template, paddingBottom: '7px', fontSize: '11px', fontWeight: 500, color: COLOR_MUTED } },
        ...columns.map((label, index) => h('div', { key: label, style: { textAlign: rightAligned.has(index) ? 'right' : 'left' } }, label)),
      ),
      ...items.map((item) =>
        h(
          'div',
          {
            key: keyOf(item),
            style: {
              display: 'grid',
              gridTemplateColumns: template,
              alignItems: 'center',
              gap: '8px',
              padding: '9px 0',
              borderTop: '1px solid ' + COLOR_LINE,
              fontSize: '13px',
            },
          },
          ...renderRow(item),
        ),
      ),
    )

  const modelRow = (row: ModelRow): readonly Node[] => {
    const pricing = formatBasis(row.basis, row.sample)
    const unit = row.price === null ? undefined : formatPrice(row.price) + ' per million'
    return [
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
        truncated(formatModel(row.provider, row.model), {}),
        text(row.sessions === 1 ? '1 session' : row.sessions + ' sessions', { fontSize: '11px', color: COLOR_MUTED }),
      ),
      text(formatTokens(row.tokens.total), { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      text(row.price === null ? '—' : formatUsd(row.costUsd), {
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        color: row.price === null ? COLOR_MUTED : COLOR_LABEL,
      }),
      h('div', { style: { minWidth: 0 } }, miniBar(mixOf(row.tokens), 8)),
      h(
        'div',
        {
          title: unit,
          style: { fontSize: '11px', color: COLOR_MUTED, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        },
        pricing,
      ),
    ]
  }

  const sessionRow = (row: SessionRow, largest: number): readonly Node[] => {
    const share = largest > 0 ? row.tokens.total / largest : 0
    return [
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 } },
        truncated(row.title ?? row.id, {}),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 } },
          text(row.workspace ?? '', {
            fontSize: '11px',
            color: COLOR_MUTED,
            flex: '0 1 auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }),
          h(
            'div',
            { style: { flex: '0 1 84px', height: '3px', borderRadius: '2px', background: COLOR_LINE, overflow: 'hidden' } },
            h('div', { style: { width: formatPercent(share), height: '100%', background: COLOR_ACCENT, opacity: 0.75 } }),
          ),
        ),
      ),
      text(formatDate(row.createdAt), { textAlign: 'right', fontSize: '12px', color: COLOR_MUTED, fontVariantNumeric: 'tabular-nums' }),
      text(formatTokens(row.tokens.total), { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      text(row.basis === null ? '—' : formatUsd(row.costUsd), {
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        color: row.basis === null ? COLOR_MUTED : COLOR_LABEL,
      }),
    ]
  }

  const withPageDefaults = (payload: StatsPayload): StatsPayload => ({
    ...payload,
    days: Array.isArray(payload.days) ? payload.days : [],
    scan: payload.scan ?? { scanned: 0, total: 0, running: false },
  })

  const loaded = (incoming: StatsPayload): Node => {
    const payload = withPageDefaults(incoming)
    const priceNote = payload.price.available
      ? 'models.dev' + (payload.price.fetchedAt === null ? '' : ' · ' + formatMoment(payload.price.fetchedAt))
      : 'unavailable — tokens only'
    const coverage =
      payload.scannedSessions === payload.countedSessions
        ? payload.countedSessions + ' sessions'
        : payload.countedSessions + ' of ' + payload.scannedSessions + ' sessions recorded usage'
    const totalTokens = payload.totals.total
    const uncached = payload.totals.uncachedInput
    const mix = mixOf(payload.totals)
    const hitRate = totalTokens > 0 ? payload.totals.cacheRead / Math.max(1, payload.totals.cacheRead + uncached) : 0
    const priced = payload.models.filter((row) => row.price !== null && row.costUsd > 0)
    const sliceItems = groupSmall(
      priced.map((row) => ({ key: formatModel(row.provider, row.model), value: row.costUsd })),
      6,
    ).map((slice, index) => ({
      label: slice.key === 'other' ? 'All other models' : slice.key,
      value: slice.value,
      color: slice.key === 'other' ? COLOR_LINE_SOFT : MODEL_COLORS[index % MODEL_COLORS.length] ?? COLOR_ACCENT,
    }))
    const largest = payload.top[0]?.tokens.total ?? 0

    return h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '26px' } },
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' } },
        tile('Estimated spend', formatUsd(payload.costUsd), priceNote, true),
        tile('Total tokens', formatTokens(totalTokens), coverage),
        tile('Cached input', formatTokens(payload.totals.cacheRead), formatPercent(hitRate) + ' cache hit rate'),
        tile('Input', formatTokens(uncached), 'uncached'),
        tile('Output', formatTokens(payload.totals.output), 'completions'),
      ),
      card(
        'Token mix',
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
          h(MixBar, { values: mix, height: 12, round: true, legend: true }),
        ),
      ),
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' } },
        card(
          'Spend by model',
          sliceItems.length === 0
            ? text('No priced model usage yet.', { fontSize: '12px', color: COLOR_MUTED })
            : h(ModelDonut, { items: sliceItems, center: formatUsd(payload.costUsd) }),
        ),
        payload.days.length === 0
          ? null
          : card(
              'Spend by day',
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                h(DayChart, { days: payload.days }),
                text('Calls dated from their Session log; Sessions outside the scan count on their start day.', {
                  fontSize: '10px',
                  color: COLOR_MUTED,
                }),
              ),
            ),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('h2', { style: { margin: 0, fontSize: '13px', fontWeight: 600 } }, 'By model'),
        payload.models.length === 0
          ? text('No model usage recorded yet.', { fontSize: '13px', color: COLOR_MUTED })
          : table(['Model', 'Tokens', 'Cost', 'Mix', 'Pricing'], MODEL_COLUMNS, new Set([1, 2, 3, 4]), payload.models, (row) => formatModel(row.provider, row.model) + row.sessions, modelRow),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('h2', { style: { margin: 0, fontSize: '13px', fontWeight: 600 } }, 'Top sessions'),
        payload.top.length === 0
          ? text('No session usage recorded yet.', { fontSize: '13px', color: COLOR_MUTED })
          : table(['Session', 'When', 'Tokens', 'Cost'], SESSION_COLUMNS, new Set([1, 2, 3]), payload.top, (row) => row.id, (row) => sessionRow(row, largest)),
      ),
      text(
        coverage +
          (payload.unpricedSessions === 0 ? '' : ' · ' + payload.unpricedSessions + ' sessions priced at no known rate') +
          (payload.scan.total === 0 || payload.scan.scanned >= payload.scan.total
            ? ''
            : ' · call-level detail for the ' + payload.scan.scanned + ' largest of ' + payload.scan.total) +
          ' · last ' + payload.days.length + ' days charted',
        { fontSize: '11px', color: COLOR_MUTED },
      ),
    )
  }

  return function StatsPage(): Node {
    const [payload, setPayload] = React.useState<StatsPayload | undefined>(undefined)
    const [error, setError] = React.useState<string | undefined>(undefined)
    const [pending, setPending] = React.useState(true)
    const [attempt, setAttempt] = React.useState(0)

    React.useEffect(() => {
      if (payload === undefined || payload.scan?.running !== true) return () => {}
      const timer = setTimeout(() => setAttempt((value) => value + 1), 1500)
      return () => clearTimeout(timer)
    }, [payload, attempt])

    React.useEffect(() => {
      let live = true
      const abort = new AbortController()
      fetch(new URL(ROUTE, document.baseURI).toString(), { signal: abort.signal, headers: { accept: 'application/json' } })
        .then(async (response) => {
          const body = (await response.json()) as StatsPayload | { error?: string }
          if (!live) return
          if (!response.ok) {
            setError((body as { error?: string }).error ?? 'HTTP ' + response.status)
            setPending(false)
            return
          }
          setPayload(withPageDefaults(body as StatsPayload))
          setError(undefined)
          setPending(false)
        })
        .catch((failure: unknown) => {
          if (!live) return
          setError(failure instanceof Error ? failure.message : String(failure))
          setPending(false)
        })
      return () => {
        live = false
        abort.abort()
      }
    }, [attempt])

    const status =
      error !== undefined
        ? text(error, { fontSize: '13px', color: COLOR_WARN })
        : payload === undefined
          ? text('Loading usage…', { fontSize: '13px', color: COLOR_MUTED })
          : null

    return h(
      'div',
      { style: container },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 } },
          h('h1', { style: { margin: 0, fontSize: '18px', fontWeight: 600, letterSpacing: '-0.01em' } }, 'Token usage'),
          payload === undefined || !payload.scan.running
            ? null
            : text('Reading ' + payload.scan.total + ' session logs…', { fontSize: '11px', color: COLOR_MUTED }),
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: pending,
            onClick: () => {
              setPending(true)
              setAttempt((value) => value + 1)
            },
            style: {
              flex: '0 0 auto',
              padding: '5px 11px',
              fontSize: '12px',
              fontWeight: 500,
              color: COLOR_LABEL,
              background: COLOR_SURFACE,
              border: '1px solid ' + COLOR_LINE,
              borderRadius: RADIUS,
              cursor: pending ? 'default' : 'pointer',
              opacity: pending ? 0.6 : 1,
            },
          },
          pending ? 'Refreshing…' : 'Refresh',
        ),
      ),
      status,
      payload === undefined ? null : loaded(payload),
    )
  }
}
