# @d0nj/dsh-ui-custom

Theme presets, colour tokens, typography, and geometry for the DeepSeek Harness Web UI, edited live from a **Theme Studio** panel in Settings.

## Why

The Harness ships one palette per mode. Restyling it otherwise means editing CSS that the next upgrade overwrites. This bundle registers complete themes through the existing `ctx.theme` seam and keeps your overrides in profile config, so a choice survives reloads, upgrades, and machine switches.

## What you get

- **15 presets**, each defined for both light and dark: Midnight, Paper, High contrast, Dracula, Nord, Catppuccin Mocha, Gruvbox, One Dark, Solarized, Rosé Pine, Tokyo Night, Ayu Dark, GitHub Dark, Monokai, Mono.
- **14 colour tokens** — surfaces, borders, text, brand, and state colours — each overridable per mode.
- **Typography** per role: interface/body, code, and the sidebar terminal, including font stacks and separate sizes.
- **Geometry**: corner radius (0–24 px) and spacing density (compact, comfortable, spacious).
- **Theme Studio** panel with live preview, so changes apply without a restart.

## Install

```bash
pnpm install
pnpm --filter @d0nj/dsh-ui-custom build
```

Then install the package directory into a profile with the `plugin_manager` tool. The bundle patch inserts one row, `ui-custom`, which is also the settings namespace the panel reads.

A browser-half change needs `pnpm build` and a page reload; the Host runs in-process, so a Host-side change needs a Harness restart.

## Configure

The stored document is the config for the `ui-custom` row:

```yaml
- id: ui-custom
  name: '@d0nj/dsh-ui-custom'
  config:
    basePreset: nord
    tokens:
      --dsw-alias-bg-base:
        light: '#fafafa'
        dark: '#111318'
    typography:
      textFontFamily: 'Inter, system-ui, sans-serif'
      codeFontFamily: 'JetBrains Mono, monospace'
      fontSize: 14
      codeFontSize: 12
      terminalFontSize: 13
    geometry:
      radius: 8
      density: comfortable
```

| Field | Default | Meaning |
|---|---|---|
| `basePreset` | `none` | Preset to build on, or `none` for the shipped theme |
| `tokens` | `{}` | Per-token overrides applied over the preset, keyed by CSS custom property |
| `typography` | built-in stacks | Font stacks per role; empty string keeps the built-in stack |
| `typography.fontSize` | `14` | Conversation text size in px |
| `typography.codeFontSize` | `11` | Code block size in px |
| `typography.terminalFontSize` | `13` | Sidebar terminal size in px |
| `geometry.radius` | `8` | Corner radius in px, 0–24 |
| `geometry.density` | `comfortable` | Spacing scale: `compact`, `comfortable`, `spacious` |

Every token override must set **both** `light` and `dark`. A token defined for one mode alone goes illegible when the palette flips, so the schema rejects it rather than trusting each caller to remember.

## Behaviour worth knowing

- **Presets are real themes.** Each registers through `ctx.theme` with its own id. A preset id already taken by another bundle is reported and skipped, never fatal.
- **Overrides are one layer.** The panel writes a single `overrideTokens` layer, replaced wholesale on each change, so restyling never accumulates stale tokens.
- **Bad input warns, it does not throw.** An unknown preset, an implausible colour, or an out-of-range size is dropped and surfaced in the panel's warnings; the plugin always mounts.
- **Writes happen only on real changes.** Typography and token writes are compared first, so the shipped Appearance rows are not fought on every render.
- **Shipped presets clear WCAG AA** for body and secondary text against their own base surface, in both modes. The tests compute the contrast ratios rather than asserting a hand-checked number.

## Tests

```bash
pnpm test
```

Catalog invariants, preset completeness across every token and both modes, resolver merge and override order, clamping and colour validation, and the contrast checks above. No network, no browser.

## Deps

Peers: `@deepseek-ai/cordis ~4.0.5` and `@deepseek-ai/schemastery ~3.18.5`. The browser services (`dsh-client-ui-theme`, `-ui-settings`, `-ui-slots`) are supplied by the Host's runtime module table and are not npm dependencies. React arrives from the loader.
