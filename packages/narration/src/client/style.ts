export const STYLE_ELEMENT_ID = 'd0nj-narration-style'

const TEXT_FAMILY = 'var(--dsw-font-family, inherit)'
const CODE_FAMILY =
  'var(--dsw-font-markdown-code-block-font-family, var(--dsw-font-markdown-code-font-family, var(--dsw-font-family, ui-monospace)))'
const CODE = 'var(--dsw-font-markdown-code-block, var(--dsw-font-markdown-code))'
const LINE = 'var(--dsw-alias-border-l1)'
const DIM = 'var(--dsw-alias-label-secondary)'
const INK = 'var(--dsw-alias-label-primary)'

export const CSS = `
.d0nj-narr {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
  font-family: ${TEXT_FAMILY};
  color: ${INK};
}
.d0nj-narr-live {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-family: ${TEXT_FAMILY};
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  color: ${DIM};
  text-align: left;
  cursor: pointer;
}
.d0nj-narr-live:focus-visible {
  outline: 2px solid ${INK};
  outline-offset: 2px;
}
.d0nj-narr-dot {
  flex: none;
  align-self: center;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--d0nj-narr-phase, var(--dsw-alias-state-idle-primary));
}
.d0nj-narr-live[data-working="true"] .d0nj-narr-dot { animation: d0nj-narr-pulse 1.6s ease-in-out infinite; }
.d0nj-narr-phase {
  flex: none;
  font-family: ${TEXT_FAMILY};
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.d0nj-narr-metrics {
  flex: none;
  display: flex;
  gap: 10px;
  margin-left: auto;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  font-variant-numeric: tabular-nums;
  color: ${DIM};
}
.d0nj-narr-calls {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.d0nj-narr-call {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-family: ${TEXT_FAMILY};
  font-size: var(--dsw-font-xs-13-font-size, 13px);
}
.d0nj-narr-verb {
  flex: none;
  color: ${INK};
}
.d0nj-narr-arg {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  overflow: hidden;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  color: ${DIM};
}
.d0nj-narr-dir {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
  opacity: 0.7;
}
.d0nj-narr-base {
  flex: none;
  white-space: pre;
  color: ${INK};
}
.d0nj-narr-caret {
  flex: none;
  width: 5px;
  height: 11px;
  margin-left: 2px;
  background: ${INK};
  animation: d0nj-narr-blink 1s steps(1) infinite;
}
.d0nj-narr-call[data-preparing="false"] .d0nj-narr-caret { display: none; }
.d0nj-narr-spent {
  flex: none;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  font-variant-numeric: tabular-nums;
  color: ${DIM};
}
.d0nj-narr-think {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 12px;
  border-left: 1px solid ${LINE};
}
.d0nj-narr-think-head {
  display: flex;
  align-items: center;
  align-self: flex-start;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${DIM};
  font-family: ${TEXT_FAMILY};
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  cursor: pointer;
}
.d0nj-narr-think-head:hover { color: ${INK}; }
.d0nj-narr-think-head:focus-visible {
  outline: 2px solid ${INK};
  outline-offset: 2px;
}
.d0nj-narr-think-body {
  margin: 0;
  max-height: none;
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ${TEXT_FAMILY};
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  line-height: 1.7;
  color: ${DIM};
}
.d0nj-narr-answer {
  min-width: 0;
}
.d0nj-narr-plain {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ${TEXT_FAMILY};
  font-size: var(--dsw-font-s-14-font-size, 14px);
  line-height: 1.65;
}
.d0nj-tool {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  border: 1px solid ${LINE};
  border-radius: var(--dsw-radius-m, 8px);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
  font-family: ${TEXT_FAMILY};
  color: ${INK};
}
.d0nj-tool > * + * { border-top: 1px solid ${LINE}; }
.d0nj-tool-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 7px 12px;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
}
.d0nj-tool-icon {
  flex: none;
  align-self: center;
  width: 1em;
  font-size: 10px;
  line-height: 1;
  text-align: center;
  color: ${DIM};
}
.d0nj-tool-icon[data-state="start"] { color: ${INK}; }
.d0nj-tool-icon[data-state="done"] { color: var(--dsw-alias-state-success-primary); }
.d0nj-tool-icon[data-state="failed"] { color: var(--dsw-alias-state-error-primary); }
.d0nj-tool-verb { flex: none; color: ${INK}; }
.d0nj-tool-target {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  color: ${DIM};
}
.d0nj-tool-state {
  flex: none;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  font-variant-numeric: tabular-nums;
  color: ${DIM};
}
.d0nj-tool[data-error="true"] .d0nj-tool-state { color: var(--dsw-alias-state-error-primary); }
.d0nj-tool-meta {
  padding: 6px 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  color: ${DIM};
}
.d0nj-tool-args {
  margin: 0;
  padding: 8px 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: ${CODE};
  color: ${DIM};
}
.d0nj-tool-command {
  margin: 0;
  padding: 8px 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: ${CODE};
  color: ${INK};
}
.d0nj-tool-prompt {
  color: ${DIM};
  user-select: none;
}
.d0nj-tool-output {
  margin: 0;
  padding: 8px 12px;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: ${CODE};
  line-height: 1.5;
  color: ${DIM};
}
.d0nj-tool[data-error="true"] .d0nj-tool-output { color: var(--dsw-alias-state-error-primary); }
.d0nj-term[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.d0nj-term[data-tone="success"] { color: var(--dsw-alias-state-success-primary); }
.d0nj-term[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.d0nj-term[data-bold="true"] { font-weight: 600; }
.d0nj-term[data-dim="true"] { opacity: 0.65; }
.d0nj-term[data-underline="true"] { text-decoration: underline; }
.d0nj-tool-output:empty, .d0nj-tool-args:empty { display: none; }
.d0nj-tool-sub {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
}
.d0nj-tool-stat {
  flex: none;
  margin-left: 8px;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  font-variant-numeric: tabular-nums;
  color: ${DIM};
}
.d0nj-diff {
  margin: 0;
  padding: 6px 0;
  max-height: 60vh;
  overflow: auto;
  font: ${CODE};
  line-height: 1.55;
}
.d0nj-diff-line {
  display: flex;
  align-items: baseline;
  padding: 0 10px;
  white-space: pre;
  color: ${INK};
}
.d0nj-diff-line[data-kind="hunk"] {
  display: block;
  padding: 2px 10px;
  color: ${DIM};
  opacity: 0.75;
}
.d0nj-diff-line[data-kind="add"] {
  color: var(--dsw-alias-state-success-primary);
  background: color-mix(in oklab, var(--dsw-alias-state-success-primary) 14%, transparent);
}
.d0nj-diff-line[data-kind="remove"] {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in oklab, var(--dsw-alias-state-error-primary) 14%, transparent);
}
.d0nj-diff-sign {
  flex: none;
  width: 1ch;
}
.d0nj-diff-no {
  flex: none;
  padding: 0 6px 0 2px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  opacity: 0.5;
}
.d0nj-diff-bar {
  flex: none;
  margin-right: 8px;
  opacity: 0.25;
}
.d0nj-diff-text {
  flex: 1 1 auto;
  white-space: pre;
}
.d0nj-tool-out-wrap {
  display: flex;
  flex-direction: column;
}
.d0nj-tool-more {
  align-self: flex-start;
  margin: 8px 12px 0;
  padding: 0;
  border: 0;
  background: transparent;
  font-family: ${CODE_FAMILY};
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  color: ${DIM};
  cursor: pointer;
}
.d0nj-tool-more:hover { color: ${INK}; }
.d0nj-tool-more:focus-visible {
  outline: 2px solid ${INK};
  outline-offset: 2px;
}
@keyframes d0nj-narr-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
@keyframes d0nj-narr-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .d0nj-narr-dot, .d0nj-narr-caret { animation: none; }
}
`

export const PHASE_COLOUR: Readonly<Record<string, string>> = {
  idle: 'var(--dsw-alias-state-idle-primary)',
  thinking: 'var(--dsw-alias-label-secondary)',
  writing: 'var(--dsw-alias-label-primary)',
  calling: 'var(--dsw-alias-label-primary)',
  holding: 'var(--dsw-alias-state-warn-primary)',
}
