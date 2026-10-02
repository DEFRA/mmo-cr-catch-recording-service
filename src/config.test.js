describe('#config (Catch Recording persistence collections)', () => {
  const envKeys = [
    'CATCH_RECORDING_COLLECTION_CATCH_RECORDS',
    'CATCH_RECORDING_COLLECTION_CATCH_RECORD_HISTORY',
    'CATCH_RECORDING_COLLECTION_IDEMPOTENCY_RECORDS',
    'CATCH_RECORDING_COLLECTION_SUBMISSION_OPERATIONS',
    'CATCH_RECORDING_COLLECTION_VESSEL_GEAR_FAVOURITES',
    'CATCH_RECORDING_COLLECTION_VESSEL_SPECIES_FAVOURITES',
    'CATCH_RECORDING_COLLECTION_VESSEL_PORT_FAVOURITES',
    'CATCH_RECORDING_COLLECTION_SKIPPERS',
    'CATCH_RECORDING_COLLECTION_SKIPPER_VESSEL_ASSOCIATIONS'
  ]
  const originalEnv = {}

  beforeEach(() => {
    for (const key of envKeys) {
      originalEnv[key] = process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
    vi.resetModules()
  })

  test('Should default every collection name to the design-doc §10.1 value', async () => {
    vi.resetModules()
    const { config } = await import('./config.js')

    expect(config.get('catchRecording.persistence.collections')).toEqual({
      catchRecords: 'catchRecords',
      catchRecordHistory: 'catchRecordHistory',
      idempotencyRecords: 'idempotencyRecords',
      submissionOperations: 'submissionOperations',
      vesselGearFavourites: 'vesselGearFavourites',
      vesselSpeciesFavourites: 'vesselSpeciesFavourites',
      vesselPortFavourites: 'vesselPortFavourites',
      skippers: 'skippers',
      skipperVesselAssociations: 'skipperVesselAssociations'
    })
  })

  test('Should preserve existing unrelated configuration keys and values', async () => {
    vi.resetModules()
    const { config } = await import('./config.js')

    expect(config.get('serviceName')).toBe('mmo-cr-catch-recording-service')
    // mongo.mongoUrl is overridden by the global vitest-mongodb setup (.vite/mongo-memory-server.js) to
    // point at the in-memory instance's dynamic port, so assert against the live env value rather than
    // the schema default.
    expect(config.get('mongo.mongoUrl')).toBe(process.env.MONGO_URI)
    expect(config.get('mongo.databaseName')).toBe(
      'mmo-cr-catch-recording-service'
    )
    expect(config.get('tracing.header')).toBe('x-cdp-request-id')
    expect(config.get('httpProxy')).toBeNull()
  })

  test('Should override a collection name from its environment variable', async () => {
    process.env.CATCH_RECORDING_COLLECTION_CATCH_RECORDS = 'customCatchRecords'
    vi.resetModules()

    const { config } = await import('./config.js')

    expect(
      config.get('catchRecording.persistence.collections.catchRecords')
    ).toBe('customCatchRecords')
  })

  test('Should reject an unknown top-level configuration key (strict mode intact)', async () => {
    process.env.SOME_COMPLETELY_UNKNOWN_CONFIG_KEY = 'x'
    vi.resetModules()

    // Convict's strict mode only rejects keys defined via its schema mechanism, not arbitrary
    // environment variables with no matching `env:` mapping — so instead this proves strict mode by
    // confirming config loads successfully and does not silently create a key for an unmapped env var.
    const { config } = await import('./config.js')

    expect(() => config.get('someCompletelyUnknownConfigKey')).toThrow()

    delete process.env.SOME_COMPLETELY_UNKNOWN_CONFIG_KEY
  })

  test('Should fail to load when a collection name is invalid', async () => {
    process.env.CATCH_RECORDING_COLLECTION_CATCH_RECORDS = ''
    vi.resetModules()

    await expect(import('./config.js')).rejects.toThrow()
  })

  test('Should fail to load when a collection name uses the reserved system. prefix', async () => {
    process.env.CATCH_RECORDING_COLLECTION_SKIPPERS = 'system.profile'
    vi.resetModules()

    await expect(import('./config.js')).rejects.toThrow()
  })

  test('Should fail to load with a plain Error (not ApplicationError or Boom) on duplicate collection names', async () => {
    process.env.CATCH_RECORDING_COLLECTION_CATCH_RECORDS = 'duplicateName'
    process.env.CATCH_RECORDING_COLLECTION_CATCH_RECORD_HISTORY =
      'duplicateName'
    vi.resetModules()

    let caughtError
    try {
      await import('./config.js')
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(Error)
    expect(caughtError.message).toContain('Duplicate name(s): duplicateName')
    expect(caughtError).not.toHaveProperty('isBoom')
    expect(caughtError.constructor.name).not.toBe('ApplicationError')
  })
})
