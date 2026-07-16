import {
  validateFormulaFields,
  buildLastFormulaDiagnostics,
} from '../src/options/formulaValidation.js';
import {
  MAX_FORMULA_ID_LENGTH,
  MAX_FORMULA_NAME_LENGTH,
  MAX_FORMULA_EXPRESSION_LENGTH,
} from '../src/core/customFormulas.js';

// ─── validateFormulaFields ────────────────────────────────────────────────────

describe('validateFormulaFields — id validation', () => {
  test('returns error when id is empty', () => {
    const err = validateFormulaFields('', '', '0', 'observe');
    expect(err).not.toBeNull();
    expect(err).toContain('required');
  });

  test('returns error when id is whitespace only', () => {
    const err = validateFormulaFields('   ', '', '0', 'observe');
    expect(err).not.toBeNull();
  });

  test('returns error when id exceeds max length', () => {
    const longId = 'a'.repeat(MAX_FORMULA_ID_LENGTH + 1);
    const err = validateFormulaFields(longId, '', '0', 'observe');
    expect(err).not.toBeNull();
    expect(err).toContain(String(MAX_FORMULA_ID_LENGTH));
  });

  test('accepts id at exactly max length', () => {
    const id = 'a'.repeat(MAX_FORMULA_ID_LENGTH);
    const err = validateFormulaFields(id, '', '0', 'observe');
    expect(err).toBeNull();
  });

  test('returns error for id with spaces', () => {
    const err = validateFormulaFields('my formula', '', '0', 'observe');
    expect(err).not.toBeNull();
    expect(err).toMatch(/letter|digit|underscore|hyphen/i);
  });

  test('returns error for id with dots', () => {
    const err = validateFormulaFields('my.formula', '', '0', 'observe');
    expect(err).not.toBeNull();
  });

  test('accepts alphanumeric id', () => {
    const err = validateFormulaFields('myFormula123', '', '0', 'observe');
    expect(err).toBeNull();
  });

  test('accepts id with hyphens and underscores', () => {
    const err = validateFormulaFields('my-formula_test', '', '0', 'observe');
    expect(err).toBeNull();
  });
});

describe('validateFormulaFields — duplicate id check', () => {
  const existing = [
    { id: 'existing-formula', name: 'Test', expression: '0', mode: 'observe' },
  ];

  test('returns error when id duplicates an existing formula (add mode)', () => {
    const err = validateFormulaFields('existing-formula', '', '0', 'observe', existing, null);
    expect(err).not.toBeNull();
    expect(err).toMatch(/already exist/i);
  });

  test('returns null when editing the same formula (editingId matches)', () => {
    const err = validateFormulaFields('existing-formula', '', '0', 'observe', existing, 'existing-formula');
    expect(err).toBeNull();
  });

  test('returns error when editing and new id collides with a DIFFERENT existing formula', () => {
    const formulas = [
      { id: 'alpha', name: '', expression: '0', mode: 'observe' },
      { id: 'beta',  name: '', expression: '0', mode: 'observe' },
    ];
    // editing 'alpha', trying to change id to 'beta' — but we don't allow id changes
    // (the UI disables the ID field when editing). Still, the validator should catch it.
    const err = validateFormulaFields('beta', '', '0', 'observe', formulas, 'alpha');
    expect(err).not.toBeNull();
  });

  test('returns null with no existing formulas', () => {
    const err = validateFormulaFields('new-id', '', '0', 'observe', [], null);
    expect(err).toBeNull();
  });
});

describe('validateFormulaFields — name validation', () => {
  test('returns error when name exceeds max length', () => {
    const longName = 'n'.repeat(MAX_FORMULA_NAME_LENGTH + 1);
    const err = validateFormulaFields('my-id', longName, '0', 'observe');
    expect(err).not.toBeNull();
    expect(err).toContain(String(MAX_FORMULA_NAME_LENGTH));
  });

  test('accepts empty name', () => {
    const err = validateFormulaFields('my-id', '', '0', 'observe');
    expect(err).toBeNull();
  });

  test('accepts name at exactly max length', () => {
    const name = 'n'.repeat(MAX_FORMULA_NAME_LENGTH);
    const err = validateFormulaFields('my-id', name, '0', 'observe');
    expect(err).toBeNull();
  });
});

describe('validateFormulaFields — expression validation', () => {
  test('returns error when expression is empty', () => {
    const err = validateFormulaFields('my-id', '', '', 'observe');
    expect(err).not.toBeNull();
    expect(err).toMatch(/required/i);
  });

  test('returns error when expression is whitespace only', () => {
    const err = validateFormulaFields('my-id', '', '   ', 'observe');
    expect(err).not.toBeNull();
  });

  test('returns error when expression exceeds max length', () => {
    const longExpr = '0 + '.repeat(MAX_FORMULA_EXPRESSION_LENGTH / 4 + 10);
    const err = validateFormulaFields('my-id', '', longExpr, 'observe');
    expect(err).not.toBeNull();
    expect(err).toContain(String(MAX_FORMULA_EXPRESSION_LENGTH));
  });

  test('returns parse error for invalid expression', () => {
    // '@' is not a supported token in the formula language
    const err = validateFormulaFields('my-id', '', 'from.domain @ 1', 'observe');
    expect(err).not.toBeNull();
    expect(err).toMatch(/parse error/i);
  });

  test('accepts valid numeric literal expression', () => {
    const err = validateFormulaFields('my-id', '', '42', 'observe');
    expect(err).toBeNull();
  });

  test('accepts valid ternary expression', () => {
    const err = validateFormulaFields('my-id', '', 'from.subdomainDepth >= 2 ? 30 : 0', 'observe');
    expect(err).toBeNull();
  });

  test('accepts has() and scoreOf() builtins', () => {
    const err = validateFormulaFields(
      'my-id', '',
      'has("composite.authAlignedRandomDomain") ? scoreOf("composite.authAlignedRandomDomain") : 0',
      'observe',
    );
    expect(err).toBeNull();
  });
});

describe('validateFormulaFields — starter template expressions', () => {
  const templates = [
    { name: 'boost-auth-aligned-random-domain', expression: 'has("composite.authAlignedRandomDomain") ? 30 : 0' },
    { name: 'deep-random-subdomain', expression: 'from.subdomainDepth >= 2 && from.leftLabelEntropy > 2.4 ? 40 : 0' },
    { name: 'msgid-mismatch', expression: 'messageId.matchesFromDomain == false && !alignment.anyDkimAligned ? 30 : 0' },
    { name: 'dkim-aligned-mitigate', expression: 'alignment.anyDkimAligned ? -20 : 0' },
  ];

  for (const tpl of templates) {
    test(`template "${tpl.name}" passes validation in observe mode`, () => {
      const err = validateFormulaFields(tpl.name, tpl.name, tpl.expression, 'observe');
      expect(err).toBeNull();
    });

    test(`template "${tpl.name}" passes validation in add mode`, () => {
      const err = validateFormulaFields(tpl.name, tpl.name, tpl.expression, 'add');
      expect(err).toBeNull();
    });
  }
});

describe('validateFormulaFields — mode validation', () => {
  test('accepts observe mode', () => {
    expect(validateFormulaFields('x', '', '0', 'observe')).toBeNull();
  });

  test('accepts add mode', () => {
    expect(validateFormulaFields('x', '', '0', 'add')).toBeNull();
  });

  test('accepts disabled mode', () => {
    expect(validateFormulaFields('x', '', '0', 'disabled')).toBeNull();
  });

  test('returns error for unrecognised mode', () => {
    const err = validateFormulaFields('x', '', '0', 'invalid-mode');
    expect(err).not.toBeNull();
  });

  test('returns error when match() is used in add mode', () => {
    const err = validateFormulaFields('x', '', 'match(from.domain, "paypal") ? 100 : 0', 'add');
    expect(err).not.toBeNull();
    expect(err).toMatch(/match_in_add_mode/i);
  });

  test('allows match() in observe mode', () => {
    expect(validateFormulaFields('x', '', 'match(from.domain, "paypal") ? 100 : 0', 'observe')).toBeNull();
  });

  test('allows match() in disabled mode', () => {
    expect(validateFormulaFields('x', '', 'match(from.domain, "paypal") ? 100 : 0', 'disabled')).toBeNull();
  });
});

// ─── buildLastFormulaDiagnostics ──────────────────────────────────────────────

describe('buildLastFormulaDiagnostics', () => {
  test('returns empty map for empty log', () => {
    const result = buildLastFormulaDiagnostics([]);
    expect(result.size).toBe(0);
  });

  test('returns empty map when log has no formulaDiagnostics', () => {
    const log = [
      { timestamp: 1, score: 0, fromDomain: 'example.com' },
    ];
    const result = buildLastFormulaDiagnostics(log);
    expect(result.size).toBe(0);
  });

  test('returns diagnostics from a single entry', () => {
    const log = [
      {
        timestamp: 1,
        formulaDiagnostics: [
          { id: 'formula-a', name: 'A', mode: 'observe', value: 30, applied: false },
        ],
      },
    ];
    const result = buildLastFormulaDiagnostics(log);
    expect(result.size).toBe(1);
    expect(result.get('formula-a').value).toBe(30);
  });

  test('most-recent entry wins for the same formula id', () => {
    const log = [
      {
        timestamp: 2,
        formulaDiagnostics: [{ id: 'formula-a', value: 99, mode: 'observe', applied: false }],
      },
      {
        timestamp: 1,
        formulaDiagnostics: [{ id: 'formula-a', value: 10, mode: 'observe', applied: false }],
      },
    ];
    const result = buildLastFormulaDiagnostics(log);
    expect(result.get('formula-a').value).toBe(99);
  });

  test('handles multiple distinct formula ids', () => {
    const log = [
      {
        timestamp: 1,
        formulaDiagnostics: [
          { id: 'a', value: 10, mode: 'observe', applied: false },
          { id: 'b', value: 20, mode: 'add', applied: true },
        ],
      },
    ];
    const result = buildLastFormulaDiagnostics(log);
    expect(result.size).toBe(2);
    expect(result.get('a').value).toBe(10);
    expect(result.get('b').value).toBe(20);
  });

  test('respects the limit parameter', () => {
    const log = [
      { timestamp: 2, formulaDiagnostics: [{ id: 'new', value: 99, mode: 'observe', applied: false }] },
      { timestamp: 1, formulaDiagnostics: [{ id: 'old', value: 1,  mode: 'observe', applied: false }] },
    ];
    // limit=1 means only the first entry (most recent) is scanned
    const result = buildLastFormulaDiagnostics(log, 1);
    expect(result.has('new')).toBe(true);
    expect(result.has('old')).toBe(false);
  });

  test('skips entries without a valid id', () => {
    const log = [
      {
        timestamp: 1,
        formulaDiagnostics: [
          { id: '', value: 5, mode: 'observe', applied: false },
          { id: null, value: 5, mode: 'observe', applied: false },
          { value: 5, mode: 'observe', applied: false },
        ],
      },
    ];
    const result = buildLastFormulaDiagnostics(log);
    expect(result.size).toBe(0);
  });
});
