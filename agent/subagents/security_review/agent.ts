import { defineAgent } from "eve";
import { eveableModels } from "../../lib/model.js";

export default defineAgent({
  description:
    "Reviews generated web app code after sandbox validation and before release summary. Tool input must contain only message.",
  model: eveableModels.securityReview,
});
