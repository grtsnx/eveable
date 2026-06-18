import { defineAgent } from "eve";
import { eveableModels } from "../../lib/model.js";

export default defineAgent({
  description:
    "Classifies, filters, and routes user prompts before any other Eveable specialist runs. Tool input must contain only message.",
  model: eveableModels.intent,
});
