/**
 * One browser tab, driven over CDP.
 *
 * Every mutating operation follows the same shape: resolve the target, check it
 * is actually visible, perform the action with real input events, wait for the
 * document to settle, and invalidate refs when the document was replaced.
 *
 * @module @d0nj/dsh-browser/tab
 */
import type { CdpClient, CdpParams } from './cdp.js'
import { ConsoleBuffer, describeRemoteObject } from './console.js'
import type { RemoteObjectLike } from './console.js'
import { parseKeyChord } from './keys.js'
import { renderAccessibilityTree } from './snapshot.js'
import type { AxNode, SnapshotResult } from './snapshot.js'

/** How a tab behaves. */
export interface TabSettings {
  readonly viewport: { readonly width: number; readonly height: number }
  readonly dialogs: 'accept' | 'dismiss'
  readonly navigateTimeoutMs: number
}

/** What to operate on: a snapshot ref, or a CSS selector as the escape hatch. */
export interface ElementTarget {
  readonly ref?: string | undefined
  readonly selector?: string | undefined
}

/** Upload a browser-style click or keyboard key name. */
export type MouseButton = 'left' | 'right' | 'middle'

/** A captured PNG screenshot. */
export interface TabScreenshot {
  readonly data: Buffer
  readonly width: number
  readonly height: number
}

/** Page identity. */
export interface PageInfo {
  readonly url: string
  readonly title: string
}

interface BoxInfo {
  readonly ok: boolean
  readonly reason?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly visible?: boolean
  readonly disabled?: boolean
  readonly tag?: string
}

interface CallResult<T> {
  readonly result?: { readonly value?: T; readonly subtype?: string; readonly objectId?: string }
  readonly exceptionDetails?: { readonly text?: string; readonly exception?: { readonly description?: string } }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const SCROLL_AND_MEASURE = `function () {
  const element = this;
  if (!(element instanceof Element)) return { ok: false, reason: 'not-an-element' };
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return {
    ok: true,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number.parseFloat(style.opacity || '1') > 0,
    disabled: ('disabled' in element && element.disabled === true) || element.getAttribute('aria-disabled') === 'true',
    tag: element.tagName.toLowerCase(),
  };
}`

const MEASURE_DOCUMENT_BOX = `function () {
  const element = this;
  if (!(element instanceof Element)) return { ok: false, reason: 'not-an-element' };
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = element.getBoundingClientRect();
  return { ok: true, x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
}`

const FOCUS_FOR_TYPING = `function (clear) {
  const element = this;
  if (!(element instanceof Element)) return { ok: false, reason: 'not-an-element' };
  element.scrollIntoView({ block: 'center', inline: 'center' });
  if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  if (!clear) return { ok: true };
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter === undefined ? (element.value = '') : setter.call(element, '');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  }
  if (element.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return { ok: true };
  }
  return { ok: true };
}`

const SELECT_OPTIONS = `function (values) {
  const element = this;
  if (!(element instanceof HTMLSelectElement)) return { ok: false, reason: 'not-a-select' };
  const wanted = new Set(values);
  let changed = false;
  for (const option of Array.from(element.options)) {
    const selected = wanted.has(option.value) || wanted.has(option.label);
    if (option.selected !== selected) {
      option.selected = selected;
      changed = true;
    }
  }
  if (changed) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { ok: true, selected: Array.from(element.selectedOptions).map((option) => option.label || option.value) };
}`

const BUTTON_MASK: Readonly<Record<MouseButton, number>> = { left: 1, right: 2, middle: 4 }

/** Schemes a navigation may use; anything else is refused before it reaches Chrome. */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'file', 'about', 'data'])

/**
 * Normalize model-supplied link text into an absolute URL.
 * @param input - absolute URL, bare host, or `localhost:port`.
 * @returns the URL to navigate to.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') throw new Error('url is required: pass an absolute URL such as https://example.com')
  if (/^javascript:/iu.test(trimmed)) throw new Error('javascript: URLs are not allowed; use evaluate to run page JavaScript')
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme !== undefined && ALLOWED_SCHEMES.has(scheme)) return new URL(trimmed).toString()
  const hostLike = /^(\[[0-9a-f:]+\]|localhost|127\.0\.0\.1|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/|$)/iu.test(trimmed)
  if (hostLike) {
    const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])/iu.test(trimmed)
    try {
      return new URL(`${loopback ? 'http' : 'https'}://${trimmed}`).toString()
    } catch {
      // Fall through to the unsupported-scheme or not-a-URL message.
    }
  }
  if (scheme !== undefined) throw new Error(`"${trimmed}" uses the unsupported ${scheme}: scheme; pass an http(s) URL or a bare host such as example.com`)
  throw new Error(`"${trimmed}" is not a URL; pass an absolute URL such as https://example.com/search?q=cats`)
}

/**
 * Interpret a model-supplied selector, accepting the ref spellings agents copy
 * out of a snapshot (`e12`, `@e12`, `aria-ref=e12`).
 * @param selector - raw selector text.
 * @returns the ref it names, when it names one.
 */
export function refFromSelector(selector: string): string | undefined {
  const trimmed = selector.trim()
  const explicit = /^(?:aria-ref=|aria-ref\/|@)(e\d+)$/iu.exec(trimmed)
  if (explicit?.[1] !== undefined) return explicit[1]
  return /^(e\d+)$/u.test(trimmed) ? trimmed : undefined
}

/** One attached tab. */
export class Tab {
  readonly name: string
  readonly targetId: string
  readonly sessionId: string
  readonly #cdp: CdpClient
  readonly #settings: TabSettings
  readonly #console = new ConsoleBuffer()
  readonly #disposers: Array<() => void> = []
  #refs = new Map<string, number>()
  #documentGeneration = 0
  #closed = false

  private constructor(cdp: CdpClient, targetId: string, sessionId: string, name: string, settings: TabSettings) {
    this.#cdp = cdp
    this.targetId = targetId
    this.sessionId = sessionId
    this.name = name
    this.#settings = settings
  }

  /**
   * Attach to one page target and enable the domains this tab uses.
   * @param cdp - browser-level connection.
   * @param targetId - page target to attach to.
   * @param name - tab name the model addresses.
   * @param settings - viewport, dialogs, and timeouts.
   * @returns the ready tab.
   */
  static async attach(cdp: CdpClient, targetId: string, name: string, settings: TabSettings): Promise<Tab> {
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    const tab = new Tab(cdp, targetId, sessionId, name, settings)
    await tab.#initialize()
    return tab
  }

  /** Whether the tab can still be used. */
  get closed(): boolean {
    return this.#closed
  }

  /** The tab's captured console and page errors. */
  get consoleBuffer(): ConsoleBuffer {
    return this.#console
  }

  async #initialize(): Promise<void> {
    const sessionId = this.sessionId
    await this.#cdp.send('Page.enable', {}, sessionId)
    await this.#cdp.send('Runtime.enable', {}, sessionId)
    await this.#cdp.send('Log.enable', {}, sessionId)
    await this.#cdp.send('Accessibility.enable', {}, sessionId)
    await this.#cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: this.#settings.viewport.width, height: this.#settings.viewport.height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )
    this.#disposers.push(
      this.#cdp.on('Runtime.consoleAPICalled', (event) => this.#onConsole(event.params), sessionId),
      this.#cdp.on('Runtime.exceptionThrown', (event) => this.#onException(event.params), sessionId),
      this.#cdp.on('Log.entryAdded', (event) => this.#onLogEntry(event.params), sessionId),
      this.#cdp.on('Page.javascriptDialogOpening', (event) => void this.#onDialog(event.params), sessionId),
      this.#cdp.on(
        'Page.frameNavigated',
        (event) => {
          const frame = event.params.frame as { parentId?: string } | undefined
          if (frame?.parentId !== undefined) return
          this.#documentGeneration++
          this.#refs.clear()
        },
        sessionId,
      ),
      this.#cdp.on('Inspector.targetCrashed', () => {
        this.#closed = true
      }, sessionId),
      this.#cdp.on('Target.detachedFromTarget', (event) => {
        if (event.params.sessionId === sessionId) this.#closed = true
      }),
    )
  }

  /** Detach and stop listening. */
  async dispose(): Promise<void> {
    this.#closed = true
    for (const dispose of this.#disposers.splice(0)) dispose()
    await this.#cdp.send('Target.detachFromTarget', { sessionId: this.sessionId }).catch(() => undefined)
  }

  #onConsole(params: CdpParams): void {
    const type = typeof params.type === 'string' ? params.type : 'log'
    const args = Array.isArray(params.args) ? (params.args as RemoteObjectLike[]) : []
    const text = args.map((argument) => describeRemoteObject(argument)).filter((part) => part !== '').join(' ')
    this.#console.push(type === 'warning' ? 'warning' : type, text)
  }

  #onException(params: CdpParams): void {
    const details = params.exceptionDetails as { text?: string; exception?: RemoteObjectLike; url?: string } | undefined
    const description = describeRemoteObject(details?.exception) || details?.text || 'uncaught exception'
    this.#console.push('pageerror', details?.url === undefined ? description : `${description} (${details.url})`)
  }

  #onLogEntry(params: CdpParams): void {
    const entry = params.entry as { level?: string; text?: string; url?: string } | undefined
    const level = entry?.level === 'warning' ? 'warning' : (entry?.level ?? 'log')
    const text = entry?.text ?? ''
    this.#console.push(level, entry?.url === undefined ? text : `${text} (${entry.url})`)
  }

  async #onDialog(params: CdpParams): Promise<void> {
    const type = typeof params.type === 'string' ? params.type : 'dialog'
    const message = typeof params.message === 'string' ? params.message : ''
    const accept = this.#settings.dialogs === 'accept'
    this.#console.push('dialog', `${type}: ${message}`)
    await this.#cdp.send('Page.handleJavaScriptDialog', { accept }, this.sessionId).catch(() => undefined)
  }

  /**
   * Evaluate one expression in the page.
   * @param expression - JavaScript expression.
   * @param timeoutMs - execution budget.
   * @returns the deserialized value.
   */
  async evaluate<T = unknown>(expression: string, timeoutMs = 30_000): Promise<T> {
    const response = await this.#cdp.send<CallResult<T>>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, this.sessionId, timeoutMs)
    if (response.exceptionDetails !== undefined) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'the page threw an exception')
    }
    return response.result?.value as T
  }

  async #callOn<T>(objectId: string, functionDeclaration: string, args: readonly unknown[] = []): Promise<T> {
    const response = await this.#cdp.send<CallResult<T>>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      returnByValue: true,
      awaitPromise: true,
      arguments: args.map((value) => ({ value })),
    }, this.sessionId)
    if (response.exceptionDetails !== undefined) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'the element threw an exception')
    }
    if (response.result?.value === undefined) throw new Error('the element returned no value')
    return response.result.value
  }

  /**
   * Current URL and title.
   * @returns page identity, or empty strings when the page is unreachable.
   */
  async info(): Promise<PageInfo> {
    try {
      const value = await this.evaluate<{ url?: string; title?: string }>('({ url: location.href, title: document.title })', 5_000)
      return { url: value.url ?? '', title: value.title ?? '' }
    } catch {
      return { url: '', title: '' }
    }
  }

  /**
   * Navigate the tab.
   * @param input - URL, bare host, or localhost address.
   * @param timeoutMs - load budget.
   * @returns the committed URL.
   */
  async navigate(input: string, timeoutMs = this.#settings.navigateTimeoutMs): Promise<string> {
    const url = normalizeUrl(input)
    const committed = this.#cdp
      .waitFor('Page.frameNavigated', {
        sessionId: this.sessionId,
        timeoutMs,
        predicate: (params) => (params.frame as { parentId?: string } | undefined)?.parentId === undefined,
      })
      .catch(() => undefined)
    const result = await this.#cdp.send<{ errorText?: string }>('Page.navigate', { url }, this.sessionId, timeoutMs)
    if (typeof result.errorText === 'string' && result.errorText !== '') throw new Error(`cannot open ${url}: ${result.errorText}`)
    await committed
    await this.#waitForReady(timeoutMs)
    return url
  }

  /** Go back one history entry. */
  async back(timeoutMs = this.#settings.navigateTimeoutMs): Promise<void> {
    await this.#travel(-1, timeoutMs)
  }

  /** Go forward one history entry. */
  async forward(timeoutMs = this.#settings.navigateTimeoutMs): Promise<void> {
    await this.#travel(1, timeoutMs)
  }

  async #travel(offset: number, timeoutMs: number): Promise<void> {
    const history = await this.#cdp.send<{ currentIndex: number; entries: unknown[] }>('Page.getNavigationHistory', {}, this.sessionId)
    const target = history.currentIndex + offset
    if (target < 0 || target >= history.entries.length) return
    const committed = this.#cdp
      .waitFor('Page.frameNavigated', {
        sessionId: this.sessionId,
        timeoutMs,
        predicate: (params) => (params.frame as { parentId?: string } | undefined)?.parentId === undefined,
      })
      .catch(() => undefined)
    await this.#cdp.send('Page.navigateToHistoryEntry', { entryId: (history.entries[target] as { id: number }).id }, this.sessionId, timeoutMs)
    await committed
    await this.#waitForReady(timeoutMs)
  }

  /** Reload the current document. */
  async reload(timeoutMs = this.#settings.navigateTimeoutMs): Promise<void> {
    const committed = this.#cdp
      .waitFor('Page.frameNavigated', {
        sessionId: this.sessionId,
        timeoutMs,
        predicate: (params) => (params.frame as { parentId?: string } | undefined)?.parentId === undefined,
      })
      .catch(() => undefined)
    await this.#cdp.send('Page.reload', {}, this.sessionId, timeoutMs)
    await committed
    await this.#waitForReady(timeoutMs)
  }

  async #waitForReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const state = await this.evaluate<string>('document.readyState', 5_000)
        if (state === 'complete') return
      } catch {
        // The execution context is replaced while a navigation commits.
      }
      if (Date.now() >= deadline) return
      await delay(100)
    }
  }

  async #resolveElement(target: ElementTarget): Promise<{ objectId: string; label: string }> {
    const ref = target.ref ?? (target.selector === undefined ? undefined : refFromSelector(target.selector))
    if (ref !== undefined) {
      const backendNodeId = this.#refs.get(ref)
      if (backendNodeId === undefined) {
        throw new Error(
          `unknown ref "${ref}" in tab "${this.name}": refs are numbered per snapshot and cleared when the page navigates. Call snapshot (or any action that returns one) and use a ref from that output.`,
        )
      }
      try {
        const resolved = await this.#cdp.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId, objectGroup: 'dsh-browser' }, this.sessionId)
        if (resolved.object.objectId === undefined) throw new Error('no object')
        return { objectId: resolved.object.objectId, label: `ref "${ref}"` }
      } catch {
        throw new Error(`ref "${ref}" no longer exists in tab "${this.name}": the page changed since the snapshot. Take a new snapshot and use a current ref.`)
      }
    }
    const selector = target.selector?.trim() ?? ''
    if (selector === '') throw new Error('name the target with ref (from a snapshot) or selector')
    const response = await this.#cdp.send<CallResult<unknown>>('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: false,
    }, this.sessionId)
    if (response.exceptionDetails !== undefined) {
      throw new Error(`selector "${selector}" is not a valid CSS selector: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'parse error'}`)
    }
    const objectId = response.result?.objectId
    if (objectId === undefined || response.result?.subtype === 'null') {
      throw new Error(`selector "${selector}" matched no element in tab "${this.name}"; take a snapshot to find a ref, or check the selector`)
    }
    return { objectId, label: `selector "${selector}"` }
  }

  async #box(objectId: string): Promise<BoxInfo> {
    return this.#callOn<BoxInfo>(objectId, SCROLL_AND_MEASURE)
  }

  async #dispatchMouse(type: string, x: number, y: number, button: MouseButton, clickCount: number): Promise<void> {
    await this.#cdp.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button,
      clickCount,
      buttons: type === 'mousePressed' ? BUTTON_MASK[button] : 0,
    }, this.sessionId)
  }

  /**
   * Click an element with real mouse events at its centre.
   * @param target - snapshot ref or selector.
   * @param options - button and click count.
   */
  async click(target: ElementTarget, options: { button?: MouseButton; clickCount?: number } = {}): Promise<void> {
    const { objectId, label } = await this.#resolveElement(target)
    const box = await this.#box(objectId)
    if (box.ok !== true) throw new Error(`cannot click ${label}: the target is not an element`)
    if (box.visible !== true) throw new Error(`cannot click ${label}: the element is not visible (hidden, zero size, or transparent); take a snapshot to pick a visible target`)
    const button = options.button ?? 'left'
    const clickCount = options.clickCount ?? 1
    await this.#dispatchMouse('mouseMoved', box.x as number, box.y as number, button, 0)
    await this.#dispatchMouse('mousePressed', box.x as number, box.y as number, button, clickCount)
    await this.#dispatchMouse('mouseReleased', box.x as number, box.y as number, button, clickCount)
    await this.#settle()
  }

  /**
   * Move the pointer over an element without clicking.
   * @param target - snapshot ref or selector.
   */
  async hover(target: ElementTarget): Promise<void> {
    const { objectId, label } = await this.#resolveElement(target)
    const box = await this.#box(objectId)
    if (box.ok !== true || box.visible !== true) throw new Error(`cannot hover ${label}: the element is not visible`)
    await this.#dispatchMouse('mouseMoved', box.x as number, box.y as number, 'left', 0)
    await delay(100)
  }

  /**
   * Focus a field and type into it.
   * @param target - snapshot ref or selector.
   * @param text - text to insert.
   * @param options - `clear` replaces the current value (default true); `submit` presses Enter.
   */
  async type(target: ElementTarget, text: string, options: { clear?: boolean; submit?: boolean } = {}): Promise<void> {
    const { objectId, label } = await this.#resolveElement(target)
    const box = await this.#box(objectId)
    if (box.ok === true && box.visible !== true) throw new Error(`cannot type into ${label}: the element is not visible`)
    const focused = await this.#callOn<{ ok: boolean; reason?: string }>(objectId, FOCUS_FOR_TYPING, [options.clear !== false])
    if (focused.ok !== true) throw new Error(`cannot type into ${label}: ${focused.reason ?? 'the element cannot take focus'}`)
    if (text !== '') await this.#cdp.send('Input.insertText', { text }, this.sessionId)
    if (options.submit === true) await this.press('Enter')
    else await this.#settle()
  }

  /**
   * Press one key or chord in the focused element, or after focusing a target.
   * @param key - chord such as `Enter` or `Control+A`.
   * @param target - element to focus first.
   */
  async press(key: string, target?: ElementTarget): Promise<void> {
    if (target !== undefined) await this.focus(target)
    const stroke = parseKeyChord(key)
    const base = { key: stroke.key, code: stroke.code, windowsVirtualKeyCode: stroke.keyCode, nativeVirtualKeyCode: stroke.keyCode, modifiers: stroke.modifiers }
    await this.#cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown', ...(stroke.text === undefined ? {} : { text: stroke.text }) }, this.sessionId)
    await this.#cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, this.sessionId)
    await this.#settle()
  }

  /**
   * Focus an element.
   * @param target - snapshot ref or selector.
   */
  async focus(target: ElementTarget): Promise<void> {
    const { objectId } = await this.#resolveElement(target)
    await this.#callOn(objectId, FOCUS_FOR_TYPING, [false])
  }

  /**
   * Choose options in a `<select>`.
   * @param target - snapshot ref or selector naming the select element.
   * @param values - option values or labels.
   * @returns the labels that ended up selected.
   */
  async select(target: ElementTarget, values: readonly string[]): Promise<string[]> {
    const { objectId, label } = await this.#resolveElement(target)
    const result = await this.#callOn<{ ok: boolean; reason?: string; selected?: string[] }>(objectId, SELECT_OPTIONS, [values])
    if (result.ok !== true) throw new Error(`cannot select in ${label}: ${result.reason === 'not-a-select' ? 'the element is not a <select>' : (result.reason ?? 'unknown reason')}`)
    await this.#settle()
    return result.selected ?? []
  }

  /**
   * Scroll the page with a mouse wheel.
   * @param options - direction, wheel notches, and optionally an element to aim at.
   */
  async scroll(options: { amount?: number; up?: boolean; target?: ElementTarget } = {}): Promise<void> {
    const notches = options.amount ?? 3
    const delta = (options.up === true ? -1 : 1) * notches * 100
    let x = Math.round(this.#settings.viewport.width / 2)
    let y = Math.round(this.#settings.viewport.height / 2)
    if (options.target !== undefined) {
      const { objectId } = await this.#resolveElement(options.target)
      const box = await this.#box(objectId)
      if (box.ok === true) {
        x = Math.round(box.x as number)
        y = Math.round(box.y as number)
      }
    }
    await this.#cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: delta }, this.sessionId)
    await delay(250)
  }

  /**
   * Wait for text or a selector to appear.
   * @param options - condition and budget.
   * @returns what was observed, or throws when the budget expires.
   */
  async waitFor(options: { text?: string; selector?: string; timeoutMs?: number }): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 10_000
    const deadline = Date.now() + timeoutMs
    const text = options.text
    const selector = options.selector
    for (;;) {
      try {
        if (selector !== undefined) {
          const found = await this.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, 5_000)
          if (found) return
        } else if (text !== undefined) {
          const present = await this.evaluate<boolean>(`document.body instanceof HTMLElement && document.body.innerText.includes(${JSON.stringify(text)})`, 5_000)
          if (present) return
        } else {
          return
        }
      } catch {
        // The document was being replaced; retry until the budget expires.
      }
      if (Date.now() >= deadline) {
        const what = selector === undefined ? `text ${JSON.stringify(text ?? '')}` : `selector "${selector ?? ''}"`
        throw new Error(`${what} did not appear in tab "${this.name}" within ${timeoutMs}ms; take a snapshot to see the current page`)
      }
      await delay(150)
    }
  }

  /**
   * Read the page as a numbered accessibility outline.
   * @param options - scope selector and budgets.
   * @returns the outline and its ref table, which replaces the previous one.
   */
  async snapshot(options: { selector?: string; maxChars?: number; maxNodes?: number } = {}): Promise<SnapshotResult> {
    let rootBackendNodeId: number | undefined
    if (options.selector !== undefined) {
      const { objectId } = await this.#resolveElement({ selector: options.selector })
      const described = await this.#cdp.send<{ node: { backendNodeId: number } }>('DOM.describeNode', { objectId }, this.sessionId)
      rootBackendNodeId = described.node.backendNodeId
    }
    const tree = await this.#cdp.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree', {}, this.sessionId, 60_000)
    const rendered = renderAccessibilityTree(tree.nodes, {
      maxChars: options.maxChars ?? 12_000,
      maxNodes: options.maxNodes ?? 1_500,
      ...(rootBackendNodeId === undefined ? {} : { rootBackendNodeId }),
    })
    this.#refs = new Map(rendered.refs)
    return rendered
  }

  /**
   * Capture a PNG.
   * @param options - viewport, full page, or one element.
   * @returns the image bytes and their pixel size.
   */
  async screenshot(options: { fullPage?: boolean; target?: ElementTarget } = {}): Promise<TabScreenshot> {
    if (options.target !== undefined) {
      const { objectId } = await this.#resolveElement(options.target)
      const box = await this.#callOn<BoxInfo>(objectId, MEASURE_DOCUMENT_BOX)
      if (box.ok !== true || box.width === undefined || box.height === undefined) throw new Error('cannot screenshot that element: it is not an element')
      if (box.width < 1 || box.height < 1) throw new Error('cannot screenshot that element: it has zero size')
      const clip = { x: box.x as number, y: box.y as number, width: box.width, height: box.height, scale: 1 }
      return this.#capture({ clip, width: clip.width, height: clip.height })
    }
    if (options.fullPage === true) {
      const metrics = await this.#cdp.send<{ cssContentSize?: { width: number; height: number }; contentSize: { width: number; height: number } }>(
        'Page.getLayoutMetrics',
        {},
        this.sessionId,
      )
      const size = metrics.cssContentSize ?? metrics.contentSize
      const height = Math.min(Math.ceil(size.height), 6_000)
      const width = Math.min(Math.ceil(size.width), this.#settings.viewport.width * 3)
      return this.#capture({ clip: { x: 0, y: 0, width, height, scale: 1 }, width, height })
    }
    return this.#capture({ width: this.#settings.viewport.width, height: this.#settings.viewport.height })
  }

  async #capture(options: { clip?: { x: number; y: number; width: number; height: number; scale: number }; width: number; height: number }): Promise<TabScreenshot> {
    const response = await this.#cdp.send<{ data: string }>(
      'Page.captureScreenshot',
      {
        format: 'png',
        fromSurface: true,
        ...(options.clip === undefined ? {} : { clip: options.clip, captureBeyondViewport: true }),
      },
      this.sessionId,
      60_000,
    )
    return { data: Buffer.from(response.data, 'base64'), width: options.width, height: options.height }
  }

  /** The document generation, which advances whenever the page navigates. */
  get documentGeneration(): number {
    return this.#documentGeneration
  }

  async #settle(): Promise<void> {
    await delay(120)
    await this.#waitForReady(Math.min(this.#settings.navigateTimeoutMs, 10_000))
  }
}
