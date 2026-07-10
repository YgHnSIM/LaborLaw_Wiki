import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import { slug as githubSlug } from "github-slugger";
import { normalizeLookup, siteHref } from "./wiki.mjs";

export function headingSlug(value) {
  return githubSlug(String(value).normalize("NFC"));
}

function wikiLinkPlugin(md, { lookup, basePath }) {
  md.inline.ruler.before("link", "obsidian_wikilink", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== "[[") return false;
    const end = state.src.indexOf("]]", start + 2);
    if (end < 0) return false;
    const inner = state.src.slice(start + 2, end);
    if (!inner || inner.includes("\n")) return false;
    if (silent) return true;

    const pipeIndex = inner.indexOf("|");
    const targetPart = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
    const label = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : "").trim();
    const hashIndex = targetPart.indexOf("#");
    const target = (hashIndex >= 0 ? targetPart.slice(0, hashIndex) : targetPart).trim();
    const section = (hashIndex >= 0 ? targetPart.slice(hashIndex + 1) : "").trim();
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
  md.use(externalLinkPlugin);
  md.use(markdownItAnchor, {
    level: [2, 3, 4],
    slugify: headingSlug
  });
  return md;
}

export function renderMarkdownPage(md, page) {
  const html = md.render(page.body);
  const toc = [];
  const headingPattern = /<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  for (const match of html.matchAll(headingPattern)) {
    toc.push({ level: Number(match[1]), id: match[2], title: textFromHtml(match[3]) });
  }
  return { html, toc };
}
