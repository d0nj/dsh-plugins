import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveDshHome, resolveSettings } from './index.js'

describe('resolveSettings', () => {
  it('starts headless with a desktop viewport', () => {
    const settings = resolveSettings({})
    assert.equal(settings.headless, true)
    assert.deepEqual(settings.viewport, { width: 1280, height: 900 })
    assert.equal(settings.toolName, 'browser')
    assert.equal(settings.dialogs, 'accept')
  })

  it('shows the window only when headless is false', () => {
    assert.equal(resolveSettings({ headless: false }).headless, false)
    assert.equal(resolveSettings({ headless: true }).headless, true)
  })

  it('closes an idle browser after a minute by default', () => {
    assert.equal(resolveSettings({}).idleCloseMs, 60_000)
    assert.equal(resolveSettings({ idleCloseSeconds: 0 }).idleCloseMs, 0)
    assert.equal(resolveSettings({ idleCloseSeconds: 120 }).idleCloseMs, 120_000)
    assert.equal(resolveSettings({ idleCloseSeconds: 99_999 }).idleCloseMs, 3_600_000)
  })

  it('keeps a profile directory under the harness home', () => {
    assert.match(resolveSettings({ profile: 'work' }).userDataDir, /browser[\\/]work$/u)
    assert.equal(resolveSettings({ userDataDir: 'D:\\profiles\\agent' }).userDataDir, 'D:\\profiles\\agent')
    assert.match(resolveSettings({ userDataDir: '   ' }).userDataDir, /browser[\\/]default$/u)
  })

  it('clamps sizes and budgets into their usable range', () => {
    const settings = resolveSettings({ width: 10, height: 99_999, navigateTimeoutMs: 1, maxSnapshotChars: 1 })
    assert.equal(settings.viewport.width, 320)
    assert.equal(settings.viewport.height, 2160)
    assert.equal(settings.navigateTimeoutMs, 1_000)
    assert.equal(settings.maxSnapshotChars, 2_000)
  })

  it('falls back for blank identifiers and drops blank launch args', () => {
    const settings = resolveSettings({ toolName: '  ', executablePath: ' ', cdpUrl: '', launchArgs: ['--proxy-server=x', ' ', ''] })
    assert.equal(settings.toolName, 'browser')
    assert.equal(settings.executablePath, undefined)
    assert.equal(settings.cdpUrl, undefined)
    assert.deepEqual(settings.launchArgs, ['--proxy-server=x'])
  })
})

describe('resolveDshHome', () => {
  it('honors DSH_HOME', () => {
    assert.equal(resolveDshHome({ DSH_HOME: 'D:\\harness' }), 'D:\\harness')
  })

  it('treats a blank DSH_HOME as unset', () => {
    assert.match(resolveDshHome({ DSH_HOME: '   ' }), /\.dsh$/u)
  })
})
