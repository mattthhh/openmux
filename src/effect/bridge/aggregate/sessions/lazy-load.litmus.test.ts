import { afterEach, describe, expect, it, mock } from 'bun:test'
import { ServicesNotInitializedError } from '../../../errors'

describe('loadSessionPtysOnDemand (litmus)', () => {
  afterEach(() => {
    mock.restore()
  })

  it('should return error when services not initialized', async () => {
    mock.module('../../services-instance', () => ({
      hasServices: () => false,
      getPtyService: () => {
        throw new Error('getPtyService should not be called when services are missing')
      },
      getSessionManager: () => {
        throw new Error('getSessionManager should not be called when services are missing')
      },
    }))

    const { loadSessionPtysOnDemand } = await import(
      './lazy-load.ts?litmus-services-missing'
    ) as typeof import('./lazy-load')
    const result = await loadSessionPtysOnDemand('session-1')

    expect(result).toBeInstanceOf(ServicesNotInitializedError)
  })
})
