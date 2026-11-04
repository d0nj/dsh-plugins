/**
 * Finding, starting, and attaching to a Chromium-family browser.
 *
 * Chrome publishes its DevTools endpoint through a `DevToolsActivePort` file in
 * the profile directory; reading it is the only way to discover a port chosen by
 * the browser (`--remote-debugging-port=0`), and it is also what makes reuse
 * across plugin restarts possible without hunting for PIDs.
 *
 * @module @d0nj/dsh-browser/launch
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'

/** Where to look for a browser binary. */
export interface ExecutableSearch {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  readonly exists: (path: string) => Promise<boolean>
}

/** The DevTools endpoint Chrome published for a profile directory. */
export interface DevToolsEndpoint {
  readonly port: number
  readonly path: string
  readonly wsUrl: string
}

/** One running or reused browser. */
export interface LaunchedBrowser {
  readonly wsUrl: string
  readonly port: number
  /** The process this plugin started; undefined when the browser was reused or attached. */
  readonly child: ChildProcess | undefined
  readonly owned: boolean
}

/** Options for starting a browser. */
export interface LaunchRequest {
  readonly executable: string
  readonly userDataDir: string
  readonly headless: boolean
  readonly windowSize: { readonly width: number; readonly height: number }
  readonly extraArgs?: readonly string[]
  readonly startupTimeoutMs?: number
  readonly signal?: AbortSignal
}

/**
 * Candidate executable paths for a platform, in preference order.
 * @param platform - `process.platform`.
 * @param env - environment variables to read install roots from.
 * @param home - the user's home directory.
 * @returns absolute paths to probe.
 */
export function executableCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string[] {
  const explicit = env['CHROME_PATH'] ?? env['DSH_BROWSER_EXECUTABLE']
  const candidates: string[] = explicit === undefined || explicit === '' ? [] : [explicit]

  if (platform === 'win32') {
    for (const root of [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']]) {
      if (root === undefined || root === '') continue
      candidates.push(win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
    for (const root of [env['LOCALAPPDATA'], env['ProgramFiles']]) {
      if (root === undefined || root === '') continue
      candidates.push(win32.join(root, 'Chromium', 'Application', 'chrome.exe'))
    }
    const scoop = env['SCOOP'] ?? win32.join(home, 'scoop')
    candidates.push(
      win32.join(scoop, 'apps', 'chromium', 'current', 'chrome.exe'),
      win32.join(scoop, 'apps', 'googlechrome', 'current', 'chrome.exe'),
      win32.join(scoop, 'apps', 'brave', 'current', 'brave.exe'),
      win32.join(scoop, 'shims', 'chromium.exe'),
      win32.join(scoop, 'shims', 'chrome.exe'),
    )
    const programData = env['ProgramData']
    if (programData !== undefined && programData !== '') {
      candidates.push(win32.join(programData, 'chocolatey', 'bin', 'chrome.exe'), win32.join(programData, 'chocolatey', 'bin', 'chromium.exe'))
    }
    for (const root of [env['ProgramFiles'], env['LOCALAPPDATA']]) {
      if (root === undefined || root === '') continue
      candidates.push(win32.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'))
    }
    // Edge often ships with remote debugging disabled by policy, so it is tried last.
    for (const root of [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']]) {
      if (root === undefined || root === '') continue
      candidates.push(win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    }
    return candidates
  }

  if (platform === 'darwin') {
    for (const root of ['/Applications', posix.join(home, 'Applications')]) {
      candidates.push(posix.join(root, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'))
      candidates.push(posix.join(root, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'))
      candidates.push(posix.join(root, 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'))
      candidates.push(posix.join(root, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
    }
    return candidates
  }

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
    candidates.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/snap/bin/${name}`)
  }
  return candidates
}

/**
 * Pick the first installed browser.
 * @param search - platform, environment, home, and an existence probe.
 * @returns the executable path, or undefined when none of the candidates exist.
 */
export async function findExecutable(search: ExecutableSearch): Promise<string | undefined> {
  for (const candidate of executableCandidates(search.platform, search.env, search.home)) {
    if (await search.exists(candidate)) return candidate
  }
  return undefined
}

/**
 * Describe what the search looked at, for an actionable error message.
 * @param search - platform, environment, and home.
 * @returns the candidate list as a readable line.
 */
export function describeSearch(search: Omit<ExecutableSearch, 'exists'>): string {
  return executableCandidates(search.platform, search.env, search.home)
    .map((candidate) => `\n  - ${candidate}`)
    .join('')
}

/**
 * Read the endpoint Chrome records in its profile directory.
 * @param userDataDir - the profile directory passed as `--user-data-dir`.
 * @returns the published endpoint, or undefined when it is absent or incomplete.
 */
export async function readActivePort(userDataDir: string): Promise<DevToolsEndpoint | undefined> {
  let raw: string
  try {
    raw = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')
  } catch {
    return undefined
  }
  const [portLine, pathLine] = raw.split('\n')
  const port = Number.parseInt(portLine?.trim() ?? '', 10)
  const path = pathLine?.trim() ?? ''
  if (!Number.isInteger(port) || port <= 0 || !path.startsWith('/')) return undefined
  return { port, path, wsUrl: `ws://127.0.0.1:${port}${path}` }
}

interface VersionInfo {
  readonly webSocketDebuggerUrl?: string
}

/**
 * Ask a DevTools HTTP endpoint for its browser WebSocket URL.
 * @param origin - `http://host:port`.
 * @param timeoutMs - probe budget.
 * @returns the browser WebSocket URL, or undefined when nothing answers.
 */
export async function probeVersion(origin: string, timeoutMs = 2_000): Promise<string | undefined> {
  try {
    const response = await fetch(`${origin.replace(/\/$/u, '')}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return undefined
    const info = (await response.json()) as VersionInfo
    return info.webSocketDebuggerUrl
  } catch {
    return undefined
  }
}

/**
 * Resolve a configured CDP address into a browser WebSocket URL.
 *
 * Accepts a `ws://` URL, or an HTTP origin such as `http://127.0.0.1:9222`
 * whose `/json/version` names the browser endpoint.
 * @param address - configured `cdpUrl`.
 * @param timeoutMs - probe budget.
 * @returns the browser WebSocket URL.
 */
export async function resolveCdpAddress(address: string, timeoutMs = 5_000): Promise<string> {
  const trimmed = address.trim()
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed
  const origin = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `http://${trimmed}`
  const wsUrl = await probeVersion(origin, timeoutMs)
  if (wsUrl === undefined) {
    throw new Error(`cannot reach a DevTools endpoint at ${origin}: start the browser with --remote-debugging-port=<port>, or clear cdpUrl to let the plugin launch its own`)
  }
  return wsUrl
}

/**
 * Attach to a browser already using a profile directory.
 * @param userDataDir - the profile directory.
 * @returns the live endpoint, or undefined when no browser owns that directory.
 */
export async function reuseBrowser(userDataDir: string): Promise<LaunchedBrowser | undefined> {
  const endpoint = await readActivePort(userDataDir)
  if (endpoint === undefined) return undefined
  const wsUrl = await probeVersion(`http://127.0.0.1:${endpoint.port}`)
  if (wsUrl === undefined) return undefined
  return { wsUrl, port: endpoint.port, child: undefined, owned: false }
}

/**
 * Start a browser and wait for its DevTools endpoint.
 * @param request - executable, profile, window, and extra flags.
 * @returns the running browser.
 */
export async function launchChrome(request: LaunchRequest): Promise<LaunchedBrowser> {
  const timeoutMs = request.startupTimeoutMs ?? 20_000
  await mkdir(request.userDataDir, { recursive: true })
  await rm(join(request.userDataDir, 'DevToolsActivePort'), { force: true })

  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${request.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--disable-sync',
    '--window-size=' + `${request.windowSize.width},${request.windowSize.height}`,
    '--window-position=48,48',
    ...(request.headless ? ['--headless=new'] : []),
    ...(request.extraArgs ?? []),
    'about:blank',
  ]
  const child = spawn(request.executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2_000)
  })
  let exited: { code: number | null; signal: string | null } | undefined
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })
  child.on('error', (error: Error) => {
    exited = { code: null, signal: null }
    stderr = `${stderr}\n${error.message}`
  })

  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      if (request.signal?.aborted === true) throw new Error('browser launch aborted')
      if (exited !== undefined) throw new Error(describeLaunchFailure(request.executable, request.userDataDir, stderr))
      const endpoint = await readActivePort(request.userDataDir)
      if (endpoint !== undefined && (await probeVersion(`http://127.0.0.1:${endpoint.port}`, 1_000)) !== undefined) {
        return { wsUrl: endpoint.wsUrl, port: endpoint.port, child, owned: true }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(
      `Chrome did not open a DevTools endpoint within ${timeoutMs}ms.${stderr === '' ? '' : `\n${stderr.trim()}`}\nRun "${request.executable}" manually with the same --user-data-dir to see why.`,
    )
  } catch (error) {
    await stopBrowser(child)
    throw error
  }
}

/**
 * Stop a browser this plugin started.
 * @param child - the process returned by {@link launchChrome}.
 */
export async function stopBrowser(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.pid === undefined) return
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    setTimeout(resolve, 2_000).unref()
  })
  child.kill()
  await exited
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await new Promise<void>((resolve) => killer.once('exit', () => resolve()))
    return
  }
  child.kill('SIGKILL')
}

/**
 * Explain why a browser that started anyway never published an endpoint.
 *
 * Edge ships with `RemoteDebuggingAllowed=false` on many machines and exits with
 * a message about remote debugging being disallowed; without naming that case
 * the operator sees a generic timeout and retries the same browser.
 * @param executable - the binary that was started.
 * @param userDataDir - the profile directory it was given.
 * @param stderr - whatever the process wrote before exiting.
 * @returns the message for the caller.
 */
export function describeLaunchFailure(executable: string, userDataDir: string, stderr: string): string {
  const detail = stderr.trim() === '' ? '' : `\n${stderr.trim()}`
  if (/remote debugging is disallowed|devtools remote debugging is disallowed/iu.test(stderr)) {
    return `"${executable}" refuses remote debugging on this machine, so the agent cannot drive it.${detail}\nInstall Chrome, Chromium, or Brave and let the plugin detect it, point executablePath at one of them, or set cdpUrl to a browser started with --remote-debugging-port.`
  }
  return `"${executable}" exited before its DevTools endpoint came up.${detail}\nThe profile directory ${userDataDir} may be in use by another browser instance; close it or change the profile name.`
}
