import type { Context } from '@deepseek-ai/cordis'
import { projectToolSchema, RUN_CODE_NAME, ToolNotFoundError } from '@deepseek-ai/dsh-tools'
import type { ToolBatchInput, ToolBatchResult, ToolDefinition, ToolExecutor, ToolModelInput, ToolPromptSection } from '@deepseek-ai/dsh-tools'
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'

import { buildCatalog } from './catalog.js'
import type { CatalogEntry } from './catalog.js'
import type { PluginConfig } from './config.js'
import { directInstruction, renderSections } from './prompt.js'
import type { PtcRuntimePort } from './ptc.js'
import { toCatalogTool } from './program.js'
import { createRunCodeTransport } from './transport.js'

export class CodeModeExecutor implements ToolExecutor {
  readonly sections: readonly ToolPromptSection[]
  readonly #settings: PluginConfig
  readonly #pipeline: ToolExecutionPipeline
  readonly #transport: ToolDefinition
  readonly #direct: ReadonlySet<string>

  constructor(ctx: Context, settings: PluginConfig, runtime: PtcRuntimePort) {
    this.#settings = settings
    this.#direct = new Set(settings.direct)
    this.#pipeline = new ToolExecutionPipeline(ctx, {
      get: (name, scope, toolSet) => (name === RUN_CODE_NAME ? this.#transport : ctx.tools.executable(name, scope, toolSet)),
      reject: (name, nested) =>
        !nested && name !== RUN_CODE_NAME && !this.#direct.has(name)
          ? new ToolNotFoundError(name, onlyDirectMessage(this.#direct, name))
          : undefined,
    })
    const logger = ctx.logger('codemode')
    this.#transport = createRunCodeTransport({
      ctx,
      config: settings,
      runtime,
      pipeline: this.#pipeline,
      log: message => logger.warn(message),
      maxResultChars: settings.maxResultChars,
    })
    this.sections = [
      { name: 'tools:codemode-only', order: ctx.systemPrompt.getSectionOrder('PTC_ONLY'), text: directInstruction([...this.#direct]), interpolate: false },
      {
        name: 'tools:codemode-catalog',
        order: ctx.systemPrompt.getSectionOrder('TOOLS_SDK'),
        text: (tools: readonly ToolDefinition[]) => renderSections(this.#entries(tools), settings.mode, settings.maxInlineBytes),
        interpolate: false,
      },
    ]
  }

  describe(tools: readonly ToolDefinition[]): ToolModelInput {
    const schemas = [projectToolSchema(this.#transport, false)]
    const knownNames = [RUN_CODE_NAME]
    for (const tool of tools) {
      if (!this.#direct.has(tool.name)) continue
      schemas.push(projectToolSchema(tool, false))
      knownNames.push(tool.name)
    }
    return { schemas, knownNames }
  }

  execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    return executeToolBatch(input, this.#pipeline, () => this.#settings.maxParallelSubCalls)
  }

  #entries(tools: readonly ToolDefinition[]): CatalogEntry[] {
    return buildCatalog(tools.map(toCatalogTool), { pinned: this.#settings.pinned, direct: this.#settings.direct, exclude: this.#settings.exclude })
  }
}

function onlyDirectMessage(direct: ReadonlySet<string>, name: string): string {
  const callable = [...direct]
  const allowed = callable.length === 0 ? `only \`${RUN_CODE_NAME}\` is callable directly` : `only \`${RUN_CODE_NAME}\` and ${callable.map(entry => `\`${entry}\``).join(', ')} are callable directly`
  return `${allowed} — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`
}
