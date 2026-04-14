// cloudflare-wl-platform — public surface
// Uncommented progressively during Phase 8 migration

// export * from './tenancy/tenant-context.mjs'
// export { DomainRoutingService, DomainBrandingService } from './tenancy/domain-control.mjs'
export * from './brand/brand-engine.mjs'
export * from './tenancy/domain-control.mjs'
export * from './email/email-sender.mjs'
export * from './billing/billing-adapter.mjs'
export * from './config/config-loader.mjs'
export * from './config/auth-identity.mjs'
export * from './config/branding-security-policy.mjs'
export * from './config/tenant-isolation.mjs'
export * from './tenancy/tenant-context.mjs'
export * from './tenancy/tenant-quota.mjs'
export * from './tenancy/tenant-lifecycle.mjs'
export * from './guards/brand-scatter-guard.mjs'
export * from './config/billing-reseller.mjs'
export { SCHEMA_VERSION, migrateConfig } from './config/customer-config.schema.mjs'
export {
  APPLE_STATUS_BAR_STYLE,
  APPLE_STATUS_BAR_STYLE_VALUES,
  MOBILE_APP_PLATFORM,
  MOBILE_APP_PLATFORM_VALUES,
  PWA_DISPLAY_MODE,
  PWA_DISPLAY_MODE_VALUES,
  PWA_ORIENTATION,
  PWA_ORIENTATION_VALUES,
  DATA_RESIDENCY_REGION,
  DATA_RESIDENCY_REGION_VALUES,
  assertMobileWhiteLabel,
  buildMobileMetaTags,
  buildPwaManifest,
  checkMobileVendorLeak,
  resolveMobileAppOffering,
  resolveMobileAssetDescriptor,
} from './config/mobile.mjs'
export {
  API_DOCS_MODE,
  API_DOCS_MODE_VALUES,
  EMBED_MODE,
  EMBED_MODE_VALUES,
  INTEGRATION_VISIBILITY,
  INTEGRATION_VISIBILITY_VALUES,
  WEBHOOK_RETRY_STRATEGY,
  WEBHOOK_RETRY_STRATEGY_VALUES,
  PLATFORM_INTEGRATION_REGISTRY,
  PLATFORM_RATE_LIMIT_DEFAULTS,
  buildApiDocsDescriptor,
  buildEmbedBrandingDescriptor,
  checkMonthlyCap,
  resolveApiRateLimitPolicy,
  resolveEmbedPolicy,
  resolveIntegrationCatalog,
  resolveWebhookDeliveryTargets,
  resolveWebhookEventSchema,
} from './config/api-integration.mjs'
