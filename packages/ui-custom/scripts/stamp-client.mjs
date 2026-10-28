/**
 * Wrap the compiled client module in the Harness module-loader envelope.
 *
 * The Host serves a browser plugin as a `window.__ModuleLoader__.load` call whose
 * factory returns the module's exports object. `tsc` emits plain ESM, which that
 * loader cannot execute, so this stamps the emitted client into the envelope at
 * build time rather than adding a second bundler to the monorepo.
 *
 * @module scripts/stamp-client
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const distDir = join(packageRoot, 'dist')
const clientDir = join(distDir, 'client')
const ENTRY = join(clientDir, 'index.js')

const idOf = (file) => relative(distDir, file).replaceAll('\\', '/')
const emitted = new Map()

function transform(file) {
  const source = readFileSync(file, 'utf8')
  const needs = new Set()
  const exported = []

  const requireFor = (spec) => {
    if (!spec.startsWith('.')) {
      throw new Error(
        idOf(file) + ' imports "' + spec + '"; the client envelope can only resolve relative modules. ' +
          'Take the dependency from the loader require instead.',
      )
    }
    const id = idOf(resolve(dirname(file), spec))
    needs.add(id)
    return id
  }

  let body = source
    .replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?$/gmu, (_all, names, spec) => {
      const bindings = String(names)
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0)
        .map((e) => {
          const parts = e.split(/\s+as\s+/u).map((p) => p.trim())
          return parts.length === 1 ? parts[0] : parts[0] + ': ' + parts[1]
        })
        .join(', ')
      return 'const { ' + bindings + " } = __require('./" + requireFor(spec) + "');"
    })
    .replace(/^import\s+(\w+)\s+from\s*'([^']+)';?$/gmu, (_all, local, spec) => {
      return 'const ' + local + " = __require('./" + requireFor(spec) + "');"
    })
    .replace(/^export\s*\{([^}]*)\};?$/gmu, (_all, names) => {
      const bindings = String(names)
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0)
        .map((e) => {
          const parts = e.split(/\s+as\s+/u).map((p) => p.trim())
          return parts.length === 1 ? parts[0] + ': ' + parts[0] : parts[1] + ': ' + parts[0]
        })
        .join(', ')
      return 'Object.assign(exports, { ' + bindings + ' });'
    })
    .replace(/^export\s+default\s+/gmu, 'exports.default = ')
    .replace(/^export\s+(?:async\s+)?(?:function|class)\s+(\w+)/gmu, (match, name) => {
      exported.push(name)
      return match.replace(/^export\s+/u, '')
    })
    .replace(/^export\s+(?:const|let|var)\s+(\w+)/gmu, (match, name) => {
      exported.push(name)
      return match.replace(/^export\s+/u, '')
    })

  if (exported.length > 0) {
    body += '\nObject.assign(exports, { ' + exported.map((n) => n + ': ' + n).join(', ') + ' });\n'
  }
  return { body, needs: [...needs] }
}

function emit(file) {
  const id = idOf(file)
  if (emitted.has(id)) return
  emitted.set(id, '')
  const { body, needs } = transform(file)
  for (const need of needs) emit(join(distDir, need))
  emitted.set(id, body)
}

emit(ENTRY)

const factories = [...emitted.entries()]
  .map(([id, body]) => {
    const indented = body.split('\n').map((line) => '        ' + line).join('\n')
    return '      ' + JSON.stringify('./' + id) + ': (module, exports, __require) => {\n' + indented + '\n      },'
  })
  .join('\n')

const envelope = [
  'window.__ModuleLoader__.load({',
  "  id: '@d0nj/dsh-ui-custom',",
  '  factory(require) {',
  '    const __modules = new Map()',
  '    function __require(id) {',
  '      if (__modules.has(id)) return __modules.get(id)',
  '      const factory = __factories[id]',
  "      if (factory === undefined) throw new Error('ui-custom: unknown module ' + id)",
  '      const module = { exports: {} }',
  '      __modules.set(id, module.exports)',
  '      factory(module, module.exports, __require)',
  '      __modules.set(id, module.exports)',
  '      return module.exports',
  '    }',
  '    const __factories = {',
  factories,
  '    }',
  '    const entry = __require(' + JSON.stringify('./' + idOf(ENTRY)) + ')',
  '    if (typeof entry.useReact === ' + String.fromCharCode(39) + 'function' + String.fromCharCode(39) + ') entry.useReact(require(' + String.fromCharCode(39) + 'react' + String.fromCharCode(39) + '))',
  '    return entry',
  '  },',
  '});',
  '',
].join('\n')

writeFileSync(join(clientDir, 'client.js'), envelope)
console.log('stamped client envelope: ' + String(emitted.size) + ' modules')