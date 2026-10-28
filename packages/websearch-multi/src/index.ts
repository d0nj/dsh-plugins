/**
 * Plugin entry: config schema, credential wiring, and provider registration.
 *
 * The bundle registers one backend per configured provider id with the `web`
 * seam, so `web_search` and `web_fetch` keep their single model-facing contracts
 * while the deployment chooses the engine — and changes it without restarting —
 * through `web.searchProvider` / `web.fetchProvider`.
 *
 * Two rules shape this file:
 *
 * - **Registration follows configuration, not credentials.** A provider is
 *   registered whenever its id is listed, even with no key stored, so
 *   `available()` reports the truth and the seam raises its structured
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` error naming that provider. Registering
 *   only usable providers would turn a missing key into the ambiguous-provider
 *   error instead, which tells the model nothing about what to fix.
 * - **Credentials are resolved per operation.** A key written to the credential
 *   store reaches the next search without re-registering a provider.
 *
 * Which provider answers is *not* decided here: the seam resolves
 * `web.searchProvider` at call time and deliberately refuses to guess between
 * several usable providers. The bundle's patch therefore selects one, and a
 * deployment changes that selection in its own profile patch or settings, which
 * outrank the bundle.
 *
 * @module @d0nj/dsh-websearch-multi
 */
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { MultiFetchProvider, MultiSearchProvider } from './provider.js'
import type { OptionsSource, ProviderOptions } from './provider.js'
import { FETCH_ADAPTERS, isFetchProviderId } from './providers/fetch.js'
import { SEARCH_ADAPTERS, isSearchProviderId } from './providers/search.js'
import type { FetchProviderId } from './providers/fetch.js'
import type { SearchProviderId } from './providers/search.js'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'websearch-multi'

/** The seam these backends register into. */
export const inject = ['web']

/** Firecrawl accepts search filters that no other provider has. */
const FirecrawlOverride = z.object({
  apiKey: z.string().role('secret').description('Literal API key. Firecrawl also runs keyless at a lower rate limit.'),
  apiKeyEnv: z.string().role('credential-ref').description('Credential reference for the Firecrawl API key.'),
  baseURL: z.string().description('Endpoint base. Omit to use https://api.firecrawl.dev/v2.'),
  tbs: z.string().description('Time filter, for example qdr:w (past week) or sbd:1 (sort by date).'),
  country: z.string().description('ISO 3166-1 alpha-2 country code, for example US or DE.'),
})

/** One provider's user-editable settings. */
const ProviderOverride = z.object({
  apiKey: z
    .string()
    .role('secret')
    .description('Literal API key. Prefer the credential reference so the secret stays out of the config document.'),
  apiKeyEnv: z
    .string()
    .role('credential-ref')
    .description('Credential reference resolved through the credentials service, then the launching environment.'),
  baseURL: z.string().description('Endpoint base, including any version prefix. Omit to use the provider default.'),
})

/**
 * The per-provider override values, as the live config carries them.
 *
 * The optional fields accept `null` because a YAML key written without a value
 * parses to `null`, and `exactOptionalPropertyTypes` means an absent key must
 * then be spelled as its own case rather than as `undefined`.
 */
export interface ProviderOverrideValues {
  apiKey?: string | null
  apiKeyEnv?: string | null
  baseURL?: string | null
  tbs?: string | null
  country?: string | null
}

/**
 * The config a mounted row resolves to.
 *
 * The fields are mutable because that is what `z.object` produces and what the
 * `Config` annotation must match; nothing in this package mutates them.
 */
export interface PluginConfig {
  providers: string[]
  fetchProviders: string[]
  overrides: Record<string, ProviderOverrideValues>
}

/**
 * The plugin's config.
 *
 * `providers` is a registration list, not a priority order: the seam selects by
 * `web.searchProvider` and never depends on registration order, so reordering
 * these ids cannot change which provider answers.
 *
 * The declaration is annotated rather than inferred: the inferred type of a
 * `z.object(...)` chain names `cosmokit` through a pnpm store path, which this
 * package's emitted `.d.ts` could not portably re-export.
 */
export const Config: z<PluginConfig> = z.object({
  providers: z
    .array(z.string())
    .description(`Search backends to register. Known ids: ${Object.keys(SEARCH_ADAPTERS).join(', ')}.`),
  fetchProviders: z
    .array(z.string())
    .description(
      `Optional web_fetch backends to register. Known ids: ${Object.keys(FETCH_ADAPTERS).join(', ')}.`,
    ),
  overrides: z
    .dict(z.union([ProviderOverride, FirecrawlOverride]))
    .description('Per-provider endpoint and credential settings, keyed by provider id.'),
})

/**
 * Resolve one provider's override object.
 * @param config - the live config.
 * @param id - provider id.
 * @returns the override, or an empty object when the user set none.
 */
function overrideFor(config: PluginConfig, id: string): ProviderOverrideValues {
  const entry: ProviderOverrideValues | undefined = config.overrides[id]
  return entry !== null && typeof entry === 'object' ? entry : {}
}

/**
 * Project one provider's settings into the options its next operation reads.
 *
 * The endpoint default comes from the adapter, and the credential reference
 * defaults to the provider's conventional environment variable, so a user who
 * already exported `TAVILY_API_KEY` needs no config at all.
 *
 * @param ctx - plugin context supplying the credentials and environment planes.
 * @param config - the live config.
 * @param id - provider id.
 * @returns the options for one operation.
 */
function resolveOptions(ctx: Context, config: PluginConfig, id: string): ProviderOptions {
  const override = overrideFor(config, id)
  const convention =
    (isSearchProviderId(id) ? SEARCH_ADAPTERS[id].env : undefined) ??
    (isFetchProviderId(id) ? FETCH_ADAPTERS[id].env : undefined)
  const refName = override.apiKeyEnv ?? convention
  const apiKeyEnv: CredentialRef | undefined =
    refName !== undefined && isCredentialRefName(refName) ? credentialRef(refName) : undefined
  const apiKey = typeof override.apiKey === 'string' && override.apiKey.length > 0 ? override.apiKey : undefined
  const baseURL = typeof override.baseURL === 'string' && override.baseURL.length > 0 ? override.baseURL : undefined
  return {
    apiKey,
    resolveApiKey:
      apiKeyEnv === undefined
        ? undefined
        : async () => {
            const credentials = ctx.get('credentials')
            if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
            const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
            return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
          },
    apiKeyEnv,
    baseURL,
    config,
  }
}

/**
 * Register every configured backend, owned by this plugin's fiber.
 * @param ctx - plugin context.
 * @param config - the config handed to `apply`.
 * @returns a disposer that unregisters everything this plugin added.
 */
export function apply(ctx: Context, config: PluginConfig): () => void {
  const disposers: (() => void)[] = []
  const logger = ctx.logger('websearch-multi')
  const options = (id: string): OptionsSource => () => resolveOptions(ctx, config, id)

  for (const id of config.providers) {
    if (!isSearchProviderId(id)) {
      logger.warn('unknown search provider id "%s" in config.providers; ignoring it', id)
      continue
    }
    disposers.push(ctx.web.registerSearchProvider(new MultiSearchProvider(id, options(id))))
  }

  for (const id of config.fetchProviders) {
    if (!isFetchProviderId(id)) {
      logger.warn('unknown fetch provider id "%s" in config.fetchProviders; ignoring it', id)
      continue
    }
    disposers.push(ctx.web.registerFetchProvider(new MultiFetchProvider(id, options(id))))
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

/** Re-exported so a settings surface can offer the same id lists and labels. */
export { FETCH_ADAPTERS, SEARCH_ADAPTERS }
export type { FetchProviderId, SearchProviderId }
