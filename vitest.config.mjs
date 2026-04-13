import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        testTimeout: 15000,
        hookTimeout: 30000,
        fileParallelism: false,
        maxConcurrency: 1,
        include: ['tests/**/*.test.mjs'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        miniflare: {
            durableObjects: {
                RATE_LIMITER: 'RateLimiterDO',
                CREDIT_LEDGER: 'CreditLedgerDO',
                SHARE_STATE: 'ShareStateDO',
            },
            kvNamespaces: ['KV_ANALYTICS', 'KV_SESSIONS'],
            d1Databases: ['DB'],
        },
    },
})
