import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeUrl, refFromSelector } from './tab.js'

describe('normalizeUrl', () => {
  it('keeps an absolute URL', () => {
    assert.equal(normalizeUrl('https://example.com/a?b=c#d'), 'https://example.com/a?b=c#d')
  })

  it('adds https to a bare host', () => {
    assert.equal(normalizeUrl('example.com'), 'https://example.com/')
    assert.equal(normalizeUrl('www.example.com/path'), 'https://www.example.com/path')
  })

  it('uses http for a loopback address', () => {
    assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000/')
    assert.equal(normalizeUrl('127.0.0.1:8080/health'), 'http://127.0.0.1:8080/health')
  })

  it('accepts about:, data:, and file: pages', () => {
    assert.equal(normalizeUrl('about:blank'), 'about:blank')
    assert.equal(normalizeUrl('file:///C:/tmp/page.html'), 'file:///C:/tmp/page.html')
    assert.match(normalizeUrl('data:text/html,<h1>hi</h1>'), /^data:text\/html/u)
  })

  it('refuses javascript: and unknown schemes', () => {
    assert.throws(() => normalizeUrl('javascript:alert(1)'), /javascript: URLs are not allowed/u)
    assert.throws(() => normalizeUrl('ftp://example.com/'), /unsupported ftp: scheme/u)
  })

  it('refuses an empty value', () => {
    assert.throws(() => normalizeUrl('   '), /url is required/u)
  })
})

describe('refFromSelector', () => {
  it('accepts the spellings agents copy out of a snapshot', () => {
    assert.equal(refFromSelector('e12'), 'e12')
    assert.equal(refFromSelector('@e12'), 'e12')
    assert.equal(refFromSelector('aria-ref=e12'), 'e12')
    assert.equal(refFromSelector('aria-ref/e12'), 'e12')
  })

  it('leaves a real CSS selector alone', () => {
    assert.equal(refFromSelector('#submit'), undefined)
    assert.equal(refFromSelector('button.e12'), undefined)
    assert.equal(refFromSelector('email'), undefined)
  })
})
