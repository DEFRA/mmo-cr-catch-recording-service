import {
  authenticationServiceScheme,
  extractBearerToken
} from './authentication-scheme.js'
import { ApplicationError } from '#/common/helpers/errors/application-error.js'

vi.mock('@defra/cdp-auditing', () => ({ audit: vi.fn() }))
vi.mock('@defra/hapi-tracing', () => ({ getTraceId: () => 'trace-1' }))

const { audit } = await import('@defra/cdp-auditing')

function fakeToolkit() {
  return {
    authenticated: vi.fn((result) => ({ type: 'authenticated', ...result })),
    unauthenticated: vi.fn((error) => ({ type: 'unauthenticated', error }))
  }
}

describe('#extractBearerToken', () => {
  test.each([
    ['Bearer abc123', 'abc123'],
    ['Bearer   ', null],
    ['Bearer', null],
    [undefined, null],
    [42, null],
    ['Basic abc123', null]
  ])('Should map %p to %p', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected)
  })
})

describe('#authenticationServiceScheme', () => {
  afterEach(() => {
    audit.mockClear()
  })

  test('Should authenticate successfully and audit a safe success outcome', async () => {
    const validate = vi.fn().mockResolvedValue({
      actorId: 'user-1',
      permissions: ['catch-recording.read']
    })
    const scheme = authenticationServiceScheme(undefined, {
      authenticationClient: { validate }
    })
    const h = fakeToolkit()

    const result = await scheme.authenticate(
      { headers: { authorization: 'Bearer good-token' } },
      h
    )

    expect(result.type).toBe('authenticated')
    expect(result.credentials).toEqual({
      userId: 'user-1',
      scopes: ['catch-recording.read']
    })
    expect(validate).toHaveBeenCalledWith({
      token: 'good-token',
      correlationId: 'trace-1'
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success' }),
      expect.any(String)
    )
  })

  test('Should pass an existing ApplicationError through unchanged', async () => {
    const existingError = new ApplicationError({
      category: 'AUTHENTICATION_FAILURE',
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required to access this resource.'
    })
    const validate = vi.fn().mockRejectedValue(existingError)
    const scheme = authenticationServiceScheme(undefined, {
      authenticationClient: { validate }
    })
    const h = fakeToolkit()

    const result = await scheme.authenticate(
      { headers: { authorization: 'Bearer bad-token' } },
      h
    )

    expect(result.type).toBe('unauthenticated')
    expect(result.error).toBe(existingError)
  })

  test('Should wrap a non-ApplicationError failure from the client defensively', async () => {
    const validate = vi.fn().mockRejectedValue(new Error('unexpected'))
    const scheme = authenticationServiceScheme(undefined, {
      authenticationClient: { validate }
    })
    const h = fakeToolkit()

    const result = await scheme.authenticate(
      { headers: { authorization: 'Bearer any-token' } },
      h
    )

    expect(result.type).toBe('unauthenticated')
    expect(result.error.category).toBe('AUTHENTICATION_FAILURE')
    expect(result.error.code).toBe('AUTHENTICATION_REQUIRED')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
      expect.any(String)
    )
  })

  test('Should reject with no network call when no Authorization header is present', async () => {
    const validate = vi.fn().mockRejectedValue(
      new ApplicationError({
        category: 'AUTHENTICATION_FAILURE',
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required to access this resource.'
      })
    )
    const scheme = authenticationServiceScheme(undefined, {
      authenticationClient: { validate }
    })
    const h = fakeToolkit()

    const result = await scheme.authenticate({ headers: {} }, h)

    expect(result.type).toBe('unauthenticated')
    expect(validate).toHaveBeenCalledWith({
      token: null,
      correlationId: 'trace-1'
    })
  })
})
