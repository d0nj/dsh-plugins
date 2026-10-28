# d0nj plugins for DeepSeek Harness

A collection of [Cordis](https://cordis.js.org) bundles for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), managed as a Turborepo monorepo.

Each package is a `dsh` bundle: it declares `dsh.bundle.patch` in its `package.json`, and installing it adds plugin rows to a profile. The Harness loads built JavaScript from `dist/`, so the TypeScript here is compiled before installation.

## Packages

| Package | What it adds |
|---|---|
| [`@d0nj/dsh-websearch-multi`](packages/websearch-multi) | Thirteen `web_search` backends and four `web_fetch` backends behind the existing `ctx.web` seam. |

## Requirements

- Node.js 22 or newer
- pnpm 12
- A `dsh` installation on `PATH`

## Working in the repo

```bash
pnpm install          # install workspace dependencies and real Harness type packages
pnpm build            # compile every package to dist/
pnpm typecheck        # strict TypeScript check, tests included
pnpm test             # node --test over the compiled tests
pnpm check            # syntax-check the emitted entry points
pnpm clean            # remove dist/ and dist-test/
```

`pnpm build` is what produces the files a profile loads. Turbo caches it, so a change to one package rebuilds only that package and its dependents.

## Adding a plugin

1. `packages/<name>/` with a `package.json` declaring `dsh.bundle.patch`, plus `cordis.patch.yml`, `locale/en.json`, and `icon.svg`.
2. `src/index.ts` exporting `apply`, and optionally `Config` / `inject`.
3. `tsconfig.build.json` extending `../../tsconfig.base.json`.
4. `pnpm install`, `pnpm build`, then install it into a profile.

## Installing a plugin into a profile

The Harness installs a bundle by absolute path, so pass the directory this repository was cloned into:

```text
plugin_manager({ action: "install_bundle", target: "<absolute path to this repo>/packages/websearch-multi" })
```

A linked directory install picks up rebuilt files, but the Host runs in-process, so a module change needs a restart before the new code loads.
