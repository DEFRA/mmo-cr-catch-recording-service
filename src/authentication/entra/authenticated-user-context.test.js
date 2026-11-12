import {
  createAuthenticatedUserContext,
  getAuthenticatedUser,
  UserContextFailure
} from './authenticated-user-context.js'
import { ENTRA_AUTH_STRATEGY } from './entra-auth-strategy.js'

const GUID = '00000000-0000-4000-8000-000000000001'

describe('#createAuthenticatedUserContext', () => {
  test('Should build a minimal frozen context containing only the configured identity claim', () => {
    const result = createAuthenticatedUserContext(
      Object.freeze({
        oid: GUID,
        sub: 'other',
        email: 'a@b.invalid',
        roles: ['x']
      }),
      'oid'
    )

    expect(result).toEqual({ ok: true, user: { userId: GUID } })
    expect(Object.isFrozen(result.user)).toBe(true)
    expect(Object.keys(result.user)).toEqual(['userId'])
  })

  test.each([
    ['a GUID', GUID],
    [
      'an opaque base64url subject',
      'AAAAAAAAAAAAAAAAAAAAAIvrXlkIHVHiHMzqTAUYYqw'
    ],
    ['mixed case preserved exactly', 'AbC-1.2_3~x']
  ])('Should accept %s without altering it', (_name, value) => {
    expect(
      createAuthenticatedUserContext({ oid: value }, 'oid').user.userId
    ).toBe(value)
  })

  test('Should use exactly the configured claim and never fall back to another', () => {
    const claims = { sub: 'subject-1', oid: GUID, preferred_username: 'x' }

    expect(createAuthenticatedUserContext(claims, 'sub').user.userId).toBe(
      'subject-1'
    )
    expect(createAuthenticatedUserContext({ sub: 'subject-1' }, 'oid')).toEqual(
      {
        ok: false,
        reason: UserContextFailure.MISSING_USER_ID_CLAIM
      }
    )
  })

  test.each([
    ['missing', {}],
    ['null', { oid: null }],
    ['undefined', { oid: undefined }],
    ['inherited from the prototype', Object.create({ oid: GUID })]
  ])('Should reject a %s identity claim', (_name, claims) => {
    expect(createAuthenticatedUserContext(claims, 'oid')).toEqual({
      ok: false,
      reason: UserContextFailure.MISSING_USER_ID_CLAIM
    })
  })

  test.each([[null], [undefined], ['string']])(
    'Should reject the non-object claims %j',
    (claims) => {
      expect(createAuthenticatedUserContext(claims, 'oid').reason).toBe(
        UserContextFailure.MISSING_USER_ID_CLAIM
      )
    }
  )

  test.each([
    ['a number', 42],
    ['a boolean', true],
    ['an object', { a: 1 }],
    ['an array', [GUID]],
    ['a multi-valued array', [GUID, 'other']]
  ])('Should reject %s as an invalid claim type', (_name, value) => {
    expect(createAuthenticatedUserContext({ oid: value }, 'oid')).toEqual({
      ok: false,
      reason: UserContextFailure.INVALID_USER_ID_CLAIM_TYPE
    })
  })

  test.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['padded', ` ${GUID}`],
    ['containing a control character', `${GUID}\n`],
    ['containing a path separator', '../users'],
    ['containing a percent escape', 'a%2Fb'],
    ['containing a space', 'a b'],
    ['non-ASCII', 'usér'],
    ['too long', 'a'.repeat(129)]
  ])('Should reject a %s identifier', (_name, value) => {
    expect(createAuthenticatedUserContext({ oid: value }, 'oid')).toEqual({
      ok: false,
      reason: UserContextFailure.INVALID_USER_ID_FORMAT
    })
  })

  test('Should accept an identifier at the maximum length', () => {
    expect(
      createAuthenticatedUserContext({ oid: 'a'.repeat(128) }, 'oid').ok
    ).toBe(true)
  })

  test.each([[null], [''], [undefined]])(
    'Should fail when no identity claim is configured (%j)',
    (claim) => {
      expect(createAuthenticatedUserContext({ oid: GUID }, claim)).toEqual({
        ok: false,
        reason: UserContextFailure.USER_ID_CLAIM_NOT_CONFIGURED
      })
    }
  )
})

describe('#getAuthenticatedUser', () => {
  const authenticatedRequest = (
    credentials,
    strategy = ENTRA_AUTH_STRATEGY
  ) => ({
    auth: { isAuthenticated: true, strategy, credentials }
  })

  test('Should return only a context built by this module on the Entra strategy', () => {
    const { user } = createAuthenticatedUserContext({ oid: GUID }, 'oid')

    expect(getAuthenticatedUser(authenticatedRequest(user))).toBe(user)
  })

  test.each([
    ['a look-alike object', authenticatedRequest({ userId: GUID })],
    [
      'a legacy principal on its own strategy',
      authenticatedRequest(
        { userId: 'mock-user', scopes: [] },
        'authentication-service'
      )
    ],
    ['an unauthenticated request', { auth: { isAuthenticated: false } }],
    ['a request without auth state', {}]
  ])('Should return null for %s', (_name, request) => {
    expect(getAuthenticatedUser(request)).toBeNull()
  })

  test('Should not accept a trusted context presented through another strategy', () => {
    const { user } = createAuthenticatedUserContext({ oid: GUID }, 'oid')

    expect(
      getAuthenticatedUser(authenticatedRequest(user, 'authentication-service'))
    ).toBeNull()
  })
})
