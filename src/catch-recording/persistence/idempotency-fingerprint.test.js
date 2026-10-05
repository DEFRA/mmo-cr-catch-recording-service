import {
  computeRequestFingerprint,
  assertFingerprint
} from './idempotency-fingerprint.js'
import { IDEMPOTENCY_OPERATION_SCOPES } from './idempotency-operation-scope.js'

const SCOPE = IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION
const KEY = 'client-key-1'

function buildParams(overrides = {}) {
  return {
    operationScope: SCOPE,
    idempotencyKey: KEY,
    allowedFields: ['vesselId', 'species'],
    semanticInput: { vesselId: 'V1', species: 'COD' },
    ...overrides
  }
}

describe('#idempotency-fingerprint', () => {
  describe('computeRequestFingerprint', () => {
    test('Should produce a 64-character lowercase hex digest', () => {
      const fingerprint = computeRequestFingerprint(buildParams())
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    })

    test('Should be deterministic for identical input', () => {
      const first = computeRequestFingerprint(buildParams())
      const second = computeRequestFingerprint(buildParams())
      expect(first).toBe(second)
    })

    test('Should be deterministic regardless of semantic-input key order', () => {
      const first = computeRequestFingerprint(
        buildParams({ semanticInput: { vesselId: 'V1', species: 'COD' } })
      )
      const second = computeRequestFingerprint(
        buildParams({ semanticInput: { species: 'COD', vesselId: 'V1' } })
      )
      expect(first).toBe(second)
    })

    test('Should differ when operationScope differs', () => {
      const first = computeRequestFingerprint(buildParams())
      const second = computeRequestFingerprint(
        buildParams({ operationScope: IDEMPOTENCY_OPERATION_SCOPES.SUBMISSION })
      )
      expect(first).not.toBe(second)
    })

    test('Should differ when idempotencyKey differs', () => {
      const first = computeRequestFingerprint(buildParams())
      const second = computeRequestFingerprint(
        buildParams({ idempotencyKey: 'client-key-2' })
      )
      expect(first).not.toBe(second)
    })

    test('Should differ when a semantic value differs', () => {
      const first = computeRequestFingerprint(buildParams())
      const second = computeRequestFingerprint(
        buildParams({ semanticInput: { vesselId: 'V1', species: 'HAD' } })
      )
      expect(first).not.toBe(second)
    })

    test('Should preserve array order as semantically significant', () => {
      const first = computeRequestFingerprint(
        buildParams({
          allowedFields: ['items'],
          semanticInput: { items: ['a', 'b'] }
        })
      )
      const second = computeRequestFingerprint(
        buildParams({
          allowedFields: ['items'],
          semanticInput: { items: ['b', 'a'] }
        })
      )
      expect(first).not.toBe(second)
    })

    test('Should produce the identical fingerprint when two simulated requests differ only in an excluded (non-allow-listed) field', () => {
      // Simulates two raw inbound requests that each additionally carried a secret/token-shaped field.
      // The calling business operation is responsible for extracting only the allow-listed subset before
      // ever calling computeRequestFingerprint — proving that field has zero effect on the fingerprint.
      const rawRequestA = { vesselId: 'V1', species: 'COD', token: 'secret-a' }
      const rawRequestB = { vesselId: 'V1', species: 'COD', token: 'secret-b' }
      const allowedFields = ['vesselId', 'species']

      const extractAllowed = (rawRequest) =>
        Object.fromEntries(
          allowedFields.map((field) => [field, rawRequest[field]])
        )

      const fingerprintA = computeRequestFingerprint(
        buildParams({
          allowedFields,
          semanticInput: extractAllowed(rawRequestA)
        })
      )
      const fingerprintB = computeRequestFingerprint(
        buildParams({
          allowedFields,
          semanticInput: extractAllowed(rawRequestB)
        })
      )

      expect(fingerprintA).toBe(fingerprintB)
    })

    test('Should reject a semanticInput key not present in allowedFields', () => {
      expect(() =>
        computeRequestFingerprint(
          buildParams({
            allowedFields: ['vesselId'],
            semanticInput: { vesselId: 'V1', token: 'secret' }
          })
        )
      ).toThrow(TypeError)
    })

    test('Should accept a nested plain object containing null and finite-number values', () => {
      expect(() =>
        computeRequestFingerprint(
          buildParams({
            allowedFields: ['value'],
            semanticInput: { value: { a: null, b: 42, c: [1, 'x', null] } }
          })
        )
      ).not.toThrow()
    })

    test('Should reject a disallowed key nested inside a semantic value, not only at the top level', () => {
      const nestedWithPollutedKey = JSON.parse('{"__proto__": "x"}')

      expect(() =>
        computeRequestFingerprint(
          buildParams({
            allowedFields: ['value'],
            semanticInput: { value: nestedWithPollutedKey }
          })
        )
      ).toThrow(TypeError)
    })

    test.each(['__proto__', 'constructor', 'prototype'])(
      'Should reject a semanticInput key of %s even when present in allowedFields',
      (key) => {
        expect(() =>
          computeRequestFingerprint(
            buildParams({
              allowedFields: [key],
              semanticInput: JSON.parse(`{"${key}": "x"}`)
            })
          )
        ).toThrow(TypeError)
      }
    )

    test('Should reject a missing or empty allowedFields array', () => {
      expect(() =>
        computeRequestFingerprint(buildParams({ allowedFields: [] }))
      ).toThrow(TypeError)
      expect(() =>
        computeRequestFingerprint(buildParams({ allowedFields: undefined }))
      ).toThrow(TypeError)
    })

    test('Should reject a non-object semanticInput', () => {
      expect(() =>
        computeRequestFingerprint(
          buildParams({ semanticInput: 'not-an-object' })
        )
      ).toThrow(TypeError)
      expect(() =>
        computeRequestFingerprint(buildParams({ semanticInput: null }))
      ).toThrow(TypeError)
      expect(() =>
        computeRequestFingerprint(buildParams({ semanticInput: ['a'] }))
      ).toThrow(TypeError)
    })

    test.each([
      ['a function', () => {}],
      ['a symbol', Symbol('x')],
      ['undefined', undefined],
      ['a Date instance', new Date()],
      ['NaN', NaN],
      ['Infinity', Infinity]
    ])('Should reject a semantic value that is %s', (_description, value) => {
      expect(() =>
        computeRequestFingerprint(
          buildParams({ allowedFields: ['value'], semanticInput: { value } })
        )
      ).toThrow(TypeError)
    })

    test('Should reject nesting deeper than the approved bound', () => {
      let deeplyNested = 'leaf'
      for (let i = 0; i < 10; i += 1) {
        deeplyNested = { nested: deeplyNested }
      }

      expect(() =>
        computeRequestFingerprint(
          buildParams({
            allowedFields: ['deep'],
            semanticInput: { deep: deeplyNested }
          })
        )
      ).toThrow(TypeError)
    })

    test('Should reject an unsupported operationScope', () => {
      expect(() =>
        computeRequestFingerprint(
          buildParams({ operationScope: 'NOT_A_SCOPE' })
        )
      ).toThrow(TypeError)
    })

    test('Should reject an invalid idempotencyKey', () => {
      expect(() =>
        computeRequestFingerprint(buildParams({ idempotencyKey: '' }))
      ).toThrow(TypeError)
    })
  })

  describe('assertFingerprint', () => {
    test('Should accept a real sha256 hex digest', () => {
      const fingerprint = computeRequestFingerprint(buildParams())
      expect(assertFingerprint(fingerprint)).toBe(fingerprint)
    })

    test.each([
      ['a short string', 'abc123'],
      ['an upper-case digest', 'A'.repeat(64)],
      ['a raw-looking payload string', JSON.stringify({ vesselId: 'V1' })],
      ['a number', 123],
      ['undefined', undefined],
      ['null', null]
    ])('Should reject %s', (_description, value) => {
      expect(() => assertFingerprint(value)).toThrow(TypeError)
    })
  })
})
