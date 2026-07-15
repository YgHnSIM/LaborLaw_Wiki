const SOURCE_CITATION_PATTERN = /\[@(SRC-[A-Z0-9][A-Z0-9._-]{2,})\]/g;
const SOURCE_CITATION_AT_START_PATTERN = /^\[@(SRC-[A-Z0-9][A-Z0-9._-]{2,})\]/;

export function parseWikiLink(value) {
  const raw = String(value ?? "");
  if (!raw.startsWith("[[") || !raw.endsWith("]]")) return null;

  const inner = raw.slice(2, -2);
  if (!inner || /[\r\n]/.test(inner)) return null;

  const pipeIndex = inner.indexOf("|");
  const targetPart = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
  const label = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : "").trim();
  const hashIndex = targetPart.indexOf("#");
  const target = (hashIndex >= 0 ? targetPart.slice(0, hashIndex) : targetPart).trim();
  const section = (hashIndex >= 0 ? targetPart.slice(hashIndex + 1) : "").trim();

  return { raw, target, section, label };
}

function scanWikiLinks(markdown) {
  const source = String(markdown ?? "");
  const matches = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf("[[", cursor);
    if (start < 0) break;
    const end = source.indexOf("]]", start + 2);
    if (end < 0) break;

    const link = parseWikiLink(source.slice(start, end + 2));
    if (link) matches.push({ ...link, start, end: end + 2 });
    cursor = end + 2;
  }

  return { source, matches };
}

export function extractWikiLinks(markdown) {
  return scanWikiLinks(markdown).matches.map(({ raw, target, section, label }) => ({
    raw,
    target,
    section,
    label
  }));
}

export function replaceWikiLinks(markdown, replacer) {
  const { source, matches } = scanWikiLinks(markdown);
  if (!matches.length) return source;

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += source.slice(cursor, match.start);
    result += String(replacer({
      raw: match.raw,
      target: match.target,
      section: match.section,
      label: match.label
    }));
    cursor = match.end;
  }
  return result + source.slice(cursor);
}

export function extractSourceCitations(markdown) {
  return [...String(markdown ?? "").matchAll(SOURCE_CITATION_PATTERN)].map((match) => match[1]);
}

export function parseSourceCitation(value) {
  const match = String(value ?? "").match(SOURCE_CITATION_AT_START_PATTERN);
  return match ? { raw: match[0], sourceId: match[1] } : null;
}

export function stripSourceCitations(markdown) {
  return String(markdown ?? "").replace(SOURCE_CITATION_PATTERN, " ");
}
