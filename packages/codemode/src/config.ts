import z from '@deepseek-ai/schemastery'

export const CATALOG_MODES = ['hybrid', 'full', 'search'] as const

export type CatalogMode = (typeof CATALOG_MODES)[number]

export interface PluginConfig {
  mode: CatalogMode
  pinned: string[]
  direct: string[]
  exclude: string[]
  maxInlineBytes: number
  maxResultChars: number
  maxProgramChars: number
  timeoutMs: number
  maxSubCallsPerMinute: number
  maxParallelSubCalls: number
}

export const Config: z<Partial<PluginConfig>, PluginConfig> = z.object({
  mode: z
    .union(CATALOG_MODES.map(value => z.const(value)))
    .default('hybrid')
    .description('How much of the tool catalog is inlined: the whole SDK, an index plus on-demand search, or only search.'),
  pinned: z.array(z.string()).default([]).description('Tool names whose full signature is always inlined.'),
  direct: z
    .array(z.string())
    .default(['ask_user_question', 'exit_plan_mode', 'skill'])
    .description('Tool names that stay directly callable instead of being reached through `run_code`.'),
  exclude: z.array(z.string()).default([]).description('Tool names that programs may not call.'),
  maxInlineBytes: z.natural().default(24_000).description('Byte budget for inlined signatures.'),
  maxResultChars: z.natural().default(50_000).description('Character budget for the rendered program result.'),
  maxProgramChars: z.natural().default(65_536).description('Program size limit, checked before the runtime starts.'),
  timeoutMs: z
    .natural()
    .min(1)
    .max(600_000)
    .default(120_000)
    .description('Program timeout forwarded to the runtime.'),
  maxSubCallsPerMinute: z.natural().min(1).default(1_024).description('Nested tool-call attempts allowed per minute of the resolved timeout.'),
  maxParallelSubCalls: z.natural().min(1).default(10).description('Maximum overlapping nested tool calls per program.'),
})

export interface SettingsIssues {
  readonly warn: (message: string) => void
}

export function resolveSettings(config: PluginConfig, issues: SettingsIssues): PluginConfig {
  const direct = unique(config.direct)
  const exclude = unique(config.exclude).filter(name => !direct.includes(name))
  for (const name of config.direct) {
    if (name === 'run_code') issues.warn('`run_code` cannot be listed in direct: it is the program transport.')
  }
  for (const name of config.pinned) {
    if (exclude.includes(name)) issues.warn(`pinned tool "${name}" is also excluded; the exclusion wins.`)
  }
  return { ...config, direct: direct.filter(name => name !== 'run_code'), exclude, pinned: unique(config.pinned).filter(name => !exclude.includes(name)) }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
