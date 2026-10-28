# Repository Guidelines — `@d0nj/dsh-ui-custom`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Split Host/browser Cordis bundle for the DeepSeek Harness Web UI: 15 theme presets, per-token colour overrides (light + dark), typography per role (text/code/terminal), geometry (radius + density), and a "Theme Studio" settings panel. Host half contributes only a config schema; the browser half owns all runtime behavior.

## Architecture & Data Flow

```
src/index.ts    (Host)     Config schema + toDocument projection; apply() is intentionally empty
src/spec.ts     (shared)   TOKEN_SPECS, PRESETS, FONT_ROLES, FONT_SIZE_RANGES, DENSITIES, RADIUS_MIN/MAX
src/resolve.ts  (shared)   resolveCustomization: preset → user overrides → geometry (pure, clamps, warns)
src/client/index.ts        registers presets as themes, maintains ONE override layer, typography, panel
src/client/panel.ts        Theme Studio view, hand-written React.createElement (no JSX)
scripts/stamp-client.mjs   rewrites tsc ESM output into the browser loader envelope at build time
```

| File | Role | Key exports |
|---|---|---|
| `src/index.ts` | Host entry, schema, config→document projection | `name`, `inject = []`, `Config`, `PluginConfig`, `apply`, `toDocument` |
| `src/spec.ts` | single source of truth for tokens and presets | `TOKEN_GROUPS`, `TOKEN_SPECS` (14 tokens), `TOKEN_NAMES`, `tokenSpec`, `PRESETS` (15), `PRESET_IDS`, `findPreset`, `FONT_ROLES`, `FONT_SIZE_RANGES`, `DENSITIES`, `RADIUS_MIN/MAX` |
| `src/resolve.ts` | pure merge/clamp/warn | `resolveCustomization`, `geometryTokens`, `isColor`, `clamp`, `correctFontSize`, `isDensity`; types `CustomizationDocument`, `ResolvedCustomization`, `Geometry`, `Typography` |
| `src/client/index.ts` | browser wiring | `apply`, `useReact`, `inject = ['theme','configForms','slots']`, `OVERRIDE_SOURCE`, `registerPanel`, `ThemeTokenOverrides` |
| `src/client/panel.ts` | Theme Studio view + styles | `ThemeStudio`, `PanelState`, `PanelActions`, `TokenRowState` |

### Browser flow (`applyInner`, `src/client/index.ts`)

1. Every `PRESETS` entry registers as a real theme through `ctx.effect(() => theme.register({id, colorScheme, tokens}))`; a taken id is reported and skipped, never fatal.
2. `form = configForms.get('ui-custom')` — the namespace equals the patch row `id`.
3. `refresh()` on `form.subscribe`: snapshot → `asDocument` → `resolveCustomization` → dispose previous layer → `theme.overrideTokens(OVERRIDE_SOURCE, resolved.tokens)`. Typography writes only when `JSON.stringify` differs, per role, each in its own try/catch.
4. `registerPanel` mounts into `slots.inject('settings.section', …)` as id `ui-custom`, order `11`, label `Theme Studio`; the panel is a real component with `useState`/`useEffect` so a Host echo re-renders it.
5. Actions write **whole fields** via `form.set(field, value)` — `tokens` always as the full dict, `resetAll` writes `tokens: {}`.

### Invariants

- **One layer per source.** `overrideTokens` replaces wholesale per source id; never register a second source.
- **Both palette modes always travel together** (`{light, dark}`) — the runtime rejects a bare string.
- **`apply` must never fail web boot.** `apply()` wraps `applyInner` in try/catch and degrades through `reportFailure`; the same guard applies to per-preset registration and panel mounting.
- **Write only real changes.** Typography and token writes are settings mutations; compare before writing to avoid fighting the shipped Appearance rows.
- **Disposal via `ctx.effect`.** `theme.register`, `overrideTokens`, `form.subscribe`, and the slot registration all return disposers; `slots` returns no-op.
- `resolveCustomization` is lenient by warning, not by throwing: invalid colours/sizes/densities are dropped and surfaced in `warnings`.

## Browser-Half Constraints (non-negotiable)

`scripts/stamp-client.mjs` post-processes `dist/` after `tsc`; it is a regex rewriter, not a bundler.

- **Relative imports only.** Any import whose specifier doesn't start with `.` throws at build time. Harness client packages (`@deepseek-ai/dsh-client-ui-*`) are declared in `dsh.client.inject` and received via `ctx`, never imported.
- **No JSX, no transform.** Use `React.createElement` shims (`panel.ts`); React arrives through `useReact(react)` called by the generated envelope.
- **Services are structural, not imported** (`ThemeService`, `ConfigForm` interfaces in `src/client/index.ts`) so package internals can move.
- Output is wrapped as `window.__ModuleLoader__.load({ id: '@d0nj/dsh-ui-custom', factory })` → `dist/client/client.js`, which is what the `./client` export points at.
- `tsc` emits plain ESM; `dist/client/client.js` is generated. Never hand-edit it, and re-run `pnpm build` after editing anything under `src/client/`.

## Commands

```bash
pnpm --filter @d0nj/dsh-ui-custom build     # tsc -p tsconfig.build.json && node scripts/stamp-client.mjs
pnpm --filter @d0nj/dsh-ui-custom test      # pretest compile → dist-test/, then node --test
pnpm --filter @d0nj/dsh-ui-custom typecheck
pnpm --filter @d0nj/dsh-ui-custom check     # node --check dist/index.js dist/client/client.js dist/spec.js
cd packages/ui-custom && node --test dist-test/spec.test.js
```

`check` only validates syntax of the envelope. A client change needs `pnpm build` and a look at the emitted `dist/client/client.js`; it cannot be smoke-tested from Node.

## Tests

`node:test` + `node:assert/strict` over `dist-test/`. `src/spec.test.ts` is the only suite (5 groups / 25 tests): token catalog invariants, preset completeness, `geometryTokens`, `resolveCustomization` merge/override/warning behaviour, clamping/validation helpers, and **WCAG contrast ratios computed in-test**.

When adding a token or preset: add it to `spec.ts`, ensure the preset defines every `TOKEN_SPECS` name for both modes, and extend `spec.test.ts` if the invariant is new. Contrast assertions are the guard against unreadable defaults — keep them.

## Patch Config

`cordis.patch.yml` inserts one row, `id: ui-custom` (the settings namespace), with `basePreset: none`, `tokens: {}`, full typography block, and `geometry: {radius: 8, density: comfortable}`. The browser half reads that namespace via `configForms.get('ui-custom')`, so the row id and the `forms.get(...)` argument must stay in sync.

## Deps

Peers: `@deepseek-ai/cordis ~4.0.5`, `@deepseek-ai/schemastery ~3.18.5` (mirrored in `devDependencies`). The client-side services are declared in `dsh.client.inject` (`dsh-client-ui-theme`, `-ui-settings`, `-ui-slots`) and resolved from the Host's runtime module table — they are not npm dependencies. React is supplied by the loader.
