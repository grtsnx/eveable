import { defineAgent } from "eve";
import { eveableModels } from "./lib/model.js";

export default defineAgent({
  model: eveableModels.root,
  compaction: {
    thresholdPercent: 0.65,
  },
});
