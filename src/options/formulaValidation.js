/**
 * Pure helper functions for custom formula validation and diagnostics lookup.
 * Kept separate from options.js so they can be unit-tested without DOM dependencies.
 */

import {
  parseFormula,
  MAX_FORMULA_ID_LENGTH,
  MAX_FORMULA_NAME_LENGTH,
  MAX_FORMULA_EXPRESSION_LENGTH,
} from '../core/customFormulas.js';
import { getMessage } from '../modules/i18n.js';

const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_MODES = new Set(['observe', 'add', 'disabled']);

/**
 * Validate custom formula input fields before saving.
 *
 * Returns an i18n error string when validation fails, or null when all fields
 * are acceptable. Runs the full parser/evaluator round-trip so parse errors
 * surface before the formula reaches storage.
 *
 * @param {string} id               - Formula ID (must be stable, alphanumeric + _ -)
 * @param {string} name             - Display name (may be empty)
 * @param {string} expression       - Formula expression string
 * @param {string} mode             - 'observe' | 'add' | 'disabled'
 * @param {Array}  [existingFormulas] - Current stored formula list for duplicate check
 * @param {string|null} [editingId] - ID being edited (excluded from duplicate check)
 * @returns {string|null}
 */
export function validateFormulaFields(
  id,
  name,
  expression,
  mode,
  existingFormulas = [],
  editingId = null,
) {
  const trimmedId = (id ?? '').trim();
  if (!trimmedId) return getMessage('custom_formula_error_id_required');
  if (trimmedId.length > MAX_FORMULA_ID_LENGTH) {
    return getMessage('custom_formula_error_id_too_long', [String(MAX_FORMULA_ID_LENGTH)]);
  }
  if (!VALID_ID_RE.test(trimmedId)) return getMessage('custom_formula_error_id_invalid');

  // Duplicate ID check: any OTHER stored formula with this ID is a conflict.
  if (existingFormulas.some(f => f.id === trimmedId && f.id !== editingId)) {
    return getMessage('custom_formula_error_id_duplicate');
  }

  const trimmedName = (name ?? '').trim();
  if (trimmedName.length > MAX_FORMULA_NAME_LENGTH) {
    return getMessage('custom_formula_error_name_too_long', [String(MAX_FORMULA_NAME_LENGTH)]);
  }

  const trimmedExpr = (expression ?? '').trim();
  if (!trimmedExpr) return getMessage('custom_formula_error_expression_required');
  if (trimmedExpr.length > MAX_FORMULA_EXPRESSION_LENGTH) {
    return getMessage('custom_formula_error_expression_too_long', [String(MAX_FORMULA_EXPRESSION_LENGTH)]);
  }

  try {
    parseFormula(trimmedExpr);
  } catch (e) {
    return getMessage('custom_formula_error_parse', [e instanceof Error ? e.message : String(e)]);
  }

  if (!VALID_MODES.has(mode)) return getMessage('custom_formula_error_invalid_mode');

  if (mode === 'add' && /\bmatch\s*\(/.test(trimmedExpr)) {
    return getMessage('custom_formula_error_match_in_add_mode');
  }

  return null;
}

/**
 * Scan recent decision log entries and return a map from formula ID to the
 * most-recent diagnostics entry for that formula.
 *
 * Used to show a brief "last result" summary in the formula list.
 *
 * @param {Array}  decisionLog
 * @param {number} [limit]    - How many log entries to scan (most recent first).
 * @returns {Map<string, object>}
 */
export function buildLastFormulaDiagnostics(decisionLog, limit = 50) {
  const result = new Map();
  const entries = (decisionLog ?? []).slice(0, limit);
  for (const entry of entries) {
    for (const diag of entry.formulaDiagnostics ?? []) {
      if (diag && diag.id && !result.has(diag.id)) {
        result.set(diag.id, diag);
      }
    }
  }
  return result;
}
