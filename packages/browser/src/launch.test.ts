import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { describeLaunchFailure, executableCandidates, findExecutable, readActivePort } from './launch.js'

const never = async (): Promise<boolean> => false
const existsOnly = (paths: string[]) => async (path: string): Promise<boolean> => paths.includes(path)

describe('executableCandidates', () => {
  it('covers the three Windows install roots per browser', () => {
    const candidates = executableCandidates('win32', {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    }, 'C:\\Users\\me')
    assert.ok(candidates.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'))
    assert.ok(candidates.includes('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'))
    assert.ok(candidates.includes('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'))
    assert.ok(candidates.includes('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'))
    assert.ok(candidates.some((candidate) => candidate.endsWith('brave.exe')))
  })

  it('finds package-manager installs outside Program Files', () => {
    const candidates = executableCandidates('win32', { SCOOP: 'D:\\scoop', ProgramData: 'C:\\ProgramData' }, 'C:\\Users\\me')
    assert.ok(candidates.includes('D:\\scoop\\apps\\chromium\\current\\chrome.exe'))
    assert.ok(candidates.includes('D:\\scoop\\shims\\chromium.exe'))
    assert.ok(candidates.includes('C:\\ProgramData\\chocolatey\\bin\\chrome.exe'))
    assert.ok(!candidates.includes('C:\\Users\\me\\scoop\\apps\\chromium\\current\\chrome.exe'))
  })

  it('uses the default scoop root when SCOOP is unset', () => {
    assert.ok(executableCandidates('win32', {}, 'C:\\Users\\me').includes('C:\\Users\\me\\scoop\\apps\\chromium\\current\\chrome.exe'))
  })

  it('tries Edge last, because it often refuses remote debugging', () => {
    const candidates = executableCandidates('win32', { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }, 'C:\\Users\\me')
    const firstEdge = candidates.findIndex((candidate) => candidate.endsWith('msedge.exe'))
    assert.ok(firstEdge > 0)
    assert.ok(candidates.slice(firstEdge).every((candidate) => candidate.endsWith('msedge.exe')))
  })

  it('covers the macOS application bundles', () => {
    const candidates = executableCandidates('darwin', {}, '/Users/me')
    assert.ok(candidates.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
    assert.ok(candidates.includes('/Users/me/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'))
  })

  it('covers the Linux package names', () => {
    const candidates = executableCandidates('linux', {}, '/home/me')
    assert.ok(candidates.includes('/usr/bin/google-chrome'))
    assert.ok(candidates.includes('/usr/bin/chromium'))
    assert.ok(candidates.includes('/snap/bin/chromium'))
  })

  it('puts an explicit override first', () => {
    const candidates = executableCandidates('win32', { CHROME_PATH: 'D:\\chrome.exe', ProgramFiles: 'C:\\Program Files' }, 'C:\\Users\\me')
    assert.equal(candidates[0], 'D:\\chrome.exe')
  })
})

describe('findExecutable', () => {
  it('returns the first installed candidate', async () => {
    const chosen = await findExecutable({ platform: 'linux', env: {}, home: '/home/me', exists: existsOnly(['/usr/local/bin/chromium', '/usr/bin/google-chrome']) })
    assert.equal(chosen, '/usr/bin/google-chrome')
  })

  it('returns undefined when nothing is installed', async () => {
    assert.equal(await findExecutable({ platform: 'linux', env: {}, home: '/home/me', exists: never }), undefined)
  })
})

describe('describeLaunchFailure', () => {
  it('names the policy that blocks Edge remote debugging', () => {
    const message = describeLaunchFailure('C:\\Edge\\msedge.exe', 'C:\\profile', 'DevTools remote debugging is disallowed by the system admin.')
    assert.match(message, /refuses remote debugging/u)
    assert.match(message, /Install Chrome, Chromium, or Brave/u)
  })

  it('falls back to the profile-lock explanation', () => {
    const message = describeLaunchFailure('C:\\Chrome\\chrome.exe', 'C:\\profile', '')
    assert.match(message, /profile directory C:\\profile may be in use/u)
    assert.doesNotMatch(message, /refuses remote debugging/u)
  })
})

describe('readActivePort', () => {
  it('parses the port and browser path Chrome publishes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-test-'))
    try {
      await writeFile(join(directory, 'DevToolsActivePort'), '51234\n/devtools/browser/abc-123\n')
      assert.deepEqual(await readActivePort(directory), {
        port: 51234,
        path: '/devtools/browser/abc-123',
        wsUrl: 'ws://127.0.0.1:51234/devtools/browser/abc-123',
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('ignores a half-written or missing file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-test-'))
    try {
      assert.equal(await readActivePort(directory), undefined)
      await writeFile(join(directory, 'DevToolsActivePort'), '51234\n')
      assert.equal(await readActivePort(directory), undefined)
      await writeFile(join(directory, 'DevToolsActivePort'), 'not-a-port\n/devtools/browser/x\n')
      assert.equal(await readActivePort(directory), undefined)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
