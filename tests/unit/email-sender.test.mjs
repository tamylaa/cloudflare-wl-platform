import { describe, expect, it } from 'vitest'

import {
  resolveEmailCircuitBreaker,
  resolveSenderIdentity,
  sendEmailNotification,
} from '../../src/email/email-sender.mjs'

describe('email-sender hardening', () => {
  it('prefers tenant emailSender identity over env defaults', () => {
    const identity = resolveSenderIdentity(
      {
        config: {
          emailSender: {
            fromName: 'Acme Support',
            fromAddress: 'support@acme.com',
            replyToAddress: 'help@acme.com',
            subjectPrefix: '[Acme]',
          },
        },
      },
      {
        EMAIL_FROM: 'platform@example.com',
        EMAIL_FROM_NAME: 'Platform',
      }
    )

    expect(identity.fromName).toBe('Acme Support')
    expect(identity.fromAddress).toBe('support@acme.com')
    expect(identity.replyTo).toBe('help@acme.com')
    expect(identity.subjectPrefix).toBe('[Acme]')
  })

  it('refuses to send when fromAddress is missing', async () => {
    const result = await sendEmailNotification(
      {
        provider: 'sendgrid',
        apiKey: 'test-key',
        subject: 'Hello',
      },
      'user@example.com',
      '<p>Hello</p>',
      'Hello',
      {},
      null
    )

    expect(result.success).toBe(false)
    expect(result.retryable).toBe(false)
    expect(String(result.error || '')).toMatch(/No fromAddress configured/i)
  })

  it('uses provided circuit breaker instance when available', async () => {
    const fakeBreaker = {
      execute: async (_op, fallback) => fallback(),
    }

    const result = await sendEmailNotification(
      {
        provider: 'sendgrid',
        apiKey: 'test-key',
        fromAddress: 'support@acme.com',
        fromName: 'Acme',
        subject: 'Hello',
        circuitBreaker: fakeBreaker,
      },
      'user@example.com',
      '<p>Hello</p>',
      'Hello',
      {},
      null
    )

    expect(result.success).toBe(false)
    expect(String(result.error || '')).toMatch(/Circuit breaker is open/i)
  })

  it('auto-resolves named circuit breaker when provider is configured', () => {
    const breaker = resolveEmailCircuitBreaker({
      provider: 'sendgrid',
      circuitBreakerName: 'email-sendgrid-test',
      circuitBreakerOptions: { threshold: 3 },
    })

    expect(breaker).toBeTruthy()
    expect(typeof breaker.execute).toBe('function')
  })
})
