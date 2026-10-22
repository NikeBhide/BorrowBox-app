// Matches "needed" posts with locker items using simple keyword overlap.
// Deliberately basic: no AI, no external services, easy to explain in a viva.

const CATEGORIES = ["Books", "Electronics", "Tools", "Sports", "Clothing", "Kitchen", "Other"];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "need", "needed", "looking", "want", "borrow",
  "any", "someone", "have", "has", "that", "this", "can", "you", "your", "from",
]);

function tokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      .map((t) => t.replace(/s$/, "")) // "chargers" -> "charger"
  );
}

// Returns 0 when there is no match, otherwise a score (higher = better).
function matchScore(need, item) {
  const wanted = tokens(need.title);
  const offered = tokens(`${item.name} ${item.description}`);
  let overlap = 0;
  for (const t of wanted) if (offered.has(t)) overlap += 1;
  if (overlap === 0) return 0;
  return overlap * 2 + (need.category === item.category ? 1 : 0);
}

module.exports = { CATEGORIES, matchScore };
