/**
 * Plugin entry: the `browser` tool over a real Chrome window.
 *
 * Chrome is started on the first browser call, with a profile directory of its
 * own so the user's everyday browser keeps running, and stays alive with the
 * plugin so consecutive actions share one page. Setting `cdpUrl` attaches to a
 * browser the user already started instead.
 *
 * @module @d0nj/dsh-browser
 */
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import { BrowserHost, resolveUserDataDir } from './host.js'
import type { BrowserSettings } from './host.js'
import { applyBrowserTool } from './tool.js'

/** Cordis plugin name — also the profile patch row id. */
export const name = 'browser'

/** Services this row relies on. */
export const inject = ['tools', 'systemPrompt']

/** Runtime schema for the browser row. */
export const Config = z.object({
  toolName: z.string().default('browser').description('Name the tool is registered under.'),
  executablePath: z.string().description('Absolute path to Chrome, Edge, Brave, or Chromium; omit to auto-detect an installed browser.'),
  cdpUrl: z
    .string()
    .description('Attach to a browser already started with --remote-debugging-port instead of launching one; accepts an HTTP origin such as http://127.0.0.1:9222 or a ws:// URL.'),
  headless: z.boolean().default(true).description('Run the launched browser without a visible window; set false to watch it, or to sign in to a site once in the persistent profile.'),
  userDataDir: z.string().description('Chrome profile directory; omit to keep one under the harness home. A persistent profile keeps site logins between sessions.'),
  profile: z.string().default('default').description('Profile name under the harness home; separate names hold separate logins.'),
  width: z.number().default(1280).min(320).max(3840).description('Window and viewport width in CSS pixels.'),
  height: z.number().default(900).min(240).max(2160).description('Window and viewport height in CSS pixels.'),
  dialogs: z.union([z.const('accept'), z.const('dismiss')]).default('accept').description('How alerts, confirms, and prompts are answered.'),
  launchArgs: z.array(z.string()).description('Extra command-line flags for the launched browser.'),
  navigateTimeoutMs: z.number().default(20_000).min(1_000).max(120_000).description('Budget in milliseconds for a navigation to finish loading.'),
  startupTimeoutMs: z.number().default(20_000).min(2_000).max(120_000).description('Budget in milliseconds for Chrome to publish its DevTools endpoint.'),
  maxSnapshotChars: z.number().default(12_000).min(2_000).max(80_000).description('Default character budget for one page outline.'),
  idleCloseSeconds: z.number().default(60).min(0).max(3_600).description('Close the browser this many seconds after the last browser call; 0 keeps it running until the plugin unloads.'),
})

/** Resolved row configuration. */
export interface PluginConfig {
  toolName?: string | undefined
  executablePath?: string | undefined
  cdpUrl?: string | undefined
  headless?: boolean | undefined
  userDataDir?: string | undefined
  profile?: string | undefined
  width?: number | undefined
  height?: number | undefined
  dialogs?: 'accept' | 'dismiss' | undefined
  launchArgs?: string[] | undefined
  navigateTimeoutMs?: number | undefined
  startupTimeoutMs?: number | undefined
  maxSnapshotChars?: number | undefined
  idleCloseSeconds?: number | undefined
}

/** Environment variable that relocates the harness home, matching `dsh-home-paths`. */
const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Resolve the harness home the same way the rest of the Harness does.
 * @param env - environment mapping to read.
 * @returns the absolute harness home.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DSH_HOME_ENV]?.trim()
  return override !== undefined && override.length > 0 ? override : join(homedir(), '.dsh')
}

function integer(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Resolve and clamp the row's configuration.
 * @param config - validated row configuration.
 * @returns the settings the host and tool use.
 */
export function resolveSettings(config: PluginConfig): BrowserSettings {
  const toolName = config.toolName?.trim()
  const cdpUrl = config.cdpUrl?.trim()
  const executablePath = config.executablePath?.trim()
  return {
    toolName: toolName === undefined || toolName === '' ? 'browser' : toolName,
    executablePath: executablePath === undefined || executablePath === '' ? undefined : executablePath,
    cdpUrl: cdpUrl === undefined || cdpUrl === '' ? undefined : cdpUrl,
    userDataDir: resolveUserDataDir(config.userDataDir, resolveDshHome(), config.profile?.trim() === undefined || config.profile.trim() === '' ? 'default' : config.profile.trim()),
    headless: config.headless !== false,
    viewport: {
      width: integer(config.width, 1280, 320, 3840),
      height: integer(config.height, 900, 240, 2160),
    },
    dialogs: config.dialogs === 'dismiss' ? 'dismiss' : 'accept',
    launchArgs: (config.launchArgs ?? []).filter((argument) => argument.trim() !== ''),
    navigateTimeoutMs: integer(config.navigateTimeoutMs, 20_000, 1_000, 120_000),
    startupTimeoutMs: integer(config.startupTimeoutMs, 20_000, 2_000, 120_000),
    maxSnapshotChars: integer(config.maxSnapshotChars, 12_000, 2_000, 80_000),
    idleCloseMs: integer(config.idleCloseSeconds, 60, 0, 3_600) * 1_000,
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Register the browser tool and hand the browser process to the plugin fiber, so
 * disposing the row also stops the Chrome instance this row started.
 * @param ctx - the plugin context.
 * @param config - validated row configuration.
 */
export function apply(ctx: Context, config: PluginConfig): void {
  const settings = resolveSettings(config)
  const host = new BrowserHost(settings, {
    logger: ctx.logger(name),
    env: process.env,
    home: homedir(),
    exists: fileExists,
  })
  ctx.effect(
    () => () => {
      void host.dispose()
    },
  )
  applyBrowserTool(ctx, host, settings)
}
