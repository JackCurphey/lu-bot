// The curve is MEE6's, unchanged: the cost of going from level n to n+1 is
// 5n^2 + 50n + 100. Kept identical rather than invented so a level here means
// what it means in every other server people have been in. Quadratic, so the
// first levels come quickly and the top of the leaderboard stays scarce.
export function costOfLevel(n) {
  return 5 * n * n + 50 * n + 100;
}

export function totalToReach(n) {
  let total = 0;
  for (let k = 0; k < n; k += 1) total += costOfLevel(k);
  return total;
}

// Counted up rather than solved in closed form: the loop is obviously correct
// against the formula above, and at these magnitudes (level 50 is 50 additions)
// the cost is irrelevant. A closed form would be one algebra slip away from
// silently misreporting everyone's level.
export function levelFor(credits) {
  // NaN-safe form: `!(credits > 0)` also catches credits being NaN (where
  // both `credits > 0` and `credits <= 0` would be false), unlike
  // `credits <= 0`. Left as-is by design, not an oversight.
  if (!(credits > 0)) return 0;
  let level = 0;
  let total = 0;
  for (;;) {
    const next = total + costOfLevel(level);
    if (next > credits) return level;
    total = next;
    level += 1;
  }
}

export function progress(credits) {
  const level = levelFor(credits);
  const floor = totalToReach(level);
  return {
    level,
    into: Math.max(0, credits - floor),
    needed: costOfLevel(level),
  };
}
