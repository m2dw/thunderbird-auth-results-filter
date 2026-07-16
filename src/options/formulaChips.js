/**
 * Snippet chip groups for the formula expression editor.
 *
 * Each group has an i18n label key and an array of chips.
 * Each chip has a snippet (the code text to insert).
 * Snippet text is never translated — only group label keys are i18n'd.
 *
 * This module is pure data with no DOM or i18n dependency.
 */

export const CHIP_GROUPS = [
  {
    labelKey: 'formula_chips_group_functions',
    chips: [
      { snippet: 'has("score.reason.key")' },
      { snippet: 'scoreOf("score.reason.key")' },
      { snippet: 'min(a, b)' },
      { snippet: 'max(a, b)' },
      { snippet: 'clamp(value, min, max)' },
    ],
  },
  {
    labelKey: 'formula_chips_group_from',
    chips: [
      { snippet: 'from.domain' },
      { snippet: 'from.registrableDomain' },
      { snippet: 'from.subdomainDepth' },
      { snippet: 'from.leftLabelEntropy' },
      { snippet: 'from.localPart' },
    ],
  },
  {
    labelKey: 'formula_chips_group_alignment',
    chips: [
      { snippet: 'alignment.spfAligned' },
      { snippet: 'alignment.anyDkimAligned' },
      { snippet: 'alignment.anyAuthAligned' },
    ],
  },
  {
    labelKey: 'formula_chips_group_message_id',
    chips: [
      { snippet: 'messageId.domain' },
      { snippet: 'messageId.registrableDomain' },
      { snippet: 'messageId.matchesFromDomain' },
    ],
  },
  {
    labelKey: 'formula_chips_group_headers',
    chips: [
      { snippet: 'headers.hasListHeaders' },
    ],
  },
  {
    labelKey: 'formula_chips_group_general',
    chips: [
      { snippet: 'baseScore' },
      { snippet: 'verdict' },
    ],
  },
];
