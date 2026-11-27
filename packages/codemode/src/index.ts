import type { Context } from '@deepseek-ai/cordis'

import { Config, resolveSettings } from './config.js'
import type { PluginConfig } from './config.js'
import { CodeModeExecutor } from './executor.js'
import { readPtcRuntime } from './ptc.js'

export const name = 'codemode'

export const inject = ['tools', 'systemPrompt']

export { Config }
export type { PluginConfig }

export function apply(ctx: Context, config: Partial<PluginConfig>): void {
  const logger = ctx.logger(name)
  const settings = resolveSettings(Config(config), { warn: message => logger.warn(message) })
  const runtime = readPtcRuntime(ctx)
  if (runtime === undefined) {
    logger.warn('no ptcRuntime service is mounted; keeping the current tool executor')
    return
  }
  const executor = new CodeModeExecutor(ctx, settings, runtime)
  ctx.effect(() => ctx.tools.setExecutor(executor))
}
