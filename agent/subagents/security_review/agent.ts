import { defineAgent } from "eve";
import { eveableModels } from "../../lib/model.js";

export default defineAgent({
  description:
    "Reviews generated web app source code after sandbox validation and before deployment. The message must include generated file contents, not only sandbox metadata.",
  model: eveableModels.securityReview,
});
