# @d0nj/dsh-codemode

Programmatic tool calling for DeepSeek Harness agents.

Instead of one model turn per tool call, the agent writes one TypeScript program that composes its tools.
The plugin is a `ToolExecutor`, so it plugs into the shipped tool registry and delegates every nested call back through the shared execution pipeline:

- each nested call still runs `tools/pre-execute`, approvals, guards, timeouts, `tools/post-execute`, and the durable `tool/ptc-dispatch` log, so the Web transcript keeps its nested call tree;
- programs run on the shipped `ctx.ptcRuntime` (`@deepseek-ai/dsh-ptc-runtime-node`, `per-call` by default) under the session's sandbox policy.

## Why it exists

The shipped `dsh-tool-executor-ptc` inlines a full TypeScript SDK for every visible tool and makes `run_code` the only callable tool.
This plugin keeps the runtime and the pipeline but changes the parts that cost tokens and flexibility:

| | shipped PTC | this plugin |
|---|---|---|
| Prompt cost | every signature inlined | compact index + `catalog.search` / `catalog.describe` inside the program |
| Tool policy | all-or-nothing | `direct` names stay model-visible tools; `exclude` names leave programs |
| Program globals | `tools` | `tools` and `catalog` |
| Nested-call log | `tool/ptc-dispatch*` | same events, same payloads |

## Install

```bash
dsh plugin --profile <profile> add @d0nj/dsh-codemode
```

Then add the bundle to the profile's `package.json` so its patch applies:

```json
{
  "dsh": { "profile": { "bundles": ["@d0nj/dsh-codemode"] } }
}
```

The bundle patch inserts one `preset-codemode` row. Select the **Codemode** preset for a new session; existing sessions keep the revision they started with.

## Configuration

| key | default | meaning |
|---|---|---|
| `mode` | `hybrid` | `full` inlines every signature (PTC parity), `hybrid` inlines pinned and direct tools, `search` inlines none |
| `pinned` | `[]` | tool names whose full signature is always inlined |
| `direct` | `["ask_user_question", "exit_plan_mode", "skill"]` | tools that stay directly callable |
| `exclude` | `[]` | tools programs may not call |
| `maxInlineBytes` | `24000` | byte budget for inlined signatures |
| `maxResultChars` | `50000` | rendered result budget |
| `maxProgramChars` | `65536` | program size limit, checked before the runtime starts |
| `timeoutMs` | `120000` | program timeout forwarded to the runtime |
| `maxSubCallsPerMinute` | `1024` | nested call attempts per minute of resolved timeout |
| `maxParallelSubCalls` | `10` | overlapping nested calls per program |

## Program surface

```ts
const files = await tools.glob({ pattern: 'src/**/*.ts' })
const hits = await catalog.search({ query: 'replace text in file' })
return await tools.edit({ path: 'a.ts', oldText: 'x', newText: 'y' })
```

A failed nested call rejects with `ToolCallError`, whose `toolName` names the tool.
Arguments and results must be lossless JSON.

## Limits

- `per-call` runtime mode gives the program a real Node process inside the OS sandbox: codemode is not itself a confinement boundary, so the session sandbox mode is what limits file and process access.
- Image results from nested tools are not attached in this version.
- Presentation is the generic execute card; the nested tree comes from the dispatch events.
