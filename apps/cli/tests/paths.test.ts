import { describe, expect, test } from 'bun:test'
import { resolveDataPaths } from '../src/lib/paths'

describe('resolveDataPaths', () => {
    test('uses development path when mode is development', () => {
        const paths = resolveDataPaths('development', '/tmp/stint-test')
        expect(paths.mode).toBe('development')
        expect(paths.dbPath).toContain('/tmp/stint-test/.stint/dev/stint.db')
    })
})
