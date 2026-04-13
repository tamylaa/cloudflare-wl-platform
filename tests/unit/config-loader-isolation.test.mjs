import { describe, expect, it } from 'vitest'

import {
  loadConfig,
  saveConfig,
} from '../../src/config/config-loader.mjs'

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

describe('config-loader tenant ownership isolation', () => {
  it('blocks save when payload site.id targets another tenant', async () => {
    const env = { KV_CONFIG: new MemoryKv() }

    const result = await saveConfig(env, 'tenant-a', {
      site: {
        id: 'tenant-b',
        domain: 'tenant-b.example.com',
        siteUrl: 'https://tenant-b.example.com',
        name: 'Tenant B',
      },
    })

    expect(result.valid).toBe(false)
    expect(result.ownershipViolation).toBe(true)
    expect(result.errors.some((item) => item.field === 'site.id')).toBe(true)
  })

  it('normalizes and enforces site.id to the target tenant key', async () => {
    const env = { KV_CONFIG: new MemoryKv() }

    const saveResult = await saveConfig(env, 'Tenant-A', {
      site: {
        domain: 'tenant-a.example.com',
        siteUrl: 'https://tenant-a.example.com',
        name: 'Tenant A',
      },
    })

    expect(saveResult.valid).toBe(true)

    const loaded = await loadConfig(env, 'tenant-a', { skipCache: true })
    expect(loaded.site.id).toBe('tenant-a')
  })
})
