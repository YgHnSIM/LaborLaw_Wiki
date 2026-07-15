import { searchDocuments } from "./search-core.js";

async function initialize(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`검색 색인 요청 실패: ${response.status}`);
  return response.json();
}

export function createSearchMessageHandler({ loadIndex = initialize, postMessage }) {
  let documents = null;

  return async (message = {}) => {
    try {
      if (message.type === "init") {
        documents = await loadIndex(message.url);
        postMessage({ type: "ready" });
        return;
      }
      if (message.type !== "search" || !documents) return;
      const matches = searchDocuments(documents, message.query, message.filters ?? {}, message.limit);
      postMessage({
        type: "results",
        id: message.id,
        total: matches.total,
        entries: matches.entries
      });
    } catch (error) {
      postMessage({ type: "error", id: message.id, message: String(error?.message || error) });
    }
  };
}

if (typeof self !== "undefined") {
  const handleMessage = createSearchMessageHandler({ postMessage: (message) => self.postMessage(message) });
  self.addEventListener("message", (event) => handleMessage(event.data ?? {}));
}
