/**
 * Layer 5: Custom formula scoring.
 *
 * Advanced/diagnostics feature for power users. Formula expressions are parsed
 * into an AST by JSEP (a parse-only library) and evaluated against a structured
 * context derived from L1-L4 scoring facts. No eval, no Function constructor,
 * no regex literals. Safety is enforced by the allowlisted evaluator below, not
 * by the parser.
 */

import jsep from '../vendor/jsep.esm.min.js';

export const FORMULA_OUTPUT_MIN = -100;
export const FORMULA_OUTPUT_MAX = 100;

// Bounds applied both at storage time and at evaluation time (defense-in-depth).
export const MAX_CUSTOM_FORMULAS = 20;
export const MAX_FORMULA_ID_LENGTH = 100;
export const MAX_FORMULA_NAME_LENGTH = 200;
export const MAX_FORMULA_EXPRESSION_LENGTH = 1000;

// ─── Parser (JSEP) ────────────────────────────────────────────────────────────

/**
 * Parse a formula expression string into a JSEP AST.
 * Throws on parse errors or when the input is not a single expression.
 * Used for pre-validation and evaluation.
 *
 * @param {string} expr
 * @returns {object} AST root node (JSEP node types)
 */
export function parseFormula(expr) {
  const ast = jsep(String(expr));
  // JSEP produces a Compound node when the input contains multiple
  // space/semicolon-separated expressions. Only single expressions are allowed.
  if (ast.type === 'Compound') {
    throw new Error('Unexpected token after expression: only a single expression is allowed');
  }
  return ast;
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

// Top-level identifiers that may be read from the formula context
const CONTEXT_TOP_LEVEL = new Set([
  'baseScore', 'verdict',
  'from', 'displayName', 'auth', 'alignment',
  'messageId', 'headers', 'metrics', 'reasons',
]);

// Function names that may be called as bare identifiers
const ALLOWED_FUNCTIONS = new Set(['has', 'scoreOf', 'min', 'max', 'clamp', 'match']);

// Method names that may be invoked on context objects
const ALLOWED_METHODS = new Set(['contains']);

/**
 * Evaluate a parsed formula AST against a formula context.
 *
 * @param {object} ast     - AST from parseFormula()
 * @param {object} context - Formula context from buildFormulaContext()
 * @returns {*}
 * @throws on evaluation errors
 */
export function evaluateFormula(ast, context) {
  return evalNode(ast, context);
}

function evalNode(node, ctx) {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Identifier': {
      const name = node.name;
      if (ALLOWED_FUNCTIONS.has(name)) return { __fn: name };
      if (!CONTEXT_TOP_LEVEL.has(name)) {
        throw new Error(`Unknown identifier: '${name}'`);
      }
      const val = ctx[name];
      return val !== undefined ? val : null;
    }

    case 'MemberExpression': {
      // Reject computed (bracket-notation) access: a[b] is not allowed.
      if (node.computed) {
        throw new Error('Computed property access (bracket notation) is not allowed');
      }
      const obj = evalNode(node.object, ctx);
      if (obj === null || obj === undefined) return null;
      if (typeof obj !== 'object' || obj.__fn !== undefined) {
        throw new Error(`Cannot access property '${node.property.name}' on non-object`);
      }
      const propName = node.property.name; // JSEP: property is an Identifier node
      // Sentinel for method calls — CallExpression handler will invoke it
      if (ALLOWED_METHODS.has(propName)) {
        return { __method: propName, __self: obj };
      }
      if (!Object.hasOwn(obj, propName)) return null;
      const val = obj[propName];
      return val !== undefined ? val : null;
    }

    case 'CallExpression': {
      const callee = evalNode(node.callee, ctx);
      const args = node.arguments.map(a => evalNode(a, ctx)); // JSEP: `arguments` not `args`
      if (callee && callee.__fn) {
        return callBuiltin(callee.__fn, args, ctx);
      }
      if (callee && callee.__method) {
        return callMethod(callee.__method, callee.__self, args);
      }
      throw new Error('Only allowlisted functions and methods can be called');
    }

    case 'BinaryExpression': {
      // Short-circuit evaluation for logical operators
      if (node.operator === '&&') {
        const lAnd = evalNode(node.left, ctx);
        return lAnd ? evalNode(node.right, ctx) : lAnd;
      }
      if (node.operator === '||') {
        const lOr = evalNode(node.left, ctx);
        return lOr ? lOr : evalNode(node.right, ctx);
      }
      return evalBinary(node.operator, evalNode(node.left, ctx), evalNode(node.right, ctx));
    }

    case 'UnaryExpression':
      // JSEP: `operator` (not `op`) and `argument` (not `operand`)
      return evalUnary(node.operator, evalNode(node.argument, ctx));

    case 'ConditionalExpression':
      return evalNode(node.test, ctx)
        ? evalNode(node.consequent, ctx)
        : evalNode(node.alternate, ctx);

    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}

function evalBinary(op, left, right) {
  switch (op) {
    case '+': return Number(left) + Number(right);
    case '-': return Number(left) - Number(right);
    case '*': return Number(left) * Number(right);
    case '/': {
      if (right === 0) return NaN;
      return Number(left) / Number(right);
    }
    case '%': return Number(left) % Number(right);
    case '==': return left === right;
    case '!=': return left !== right;
    case '>':  return Number(left) > Number(right);
    case '>=': return Number(left) >= Number(right);
    case '<':  return Number(left) < Number(right);
    case '<=': return Number(left) <= Number(right);
    case '&&': return left && right;
    case '||': return left || right;
    default: throw new Error(`Unknown operator: '${op}'`);
  }
}

function evalUnary(op, operand) {
  switch (op) {
    case '!': return !operand;
    case '-': return -Number(operand);
    case '+': return +Number(operand);
    default: throw new Error(`Unknown unary operator: '${op}'`);
  }
}

function callBuiltin(name, args, ctx) {
  switch (name) {
    case 'has': {
      const key = String(args[0] ?? '');
      return Object.prototype.hasOwnProperty.call(ctx.reasons ?? {}, key);
    }
    case 'scoreOf': {
      const key = String(args[0] ?? '');
      const val = (ctx.reasons ?? {})[key];
      return typeof val === 'number' ? val : 0;
    }
    case 'min':
      return Math.min(Number(args[0] ?? 0), Number(args[1] ?? 0));
    case 'max':
      return Math.max(Number(args[0] ?? 0), Number(args[1] ?? 0));
    case 'clamp': {
      const val = Number(args[0] ?? 0);
      const lo  = Number(args[1] ?? 0);
      const hi  = Number(args[2] ?? 0);
      return Math.min(Math.max(val, lo), hi);
    }
    case 'match': {
      // v1 hard constraint: no regex sender-domain scoring rules.
      // match() is allowed in observe mode (no verdict change) but not in add mode.
      if (ctx._mode === 'add') {
        throw new Error('match() is not available in add mode (v1 restriction: regex sender-domain scoring rules are not permitted)');
      }
      // ReDoS risk: patterns are user-supplied. Feature is Advanced/Diagnostics only.
      const input   = String(args[0] ?? '').slice(0, 512);
      const pattern = String(args[1] ?? '');
      const flagArg = args[2] !== undefined ? String(args[2]) : '';
      if (pattern.length > 256) throw new Error('match(): pattern too long (max 256)');
      if (flagArg && flagArg !== 'i') throw new Error(`match(): unsupported flag '${flagArg}' (only "i" allowed)`);
      const re = new RegExp(pattern, flagArg || '');
      return re.test(input);
    }
    default:
      throw new Error(`Unknown builtin: '${name}'`);
  }
}

function callMethod(method, self, args) {
  if (method === 'contains') {
    // Apply the same normalization as computeDisplayNameMetrics() so that
    // needles like "American Express" match the stripped haystack "americanexpress".
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const needle = normalize(String(args[0] ?? ''));
    const haystack = normalize(String(self?.normalized ?? ''));
    return haystack.includes(needle);
  }
  throw new Error(`Unknown method: '${method}'`);
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Build the formula evaluation context from scoring facts.
 *
 * Produces a stable, documented context for custom formula expressions.
 * All values come from data already computed by L1-L4; no re-scoring occurs.
 *
 * @param {object} opts
 * @param {number}  opts.baseScore            - Total score from L1-L5 before custom formulas.
 * @param {string}  opts.classification       - 'normal' | 'review' | 'high-risk'
 * @param {string}  [opts.senderDomain]       - RFC5322 From domain (lowercased).
 * @param {string}  [opts.senderLocalPart]    - RFC5322 From local part.
 * @param {string}  [opts.senderAddress]      - Full From address (local@domain).
 * @param {object}  [opts.domainParts]        - Output of getDomainParts(senderDomain).
 * @param {number}  [opts.leftLabelEntropy]   - Shannon entropy of the leftmost domain label.
 * @param {object}  [opts.displayNameMetrics] - From decision log displayNameMetrics.
 * @param {object}  [opts.alignmentSummary]   - Output of computePassAlignmentSummary().
 * @param {Array}   [opts.scoreReasons]       - Score reasons array from L1-L4.
 * @param {object}  [opts.messageIdMetrics]   - Message-ID related metrics.
 * @param {object}  [opts.headerMetrics]      - Header metrics from computeHeaderMetrics().
 * @returns {object} Formula context.
 */
export function buildFormulaContext({
  baseScore = 0,
  classification = 'normal',
  senderDomain = '',
  senderLocalPart = '',
  senderAddress = '',
  domainParts = null,
  leftLabelEntropy = 0,
  displayNameMetrics = null,
  alignmentSummary = null,
  scoreReasons = [],
  messageIdMetrics = null,
  headerMetrics = null,
} = {}) {
  const dp = domainParts ?? {};

  // Build reasons lookup: key → delta for use by has() and scoreOf()
  const reasons = {};
  for (const r of scoreReasons) {
    if (r.key) reasons[r.key] = r.delta ?? 0;
  }

  // Derive auth results from score reasons (first occurrence of each method)
  let dmarcResult = null, spfResult = null, dkimResult = null;
  for (const r of scoreReasons) {
    const m = r.key?.match(/^auth\.(dmarc|spf|dkim)\.(\w+)$/);
    if (!m) continue;
    if (m[1] === 'dmarc' && !dmarcResult) dmarcResult = m[2];
    if (m[1] === 'spf' && !spfResult) spfResult = m[2];
    if (m[1] === 'dkim' && !dkimResult) dkimResult = m[2];
  }

  const effectiveAddress = senderAddress ||
    (senderLocalPart && senderDomain ? `${senderLocalPart.toLowerCase()}@${senderDomain}` : null);

  return {
    baseScore,
    verdict: classification,
    from: {
      address: effectiveAddress,
      localPart: senderLocalPart || null,
      domain: senderDomain || null,
      registrableDomain: dp.registrableDomain ?? null,
      tld: dp.publicSuffix ?? null,
      subdomainDepth: dp.subdomainDepth ?? 0,
      leftLabelEntropy,
    },
    displayName: {
      raw: displayNameMetrics?.displayNameRaw ?? null,
      normalized: displayNameMetrics?.displayNameNormalized ?? null,
    },
    auth: {
      dmarc: dmarcResult,
      spf: spfResult,
      dkim: dkimResult,
    },
    alignment: {
      spfAligned: alignmentSummary?.spfAligned ?? null,
      anyDkimAligned: alignmentSummary?.anyDkimAligned ?? null,
      anyAuthAligned: alignmentSummary?.anyAuthAligned ?? null,
    },
    messageId: {
      domain: messageIdMetrics?.messageIdDomain ?? null,
      registrableDomain: messageIdMetrics?.messageIdRegistrableDomain ?? null,
      matchesFromDomain: messageIdMetrics?.messageIdDomainMatchesFromDomain ?? null,
    },
    headers: {
      hasListHeaders: headerMetrics?.hasListHeaders ?? false,
    },
    metrics: {},
    reasons,
  };
}

// ─── Formula application ──────────────────────────────────────────────────────

function classifyScore(score) {
  if (score >= 100) return 'high-risk';
  if (score >= 50) return 'review';
  return 'normal';
}

/**
 * Apply custom formulas to produce score adjustments and diagnostics.
 *
 * Each formula is evaluated in isolation. Parse or evaluation errors are caught
 * and recorded in diagnostics; they never propagate to affect scoring.
 *
 * @param {Array}  formulas - Custom formula definitions.
 *   Each: { id: string, name?: string, expression: string, mode: 'observe'|'add'|'disabled' }
 * @param {object} context  - Formula context from buildFormulaContext().
 * @param {object} [opts]
 * @param {number} [opts.baseScore]   - Score before formulas (for hypothetical displays).
 * @param {string} [opts.baseVerdict] - Verdict before formulas.
 * @returns {{ score: number, scoreReasons: Array, formulaDiagnostics: Array }}
 */
export function applyCustomFormulas(formulas, context, { baseScore = 0, baseVerdict = 'normal' } = {}) {
  if (!Array.isArray(formulas) || formulas.length === 0) {
    return { score: 0, scoreReasons: [], formulaDiagnostics: [] };
  }

  let totalDelta = 0;
  const scoreReasons = [];
  const formulaDiagnostics = [];

  // Cap to the same limit enforced at storage time (defense-in-depth).
  const active = formulas.slice(0, MAX_CUSTOM_FORMULAS);
  for (const formula of active) {
    const { id, name, expression, mode = 'observe' } = formula;
    if (mode === 'disabled' || !id || !expression) continue;

    let value = null;
    let error = null;

    try {
      const ast = parseFormula(expression);
      // _mode is an internal sentinel — not in CONTEXT_TOP_LEVEL so formulas can't read it
      const evalCtx = { ...context, _mode: mode };
      const raw = evaluateFormula(ast, evalCtx);

      if (typeof raw !== 'number' || !isFinite(raw) || isNaN(raw)) {
        throw new Error(`Formula must return a finite number, got: ${String(raw)}`);
      }

      // Clamp output to the allowed range
      value = Math.min(Math.max(raw, FORMULA_OUTPUT_MIN), FORMULA_OUTPUT_MAX);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const applied = mode === 'add' && value !== null && error === null;
    const label = name || id;

    const diag = { id, name: label, mode };
    if (error !== null) {
      diag.error = error;
      diag.applied = false;
    } else {
      diag.value = value;
      diag.applied = applied;

      // Hypothetical score/verdict if this formula were applied
      const hypotheticalScore = baseScore + value;
      diag.wouldChangeScore = hypotheticalScore;
      const hypotheticalVerdict = classifyScore(hypotheticalScore);
      if (hypotheticalVerdict !== baseVerdict) {
        diag.wouldChangeVerdict = `${baseVerdict} -> ${hypotheticalVerdict}`;
      }
    }

    formulaDiagnostics.push(diag);

    if (applied) {
      totalDelta += value;
      scoreReasons.push({
        key: `custom.formula.${id}`,
        label,
        delta: value,
        formulaId: id,
      });
    }
  }

  return { score: totalDelta, scoreReasons, formulaDiagnostics };
}
