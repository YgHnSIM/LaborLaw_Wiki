let documents = null;

function normalize(value) {
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

function scoreDocument(document, query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  const normalizedAliases = document.aliases.map(normalize);
  const fields = {
    title: normalize(document.title),
    aliases: normalizedAliases.join(" "),
    id: normalize(document.sourceId),
    publisher: normalize(document.publisher),
    metadata: normalize(document.metadata),
    excerpt: normalize(document.excerpt),
    body: normalize(document.body)
  };
  const combined = Object.values(fields).join(" ");
  if (!tokens.every((token) => combined.includes(token))) return -1;

  let score = 0;
  if (fields.title === query) score += 1_400;
  else if (fields.title.startsWith(query)) score += 520;
  else if (fields.title.includes(query)) score += 300;
  if (normalizedAliases.includes(query)) score += 900;
  else if (fields.aliases.includes(query)) score += 220;

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

  if (document.category === "meta") score -= 180;
  if (document.legalStatus === "current") score += 12;
  score += Math.min(Number(document.officialSourceCount || 0), 8);
  return score;
}

function matchesFilters(entry, filters) {
  return (!filters.category || entry.category === filters.category)
    && (!filters.status || entry.status === filters.status)
    && (!filters.area || entry.legalArea === filters.area)
    && (!filters.sourceType || entry.sourceType === filters.sourceType)
    && (!filters.legalStatus || entry.legalStatus === filters.legalStatus)
    && (!filters.dateKind || Boolean(entry[filters.dateKind]));
}

async function initialize(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`검색 색인 요청 실패: ${response.status}`);
  documents = await response.json();
}

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  try {
    if (message.type === "init") {
      await initialize(message.url);
      self.postMessage({ type: "ready" });
      return;
    }
    if (message.type !== "search" || !documents) return;
    const query = normalize(message.query);
    const matches = documents
      .filter((entry) => matchesFilters(entry, message.filters ?? {}))
      .map((entry) => ({ entry, score: query ? scoreDocument(entry, query) : 0 }))
      .filter((match) => match.score >= 0)
      .sort((a, b) => b.score - a.score
        || String(b.entry.asOfDate || b.entry.updated).localeCompare(String(a.entry.asOfDate || a.entry.updated))
        || a.entry.title.localeCompare(b.entry.title, "ko"));
    self.postMessage({
      type: "results",
      id: message.id,
      total: matches.length,
      entries: matches.slice(0, message.limit).map((match) => match.entry)
    });
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, message: String(error?.message || error) });
  }
});
