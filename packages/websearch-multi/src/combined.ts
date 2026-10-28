/**
 * Combined providers: one registered backend that fans a query out to several.
 *
 * A combo is registered under its own id like any other provider, so it is
 * selected the same way — `web.searchProvider: <comboid>` — and needs no change
 * to the seam or to `web_search`. What it adds is agreement across engines: the
 * merged list ranks a page higher when several backends returned it.
 *
 * Failure policy is deliberate and asymmetric. If one member fails and others
 * succeed, the search succeeds with the members that answered, because a combo
 * exists precisely to survive one engine being down or out of credit. If every
 * member fails, the first error is rethrown unchanged, so a missing credential
 * or an exhausted balance still reaches the model with its structured code.
 *
 * @module @d0nj/dsh-websearch-multi/combined
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'

import { aborted, cancelled, describe, providerError, text } from './providers/http.js'
import { fuseResults } from './fusion.js'
import type { MergeStrategy } from './fusion.js'

/** How one combo is configured. */
export interface ComboSpec {
  /** Provider id the combo registers under; must not collide with a real backend. */
  readonly id: string
  /** Display name used in diagnostics. */
  readonly label: string
  /** Member provider ids, in priority order. Earlier members win ties. */
  readonly members: readonly string[]
  /** How the members' results are merged. */
  readonly merge: MergeStrategy
  /**
   * Run members at the same time rather than one after another. Parallel is
   * faster but spends every member's quota on every search; serial stops at the
   * first member that answers well enough, when `stopAfterResults` is set.
   */
  readonly concurrent: boolean
  /**
   * With `concurrent: false`, stop once this many sources have been collected,
   * so a working first backend does not also bill the rest. Ignored when
   * `concurrent` is true.
   */
  readonly stopAfterResults: number | undefined
  /** Characters kept per merged snippet. */
  readonly snippetBudget: number
}

/** Supplies the member providers a combo fans out to, by id. */
export type ProviderLookup = (id: string) => WebSearchProvider | undefined

/**
 * One registered combination of search backends.
 *
 * @implements {WebSearchProvider}
 */
export class CombinedSearchProvider implements WebSearchProvider {
  /** Provider id the seam selects by. */
  readonly id: string

  readonly #spec: ComboSpec
  readonly #lookup: ProviderLookup

  /**
   * @param spec - the combination's configuration.
   * @param lookup - resolves member ids to the providers registered for them.
   */
  constructor(spec: ComboSpec, lookup: ProviderLookup) {
    this.id = spec.id
    this.#spec = spec
    this.#lookup = lookup
  }

  /** The combination's display name. */
  get label(): string {
    return this.#spec.label
  }

  /**
   * Whether any member can answer right now. A combo is unusable only when
   * every member is, so it stays selected through one backend's outage.
   * @returns whether at least one member is registered and available.
   */
  available(): boolean {
    return this.#usableMembers().length > 0
  }

  /**
   * Members that are registered, available, and not this combo itself.
   * @returns the usable members in configured priority order.
   */
  #usableMembers(): readonly WebSearchProvider[] {
    const usable: WebSearchProvider[] = []
    for (const id of this.#spec.members) {
      // A combo naming itself would recurse until the stack ran out.
      if (id === this.id) continue
      const provider = this.#lookup(id)
      if (provider === undefined) continue
      if (!provider.available()) continue
      usable.push(provider)
    }
    return usable
  }

  /**
   * Search every usable member and fuse the results.
   * @param request - the query and the caller's result bound.
   * @param signal - caller cancellation.
   * @returns the fused sources, plus the merged answers when members supplied any.
   * @throws {WebError} when no member is usable, when every member fails, or when
   *   the caller cancels.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (cancelled(signal)) throw aborted(this.#spec.label, signal)
    const members = this.#usableMembers()
    if (members.length === 0) {
      throw providerError(
        `${this.#spec.label} has no usable backend: none of ${this.#spec.members.join(', ')} is registered and configured with a credential`,
        'WEB_PROVIDER_UNAVAILABLE',
      )
    }

    const outcomes = this.#spec.concurrent
      ? await this.#searchConcurrently(members, request, signal)
      : await this.#searchSerially(members, request, signal)

    if (outcomes.results.length === 0) {
      // Re-throw the first failure rather than a summary: it carries the seam's
      // structured code, which is what the model can act on.
      const first = outcomes.errors[0]
      throw first ?? providerError(`${this.#spec.label} returned no results`, 'WEB_PROVIDER_ERROR')
    }

    const sources = fuseResults(outcomes.results, {
      strategy: this.#spec.merge,
      snippetBudget: this.#spec.snippetBudget,
      // Members are asked for their own bounded list; the seam caps the merged
      // list afterwards, so this only avoids materializing a longer tail.
      maxResults: request.maxResults ?? sourcesBudget(request.maxResults),
      seed: seedFor(request.query),
    })

    return {
      ...(outcomes.answers.length === 0 ? {} : { content: outcomes.answers.join('\n\n') }),
      sources,
      // The seam owns truncation reporting; a combo that dropped members' tail
      // has still returned a complete answer for the backends it used.
      truncated: false,
    }
  }

  /**
   * Query every member at once.
   * @param members - usable members.
   * @param request - the caller's request.
   * @param signal - caller cancellation.
   * @returns the successful results, their answers, and every failure.
   */
  async #searchConcurrently(
    members: readonly WebSearchProvider[],
    request: WebSearchRequest,
    signal: AbortSignal | undefined,
  ): Promise<{ results: WebSearchSourceList[]; answers: string[]; errors: unknown[] }> {
    const settled = await Promise.allSettled(
      members.map((member) => member.search(request, signal)),
    )
    const results: WebSearchSourceList[] = []
    const answers: string[] = []
    const errors: unknown[] = []
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        errors.push(outcome.reason)
        continue
      }
      results.push(outcome.value.sources)
      const answer = text(outcome.value.content)
      if (answer !== undefined) answers.push(answer)
    }
    // A cancellation is the caller's decision, not a member outage: surface it
    // even though other members may already have answered.
    if (cancelled(signal)) throw aborted(this.#spec.label, signal)
    return { results, answers, errors }
  }

  /**
   * Query members in priority order, stopping once enough sources exist.
   * @param members - usable members.
   * @param request - the caller's request.
   * @param signal - caller cancellation.
   * @returns the collected results, their answers, and every failure.
   */
  async #searchSerially(
    members: readonly WebSearchProvider[],
    request: WebSearchRequest,
    signal: AbortSignal | undefined,
  ): Promise<{ results: WebSearchSourceList[]; answers: string[]; errors: unknown[] }> {
    const results: WebSearchSourceList[] = []
    const answers: string[] = []
    const errors: unknown[] = []
    const target = this.#spec.stopAfterResults ?? Number.POSITIVE_INFINITY
    let collected = 0
    for (const member of members) {
      if (cancelled(signal)) throw aborted(this.#spec.label, signal)
      try {
        const result = await member.search(request, signal)
        results.push(result.sources)
        collected += result.sources.length
        const answer = text(result.content)
        if (answer !== undefined) answers.push(answer)
      } catch (error) {
        if (cancelled(signal)) throw aborted(this.#spec.label, signal)
        if (isAbort(error)) throw error
        errors.push(error)
      }
      // Stop once the first members have already supplied enough to fill the
      // page, so a healthy backend does not also spend the others' quota.
      if (collected >= target) break
    }
    return { results, answers, errors }
  }
}

/** A member's source list, named for readability in the signatures above. */
type WebSearchSourceList = WebSearchResult['sources']

/**
 * The fallback result bound when the caller sets none.
 * @param requested - the caller's bound, if any.
 * @returns the bound to fuse with.
 */
function sourcesBudget(requested: number | undefined): number {
  return requested ?? 20
}

/**
 * Derive a stable shuffle seed from the query.
 *
 * Keyed on the query rather than on time so that retrying the same search, or
 * replaying a session, produces the same `random` order. The model gets variety
 * across different queries, which is what "random" is for, without a replay
 * citing different sources than the original turn did.
 * @param query - the search query.
 * @returns a positive 32-bit seed.
 */
function seedFor(query: string): number {
  let hash = 2166136261
  for (let index = 0; index < query.length; index += 1) {
    hash ^= query.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Whether a thrown value is a cancellation.
 *
 * A member that respects the signal reports `WEB_ABORTED`; rethrowing it
 * rather than recording it as a failure keeps the caller's own cancellation
 * from reading as a backend outage.
 * @param error - the thrown value.
 * @returns true for a cancellation.
 */
function isAbort(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'WEB_ABORTED'
  )
}

/**
 * Validate a combo specification against the catalogs, so a configuration typo
 * fails at load with a message naming it instead of producing an empty result
 * at search time.
 * @param spec - the combination's configured fields.
 * @param knownSearchIds - every real backend id in the catalog.
 * @param comboIds - every configured combo id.
 * @returns the validated specification.
 * @throws {Error} naming the offending field.
 */
export function validateCombo(
  spec: {
    readonly id: string
    readonly label: string | undefined
    readonly members: readonly string[]
    readonly merge: string
    readonly concurrent: boolean
    readonly stopAfterResults: number | undefined
    readonly snippetBudget: number | undefined
  },
  knownSearchIds: readonly string[],
  comboIds: readonly string[],
): ComboSpec {
  const label = spec.label ?? spec.id
  if (spec.id.trim().length === 0) throw new Error('a combo needs a non-empty id')
  if (knownSearchIds.includes(spec.id) || comboIds.filter((id) => id === spec.id).length > 1) {
    throw new Error(
      `combo id "${spec.id}" collides with another provider id; choose a name that is not one of: ${knownSearchIds.join(', ')}`,
    )
  }
  if (spec.members.length === 0) throw new Error(`combo "${spec.id}" needs at least one member`)
  const unknown = spec.members.filter((member) => !knownSearchIds.includes(member))
  if (unknown.length > 0) {
    throw new Error(
      `combo "${spec.id}" names unknown backend(s): ${unknown.join(', ')}; known backends are: ${knownSearchIds.join(', ')}`,
    )
  }
  if (spec.members.includes(spec.id)) {
    throw new Error(`combo "${spec.id}" cannot include itself as a member`)
  }
  if (spec.stopAfterResults !== undefined && spec.stopAfterResults < 1) {
    throw new Error(`combo "${spec.id}" has stopAfterResults below 1`)
  }
  if (spec.snippetBudget !== undefined && spec.snippetBudget < 1) {
    throw new Error(`combo "${spec.id}" has snippetBudget below 1`)
  }
  return {
    id: spec.id,
    label,
    members: spec.members,
    merge: spec.merge as MergeStrategy,
    concurrent: spec.concurrent,
    stopAfterResults: spec.stopAfterResults,
    snippetBudget: spec.snippetBudget ?? 600,
  }
}

/** Human-readable description of one merge strategy, for diagnostics. */
export const MERGE_STRATEGY_HELP: Readonly<Record<MergeStrategy, string>> = {
  consensus: 'rank by how many backends returned a page, then by their mean position',
  'round-robin': 'take the best of each backend in turn, then the next of each',
  append: 'list each backend whole, in configured priority order',
  random: 'shuffle the deduplicated pool with a seed derived from the query',
}

/**
 * Render a failure summary for diagnostics that never reaches the model.
 * @param errors - the failures from one fan-out.
 * @returns one line per failure.
 */
export function describeFailures(errors: readonly unknown[]): string {
  return errors.map((error) => describe(error)).join('; ')
}
