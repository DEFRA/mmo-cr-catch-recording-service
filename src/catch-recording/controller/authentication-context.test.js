import { createAuthenticationContext } from './authentication-context.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

describe('#createAuthenticationContext', () => {
  test('Should build the minimal frozen context from a valid actor', () => {
    const context = createAuthenticationContext({
      actorId: 'user-1',
      permissions: ['reference-data.read', 'catch-recording.complete']
    })

    expect(context).toEqual({
      userId: 'user-1',
      scopes: ['reference-data.read', 'catch-recording.complete']
    })
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.scopes)).toBe(true)
  })

  test('Should deduplicate scopes deterministically in first-seen order', () => {
    const context = createAuthenticationContext({
      actorId: 'user-1',
      permissions: ['a', 'b', 'a', 'c', 'b']
    })

    expect(context.scopes).toEqual(['a', 'b', 'c'])
  })

  test('Should produce an empty scopes array for an empty permissions collection', () => {
    const context = createAuthenticationContext({
      actorId: 'user-1',
      permissions: []
    })

    expect(context.scopes).toEqual([])
  })

  test('Should not retain the input permissions array by reference', () => {
    const permissions = ['a', 'b']
    const context = createAuthenticationContext({
      actorId: 'user-1',
      permissions
    })

    expect(context.scopes).not.toBe(permissions)
    permissions.push('c')
    expect(context.scopes).toEqual(['a', 'b'])
  })

  test('Should not expose any field beyond userId and scopes', () => {
    const context = createAuthenticationContext({
      actorId: 'user-1',
      permissions: ['a'],
      email: 'SENTINEL@example.com',
      rawToken: 'SENTINEL-TOKEN'
    })

    expect(Object.keys(context).sort()).toEqual(['scopes', 'userId'])
  })

  test.each([
    ['missing actorId', { actorId: undefined, permissions: [] }],
    ['empty actorId', { actorId: '', permissions: [] }],
    ['non-string actorId', { actorId: 42, permissions: [] }],
    ['null actor', null],
    ['missing permissions', { actorId: 'user-1', permissions: undefined }],
    [
      'non-array permissions',
      { actorId: 'user-1', permissions: 'reference-data.read' }
    ],
    ['non-string permission entry', { actorId: 'user-1', permissions: [42] }]
  ])('Should fail closed for %s', (_label, actor) => {
    expect(() => createAuthenticationContext(actor)).toThrow()
    try {
      createAuthenticationContext(actor)
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.category).toBe('AUTHENTICATION_FAILURE')
      expect(error.code).toBe('AUTHENTICATION_REQUIRED')
    }
  })
})
