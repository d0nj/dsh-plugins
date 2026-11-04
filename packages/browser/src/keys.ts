/**
 * Key-chord parsing and the CDP key event a chord produces.
 *
 * `Input.dispatchKeyEvent` needs four correlated fields per keystroke — `key`,
 * `code`, `windowsVirtualKeyCode`, and the text the key produces — and Chrome
 * drops the event when they disagree. This table is the single place that
 * mapping lives.
 *
 * @module @d0nj/dsh-browser/keys
 */
/** CDP modifier bitmask. */
export const MODIFIER = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const

/** One modifier name a chord may name. */
export type ModifierName = keyof typeof MODIFIER

/** A resolved keystroke, ready for `Input.dispatchKeyEvent`. */
export interface KeyStroke {
  /** `KeyboardEvent.key` value. */
  readonly key: string
  /** `KeyboardEvent.code` value. */
  readonly code: string
  /** Legacy virtual key code Chrome matches against. */
  readonly keyCode: number
  /** Text the key inserts, when the chord produces text. */
  readonly text?: string
  /** Bitmask of held modifiers. */
  readonly modifiers: number
}

/** Thrown for a key name the table does not know. */
export class KeyChordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyChordError'
  }
}

interface KeySpec {
  readonly key: string
  readonly code: string
  readonly keyCode: number
  readonly text?: string
}

const NAMED_KEYS: Record<string, KeySpec> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
}

for (let index = 1; index <= 12; index++) {
  NAMED_KEYS[`f${index}`] = { key: `F${index}`, code: `F${index}`, keyCode: 111 + index }
}

/** Punctuation whose `code` is not derivable from the character. */
const PUNCTUATION: Record<string, { code: string; keyCode: number }> = {
  '-': { code: 'Minus', keyCode: 189 },
  '=': { code: 'Equal', keyCode: 187 },
  '[': { code: 'BracketLeft', keyCode: 219 },
  ']': { code: 'BracketRight', keyCode: 221 },
  '\\': { code: 'Backslash', keyCode: 220 },
  ';': { code: 'Semicolon', keyCode: 186 },
  "'": { code: 'Quote', keyCode: 222 },
  ',': { code: 'Comma', keyCode: 188 },
  '.': { code: 'Period', keyCode: 190 },
  '/': { code: 'Slash', keyCode: 191 },
  '`': { code: 'Backquote', keyCode: 192 },
}

const MODIFIER_ALIASES: Record<string, ModifierName> = {
  alt: 'Alt',
  option: 'Alt',
  ctrl: 'Control',
  control: 'Control',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  super: 'Meta',
  shift: 'Shift',
}

/**
 * Resolve a single key token.
 * @param token - key name or one character.
 * @param shift - whether Shift is held, which selects the shifted glyph.
 * @returns the key specification.
 */
function resolveToken(token: string, shift: boolean): KeySpec {
  const named = NAMED_KEYS[token.toLowerCase()]
  if (named !== undefined) {
    return shift && named.key.length === 1 ? { ...named, key: named.key.toUpperCase() } : named
  }
  if (token.length === 1) {
    const character = shift ? token.toUpperCase() : token.toLowerCase()
    const upper = character.toUpperCase()
    if (upper >= 'A' && upper <= 'Z') return { key: character, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: character }
    if (character >= '0' && character <= '9') return { key: character, code: `Digit${character}`, keyCode: character.charCodeAt(0), text: character }
    const punctuation = PUNCTUATION[token]
    if (punctuation !== undefined) {
      return { key: character, code: punctuation.code, keyCode: punctuation.keyCode, text: character }
    }
  }
  throw new KeyChordError(`unknown key "${token}"; use a single character, a name like Enter, Tab, Escape, Backspace, Delete, ArrowUp, Home, End, PageUp, PageDown, Space, F1–F12, or a chord like Control+A`)
}

/**
 * Parse a chord such as `Enter`, `Control+A`, or `Meta+Shift+ArrowLeft`.
 * @param chord - the chord text.
 * @returns the keystroke to dispatch.
 */
export function parseKeyChord(chord: string): KeyStroke {
  const parts = chord.split('+').map((part) => part.trim())
  const keyToken = parts.pop()
  if (keyToken === undefined || keyToken === '') throw new KeyChordError(`"${chord}" names no key`)
  let modifiers = 0
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier === undefined) throw new KeyChordError(`"${part}" in "${chord}" is not a modifier; use Alt, Control, Meta, or Shift`)
    modifiers |= MODIFIER[modifier]
  }
  const shift = (modifiers & MODIFIER.Shift) !== 0
  const spec = resolveToken(keyToken, shift)
  const textual = spec.text !== undefined && (modifiers & (MODIFIER.Alt | MODIFIER.Control | MODIFIER.Meta)) === 0
  return {
    key: spec.key,
    code: spec.code,
    keyCode: spec.keyCode,
    modifiers,
    ...(textual ? { text: spec.text as string } : {}),
  }
}
