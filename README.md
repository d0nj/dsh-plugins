# d0nj plugins for DeepSeek Harness

A collection of [Cordis](https://cordis.js.org) bundles for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), managed as a Turborepo monorepo.

Each package is a `dsh` bundle: it declares `dsh.bundle.patch` in its `package.json`, and installing it adds rows to a profile. The Harness loads built JavaScript from `dist/`, so the TypeScript here is compiled before installation.

## Packages

| Package | What it adds |
|---|---|
| [`@d0nj/dsh-websearch-multi`](packages/websearch-multi) | Thirteen `web_search` backends, four `web_fetch` backends and three combo providers behind the existing `ctx.web` seam. |
| [`@d0nj/dsh-ui-custom`](packages/ui-custom) | Thirty light/dark theme presets, colour tokens, typography and radius/density geometry for the Web UI, edited live in a Theme Studio settings panel. |
| [`@d0nj/dsh-git-bash`](packages/git-bash) | A working `bash` tool on Windows, backed by Git Bash, beside the shipped `pwsh` tool. |
| [`@d0nj/dsh-agent-rules`](packages/agent-rules) | `AGENTS.md`, `CLAUDE.md` and `*.local.md` as binding system-prompt sections, replacing the advisory reminder that agents can talk themselves out of. |
| [`@d0nj/dsh-browser`](packages/browser) | A headless-by-default Chromium the agent drives through the `browser` tool: pages read as numbered accessibility outlines, then clicked, typed and scrolled by ref. |
| [`@d0nj/dsh-init`](packages/init) | The `/init` command: queues a repository-survey brief so the agent writes or refreshes its `AGENTS.md`. |
| [`@d0nj/dsh-stats`](packages/stats) | A **Token usage** page in the sidebar: lifetime input, cache-read, cache-write and output totals across every Session, with charts and a models.dev spend estimate. |
| [`@d0nj/dsh-narration`](packages/narration) | Each assistant step rendered in the chat as frame-paced reasoning and tool rows, plus a system-prompt rule for one-line intent and batched reads. |
| [`@d0nj/dsh-codemode`](packages/codemode) | A `run_code` tool and Codemode preset: one TypeScript program composes the other tools through `tools.*`, with `catalog.search`/`describe` for the rest. |

## Requirements

- Node.js 22 or newer
- pnpm 12.8.2
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
2. `src/index.ts` exporting `name`, `inject`, `Config`, and either `apply(ctx, config)` or a service class the Host constructs.
3. `tsconfig.build.json` extending `../../tsconfig.base.json`.
4. `pnpm install`, `pnpm build`, then install it into a profile.

## Installing a plugin into a profile

The Harness installs a bundle by absolute path, so pass the directory this repository was cloned into:

```text
plugin_manager({ action: "install_bundle", target: "<absolute path to this repo>/packages/websearch-multi" })
```

A linked directory install picks up rebuilt files, but the Host runs in-process, so a module change needs a restart before the new code loads.

## Releasing

Merge to `main`; the commit messages decide the release. [`.github/workflows/publish.yml`](.github/workflows/publish.yml) runs [`scripts/release.mjs`](scripts/release.mjs), which runs [semantic-release](https://semantic-release.gitbook.io/semantic-release/) once per package. Commits are attributed by the files they touched, each package versions independently from its own `<package>@<version>` tag, and the release is published to npm and opened on GitHub. Never edit a version by hand.

- `fix(...)` releases a patch, `feat(...)` a minor, and a `BREAKING CHANGE:` footer a major.
- Scope the commit to the package it changes (`feat(ui-custom): ...`); a commit touching several packages releases each of them.
- npm authentication prefers OIDC trusted publishing. A package that does not exist on npm cannot be created that way, so add an `NPM_TOKEN` repository secret (`gh secret set NPM_TOKEN`) if the bot should create a new package; otherwise its first version needs one manual publish.
- Keep the workflow filename `publish.yml`: npm trusted publishers are configured against it.
- A push that only touches root files (docs, CI, this driver) releases nothing. Run `pnpm release:dry` with a `GITHUB_TOKEN` to preview what a push would release.

## Dependency updates

[`.github/renovate.json5`](.github/renovate.json5) groups the Harness packages into a single "DeepSeek Harness" pull request and rewrites `peerDependencies` together with `devDependencies`. That pairing matters: the Host refuses to load a bundle whose declared `dsh-*` peers do not satisfy its own version, and [Dependabot does not update `peerDependencies`](https://github.com/dependabot/dependabot-core/issues/1242) at all.

The config only runs once the [Renovate app](https://github.com/apps/renovate) is installed on this repository. Merging the PR releases a patch for every package it touched; its `fix(deps): ...` commit is the release trigger.
