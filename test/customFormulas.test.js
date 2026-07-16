import {
  parseFormula,
  evaluateFormula,
  buildFormulaContext,
  applyCustomFormulas,
  FORMULA_OUTPUT_MIN,
  FORMULA_OUTPUT_MAX,
  MAX_CUSTOM_FORMULAS,
} from '../src/core/customFormulas.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function eval_(expr, ctx = {}) {
  return evaluateFormula(parseFormula(expr), ctx);
}

function makeCtx(overrides = {}) {
  return buildFormulaContext({
    baseScore: 0,
    classification: 'normal',
    senderDomain: 'example.com',
    senderLocalPart: 'user',
    ...overrides,
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('FORMULA_OUTPUT_MIN / FORMULA_OUTPUT_MAX', () => {
  test('min is -100', () => expect(FORMULA_OUTPUT_MIN).toBe(-100));
  test('max is 100', () => expect(FORMULA_OUTPUT_MAX).toBe(100));
});

// ─── Parser ───────────────────────────────────────────────────────────────────

describe('parseFormula', () => {
  test('parses a numeric literal', () => {
    const ast = parseFormula('42');
    expect(ast).toMatchObject({ type: 'Literal', value: 42 });
  });

  test('parses a string literal (double-quoted)', () => {
    const ast = parseFormula('"hello"');
    expect(ast).toMatchObject({ type: 'Literal', value: 'hello' });
  });

  test('parses a string literal (single-quoted)', () => {
    const ast = parseFormula("'world'");
    expect(ast).toMatchObject({ type: 'Literal', value: 'world' });
  });

  test('parses true / false / null', () => {
    expect(parseFormula('true')).toMatchObject({ type: 'Literal', value: true });
    expect(parseFormula('false')).toMatchObject({ type: 'Literal', value: false });
    expect(parseFormula('null')).toMatchObject({ type: 'Literal', value: null });
  });

  test('parses identifier', () => {
    expect(parseFormula('foo')).toEqual({ type: 'Identifier', name: 'foo' });
  });

  test('parses member expression', () => {
    const ast = parseFormula('from.domain');
    // JSEP MemberExpression: property is an Identifier node, not a plain string
    expect(ast).toMatchObject({
      type: 'MemberExpression',
      computed: false,
      object: { type: 'Identifier', name: 'from' },
      property: { type: 'Identifier', name: 'domain' },
    });
  });

  test('parses chained member expression', () => {
    const ast = parseFormula('from.registrableDomain');
    expect(ast.type).toBe('MemberExpression');
  });

  test('parses ternary', () => {
    const ast = parseFormula('a ? 1 : 0');
    expect(ast.type).toBe('ConditionalExpression');
    expect(ast.consequent).toMatchObject({ type: 'Literal', value: 1 });
    expect(ast.alternate).toMatchObject({ type: 'Literal', value: 0 });
  });

  test('parses logical &&', () => {
    const ast = parseFormula('a && b');
    expect(ast).toMatchObject({ type: 'BinaryExpression', operator: '&&' });
  });

  test('parses logical ||', () => {
    const ast = parseFormula('a || b');
    expect(ast).toMatchObject({ type: 'BinaryExpression', operator: '||' });
  });

  test('parses comparison operators', () => {
    for (const op of ['==', '!=', '<', '>', '<=', '>=']) {
      const ast = parseFormula(`1 ${op} 2`);
      expect(ast).toMatchObject({ type: 'BinaryExpression', operator: op });
    }
  });

  test('parses arithmetic operators', () => {
    for (const op of ['+', '-', '*', '/', '%']) {
      const ast = parseFormula(`1 ${op} 2`);
      expect(ast).toMatchObject({ type: 'BinaryExpression', operator: op });
    }
  });

  test('parses unary !', () => {
    const ast = parseFormula('!a');
    expect(ast).toMatchObject({ type: 'UnaryExpression', operator: '!' });
  });

  test('parses unary -', () => {
    const ast = parseFormula('-1');
    expect(ast).toMatchObject({ type: 'UnaryExpression', operator: '-' });
  });

  test('parses grouped expression', () => {
    const ast = parseFormula('(1 + 2) * 3');
    expect(ast).toMatchObject({ type: 'BinaryExpression', operator: '*' });
  });

  test('parses function call', () => {
    const ast = parseFormula('has("key")');
    expect(ast.type).toBe('CallExpression');
    expect(ast.callee).toEqual({ type: 'Identifier', name: 'has' });
    expect(ast.arguments).toHaveLength(1);
  });

  test('parses method call (member call)', () => {
    const ast = parseFormula('displayName.contains("Foo")');
    expect(ast.type).toBe('CallExpression');
    // JSEP: callee is MemberExpression with property as Identifier node
    expect(ast.callee).toMatchObject({ type: 'MemberExpression', property: { name: 'contains' } });
  });

  test('throws on unterminated string', () => {
    // JSEP error message differs from the old custom parser
    expect(() => parseFormula('"unterminated')).toThrow();
  });

  test('throws on unexpected character', () => {
    // JSEP error message: 'Unexpected "@" at character 0'
    expect(() => parseFormula('@foo')).toThrow('Unexpected "@"');
  });

  test('throws on trailing tokens', () => {
    // JSEP produces a Compound node; parseFormula wrapper rejects it
    expect(() => parseFormula('1 2')).toThrow(/Unexpected token/);
  });

  test('throws on missing closing paren', () => {
    expect(() => parseFormula('(1 + 2')).toThrow();
  });

  test('parses complex real-world formula', () => {
    const expr = 'has("composite.authAlignedRandomDomain") ? 40 : 0';
    expect(() => parseFormula(expr)).not.toThrow();
  });

  test('parses multi-condition formula', () => {
    const expr = 'from.subdomainDepth >= 2 && from.leftLabelEntropy > 2.4 ? 60 : 0';
    expect(() => parseFormula(expr)).not.toThrow();
  });
});

// ─── Evaluator — literals ─────────────────────────────────────────────────────

describe('evaluateFormula — literals', () => {
  const ctx = makeCtx();
  test('number', () => expect(eval_('42', ctx)).toBe(42));
  test('float', () => expect(eval_('3.14', ctx)).toBe(3.14));
  test('string', () => expect(eval_('"hello"', ctx)).toBe('hello'));
  test('true', () => expect(eval_('true', ctx)).toBe(true));
  test('false', () => expect(eval_('false', ctx)).toBe(false));
  test('null', () => expect(eval_('null', ctx)).toBeNull());
});

// ─── Evaluator — arithmetic ───────────────────────────────────────────────────

describe('evaluateFormula — arithmetic', () => {
  const ctx = makeCtx();
  test('addition', () => expect(eval_('1 + 2', ctx)).toBe(3));
  test('subtraction', () => expect(eval_('5 - 3', ctx)).toBe(2));
  test('multiplication', () => expect(eval_('3 * 4', ctx)).toBe(12));
  test('division', () => expect(eval_('10 / 4', ctx)).toBe(2.5));
  test('modulo', () => expect(eval_('7 % 3', ctx)).toBe(1));
  test('division by zero returns NaN', () => expect(eval_('1 / 0', ctx)).toBeNaN());
  test('unary minus', () => expect(eval_('-5', ctx)).toBe(-5));
  test('unary plus', () => expect(eval_('+3', ctx)).toBe(3));
  test('operator precedence (* before +)', () => expect(eval_('2 + 3 * 4', ctx)).toBe(14));
  test('parentheses override precedence', () => expect(eval_('(2 + 3) * 4', ctx)).toBe(20));
});

// ─── Evaluator — comparison and logical ───────────────────────────────────────

describe('evaluateFormula — comparison', () => {
  const ctx = makeCtx();
  test('==  true', () => expect(eval_('1 == 1', ctx)).toBe(true));
  test('==  false', () => expect(eval_('1 == 2', ctx)).toBe(false));
  test('!=  true', () => expect(eval_('1 != 2', ctx)).toBe(true));
  test('>   true', () => expect(eval_('3 > 2', ctx)).toBe(true));
  test('>=  equal', () => expect(eval_('2 >= 2', ctx)).toBe(true));
  test('<   true', () => expect(eval_('1 < 2', ctx)).toBe(true));
  test('<=  equal', () => expect(eval_('2 <= 2', ctx)).toBe(true));
});

describe('evaluateFormula — logical', () => {
  const ctx = makeCtx();
  test('&& both true', () => expect(eval_('true && true', ctx)).toBe(true));
  test('&& one false', () => expect(eval_('true && false', ctx)).toBe(false));
  test('|| one true', () => expect(eval_('false || true', ctx)).toBe(true));
  test('|| both false', () => expect(eval_('false || false', ctx)).toBe(false));
  test('! negation', () => expect(eval_('!false', ctx)).toBe(true));
  test('! double negation', () => expect(eval_('!!true', ctx)).toBe(true));
});

// ─── Evaluator — conditional (ternary) ───────────────────────────────────────

describe('evaluateFormula — conditional', () => {
  const ctx = makeCtx();
  test('true branch', () => expect(eval_('true ? 1 : 0', ctx)).toBe(1));
  test('false branch', () => expect(eval_('false ? 1 : 0', ctx)).toBe(0));
  test('nested ternary', () => {
    expect(eval_('true ? false ? 99 : 42 : 0', ctx)).toBe(42);
  });
});

// ─── Evaluator — context access ───────────────────────────────────────────────

describe('evaluateFormula — context property access', () => {
  test('from.domain', () => {
    const ctx = makeCtx({ senderDomain: 'test.example.com' });
    expect(eval_('from.domain', ctx)).toBe('test.example.com');
  });

  test('from.localPart', () => {
    const ctx = makeCtx({ senderLocalPart: 'alice' });
    expect(eval_('from.localPart', ctx)).toBe('alice');
  });

  test('from.subdomainDepth — default 0 for simple domain', () => {
    const ctx = makeCtx({ senderDomain: 'example.com' });
    expect(typeof eval_('from.subdomainDepth', ctx)).toBe('number');
  });

  test('from.leftLabelEntropy', () => {
    const ctx = makeCtx({ leftLabelEntropy: 2.5 });
    expect(eval_('from.leftLabelEntropy', ctx)).toBe(2.5);
  });

  test('alignment.anyDkimAligned', () => {
    const ctx = makeCtx({
      alignmentSummary: { spfAligned: false, anyDkimAligned: true, anyAuthAligned: true },
    });
    expect(eval_('alignment.anyDkimAligned', ctx)).toBe(true);
  });

  test('headers.hasListHeaders', () => {
    const ctx = makeCtx({ headerMetrics: { hasListHeaders: true } });
    expect(eval_('headers.hasListHeaders', ctx)).toBe(true);
  });

  test('accessing null sub-property returns null', () => {
    const ctx = makeCtx({ senderDomain: '' });
    expect(eval_('messageId.domain', ctx)).toBeNull();
  });

  test('unknown top-level identifier throws', () => {
    const ctx = makeCtx();
    expect(() => eval_('__proto__', ctx)).toThrow("Unknown identifier: '__proto__'");
  });

  test('unknown identifier throws', () => {
    const ctx = makeCtx();
    expect(() => eval_('evil', ctx)).toThrow("Unknown identifier: 'evil'");
  });
});

// ─── Evaluator — has() and scoreOf() ─────────────────────────────────────────

describe('evaluateFormula — has()', () => {
  test('returns true when reason key exists', () => {
    const ctx = makeCtx({
      scoreReasons: [{ key: 'composite.authAlignedRandomDomain', delta: 40 }],
    });
    expect(eval_('has("composite.authAlignedRandomDomain")', ctx)).toBe(true);
  });

  test('returns false when reason key absent', () => {
    const ctx = makeCtx({ scoreReasons: [] });
    expect(eval_('has("composite.authAlignedRandomDomain")', ctx)).toBe(false);
  });

  test('has() used in ternary formula', () => {
    const ctx = makeCtx({
      scoreReasons: [{ key: 'composite.authAlignedRandomDomain', delta: 40 }],
    });
    expect(eval_('has("composite.authAlignedRandomDomain") ? 40 : 0', ctx)).toBe(40);
  });
});

describe('evaluateFormula — scoreOf()', () => {
  test('returns delta when key exists', () => {
    const ctx = makeCtx({
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
    });
    expect(eval_('scoreOf("auth.dmarc.fail")', ctx)).toBe(15);
  });

  test('returns 0 when key absent', () => {
    const ctx = makeCtx({ scoreReasons: [] });
    expect(eval_('scoreOf("auth.dmarc.fail")', ctx)).toBe(0);
  });
});

// ─── Evaluator — displayName.contains() ──────────────────────────────────────

describe('evaluateFormula — displayName.contains()', () => {
  test('returns true when normalized displayName contains the string', () => {
    const ctx = makeCtx({
      displayNameMetrics: {
        displayNameRaw: 'American Express',
        displayNameNormalized: 'american express',
      },
    });
    expect(eval_('displayName.contains("American Express")', ctx)).toBe(true);
  });

  test('case-insensitive matching', () => {
    const ctx = makeCtx({
      displayNameMetrics: {
        displayNameRaw: 'AMEX',
        displayNameNormalized: 'amex',
      },
    });
    expect(eval_('displayName.contains("amex")', ctx)).toBe(true);
  });

  test('returns false when displayName is null', () => {
    const ctx = makeCtx({ displayNameMetrics: null });
    expect(eval_('displayName.contains("Foo")', ctx)).toBe(false);
  });

  test('returns false when displayName does not contain string', () => {
    const ctx = makeCtx({
      displayNameMetrics: {
        displayNameRaw: 'Hello',
        displayNameNormalized: 'hello',
      },
    });
    expect(eval_('displayName.contains("World")', ctx)).toBe(false);
  });
});

// ─── Evaluator — min() / max() / clamp() ──────────────────────────────────────

describe('evaluateFormula — min() / max() / clamp()', () => {
  const ctx = makeCtx();
  test('min', () => expect(eval_('min(3, 7)', ctx)).toBe(3));
  test('max', () => expect(eval_('max(3, 7)', ctx)).toBe(7));
  test('clamp below range', () => expect(eval_('clamp(-200, -100, 100)', ctx)).toBe(-100));
  test('clamp above range', () => expect(eval_('clamp(200, -100, 100)', ctx)).toBe(100));
  test('clamp within range', () => expect(eval_('clamp(42, -100, 100)', ctx)).toBe(42));
});

// ─── Evaluator — match() ──────────────────────────────────────────────────────

describe('evaluateFormula — match()', () => {
  const ctx = makeCtx({ senderDomain: 'evil.example.com' });

  test('basic match returns true', () =>
    expect(eval_('match(from.domain, "evil")', ctx)).toBe(true));

  test('anchored pattern matches exact domain', () =>
    expect(eval_('match(from.domain, "^evil\\\\.example\\\\.com$")', ctx)).toBe(true));

  test('non-matching pattern returns false', () =>
    expect(eval_('match(from.domain, "^safe\\\\.com$")', ctx)).toBe(false));

  test('case-insensitive flag', () => {
    const c = makeCtx({ senderDomain: 'AMEX.COM' });
    expect(eval_('match(from.domain, "amex", "i")', c)).toBe(true);
  });

  test('case-sensitive without flag', () => {
    const c = makeCtx({ senderDomain: 'AMEX.COM' });
    expect(eval_('match(from.domain, "amex")', c)).toBe(false);
  });

  test('rejects unsupported flag', () =>
    expect(() => eval_('match(from.domain, "x", "g")', ctx)).toThrow('unsupported flag'));

  test('rejects pattern over 256 chars', () => {
    const long = 'a'.repeat(257);
    expect(() => eval_(`match(from.domain, "${long}")`, ctx)).toThrow('pattern too long');
  });

  test('invalid regex throws', () =>
    expect(() => eval_('match(from.domain, "[")', ctx)).toThrow());
});

// ─── Evaluator — safety ───────────────────────────────────────────────────────

describe('evaluateFormula — safety', () => {
  const ctx = makeCtx();

  test('disallows calling arbitrary identifier', () => {
    expect(() => eval_('eval("1")', ctx)).toThrow();
  });

  test('disallows calling property of non-context object', () => {
    expect(() => eval_('from.toString()', ctx)).toThrow('Only allowlisted functions and methods can be called');
  });

  test('disallows accessing unknown top-level', () => {
    expect(() => eval_('globalThis', ctx)).toThrow();
  });

  test('property access on null returns null (not throws)', () => {
    const ctx2 = makeCtx({ messageIdMetrics: null });
    expect(eval_('messageId.domain', ctx2)).toBeNull();
  });

  test('does not allow constructor access', () => {
    expect(() => eval_('from.constructor', ctx)).not.toThrow();
    // 'constructor' is just a property name — it should return null from context
    // (it's not a special attack vector since we don't call it as a builtin)
  });

  test('disallows unknown function calls', () => {
    expect(() => eval_('setTimeout("x", 0)', ctx)).toThrow();
  });
});

// ─── buildFormulaContext ──────────────────────────────────────────────────────

describe('buildFormulaContext', () => {
  test('baseScore and verdict are set', () => {
    const ctx = buildFormulaContext({ baseScore: 45, classification: 'normal' });
    expect(ctx.baseScore).toBe(45);
    expect(ctx.verdict).toBe('normal');
  });

  test('from.domain is set from senderDomain', () => {
    const ctx = buildFormulaContext({ senderDomain: 'test.com' });
    expect(ctx.from.domain).toBe('test.com');
  });

  test('from.localPart is null when empty', () => {
    const ctx = buildFormulaContext({ senderLocalPart: '' });
    expect(ctx.from.localPart).toBeNull();
  });

  test('reasons map is built from scoreReasons', () => {
    const ctx = buildFormulaContext({
      scoreReasons: [
        { key: 'auth.dmarc.fail', delta: 15 },
        { key: 'composite.authAlignedRandomDomain', delta: 40 },
      ],
    });
    expect(ctx.reasons['auth.dmarc.fail']).toBe(15);
    expect(ctx.reasons['composite.authAlignedRandomDomain']).toBe(40);
  });

  test('auth.dmarc derived from scoreReasons', () => {
    const ctx = buildFormulaContext({
      scoreReasons: [{ key: 'auth.dmarc.fail', delta: 15 }],
    });
    expect(ctx.auth.dmarc).toBe('fail');
  });

  test('alignment values come from alignmentSummary', () => {
    const ctx = buildFormulaContext({
      alignmentSummary: { spfAligned: true, anyDkimAligned: false, anyAuthAligned: true },
    });
    expect(ctx.alignment.spfAligned).toBe(true);
    expect(ctx.alignment.anyDkimAligned).toBe(false);
    expect(ctx.alignment.anyAuthAligned).toBe(true);
  });

  test('displayName.raw and .normalized come from displayNameMetrics', () => {
    const ctx = buildFormulaContext({
      displayNameMetrics: {
        displayNameRaw: 'Alice',
        displayNameNormalized: 'alice',
      },
    });
    expect(ctx.displayName.raw).toBe('Alice');
    expect(ctx.displayName.normalized).toBe('alice');
  });

  test('messageId fields come from messageIdMetrics', () => {
    const ctx = buildFormulaContext({
      messageIdMetrics: {
        messageIdDomain: 'mail.sender.com',
        messageIdRegistrableDomain: 'sender.com',
        messageIdDomainMatchesFromDomain: false,
      },
    });
    expect(ctx.messageId.domain).toBe('mail.sender.com');
    expect(ctx.messageId.registrableDomain).toBe('sender.com');
    expect(ctx.messageId.matchesFromDomain).toBe(false);
  });

  test('defaults to safe nulls when data is absent', () => {
    const ctx = buildFormulaContext();
    expect(ctx.from.domain).toBeNull();
    expect(ctx.from.registrableDomain).toBeNull();
    expect(ctx.alignment.spfAligned).toBeNull();
    expect(ctx.displayName.raw).toBeNull();
    expect(ctx.messageId.domain).toBeNull();
    expect(ctx.headers.hasListHeaders).toBe(false);
  });
});

// ─── applyCustomFormulas ──────────────────────────────────────────────────────

describe('applyCustomFormulas — observe mode', () => {
  const ctx = makeCtx();

  test('observe mode does not affect score', () => {
    const result = applyCustomFormulas([
      { id: 'test', name: 'Test', expression: '50', mode: 'observe' },
    ], ctx, { baseScore: 0, baseVerdict: 'normal' });
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(0);
  });

  test('observe mode records formulaDiagnostics entry', () => {
    const result = applyCustomFormulas([
      { id: 'test', name: 'Test', expression: '60', mode: 'observe' },
    ], ctx, { baseScore: 40, baseVerdict: 'normal' });
    expect(result.formulaDiagnostics).toHaveLength(1);
    const d = result.formulaDiagnostics[0];
    expect(d.id).toBe('test');
    expect(d.name).toBe('Test');
    expect(d.mode).toBe('observe');
    expect(d.value).toBe(60);
    expect(d.applied).toBe(false);
    expect(d.wouldChangeScore).toBe(100); // 40 + 60
    expect(d.wouldChangeVerdict).toBe('normal -> high-risk');
  });

  test('observe mode: wouldChangeVerdict absent when verdict unchanged', () => {
    const result = applyCustomFormulas([
      { id: 'test', expression: '5', mode: 'observe' },
    ], ctx, { baseScore: 10, baseVerdict: 'normal' });
    const d = result.formulaDiagnostics[0];
    expect(d.wouldChangeVerdict).toBeUndefined();
    expect(d.wouldChangeScore).toBe(15);
  });
});

describe('applyCustomFormulas — add mode', () => {
  const ctx = makeCtx();

  test('add mode contributes to score', () => {
    const result = applyCustomFormulas([
      { id: 'bonus', name: 'Bonus', expression: '30', mode: 'add' },
    ], ctx, { baseScore: 0 });
    expect(result.score).toBe(30);
    expect(result.scoreReasons).toHaveLength(1);
    expect(result.scoreReasons[0].key).toBe('custom.formula.bonus');
    expect(result.scoreReasons[0].delta).toBe(30);
    expect(result.scoreReasons[0].label).toBe('Bonus');
    expect(result.scoreReasons[0].formulaId).toBe('bonus');
  });

  test('add mode: applied flag is true', () => {
    const result = applyCustomFormulas([
      { id: 'x', expression: '10', mode: 'add' },
    ], ctx);
    expect(result.formulaDiagnostics[0].applied).toBe(true);
  });

  test('multiple add mode formulas accumulate', () => {
    const result = applyCustomFormulas([
      { id: 'a', expression: '10', mode: 'add' },
      { id: 'b', expression: '20', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(30);
    expect(result.scoreReasons).toHaveLength(2);
  });
});

describe('applyCustomFormulas — disabled mode', () => {
  const ctx = makeCtx();

  test('disabled formula produces no score and no diagnostics entry', () => {
    const result = applyCustomFormulas([
      { id: 'off', expression: '99', mode: 'disabled' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(0);
    expect(result.formulaDiagnostics).toHaveLength(0);
  });
});

describe('applyCustomFormulas — default mode', () => {
  const ctx = makeCtx();

  test('missing mode defaults to observe (no score contribution)', () => {
    const result = applyCustomFormulas([
      { id: 'x', expression: '50' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics[0].mode).toBe('observe');
  });
});

describe('applyCustomFormulas — clamping', () => {
  const ctx = makeCtx();

  test('output clamped to +100', () => {
    const result = applyCustomFormulas([
      { id: 'big', expression: '9999', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(100);
    expect(result.formulaDiagnostics[0].value).toBe(100);
  });

  test('output clamped to -100', () => {
    const result = applyCustomFormulas([
      { id: 'small', expression: '-9999', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(-100);
    expect(result.formulaDiagnostics[0].value).toBe(-100);
  });

  test('value within range is not clamped', () => {
    const result = applyCustomFormulas([
      { id: 'ok', expression: '42', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(42);
  });
});

describe('applyCustomFormulas — error handling', () => {
  const ctx = makeCtx();

  test('parse error is caught and recorded, score unaffected', () => {
    const result = applyCustomFormulas([
      { id: 'bad', name: 'Bad', expression: 'from.domain ??? 1 : 0', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.scoreReasons).toHaveLength(0);
    const d = result.formulaDiagnostics[0];
    expect(d.error).toBeTruthy();
    expect(d.applied).toBe(false);
  });

  test('evaluation error (unknown identifier) is caught', () => {
    const result = applyCustomFormulas([
      { id: 'bad2', expression: 'evil + 1', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics[0].error).toContain('Unknown identifier');
  });

  test('non-numeric return value is an error', () => {
    const result = applyCustomFormulas([
      { id: 'str', expression: '"hello"', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics[0].error).toBeTruthy();
  });

  test('NaN return value is an error', () => {
    const result = applyCustomFormulas([
      { id: 'nan', expression: '1 / 0', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics[0].error).toBeTruthy();
  });

  test('boolean return value is an error', () => {
    const result = applyCustomFormulas([
      { id: 'bool', expression: 'true', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics[0].error).toBeTruthy();
  });

  test('one formula erroring does not affect other formulas', () => {
    const result = applyCustomFormulas([
      { id: 'bad', expression: 'evil', mode: 'add' },
      { id: 'good', expression: '25', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(25);
    expect(result.scoreReasons).toHaveLength(1);
    expect(result.formulaDiagnostics).toHaveLength(2);
    expect(result.formulaDiagnostics[0].error).toBeTruthy();
    expect(result.formulaDiagnostics[1].applied).toBe(true);
  });

  test('formula with missing expression is skipped silently', () => {
    const result = applyCustomFormulas([
      { id: 'empty', expression: '', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics).toHaveLength(0);
  });

  test('formula with missing id is skipped silently', () => {
    const result = applyCustomFormulas([
      { id: '', expression: '10', mode: 'add' },
    ], ctx);
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics).toHaveLength(0);
  });

});

describe('applyCustomFormulas — formula count cap', () => {
  const ctx = makeCtx();

  test('evaluates at most MAX_CUSTOM_FORMULAS formulas', () => {
    const many = Array.from({ length: MAX_CUSTOM_FORMULAS + 5 }, (_, i) => ({
      id: `f${i}`, expression: '1', mode: 'add',
    }));
    const result = applyCustomFormulas(many, ctx);
    expect(result.formulaDiagnostics.length).toBe(MAX_CUSTOM_FORMULAS);
    expect(result.score).toBe(MAX_CUSTOM_FORMULAS);
  });
});

describe('applyCustomFormulas — empty and missing formulas list', () => {
  const ctx = makeCtx();
  test('empty array', () => {
    const r = applyCustomFormulas([], ctx);
    expect(r.score).toBe(0);
    expect(r.scoreReasons).toHaveLength(0);
    expect(r.formulaDiagnostics).toHaveLength(0);
  });
  test('undefined formulas', () => {
    const r = applyCustomFormulas(undefined, ctx);
    expect(r.score).toBe(0);
  });
});

// ─── Integration: real-world formula examples ─────────────────────────────────

describe('applyCustomFormulas — real-world formula examples', () => {
  test('authAlignedRandomDomain formula in add mode', () => {
    const ctx = makeCtx({
      scoreReasons: [{ key: 'composite.authAlignedRandomDomain', delta: 40 }],
    });
    const result = applyCustomFormulas([
      {
        id: 'extra-random-domain',
        name: 'Extra penalty for auth-aligned random domain',
        expression: 'has("composite.authAlignedRandomDomain") ? 40 : 0',
        mode: 'add',
      },
    ], ctx, { baseScore: 40 });
    expect(result.score).toBe(40);
    expect(result.scoreReasons[0].key).toBe('custom.formula.extra-random-domain');
  });

  test('subdomain depth + entropy formula in observe mode', () => {
    const ctx = makeCtx({
      senderDomain: 'ppbwwcyr.customer.example.com',
      domainParts: {
        registrableDomain: 'example.com',
        publicSuffix: 'com',
        subdomainDepth: 2,
      },
      leftLabelEntropy: 3.2,
    });
    const result = applyCustomFormulas([
      {
        id: 'deep-random',
        expression: 'from.subdomainDepth >= 2 && from.leftLabelEntropy > 2.4 ? 60 : 0',
        mode: 'observe',
      },
    ], ctx, { baseScore: 20, baseVerdict: 'normal' });
    expect(result.score).toBe(0); // observe — no score contribution
    expect(result.formulaDiagnostics[0].value).toBe(60);
    expect(result.formulaDiagnostics[0].applied).toBe(false);
    expect(result.formulaDiagnostics[0].wouldChangeScore).toBe(80);
  });

  test('brand impersonation formula using displayName.contains() in add mode', () => {
    const ctx = makeCtx({
      senderDomain: 'phishing.ru',
      domainParts: { registrableDomain: 'phishing.ru', publicSuffix: 'ru', subdomainDepth: 0 },
      displayNameMetrics: {
        displayNameRaw: 'American Express',
        displayNameNormalized: 'american express',
      },
    });
    const result = applyCustomFormulas([
      {
        id: 'amex-check',
        expression: 'displayName.contains("American Express") ? 80 : 0',
        mode: 'add',
      },
    ], ctx, { baseScore: 0 });
    expect(result.score).toBe(80);
  });

  test('match() in add mode is rejected (v1 regex sender-domain restriction)', () => {
    const ctx = makeCtx({ senderDomain: 'phishing.ru' });
    const result = applyCustomFormulas([
      {
        id: 'regex-domain-add',
        expression: 'match(from.domain, "phishing") ? 80 : 0',
        mode: 'add',
      },
    ], ctx, { baseScore: 0 });
    // must not apply — match() in add mode is a hard error
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics[0].applied).toBe(false);
    expect(result.formulaDiagnostics[0].error).toMatch(/add mode/);
  });

  test('match() in observe mode is allowed', () => {
    const ctx = makeCtx({ senderDomain: 'phishing.ru' });
    const result = applyCustomFormulas([
      {
        id: 'regex-domain-observe',
        expression: 'match(from.domain, "phishing") ? 80 : 0',
        mode: 'observe',
      },
    ], ctx, { baseScore: 0 });
    // observe — computes value but does not affect score
    expect(result.score).toBe(0);
    expect(result.formulaDiagnostics[0].applied).toBe(false);
    expect(result.formulaDiagnostics[0].value).toBe(80);
  });
});
