import { Capability, findCatalogueCapability } from './capabilities.js'
import { isRequiredCapability } from './capability-authorizer.js'
import { protectedRoute, readRouteAuthorization } from './protected-route.js'

describe('#Capability catalogue', () => {
  test('Should define exactly the five approved exact identifiers, immutably', () => {
    expect(
      Object.fromEntries(
        Object.entries(Capability).map(([name, value]) => [
          name,
          value.capabilityId
        ])
      )
    ).toEqual({
      READ: 'catch-record.read',
      CREATE: 'catch-record.create',
      UPDATE: 'catch-record.update',
      SUBMIT: 'catch-record.submit',
      AMEND: 'catch-record.amend'
    })
    expect(Object.isFrozen(Capability)).toBe(true)
    expect(Object.values(Capability).every(isRequiredCapability)).toBe(true)
  })

  test('Should resolve each identifier back to its catalogue capability', () => {
    for (const capability of Object.values(Capability)) {
      expect(findCatalogueCapability(capability.capabilityId)).toBe(capability)
    }
  })

  test.each([
    ['a wildcard', 'catch-record.*'],
    ['a different case', 'Catch-Record.Read'],
    ['a padded identifier', ' catch-record.read'],
    ['an unknown capability', 'catch-record.delete'],
    ['a role name', 'Owner'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['an object key from the prototype', 'constructor']
  ])('Should not resolve %s', (_name, value) => {
    expect(findCatalogueCapability(value)).toBeNull()
  })
})

describe('#protectedRoute', () => {
  test('Should declare Entra authentication and the capability, keeping the other options', () => {
    const options = protectedRoute(
      { capability: Capability.READ },
      { validate: { query: {} }, app: { other: 1 } }
    )

    expect(options).toMatchObject({
      auth: 'entra-bearer',
      validate: { query: {} },
      app: { other: 1, requiredCapabilityId: 'catch-record.read' }
    })
    expect(options.app).not.toHaveProperty('vesselIdParam')
  })

  test('Should record the vessel path parameter when one is given', () => {
    const options = protectedRoute({
      capability: Capability.UPDATE,
      vesselIdParam: 'vesselId'
    })

    expect(readRouteAuthorization({ settings: { app: options.app } })).toEqual({
      capability: Capability.UPDATE,
      vesselIdParam: 'vesselId'
    })
  })

  test('Should read no capability from a route that declares none', () => {
    expect(readRouteAuthorization({ route: { settings: {} } })).toEqual({
      capability: null,
      vesselIdParam: undefined
    })
  })
})
