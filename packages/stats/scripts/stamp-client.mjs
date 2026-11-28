import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ID = '@d0nj/dsh-stats'
const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(resolve(here, '..'), 'dist')
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
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => {
          const parts = entry.split(/\s+as\s+/u).map((part) => part.trim())
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
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => {
          const parts = entry.split(/\s+as\s+/u).map((part) => part.trim())
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
    body += '\nObject.assign(exports, { ' + exported.map((name) => name + ': ' + name).join(', ') + ' });\n'
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

const quote = String.fromCharCode(39)
const envelope = [
  'window.__ModuleLoader__.load({',
  '  id: ' + JSON.stringify(PACKAGE_ID) + ',',
  '  factory(require) {',
  '    const __modules = new Map()',
  '    function __require(id) {',
  '      if (__modules.has(id)) return __modules.get(id)',
  '      const factory = __factories[id]',
  '      if (factory === undefined) throw new Error(' + JSON.stringify(PACKAGE_ID + ': unknown module ') + ' + id)',
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
  '    if (typeof entry.useReact === ' + quote + 'function' + quote + ') entry.useReact(require(' + quote + 'react' + quote + '))',
  '    return entry',
  '  },',
  '});',
  '',
].join('\n')

writeFileSync(join(clientDir, 'client.js'), envelope)
console.log('stamped ' + PACKAGE_ID + ' client envelope: ' + String(emitted.size) + ' modules')
