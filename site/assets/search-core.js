export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ")
    .trim();
}

function occurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while ((position = haystack.indexOf(needle, position)) >= 0) {
    count += 1;
    position += Math.max(needle.length, 1);
    if (count >= 8) break;
  }
  return count;
}

export function scoreDocument(entry, query) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const normalizedAliases = entry.aliases.map(normalizeSearchText);
  const fields = {
    title: normalizeSearchText(entry.title),
    aliases: normalizedAliases.join(" "),
    id: normalizeSearchText(entry.sourceId),
    publisher: normalizeSearchText(entry.publisher),
    metadata: normalizeSearchText(entry.metadata),
    excerpt: normalizeSearchText(entry.excerpt),
    body: normalizeSearchText(entry.body)
  };
  const combined = Object.values(fields).join(" ");
  if (!tokens.every((token) => combined.includes(token))) return -1;

  let score = 0;
  if (fields.title === normalizedQuery) score += 1_400;
  else if (fields.title.startsWith(normalizedQuery)) score += 520;
  else if (fields.title.includes(normalizedQuery)) score += 300;
  if (normalizedAliases.includes(normalizedQuery)) score += 900;
  else if (fields.aliases.includes(normalizedQuery)) score += 220;

  for (const token of tokens) {
    if (fields.title === token) score += 360;
    else if (fields.title.startsWith(token)) score += 220;
    else if (fields.title.includes(token)) score += 150;
    if (normalizedAliases.includes(token)) score += 180;
    else if (fields.aliases.includes(token)) score += 90;
    if (fields.id === token) score += 700;
    else if (fields.id.includes(token)) score += 160;
    if (fields.publisher.includes(token)) score += 70;
    if (fields.metadata.includes(token)) score += 50;
    if (fields.excerpt.includes(token)) score += 30;
    score += Math.min(occurrences(fields.body, token) * 5, 30);
  }

  if (entry.category === "meta") score -= 180;
  if (entry.legalStatus === "current") score += 12;
  score += Math.min(Number(entry.officialSourceCount || 0), 8);
  return score;
}

export function matchesSearchFilters(entry, filters = {}) {
  return (!filters.category || entry.category === filters.category)
    && (!filters.status || entry.status === filters.status)
    && (!filters.area || entry.legalArea === filters.area)
    && (!filters.sourceType || entry.sourceType === filters.sourceType)
    && (!filters.legalStatus || entry.legalStatus === filters.legalStatus)
    && (!filters.dateKind || Boolean(entry[filters.dateKind]));
}

export function compareSearchMatches(a, b) {
  return b.score - a.score
    || String(b.entry.asOfDate || b.entry.updated).localeCompare(String(a.entry.asOfDate || a.entry.updated))
    || a.entry.title.localeCompare(b.entry.title, "ko");
}

export function searchDocuments(documents, query, filters = {}, limit = Number.POSITIVE_INFINITY) {
  const normalizedQuery = normalizeSearchText(query);
  const matches = documents
    .filter((entry) => matchesSearchFilters(entry, filters))
    .map((entry) => ({ entry, score: normalizedQuery ? scoreDocument(entry, normalizedQuery) : 0 }))
    .filter((match) => match.score >= 0)
    .sort(compareSearchMatches);
  return {
    total: matches.length,
    entries: matches.slice(0, limit).map((match) => match.entry)
  };
}
