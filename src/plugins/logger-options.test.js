import { describe, expect, test } from 'vitest'

import { toCdpFields } from '#/plugins/logger-options.js'

describe('toCdpFields', () => {
  test('moves string event to event.action and custom fields to labels', () => {
    expect(
      toCdpFields({
        event: 'auth.token-validation',
        outcome: 'failure',
        durationMs: 12,
        reason: undefined,
        'trace.id': 'abc'
      })
    ).toEqual({
      'event.action': 'auth.token-validation',
      labels: { outcome: 'failure', durationMs: 12 },
      reason: undefined,
      'trace.id': 'abc'
    })
  })

  test('leaves ECS fields untouched and adds no labels when none', () => {
    const input = { trace: { id: 'abc' }, res: { statusCode: 200 } }
    expect(toCdpFields(input)).toEqual(input)
  })
})
