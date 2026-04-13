import { describe, expect, it } from 'vitest'

import { configKey } from '../../src/config/config-loader.mjs'
import {
  exportTenantData,
  listTenantLifecycleEvents,
  offboardTenant,
  provisionTenant,
} from '../../src/tenancy/tenant-lifecycle.mjs'

class MemoryKv {
  constructor() {
    this.map = new Map()
  }

  async get(key, type) {
    const value = this.map.get(key)
    if (value === undefined) {
      return null
    }
    if (type === 'json') {
      return JSON.parse(value)
    }
    return value
  }

  async put(key, value) {
    this.map.set(key, String(value))
  }

  async delete(key) {
    this.map.delete(key)
  }

  async list(options = {}) {
    const prefix = String(options.prefix || '')
    const limit = Number(options.limit || 100)
    const keys = [...this.map.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map((name) => ({ name }))

    return {
      keys,
      list_complete: true,
      cursor: null,
    }
  }
}

class MemoryR2 {
  constructor() {
    this.map = new Map()
  }

  async put(key, value) {
    this.map.set(String(key), value)
  }

  async delete(key) {
    this.map.delete(String(key))
  }

  async list(options = {}) {
    const prefix = String(options.prefix || '')
    const limit = Number(options.limit || 100)
    const objects = [...this.map.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map((key) => ({ key }))

    return {
      objects,
      truncated: false,
      cursor: null,
    }
  }
}

describe('tenant-lifecycle orchestration', () => {
  it('provisions tenant config and writes lifecycle audit', async () => {
    const kv = new MemoryKv()
    const env = {
      KV_CONFIG: kv,
      KV_ANALYTICS: kv,
      KV_HISTORY: new MemoryKv(),
      R2_ANALYTICS: new MemoryR2(),
    }

    const provisioned = await provisionTenant(env, {
      siteId: 'acme-a',
      hostname: 'app.acme-a.com',
      name: 'Acme A',
      supportEmail: 'support@acme-a.com',
      tier: 'pro',
    })

    expect(provisioned.success).toBe(true)
    expect(provisioned.siteId).toBe('acme-a')
    expect(provisioned.selfServiceReady).toBe(true)

    const events = await listTenantLifecycleEvents(env, 'acme-a')
    expect(events.some((event) => event.action === 'provisioned')).toBe(true)
  })

  it('exports and offboards tenant with purge controls', async () => {
    const kvConfig = new MemoryKv()
    const kvAnalytics = new MemoryKv()
    const kvHistory = new MemoryKv()
    const r2 = new MemoryR2()
    const env = {
      KV_CONFIG: kvConfig,
      KV_ANALYTICS: kvAnalytics,
      KV_HISTORY: kvHistory,
      R2_ANALYTICS: r2,
    }

    await provisionTenant(env, {
      siteId: 'acme-b',
      hostname: 'app.acme-b.com',
      name: 'Acme B',
      supportEmail: 'support@acme-b.com',
    })

    await kvAnalytics.put('acme-b:usage:1', 'x')
    await kvHistory.put('acme-b:history:1', 'x')
    await r2.put('acme-b/reports/1.json', '{}')

    const exported = await exportTenantData(env, 'acme-b')
    expect(exported.siteId).toBe('acme-b')
    expect(Array.isArray(exported.revisions)).toBe(true)

    const offboarded = await offboardTenant(env, 'acme-b', {
      hardDeleteConfig: true,
      purgeData: true,
      deleteRegistryEntry: true,
    })

    expect(offboarded.success).toBe(true)
    expect(offboarded.purgeSummary.configDeleted).toBe(true)
    expect(offboarded.purgeSummary.analyticsKeysDeleted).toBeGreaterThanOrEqual(1)
    expect(offboarded.purgeSummary.historyKeysDeleted).toBeGreaterThanOrEqual(1)
    expect(offboarded.purgeSummary.r2ObjectsDeleted).toBeGreaterThanOrEqual(1)

    const rawConfig = await kvConfig.get(configKey('acme-b'))
    expect(rawConfig).toBe(null)
  })
})
