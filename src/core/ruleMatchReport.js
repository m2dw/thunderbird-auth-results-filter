/**
 * Rule match report aggregation (pure).
 *
 * Turns per-message assessment results into per-rule aggregates keyed by the
 * stable score-reason key. See SPEC.md "Rule Match Report" for the contract.
 */

import { REGISTRY, getRuleMeta } from './ruleRegistry.js';
import { DEFAULT_AUTH_SCORES } from './scoring.js';

export const RULE_LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5'];

const REGISTRY_INDEX = new Map(REGISTRY.map((e, i) => [e.key, i]));
const AUTH_METHOD_ORDER = Object.keys(DEFAULT_AUTH_SCORES);

/**
 * Return the scoring layer ('L1'–'L5') a score-reason key belongs to, or null
 * for keys outside the known namespaces.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function ruleLayerForKey(key) {
  if (typeof key !== 'string') return null;
  if (key === 'authserv.untrusted' || key.startsWith('auth.')) return 'L1';
  if (key.startsWith('identity.')) return 'L2';
  if (key.startsWith('heuristic.')) return 'L3';
  if (key.startsWith('composite.')) return 'L4';
  if (key === 'sender.rule' || key.startsWith('whitelist.') || key.startsWith('custom.formula.')) return 'L5';
  return null;
}

// Rank within a layer: auth.method.result keys first (method/result order of
// DEFAULT_AUTH_SCORES), then registry order, then custom formulas / unknown keys.
function rankWithinLayer(key) {
  const auth = key.match(/^auth\.(\w+)\.(\w+)$/);
  if (auth && !REGISTRY_INDEX.has(key)) {
    const m = AUTH_METHOD_ORDER.indexOf(auth[1]);
    const results = m >= 0 ? Object.keys(DEFAULT_AUTH_SCORES[auth[1]]) : [];
    const r = results.indexOf(auth[2]);
    return -10000 + (m >= 0 ? m : 99) * 100 + (r >= 0 ? r : 99);
  }
  if (REGISTRY_INDEX.has(key)) return REGISTRY_INDEX.get(key);
  return 10000;
}

/**
 * Comparator implementing the canonical rule order: layer L1→L5 (unknown
 * layers last), then rank within the layer, then key (code-unit order) as the
 * final deterministic tiebreak.
 */
export function compareRuleKeys(a, b) {
  const la = RULE_LAYERS.indexOf(ruleLayerForKey(a));
  const lb = RULE_LAYERS.indexOf(ruleLayerForKey(b));
  const layerA = la < 0 ? RULE_LAYERS.length : la;
  const layerB = lb < 0 ? RULE_LAYERS.length : lb;
  if (layerA !== layerB) return layerA - layerB;
  const ra = rankWithinLayer(a);
  const rb = rankWithinLayer(b);
  if (ra !== rb) return ra - rb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Aggregate assessed messages into per-rule match counts.
 *
 * Each message counts at most once per rule key, even when the evaluator
 * emitted that key several times (e.g. two untrusted AR headers). Zero-delta
 * reasons are counted as matches.
 *
 * `diagnostic` is true only when the registry marks the rule diagnostic and
 * none of its matches changed a message score in this run.
 *
 * @param {Array<{ messageId: number, score: number, classification: string,
 *   scoreReasons: Array<{ key: string, delta?: number, label?: string }> }>} assessed
 *   In the order the matching-message references should appear.
 * @returns {Array<object>} Rule aggregates in canonical rule order.
 */
export function aggregateRuleMatches(assessed) {
  const byKey = new Map();

  for (const msg of assessed) {
    const perKey = new Map();
    for (const reason of msg.scoreReasons ?? []) {
      if (!reason || typeof reason.key !== 'string') continue;
      const delta = Number.isFinite(reason.delta) ? reason.delta : 0;
      const seen = perKey.get(reason.key);
      if (seen) {
        seen.delta += delta;
        seen.occurrences += 1;
      } else {
        perKey.set(reason.key, { delta, occurrences: 1, label: reason.label ?? null });
      }
    }

    for (const [key, hit] of perKey) {
      let rule = byKey.get(key);
      if (!rule) {
        const meta = getRuleMeta(key);
        rule = {
          key,
          layer: ruleLayerForKey(key),
          type: meta?.type ?? null,
          diagnostic: meta?.type === 'diagnostic',
          title: meta?.title ?? key,
          label: hit.label,
          matchCount: 0,
          zeroDeltaMatchCount: 0,
          totalDelta: 0,
          messages: [],
        };
        byKey.set(key, rule);
      }
      rule.matchCount += 1;
      if (hit.delta === 0) rule.zeroDeltaMatchCount += 1;
      rule.totalDelta += hit.delta;
      rule.messages.push({
        messageId: msg.messageId,
        delta: hit.delta,
        occurrences: hit.occurrences,
        score: msg.score,
        classification: msg.classification,
      });
    }
  }

  // A registry 'diagnostic' rule that actually changed a score in this run
  // (e.g. auth.*.pass configured to a nonzero score) is a score contributor,
  // so it must not be flagged diagnostic or typed as such.
  for (const rule of byKey.values()) {
    if (rule.diagnostic && rule.messages.some(m => m.delta !== 0)) {
      rule.diagnostic = false;
      rule.type = scoringTypeForDeltas(rule.messages);
    }
  }

  return [...byKey.keys()].sort(compareRuleKeys).map(k => byKey.get(k));
}

function scoringTypeForDeltas(messages) {
  const hasRisk = messages.some(m => m.delta > 0);
  const hasMitigation = messages.some(m => m.delta < 0);
  if (hasRisk && !hasMitigation) return 'risk';
  if (hasMitigation && !hasRisk) return 'mitigation';
  return null;
}
