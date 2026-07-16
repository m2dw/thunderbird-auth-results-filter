import {
  shouldNotifyAfterAssessment,
  shouldShowImmediately,
  addToNotifQueue,
  isJunkLikeFolderType,
} from '../src/modules/notificationPolicy.js';

// ── shouldNotifyAfterAssessment ───────────────────────────────────────────────

describe('shouldNotifyAfterAssessment — disabled', () => {
  const settings = { notifyAfterAssessment: false, notificationMaxScore: 49 };

  test('returns false even for score 0', () => {
    expect(shouldNotifyAfterAssessment(settings, { score: 0 })).toBe(false);
  });
});

describe('shouldNotifyAfterAssessment — enabled, default threshold (49)', () => {
  const settings = { notifyAfterAssessment: true, notificationMaxScore: 49 };

  test('score 0 → notify', () =>
    expect(shouldNotifyAfterAssessment(settings, { score: 0 })).toBe(true));

  test('score 49 → notify (at threshold)', () =>
    expect(shouldNotifyAfterAssessment(settings, { score: 49 })).toBe(true));

  test('score 50 → no notify (above threshold)', () =>
    expect(shouldNotifyAfterAssessment(settings, { score: 50 })).toBe(false));

  test('score 100 → no notify', () =>
    expect(shouldNotifyAfterAssessment(settings, { score: 100 })).toBe(false));
});

describe('shouldNotifyAfterAssessment — custom threshold', () => {
  test('threshold 60 allows score 50 (review-range)', () => {
    const settings = { notifyAfterAssessment: true, notificationMaxScore: 60 };
    expect(shouldNotifyAfterAssessment(settings, { score: 50 })).toBe(true);
  });

  test('threshold 60 blocks score 61', () => {
    const settings = { notifyAfterAssessment: true, notificationMaxScore: 60 };
    expect(shouldNotifyAfterAssessment(settings, { score: 61 })).toBe(false);
  });

  test('threshold 30 suppresses borderline-normal score 40', () => {
    const settings = { notifyAfterAssessment: true, notificationMaxScore: 30 };
    expect(shouldNotifyAfterAssessment(settings, { score: 40 })).toBe(false);
  });
});

describe('shouldNotifyAfterAssessment — missing notificationMaxScore defaults to 49', () => {
  const settings = { notifyAfterAssessment: true };

  test('score 49 → notify', () =>
    expect(shouldNotifyAfterAssessment(settings, { score: 49 })).toBe(true));

  test('score 50 → no notify', () =>
    expect(shouldNotifyAfterAssessment(settings, { score: 50 })).toBe(false));
});

// ── shouldShowImmediately ─────────────────────────────────────────────────────

describe('shouldShowImmediately', () => {
  test('returns true when no notification shown yet (lastShownAt = 0)', () => {
    expect(shouldShowImmediately(0, 5000, 4000)).toBe(true);
  });

  test('returns true when elapsed time equals minInterval', () => {
    expect(shouldShowImmediately(1000, 5000, 4000)).toBe(true);
  });

  test('returns true when elapsed time exceeds minInterval', () => {
    expect(shouldShowImmediately(1000, 6000, 4000)).toBe(true);
  });

  test('returns false when elapsed time is less than minInterval', () => {
    expect(shouldShowImmediately(1000, 4999, 4000)).toBe(false);
  });

  test('returns false when just one ms short', () => {
    expect(shouldShowImmediately(1000, 4999, 4000)).toBe(false);
  });
});

// ── addToNotifQueue ───────────────────────────────────────────────────────────

describe('addToNotifQueue', () => {
  test('appends entry to empty queue', () => {
    const q = addToNotifQueue([], 5, 'a');
    expect(q).toEqual(['a']);
  });

  test('appends entry below cap', () => {
    const q = addToNotifQueue(['a', 'b'], 5, 'c');
    expect(q).toEqual(['a', 'b', 'c']);
  });

  test('drops oldest when cap is exceeded', () => {
    const q = addToNotifQueue(['a', 'b', 'c'], 3, 'd');
    expect(q).toEqual(['b', 'c', 'd']);
  });

  test('does not mutate original queue', () => {
    const original = ['a', 'b'];
    addToNotifQueue(original, 5, 'c');
    expect(original).toEqual(['a', 'b']);
  });

  test('cap of 1 always keeps only the newest entry', () => {
    const q = addToNotifQueue(['old'], 1, 'new');
    expect(q).toEqual(['new']);
  });

  test('adding up to cap does not drop anything', () => {
    const q = addToNotifQueue(['a', 'b', 'c', 'd'], 5, 'e');
    expect(q).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

// ── isJunkLikeFolderType ──────────────────────────────────────────────────────

describe('isJunkLikeFolderType', () => {
  test.each(['junk', 'trash', 'spam'])('returns true for %s', (type) => {
    expect(isJunkLikeFolderType(type)).toBe(true);
  });

  test.each(['inbox', 'sent', 'drafts', 'archives', 'templates', ''])('returns false for %s', (type) => {
    expect(isJunkLikeFolderType(type)).toBe(false);
  });
});
