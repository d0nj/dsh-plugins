import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { candidateExists, diagnose, installRoots, resolveBash } from './resolve.js'
import type { Exists } from './resolve.js'

/** Probe that reports exactly the listed paths as spawnable files. */
function probeOf(...paths: readonly string[]): Exists {
  const present = new Set(paths)
  return (candidate) => {
    if (!present.has(candidate)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return { isFile: () => true, isSymbolicLink: () => false }
  }
}

/** No candidate exists anywhere. */
const noFiles: Exists = () => {
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

describe('installRoots', () => {
  it('orders Program Files before per-user installs', () => {
    const roots = installRoots({
      ProgramFiles: 'C:\\Program Files',
      ProgramW6432: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
    })
    assert.deepEqual(roots, [
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\Users\\dev\\AppData\\Local\\Programs',
    ])
  })

  it('deduplicates roots that point at the same directory', () => {
    const roots = installRoots({ ProgramFiles: 'C:\\Program Files', ProgramW6432: 'C:\\Program Files' })
    assert.deepEqual(roots, ['C:\\Program Files'])
  })

  it('strips surrounding quotes and ignores blank entries', () => {
    const roots = installRoots({ ProgramFiles: '  "D:\\Apps"  ', ProgramW6432: '   ' })
    assert.deepEqual(roots, ['D:\\Apps'])
  })

  it('returns nothing when the environment names no root', () => {
    assert.deepEqual(installRoots({}), [])
  })
})

describe('candidateExists', () => {
  it('accepts a regular file', () => {
    assert.equal(candidateExists('C:\\Git\\bin\\bash.exe', probeOf('C:\\Git\\bin\\bash.exe')), true)
  })

  it('accepts a symlink, which a Windows app alias may report as', () => {
    const link: Exists = () => ({ isFile: () => false, isSymbolicLink: () => true })
    assert.equal(candidateExists('C:\\alias', link), true)
  })

  it('rejects a directory', () => {
    const directory: Exists = () => ({ isFile: () => false, isSymbolicLink: () => false })
    assert.equal(candidateExists('C:\\Git', directory), false)
  })

  it('rejects a missing path without throwing', () => {
    assert.equal(candidateExists('C:\\nope', noFiles), false)
  })
})

describe('resolveBash', () => {
  it('prefers an explicit bashPath over every probe', () => {
    const resolved = resolveBash({
      configured: 'D:\\tools\\bash.exe',
      env: { GITBASH_PATH: 'E:\\env\\bash.exe', ProgramFiles: 'C:\\Program Files' },
      platform: 'win32',
      probe: probeOf('C:\\Program Files\\Git\\bin\\bash.exe'),
    })
    assert.deepEqual(resolved, { executable: 'D:\\tools\\bash.exe', origin: 'config' })
  })

  it('ignores a blank or whitespace-only bashPath', () => {
    const resolved = resolveBash({
      configured: '   ',
      env: { ProgramFiles: 'C:\\Program Files' },
      platform: 'win32',
      probe: probeOf('C:\\Program Files\\Git\\bin\\bash.exe'),
    })
    assert.deepEqual(resolved, { executable: 'C:\\Program Files\\Git\\bin\\bash.exe', origin: 'install' })
  })

  it('prefers GITBASH_PATH over install probing', () => {
    const resolved = resolveBash({
      env: { GITBASH_PATH: 'E:\\portable\\bin\\bash.exe', ProgramFiles: 'C:\\Program Files' },
      platform: 'win32',
      probe: probeOf('C:\\Program Files\\Git\\bin\\bash.exe'),
    })
    assert.deepEqual(resolved, { executable: 'E:\\portable\\bin\\bash.exe', origin: 'environment' })
  })

  it('finds a Git for Windows install outside Program Files', () => {
    const resolved = resolveBash({
      env: { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
      platform: 'win32',
      probe: probeOf('C:\\Users\\dev\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'),
    })
    assert.deepEqual(resolved, {
      executable: 'C:\\Users\\dev\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
      origin: 'install',
    })
  })

  it('falls through bin to usr\\bin when the launcher is missing', () => {
    const resolved = resolveBash({
      env: { ProgramFiles: 'C:\\Program Files' },
      platform: 'win32',
      probe: probeOf('C:\\Program Files\\Git\\usr\\bin\\bash.exe'),
    })
    assert.deepEqual(resolved, { executable: 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', origin: 'install' })
  })

  it('falls back to the bare name when no install is present', () => {
    const resolved = resolveBash({ env: { ProgramFiles: 'C:\\Program Files' }, platform: 'win32', probe: noFiles })
    assert.deepEqual(resolved, { executable: 'bash', origin: 'path' })
  })

  it('skips install probing on a non-Windows host', () => {
    const resolved = resolveBash({
      env: { ProgramFiles: 'C:\\Program Files' },
      platform: 'linux',
      probe: probeOf('C:\\Program Files\\Git\\bin\\bash.exe'),
    })
    assert.deepEqual(resolved, { executable: 'bash', origin: 'path' })
  })
})

describe('diagnose', () => {
  it('reports the discovered install', () => {
    assert.match(diagnose({ executable: 'C:\\Git\\bin\\bash.exe', origin: 'install' }) ?? '', /C:\\Git\\bin\\bash\.exe/)
  })

  it('warns when only PATH can supply bash', () => {
    assert.match(diagnose({ executable: 'bash', origin: 'path' }) ?? '', /PATH/)
  })

  it('stays quiet for an explicit choice', () => {
    assert.equal(diagnose({ executable: 'bash', origin: 'config' }), undefined)
    assert.equal(diagnose({ executable: 'bash', origin: 'environment' }), undefined)
  })
})
