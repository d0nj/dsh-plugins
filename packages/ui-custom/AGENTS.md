# Repository Guidelines — `@d0nj/dsh-ui-custom`

Shared monorepo rules: [`../../AGENTS.md`](../../AGENTS.md). This file covers only this package.

## Overview

Split Host/browser Cordis bundle for the DeepSeek Harness Web UI: 30 theme presets (21 night, 9 daylight), per-token colour overrides (light + dark), optional typography overrides per role (text/code/terminal), geometry (radius + density), and a "Theme Studio" settings panel with a searchable, scheme-filtered preset gallery. Host half contributes only a config schema; the browser half owns all runtime behavior.

## Architecture & Data Flow

```
src/index.ts    (Host)     Config schema + toDocument projection; apply() is intentionally empty
src/spec.ts     (shared)   TOKEN_SPECS, PRESETS, FONT_ROLES, FONT_FAMILY_FIELDS, FONT_SIZE_FIELDS, FONT_SIZE_RANGES, DENSITIES, DEFAULT_GEOMETRY, RADIUS_MIN/MAX
src/resolve.ts  (shared)   resolveCustomization + planTypography (pure: preset → overrides → geometry, clamps, warns)
src/client/index.ts        registers presets as themes, maintains ONE override layer, applies typography, panel
src/client/panel.ts        Theme Studio view, hand-written React.createElement (no JSX)
src/client/hosted-fonts.ts family catalog; loads one mirror stylesheet per pick
scripts/stamp-client.mjs   rewrites tsc ESM output into the browser loader envelope at build time
```

| File | Role | Key exports |
|---|---|---|
| `src/index.ts` | Host entry, schema, config→document projection | `name`, `inject = []`, `Config`, `PluginConfig`, `apply`, `toDocument` |
| `src/spec.ts` | single source of truth for tokens and presets | `TOKEN_GROUPS`, `TOKEN_SPECS` (14 tokens), `TOKEN_NAMES`, `tokenSpec`, `PRESETS` (30), `PRESET_IDS`, `findPreset`, `FONT_ROLES`, `FONT_FAMILY_FIELDS`, `FONT_SIZE_FIELDS`, `FONT_SIZE_RANGES`, `DENSITIES`, `DEFAULT_GEOMETRY`, `RADIUS_MIN/MAX` |
| `src/resolve.ts` | pure merge/clamp/warn and the typography plan | `resolveCustomization`, `planTypography`, `normalizeFontList`, `geometryTokens`, `isColor`, `clamp`, `correctFontSize`, `isDensity`; types `CustomizationDocument`, `ResolvedCustomization`, `Geometry`, `Typography`, `AppliedTypography`, `FontApplication` |
| `src/client/index.ts` | browser wiring | `apply`, `useReact`, `inject = ['theme','configForms','slots']`, `OVERRIDE_SOURCE`, `registerPanel`, `ThemeTokenOverrides` |
| `src/client/panel.ts` | Theme Studio view + styles | `ThemeStudio`, `PanelState`, `PanelActions`, `TokenRowState`, `PresetChoice` |
| `src/client/hosted-fonts.ts` | font catalog + on-demand stylesheet loading | `HOSTED_FONTS`, `HostedFont`, `FontCategory`, `fontSlug`, `hostedFontUrl`, `loadHostedFont`, `hostedFamilies`, `findHostedFont` |

### Browser flow (`applyInner`, `src/client/index.ts`)

1. Every `PRESETS` entry registers as a real theme through `ctx.effect(() => theme.register({id, colorScheme, tokens}))`; a taken id is reported and skipped, never fatal.
2. `form = configForms.get('ui-custom')` — the namespace equals the patch row `id`.
3. `refresh()` on `form.subscribe`: snapshot → `asDocument` → `resolveCustomization` → dispose previous layer → `theme.overrideTokens(OVERRIDE_SOURCE, resolved.tokens)`.
4. Typography is applied only when the stored `typography` section itself changed (compare its JSON to the last applied one), and then through `planTypography(resolved.typography, theme.getTheme())`, which reads the theme's current families/sizes. An in-sync theme yields no writes, so a preset, token, or geometry change cannot touch fonts. A family the document leaves empty is skipped, never used to clear the theme.
5. Actions write **one path each** via `form.mutate([{op:'set', path:[...], value}])`; typography actions also write the theme service immediately, so the pick is visible before the settings round trip and does not depend on the echo.
6. `registerPanel` mounts into `slots.inject('settings.section', …)` as id `ui-custom`, order `11`, label `Theme Studio`; the panel is a real component with `useState`/`useEffect` so a Host echo re-renders it.

### Invariants

- **One layer per source.** `overrideTokens` replaces wholesale per source id; never register a second source.
- **Both palette modes always travel together** (`{light, dark}`) — the runtime rejects a bare string.
- **`apply` must never fail web boot.** `apply()` wraps `applyInner` in try/catch and degrades through `reportFailure`; the same guard applies to per-preset registration and panel mounting.
- **Typography is theme-owned.** The theme service stores families and sizes in its own `ui-theme` namespace, which the built-in Appearance rows edit. This document holds only overrides picked here: apply the difference from the theme's current state, never clear a family the document leaves empty, and skip typography entirely when its section did not change.
- **One path per write.** `form.mutate` with a path addresses the edited field; never rebuild a whole section from a possibly stale snapshot, or two quick edits can drop each other.
- **Runtime tokens follow the preset.** The composer surface and the send-button accent are painted with tokens no preset names, so `resolveCustomization` derives them from `bg-layer-1` and `brand-primary`; otherwise they keep the built-in colours and stick out of every theme.
- **Disposal via `ctx.effect`.** `theme.register`, `overrideTokens`, `form.subscribe`, and the slot registration all return disposers; `slots` returns no-op.
- `resolveCustomization` is lenient by warning, not by throwing: invalid colours/sizes/densities are dropped and surfaced in `warnings`.
- **Fonts come from our own mirror.** `HOSTED_FONTS` names families served by `cdn.jsdelivr.net/gh/d0nj/dsh-fonts@<tag>`; the tag is pinned in `CDN_BASE`, and a family is only loadable once the mirror carries it. Nothing is fetched from Google at runtime.

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

`node:test` + `node:assert/strict` over `dist-test/`. Four suites:

- `src/spec.test.ts` — token catalog invariants, preset completeness, `geometryTokens`, `resolveCustomization` merge/override/warning behaviour, clamping/validation helpers, `planTypography` idempotence and emptiness rules, and **WCAG contrast ratios computed in-test** (body text on base and raised surfaces, secondary on base).
- `src/panel.test.ts` — preset gallery filtering (scheme, search, empty state), tile previews and pressed state, plus font-combobox keyboard/blur commit semantics.
- `src/client.test.ts` — drives `apply` over a stub theme service and settings form: a preset-only change writes no typography, an empty document never clears a theme font, and only the role the user changed is written.
- `src/hosted-fonts.test.ts` — mirror slugs, URLs, catalog helpers.

When adding a token or preset: add it to `spec.ts`, ensure the preset defines every `TOKEN_SPECS` name for both modes, and extend `spec.test.ts` if the invariant is new. Contrast assertions are the guard against unreadable defaults — keep them.

## Patch Config

`cordis.patch.yml` inserts one row, `id: ui-custom` (the settings namespace), with `basePreset: none`, `tokens: {}`, and `geometry: {radius: 8, density: comfortable}`. Typography is deliberately not shipped as a default: an empty family or an absent size means "keep whatever the built-in Appearance rows use", so a fresh install never fights them. The browser half reads that namespace via `configForms.get('ui-custom')`, so the row id and the `forms.get(...)` argument must stay in sync.

## Deps

Peers: `@deepseek-ai/cordis ~4.1.0`, `@deepseek-ai/schemastery ~3.19.0` (mirrored in `devDependencies`). The client-side services are declared in `dsh.client.inject` (`dsh-client-ui-theme`, `-ui-settings`, `-ui-slots`) and resolved from the Host's runtime module table — they are not npm dependencies. React is supplied by the loader.
