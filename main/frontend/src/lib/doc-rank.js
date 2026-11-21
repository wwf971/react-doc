// Ranks: strings that put things in an order by comparison alone, in the
// manner of LexoRank (fractional indexing). Design:
// doc_page_impl_config.md#ranks
//
// A rank is written with the digits 0-9 and the letters a-z and never ends
// with 0. Two ranks compare character by character, by code unit (never by
// the locale): "c" < "ci" < "d" < "d5" < "e". Read as the digits of a
// fraction in base 36 after the point, every rank lies in (0, 1) and between
// any two ranks there is always another one, so a new thing is placed
// between two others by giving it a rank between theirs, without renumbering
// anything (rankBetween). The trailing 0 is excluded because "c0" would be
// "c" again, and nothing would lie between "c" and "c0".
//
// A thing without a rank comes after every ranked thing; the order among the
// unranked is the caller's own (rankOrderCompare).

export const RANK_DIGIT_TEXT = '0123456789abcdefghijklmnopqrstuvwxyz';

// the pattern of a rank, as text: the valuePattern of a config key holding ranks
export const RANK_PATTERN_TEXT = '^[0-9a-z]*[1-9a-z]$';
const RANK_PATTERN = new RegExp(RANK_PATTERN_TEXT);

export function rankIsValid(rank) {
  return typeof rank === 'string' && RANK_PATTERN.test(rank);
}

// code-unit order: -1, 0, 1
export function rankCompare(rankA, rankB) {
  if (rankA === rankB) return 0;
  return rankA < rankB ? -1 : 1;
}

// two things by rank: a ranked one before an unranked one, two ranked ones by
// rank; 0 when neither is ranked or both have the same rank, so the caller's
// own order decides. a rank that is not valid counts as no rank.
export function rankOrderCompare(rankA, rankB) {
  const isRankedA = rankIsValid(rankA);
  const isRankedB = rankIsValid(rankB);
  if (isRankedA && isRankedB) return rankCompare(rankA, rankB);
  if (isRankedA) return -1;
  if (isRankedB) return 1;
  return 0;
}

// a rank strictly between two: rankBefore < result < rankAfter. '' (or
// nothing) stands for an open end: rankBetween('', 'c') is before "c",
// rankBetween('c') after it, rankBetween() the middle of the whole range.
// -> { code: 0, data: rank } | { code: -1, message }
export function rankBetween(rankBefore = '', rankAfter = '') {
  for (const rank of [rankBefore, rankAfter]) {
    if (rank !== '' && !rankIsValid(rank)) return { code: -1, message: `"${rank}" is not a rank (${RANK_PATTERN_TEXT})` };
  }
  if (rankBefore !== '' && rankAfter !== '' && rankCompare(rankBefore, rankAfter) >= 0) {
    return { code: -1, message: `"${rankBefore}" does not come before "${rankAfter}"` };
  }
  return { code: 0, data: rankMidpoint(rankBefore, rankAfter === '' ? null : rankAfter) };
}

// the digits between a (possibly '') and b (null: the end of the range).
// the common prefix is kept (a padded with 0); then either the first digits
// leave room for one between them, or the first digit of a is kept and a
// digit is looked for after it
function rankMidpoint(rankA, rankB) {
  if (rankB !== null) {
    let indexCommon = 0;
    while ((rankA[indexCommon] ?? '0') === rankB[indexCommon]) indexCommon += 1;
    if (indexCommon > 0) return rankB.slice(0, indexCommon) + rankMidpoint(rankA.slice(indexCommon), rankB.slice(indexCommon));
  }
  const digitA = rankA === '' ? 0 : RANK_DIGIT_TEXT.indexOf(rankA[0]);
  const digitB = rankB === null ? RANK_DIGIT_TEXT.length : RANK_DIGIT_TEXT.indexOf(rankB[0]);
  if (digitB - digitA > 1) return RANK_DIGIT_TEXT[Math.round((digitA + digitB) / 2)];
  // consecutive first digits: b itself cut to its first digit, when that is
  // still after a; otherwise the first digit of a and a digit after the rest of a
  if (rankB !== null && rankB.length > 1) return rankB.slice(0, 1);
  return RANK_DIGIT_TEXT[digitA] + rankMidpoint(rankA.slice(1), null);
}
