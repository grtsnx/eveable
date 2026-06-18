import { defineMcpClientConnection } from "eve/connections";

const referoToken =
  process.env.REFERO_API_KEY?.trim() ?? process.env.REFERO_MCP_TOKEN?.trim();

export default defineMcpClientConnection({
  url: process.env.REFERO_MCP_URL ?? "https://api.refero.design/mcp",
  description:
    "Refero design inspiration: curated web styles and real UI screen references for visual direction, layout patterns, typography, palette, spacing, imagery, and component treatment.",
  ...(referoToken
    ? {
        headers: {
          Authorization: `Bearer ${referoToken}`,
        },
      }
    : {}),
  tools: {
    allow: [
      "refero_search_styles",
      "refero_get_style",
      "refero_search_screens",
      "refero_get_screen",
      "refero_get_similar_screens",
    ],
  },
});
