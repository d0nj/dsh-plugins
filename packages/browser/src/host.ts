/**
 * Browser instance and tab lifecycle.
 *
 * One browser process serves every tab. It is started on first use, reused when
 * a previous run left it on the same profile, closed once it has been idle, and
 * left alone when it is a browser the plugin only attached to.
 *
 * @module @d0nj/dsh-browser/host
 */
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'

import { CdpClient } from './cdp.js'
import { IdleCloser } from './idle.js'
import { describeSearch, findExecutable, launchChrome, resolveCdpAddress, reuseBrowser, stopBrowser } from './launch.js'
import { Tab } from './tab.js'
import type { PageInfo, TabSettings } from './tab.js'

/** Resolved, validated configuration. */
export interface BrowserSettings {
  readonly toolName: string
  readonly executablePath: string | undefined
  readonly cdpUrl: string | undefined
  readonly userDataDir: string
  readonly headless: boolean
  readonly viewport: { readonly width: number; readonly height: number }
  readonly dialogs: 'accept' | 'dismiss'
  readonly launchArgs: readonly string[]
  readonly navigateTimeoutMs: number
  readonly startupTimeoutMs: number
  readonly maxSnapshotChars: number
  readonly idleCloseMs: number
}

/** Ambient dependencies, injected so the host can be tested without spawning. */
export interface BrowserHostDeps {
  readonly logger: { warn(message: string): void; debug?(message: string): void }
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  readonly exists: (path: string) => Promise<boolean>
}

interface BrowserConnection {
  readonly cdp: CdpClient
  readonly child: ChildProcess | undefined
  /** Whether this plugin may close it: it launched it, or found it on the plugin's own profile. */
  readonly managed: boolean
  /** Detaches the idle clock from this connection's commands. */
  readonly stopActivity: () => void
}

/** A tab as reported to the model. */
export interface TabListing extends PageInfo {
  readonly name: string
}

export class BrowserHost {
  readonly #settings: BrowserSettings
  readonly #deps: BrowserHostDeps
  readonly #tabs = new Map<string, Tab>()
  readonly #pendingTabs = new Map<string, Promise<Tab>>()
  readonly #idle: IdleCloser
  #connection: Promise<BrowserConnection> | undefined
  #closing: Promise<void> | undefined
  #disposed = false

  constructor(settings: BrowserSettings, deps: BrowserHostDeps) {
    this.#settings = settings
    this.#deps = deps
    this.#idle = new IdleCloser(settings.idleCloseMs, () => {
      void this.closeIdleBrowser()
    })
  }

  /** The tab settings every new tab receives. */
  get tabSettings(): TabSettings {
    return {
      viewport: this.#settings.viewport,
      dialogs: this.#settings.dialogs,
      navigateTimeoutMs: this.#settings.navigateTimeoutMs,
    }
  }

  /**
   * The named tab, created on first use.
   * @param name - model-facing tab name.
   * @returns the live tab.
   */
  async tab(name: string): Promise<Tab> {
    if (this.#disposed) throw new Error('the browser plugin was disposed')
    const existing = this.#tabs.get(name)
    if (existing !== undefined && !existing.closed) return existing
    if (existing !== undefined) this.#tabs.delete(name)

    const pending = this.#pendingTabs.get(name)
    if (pending !== undefined) return pending

    const created = this.#openTab(name).finally(() => {
      this.#pendingTabs.delete(name)
    })
    this.#pendingTabs.set(name, created)
    return created
  }

  async #openTab(name: string): Promise<Tab> {
    const connection = await this.#ensureConnection()
    let targetId: string
    try {
      const created = await connection.cdp.send<{ targetId: string }>('Target.createTarget', {
        url: 'about:blank',
      })
      targetId = created.targetId
    } catch (error) {
      throw new Error(`cannot open a browser tab: ${error instanceof Error ? error.message : String(error)}`)
    }
    let tab: Tab
    try {
      tab = await Tab.attach(connection.cdp, targetId, name, this.tabSettings)
    } catch (error) {
      await connection.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined)
      throw new Error(`cannot attach to the new browser tab: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.#tabs.set(name, tab)
    return tab
  }

  /**
   * Every open tab with its current page.
   * @returns the tab listing.
   */
  async listTabs(): Promise<TabListing[]> {
    const entries = [...this.#tabs.entries()].filter(([, tab]) => !tab.closed)
    return Promise.all(
      entries.map(async ([name, tab]) => {
        const info = await tab.info()
        return { name, ...info }
      }),
    )
  }

  /**
   * Close one tab, or all of them.
   * @param name - tab name to close; ignored when `all` is true.
   * @param all - close every tab this plugin opened.
   * @returns the names that were closed.
   */
  async closeTab(name: string | undefined, all: boolean): Promise<string[]> {
    if (all) {
      const names = [...this.#tabs.keys()]
      for (const key of names) await this.#closeOne(key)
      return names
    }
    const target = name ?? 'main'
    if (!this.#tabs.has(target)) return []
    await this.#closeOne(target)
    return [target]
  }

  async #closeOne(name: string): Promise<void> {
    const tab = this.#tabs.get(name)
    this.#tabs.delete(name)
    if (tab === undefined) return
    const connection = await this.#connection?.catch(() => undefined)
    await tab.dispose()
    await connection?.cdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => undefined)
  }

  async #ensureConnection(): Promise<BrowserConnection> {
    if (this.#connection !== undefined) {
      const current = await this.#connection.catch(() => undefined)
      if (current !== undefined && !current.cdp.closed) return current
      this.#connection = undefined
    }
    const attempt = this.#connect()
    this.#connection = attempt
    try {
      return await attempt
    } catch (error) {
      if (this.#connection === attempt) this.#connection = undefined
      throw error
    }
  }

  async #connect(): Promise<BrowserConnection> {
    if (this.#settings.cdpUrl !== undefined) {
      const wsUrl = await resolveCdpAddress(this.#settings.cdpUrl)
      return { ...(await this.#open(wsUrl)), child: undefined, managed: false }
    }

    const reused = await reuseBrowser(this.#settings.userDataDir)
    if (reused !== undefined) {
      this.#deps.logger.debug?.(`browser: reusing the browser already running on ${this.#settings.userDataDir}`)
      return { ...(await this.#open(reused.wsUrl)), child: undefined, managed: true }
    }

    const executable = this.#settings.executablePath ?? (await findExecutable({ platform: process.platform, env: this.#deps.env, home: this.#deps.home, exists: this.#deps.exists }))
    if (executable === undefined) {
      throw new Error(
        `cannot open a browser: no Chrome, Edge, Brave, or Chromium was found. Install one, set executablePath in the browser plugin config, or set cdpUrl to attach to a browser started with --remote-debugging-port.${describeSearch({ platform: process.platform, env: this.#deps.env, home: this.#deps.home })}`,
      )
    }

    const launched = await launchChrome({
      executable,
      userDataDir: this.#settings.userDataDir,
      headless: this.#settings.headless,
      windowSize: this.#settings.viewport,
      extraArgs: this.#settings.launchArgs,
      startupTimeoutMs: this.#settings.startupTimeoutMs,
    })
    const child = launched.child
    child?.once('exit', () => {
      this.#tabs.clear()
      this.#connection = undefined
    })
    return { ...(await this.#open(launched.wsUrl)), child, managed: launched.owned }
  }

  /**
   * Connect, and let every command this connection carries restart the idle deadline.
   * @param wsUrl - browser WebSocket URL.
   * @returns the client and its activity detacher.
   */
  async #open(wsUrl: string): Promise<{ cdp: CdpClient; stopActivity: () => void }> {
    const cdp = await CdpClient.connect(wsUrl)
    const stopActivity = cdp.onActivity(() => this.#idle.end())
    return { cdp, stopActivity }
  }

  /** Close a browser nothing has used for the configured idle period. */
  async closeIdleBrowser(): Promise<void> {
    if (this.#disposed || this.#connection === undefined || this.#pendingTabs.size > 0) return
    this.#deps.logger.debug?.(`browser: closing the browser after ${Math.round(this.#settings.idleCloseMs / 1_000)}s idle; the next call starts it again`)
    await this.#teardown()
  }

  /** Stop every tab and the browser this plugin manages. */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#idle.stop()
    await this.#teardown()
  }

  async #teardown(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing
    const closing = this.#closeEverything().finally(() => {
      this.#closing = undefined
    })
    this.#closing = closing
    return closing
  }

  async #closeEverything(): Promise<void> {
    const connection = await this.#connection?.catch(() => undefined)
    this.#connection = undefined
    for (const [name, tab] of this.#tabs) {
      this.#tabs.delete(name)
      await tab.dispose().catch(() => undefined)
    }
    if (connection === undefined) return
    connection.stopActivity()
    if (connection.managed) await connection.cdp.send('Browser.close').catch(() => undefined)
    connection.cdp.close()
    await stopBrowser(connection.child)
  }
}

/**
 * Absolute profile directory for one configured profile name.
 * @param userDataDir - configured root, when the operator set one.
 * @param dshHome - harness home.
 * @param profile - profile name.
 * @returns the directory Chrome stores its profile in.
 */
export function resolveUserDataDir(userDataDir: string | undefined, dshHome: string, profile: string): string {
  const root = userDataDir?.trim()
  return root !== undefined && root !== '' ? root : join(dshHome, 'browser', profile)
}
