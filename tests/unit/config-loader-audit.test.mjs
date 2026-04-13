import { describe, expect, it } from 'vitest'

import {
  listConfigRevisions,
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

describe('config-loader audit snapshot redaction', () => {
  it('redacts sensitive fields and keeps allowlisted site identity fields', async () => {
    const kv = new MemoryKv()
    const env = { KV_CONFIG: kv }

    const result = await saveConfig(
      env,
      'tenant-a',
      {
        site: {
          id: 'tenant-a',
          domain: 'example.com',
          siteUrl: 'https://example.com',
          name: 'Example Tenant',
        },
        authIdentity: {
          oidcClientSecretSecret: 'SUPER_SECRET_NAME',
        },
        branding: {
          productName: 'Acme',
          customCss: 'body { color: red; }',
          customJs: 'console.log("unsafe-inline")',
        },
      },
      {
        merge: false,
        audit: { actor: 'unit-test', source: 'vitest' },
      }
    )

    expect(result.valid).toBe(true)

    const revisions = await listConfigRevisions(env, 'tenant-a', { limit: 1 })
    expect(revisions.length).toBe(1)

    const latest = revisions[0]
    const after = latest.after || {}

    expect(after.site?.name).toBe('Example Tenant')
    expect(String(after.authIdentity?.oidcClientSecretSecret || '')).toContain('[redacted from audit snapshot:')
    expect(String(after.branding?.customCss || '')).toContain('[redacted from audit snapshot:')
    expect(String(after.branding?.customJs || '')).toContain('[redacted from audit snapshot:')
  })
})
