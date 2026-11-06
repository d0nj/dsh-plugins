/**
 * Pins the two things that break the picker silently: a duplicate family name,
 * and a slug the mirror does not have a directory for.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HOSTED_FONTS,
  findHostedFont,
  fontSlug,
  hostedFamilies,
  hostedFontUrl,
  loadHostedFont,
} from './client/hosted-fonts.js'

describe('HOSTED_FONTS', () => {
  it('has unique family names', () => {
    const names = HOSTED_FONTS.map((font) => font.family.toLowerCase())
    assert.equal(new Set(names).size, names.length)
  })

  it('gives every family a name and a known category', () => {
    for (const font of HOSTED_FONTS) {
      assert.ok(font.family.trim() !== '', 'a family needs a name')
      assert.ok(
        ['sans', 'serif', 'mono', 'display'].includes(font.category),
        `${font.family} has an unknown category`,
      )
    }
  })

  it('offers monospace families for code', () => {
    assert.ok(HOSTED_FONTS.some((font) => font.category === 'mono'))
  })
})

describe('fontSlug', () => {
  it('lowercases and joins words with dashes', () => {
    assert.equal(fontSlug('IBM Plex Mono'), 'ibm-plex-mono')
    assert.equal(fontSlug('SF Mono'), 'sf-mono')
    assert.equal(fontSlug('Inter'), 'inter')
  })

  it('produces a bare path segment for every family', () => {
    for (const font of HOSTED_FONTS) {
      assert.match(fontSlug(font.family), /^[a-z0-9-]+$/u, font.family)
    }
  })
})

describe('hostedFontUrl', () => {
  it('addresses the mirror stylesheet of a family', () => {
    assert.equal(
      hostedFontUrl({ family: 'IBM Plex Mono', category: 'mono' }),
      'https://cdn.jsdelivr.net/gh/d0nj/dsh-fonts@v1.0.0/fonts/ibm-plex-mono/font.css',
    )
  })

  it('stays off Google Fonts', () => {
    for (const font of HOSTED_FONTS) {
      assert.doesNotMatch(hostedFontUrl(font), /googleapis|gstatic/u, font.family)
    }
  })
})

describe('hostedFamilies', () => {
  it('lists every family, sorted', () => {
    const families = hostedFamilies()
    assert.equal(families.length, HOSTED_FONTS.length)
    assert.deepEqual(families, [...families].sort((left, right) => left.localeCompare(right)))
  })
})

describe('findHostedFont', () => {
  it('matches a name regardless of case and surrounding quotes', () => {
    assert.equal(findHostedFont('inter')?.family, 'Inter')
    assert.equal(findHostedFont('"JetBrains Mono"')?.family, 'JetBrains Mono')
  })

  it('rejects a name that is not hosted', () => {
    assert.equal(findHostedFont('Comic Sans MS'), undefined)
  })

  it('rejects an empty name', () => {
    assert.equal(findHostedFont('   '), undefined)
  })
})

describe('loadHostedFont', () => {
  it('does nothing without a document', async () => {
    await loadHostedFont({ family: 'Inter', category: 'sans' }, undefined)
  })

  it('appends one stylesheet and is idempotent', async () => {
    const appended: { rel: string; href: string }[] = []
    const document = {
      createElement: () => ({
        rel: '',
        href: '',
        dataset: {},
        addEventListener: (event: string, handler: () => void) => {
          if (event === 'load') setTimeout(handler, 0)
        },
      }),
      head: {
        append: (node: { rel: string; href: string }) => {
          appended.push(node)
        },
      },
    } as unknown as Document
    const font = { family: 'Lora', category: 'serif' } as const
    await loadHostedFont(font, document)
    await loadHostedFont(font, document)
    assert.equal(appended.length, 1, 'the same family must not be requested twice')
    assert.match(appended[0]?.href ?? '', /fonts\/lora\/font\.css$/u)
  })
})
