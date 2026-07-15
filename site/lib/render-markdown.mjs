import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import { slug as githubSlug } from "github-slugger";
import { normalizeLookup, siteHref } from "./wiki.mjs";
import { extractSourceCitations, parseSourceCitation, parseWikiLink } from "./wiki-syntax.mjs";

export { extractSourceCitations };

export function headingSlug(value) {
  return githubSlug(String(value).normalize("NFC"));
}

function wikiLinkPlugin(md, { lookup, basePath }) {
  md.inline.ruler.before("link", "obsidian_wikilink", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== "[[") return false;
    const end = state.src.indexOf("]]", start + 2);
    if (end < 0) return false;
    const link = parseWikiLink(state.src.slice(start, end + 2));
    if (!link) return false;
    if (silent) return true;

    const { target, section, label } = link;
    const resolved = target ? lookup.get(normalizeLookup(target)) : null;
    const route = resolved?.route ?? "";
    const fragment = section ? `#${headingSlug(section)}` : "";
    const href = target ? siteHref(basePath, `${route}${fragment}`) : fragment;

    const open = state.push("link_open", "a", 1);
    open.attrSet("href", href);
    open.attrSet("class", "wiki-link");
    if (resolved && normalizeLookup(target) !== normalizeLookup(resolved.data.title)) {
      open.attrSet("title", resolved.data.title);
    }
    const text = state.push("text", "", 0);
    text.content = label || (section && !target ? section : target);
    state.push("link_close", "a", -1);
    state.pos = end + 2;
    return true;
  });
}

function calloutPlugin(md) {
  md.core.ruler.after("inline", "obsidian_callouts", (state) => {
    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token.type !== "blockquote_open") continue;
      let inlineToken = null;
      for (let cursor = index + 1; cursor < state.tokens.length; cursor += 1) {
        if (state.tokens[cursor].type === "blockquote_close") break;
        if (state.tokens[cursor].type === "inline") {
          inlineToken = state.tokens[cursor];
          break;
        }
      }
      if (!inlineToken?.children?.length) continue;
      const firstText = inlineToken.children.find((child) => child.type === "text" && child.content.trim());
      if (!firstText) continue;
      const match = firstText.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
      if (!match) continue;
      const kind = match[1].toLocaleLowerCase("en-US");
      firstText.content = firstText.content.slice(match[0].length);
      inlineToken.content = inlineToken.content.replace(match[0], "");
      token.attrJoin("class", `callout callout-${kind}`);
      token.attrSet("data-callout", kind);
    }
  });
}

function sourceCitationPlugin(md) {
  md.inline.ruler.before("emphasis", "source_citation", (state, silent) => {
    const parsed = parseSourceCitation(state.src.slice(state.pos));
    if (!parsed) return false;
    const citation = state.env?.sourceCitationIndex?.get(parsed.sourceId);
    if (!citation) return false;
    if (silent) return true;

    const open = state.push("link_open", "a", 1);
    open.attrSet("href", `#evidence-${parsed.sourceId}`);
    open.attrSet("class", "evidence-citation");
    open.attrSet("aria-label", `근거 ${citation.index}: ${citation.title}`);
    const label = state.push("text", "", 0);
    label.content = `[${citation.index}]`;
    state.push("link_close", "a", -1);
    state.pos += parsed.raw.length;
    return true;
  });
}

function scrollableTablePlugin(md) {
  const tableOpen = md.renderer.rules.table_open ?? (() => "<table>\n");
  const tableClose = md.renderer.rules.table_close ?? (() => "</table>\n");
  md.renderer.rules.table_open = (tokens, index, options, env, renderer) =>
    `<div class="table-scroll" data-table-scroll tabindex="0" role="region" aria-label="표, 가로로 스크롤할 수 있습니다">${tableOpen(tokens, index, options, env, renderer)}`;
  md.renderer.rules.table_close = (tokens, index, options, env, renderer) =>
    `${tableClose(tokens, index, options, env, renderer)}</div>`;
}

function externalLinkPlugin(md) {
  const fallback = md.renderer.rules.link_open ?? ((tokens, index, options, env, renderer) =>
    renderer.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const href = tokens[index].attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      tokens[index].attrSet("target", "_blank");
      tokens[index].attrSet("rel", "noopener noreferrer");
      tokens[index].attrJoin("class", "external-link");
    }
    return fallback(tokens, index, options, env, renderer);
  };
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textFromHtml(value) {
  return decodeEntities(String(value).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

export function createMarkdownRenderer(options) {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false
  });
  md.use(wikiLinkPlugin, options);
  md.use(calloutPlugin);
  md.use(sourceCitationPlugin);
  md.use(externalLinkPlugin);
  md.use(scrollableTablePlugin);
  md.use(markdownItAnchor, {
    level: [2, 3, 4],
    slugify: headingSlug
  });
  return md;
}

export function renderMarkdownPage(md, page) {
  const citations = extractSourceCitations(page.body);
  const allowed = new Set(page.data.source_refs);
  for (const sourceId of citations) {
    if (!allowed.has(sourceId)) {
      throw new Error(`${page.relativePath}: 본문 근거 표식 ${sourceId}가 source_refs에 없습니다.`);
    }
  }
  const sourceCitationIndex = new Map(page.sourcePages.map((source, index) => [source.data.source_id, {
    index: index + 1,
    title: source.data.title
  }]));
  const html = md.render(page.body, { page, sourceCitationIndex });
  const leadMatch = html.match(/^<p>([\s\S]*?)<\/p>\n?/);
  const contentHtml = leadMatch ? html.slice(leadMatch[0].length) : html;
  const toc = [];
  const headingPattern = /<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  for (const match of html.matchAll(headingPattern)) {
    toc.push({ level: Number(match[1]), id: match[2], title: textFromHtml(match[3]) });
  }
  return { html, contentHtml, toc };
}
