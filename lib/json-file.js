// Strict JSON reader for the plugin's declaration files.
//
// JSON.parse silently keeps the LAST value of a duplicated key, so a definitions
// file with two `spec-driven-development` entries loads as one skill and nothing
// complains. That is the class of silent drift this repo's gates exist to catch,
// so duplicates are rejected here rather than in a downstream schema check.
//
// A reviver cannot see the collapse: JSON.parse builds the object first and the
// reviver walks the result, where the second key is already gone. So the scan
// below is a real character-level lexer that tracks string state, container
// depth, and whether the next string is a key or a value. It is not a regex over
// the text: a regex cannot tell a key from a string that merely looks like one.
//
// No dependencies: the plugin cannot resolve the host's YAML parser, which is
// why its declaration files are JSON in the first place.

import { readFileSync } from 'node:fs'

/**
 * Lex one JSON document into structural tokens.
 *
 * @param {string} text raw JSON
 * @returns {Array<{ kind: 'punct' | 'string', value: string, index: number }>}
 */
function lex(text) {
  const tokens = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ',') {
      tokens.push({ kind: 'punct', value: ch, index: i })
      i += 1
      continue
    }
    if (ch === '"') {
      const start = i
      i += 1
      let closed = false
      while (i < n) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === '"') { i += 1; closed = true; break }
        i += 1
      }
      if (!closed) throw new Error('unterminated string')
      // Decode so an escaped quote in the raw text cannot masquerade as a
      // delimiter; the value is only ever compared, never re-emitted.
      tokens.push({ kind: 'string', value: JSON.parse(text.slice(start, i)), index: start })
      continue
    }
    // Numbers, literals, and anything else: never a key, so its text is
    // irrelevant here. Consume up to the next structural character.
    const start = i
    while (i < n && !'{}[]:,"'.includes(text[i]) && !/\s/.test(text[i])) i += 1
    if (i === start) i += 1
    tokens.push({ kind: 'other', value: text.slice(start, i), index: start })
  }
  return tokens
}

/**
 * Name the first duplicated object key in a JSON document.
 *
 * @param {string} text raw JSON
 * @param {string} label file label used in the error message
 * @returns {{ key: string, index: number } | null} null when no duplicate exists
 * @throws {Error} when the text cannot be lexed as JSON at all
 */
export function findDuplicateKey(text, label) {
  const tokens = lex(text)
  const stack = []
  // True when the next string in an object frame is a key rather than a value.
  let expectKey = false
  for (const token of tokens) {
    if (token.kind === 'punct') {
      if (token.value === '{') {
        stack.push({ keys: new Set() })
        expectKey = true
      } else if (token.value === '[') {
        stack.push(null)
        expectKey = false
      } else if (token.value === '}' || token.value === ']') {
        stack.pop()
        const top = stack[stack.length - 1]
        expectKey = top !== undefined && top !== null
      } else if (token.value === ':') {
        expectKey = false
      } else if (token.value === ',') {
        expectKey = stack.length > 0 && stack[stack.length - 1] !== null
      }
      continue
    }
    if (token.kind === 'string' && expectKey) {
      const frame = stack[stack.length - 1]
      if (frame === null) throw new Error(`${label}: key outside of an object`)
      if (frame.keys.has(token.value)) return { key: token.value, index: token.index }
      frame.keys.add(token.value)
      expectKey = false
    }
  }
  return null
}

/**
 * Parse one JSON document, rejecting duplicate keys.
 *
 * @param {string} text raw file contents
 * @param {string} label file label used in error messages
 * @returns {unknown} the parsed value
 * @throws {Error} on invalid JSON, a duplicated key, or a non-object document
 */
export function parseJsonDocument(text, label) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`${label}: invalid JSON (${error.message})`)
  }
  const duplicate = findDuplicateKey(text, label)
  if (duplicate !== null) {
    throw new Error(`${label}: duplicate key "${duplicate.key}" at offset ${duplicate.index}`)
  }
  return value
}

/**
 * Read and parse one JSON file, rejecting duplicate keys.
 *
 * @param {string} path absolute path
 * @param {string} [label] file label used in error messages
 * @returns {unknown} the parsed value
 * @throws {Error} when the file cannot be read or parsed
 */
export function readJsonFile(path, label = path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`${label}: cannot be read (${error.code ?? error.message})`)
  }
  return parseJsonDocument(text, label)
}
