# Repository Guidelines

## Project Overview

Turborepo monorepo of [Cordis](https://cordis.js.org) bundles ("dsh plugins") for DeepSeek Harness. Each package is a bundle: `package.json` declares `dsh.bundle.patch` → `cordis.patch.yml`, which inserts plugin rows into a dsh profile. The Harness loads compiled JS from `dist/`, never `src/`.

| Package | Dir | Its guidelines |
|---|---|---|
| `@d0nj/dsh-websearch-multi` | `packages/websearch-multi` | [`packages/websearch-multi/AGENTS.md`](packages/websearch-multi/AGENTS.md) |
| `@d0nj/dsh-ui-custom` | `packages/ui-custom` | [`packages/ui-custom/AGENTS.md`](packages/ui-custom/AGENTS.md) |

Read the package file before touching that package's `src/`. This file covers only what is shared.

## Architecture & Data Flow

```
pnpm-workspace.yaml (packages/*)
  → turbo run <task>            task graph, dist/** cached
  → package: tsc -p tsconfig.build.json → dist/
  → Harness: dsh.bundle.patch → cordis.patch.yml → profile rows
  → Harness loader: package.json main = dist/index.js → name / inject / Config / apply(ctx, config)
```

Three layers every plugin follows:

1. **Manifest** — `dsh.bundle.patch` (every package) and `dsh.client` (browser half, ui-custom only).
2. **Host entry** `src/index.ts` — exports `name` (bare directory name), `inject`, `Config` (schemastery), `apply(ctx, config)` returning a disposer.
3. **Seam usage** — obtain capabilities from `ctx` only (`ctx.web`, `ctx.logger(name)`, `ctx.get('credentials')`, `ctx.effect`); `inject` guarantees their presence.

`apply` never throws on bad user config: validate cross-field constraints, `logger.warn`/`logger.error`, skip that row. The Host runs in-process, so a module change needs a Harness restart.

### Patch files

- `cordis.patch.yml` holds `- insert:` rows: `id` (= plugin `name`), `name` (= npm name), `config`.
- A profile's own patch **outranks** the bundle's, so bundles ship complete defaults and profiles override selected keys. Do not override sibling plugin rows (e.g. the `web` row) from a bundle patch.
- Row `id` is also the settings/config namespace the client side reads.

## Key Directories

```
packages/<name>/
  src/index.ts            plugin entry (name/inject/Config/apply)
  src/*.test.ts           node:test suites, co-located
  cordis.patch.yml        profile rows
  locale/{en,zh}.json     meta.title / meta.description only (no i18n calls in src)
  icon.svg  README.md  package.json
  tsconfig.build.json     → dist/   (excludes *.test.ts)
  tsconfig.test.json      → dist-test/ (includes everything, for tests)
  tsconfig.json           editor-only (--noEmit), referenced by no script
scripts/                  repo-level tooling (release tag resolver)
.github/workflows/        ci.yml (verify), publish.yml (tag → npm)
```

## Development Commands

```bash
pnpm install             # workspace + real Harness type packages
pnpm build               # tsc → dist/
pnpm typecheck           # tsc -p tsconfig.test.json --noEmit
pnpm test                # pretest compiles dist-test/, then node --test
pnpm check               # node --check on emitted entry points
pnpm clean               # rm dist/ dist-test/
pnpm exec turbo run build typecheck test check   # exactly what CI runs
```

Per package:

```bash
pnpm --filter @d0nj/dsh-<dir> build|test|typecheck|check|clean
pnpm --filter @d0nj/dsh-<dir> exec tsc -p tsconfig.test.json   # rebuild dist-test after edits
node --test dist-test/<subject>.test.js
node --test --test-name-pattern="<regex>" "dist-test/**/*.test.js"
```

Caveats:
- `pnpm lint` and `turbo run lint` are wired but no package defines a `lint` script — **no linter exists**; tsc strictness is the only static gate. Don't add a lint config silently.
- `check` runs `node --check` over a **hardcoded** file list in each `package.json`. A new emitted entry file must be added there or it escapes the gate.
- `pnpm build` is what a profile loads. `dist-test/` never ships.
- Root `dev:websearch-multi` is a one-shot build, not a watcher.

## Code Conventions & Common Patterns

**TypeScript / ESM** — `tsconfig.base.json` is the truth; extend it, never loosen:
- `NodeNext` + `"type": "module"` ⇒ relative imports **must** end in `.js`.
- `verbatimModuleSyntax` ⇒ type-only imports use `import type`.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`, `isolatedModules`.
- Optional fields: conditionally spread (`...(v === undefined ? {} : { k: v })`), never assign `undefined`.
- `skipLibCheck` is required: Harness `.d.ts` reference peer types they don't declare.

**Naming**
- Dir kebab-case; npm `@d0nj/dsh-<dir>`; plugin `name` export and patch row `id` = bare dir name.
- Declarative catalogs: `SEARCH_ADAPTERS`, `FETCH_ADAPTERS`, `PRESETS`, `TOKEN_SPECS` keyed by id, plus `*_IDS` arrays and `is*Id()` guards.
- Tests `src/<subject>.test.ts`; commit scopes use the package directory name (`feat(websearch-multi): …`).

**Schemastery**
- Annotate `Config` explicitly as `z<PluginConfig>`; inferred chains leak cosmokit store paths into published `.d.ts`.
- `z.object`, `.dict`, `.union([z.const(...)])`, `.default`, `.min/.max/.step`, `.role('secret')`, `.role('credential-ref')`, `.volatile()`.

**Async & state**
- `async/await` only; `AbortSignal` as trailing optional param; fan-out via `Promise.allSettled`.
- `readonly` fields, `#private` class members, pure merge/resolve/fusion functions with side effects pushed to the edges.

## Important Files

| Path | Why |
|---|---|
| `tsconfig.base.json` | compiler truth; `globalDependencies` in turbo |
| `turbo.json` | task graph: `test`/`check` depend on `build`, `typecheck` on `^build` |
| `pnpm-workspace.yaml` | `packages/*` only — no `workspaces` field, so npm/yarn won't link |
| `scripts/resolve-release-tag.mjs` | tag → publish matrix; rejects version mismatch and tags not on `origin/main` |
| `.github/workflows/ci.yml` | `turbo run build typecheck test check` + `pnpm pack --dry-run` per non-private package |
| `.github/workflows/publish.yml` | tag trigger, npm OIDC trusted publishing |

## Runtime / Tooling Preferences

- **Node ≥ 22** (CI pins `22.14.0`), **pnpm 12.8.2** (`packageManager` field, both workflows, lockfile v9).
- **ESM only** — no CJS, no dual exports. `require()` of these packages fails.
- Turborepo for ordering/caching only: no project references, no `tsc -b`; `tsBuildInfoFile` is inert (nothing sets `incremental`/`composite`).
- Harness peers are RC-pinned (`@deepseek-ai/cordis ~4.0.5`, `schemastery ~3.18.5`, `dsh-* 0.2.1-rc.2`) and **duplicated into `devDependencies`** so `pnpm install` supplies real types. Keep both lists identical.
- No runtime third-party dependencies: Node globals (`fetch`, `URL`, `AbortSignal`) only.
- Secrets live in the dsh credential store, never files. `.gitignore`'s last line fuses two patterns (`.env.local*.tgz`), so `*.tgz` and `.env.local` are *not* ignored.
- Release: `git tag @d0nj/dsh-<pkg>@<version> && git push origin <tag>`. The first publish of a **new** package must be manual (trusted publishing cannot create a package).

## Testing & QA

- **`node:test` + `node:assert/strict`**, no vitest/jest/mocha. Tests execute compiled output from `dist-test/`, so dist and source cannot diverge silently.
- `pretest` (`tsc -p tsconfig.test.json`) is the emitting compile; `typecheck` is the same config with `--noEmit`.
- Naming: `src/<subject>.test.ts`; `describe(<exported symbol group>)` + `it('<behavior sentence>')`; assertion messages act as labels.
- No mocking libraries and no network: swap `globalThis.fetch` via a `stubFetch(handler)` helper (restore in `finally`), build `Response` with a small `json(body, status)` helper, and inject stubs through the seam's constructor/lookup instead of module mocking.
- Permanent tests target behavior, boundaries, invariants, errors — not wiring or forwarding.
- Before claiming done: `pnpm exec turbo run build typecheck test check`, plus the runtime check relevant to the change. Tests are not proof for UI/browser behavior.
