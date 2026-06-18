import { defineAgent } from "eve";
import { eveableModels } from "../../lib/model.js";

export default defineAgent({
  description:
    "Writes complete Next.js, TypeScript, App Router, Bun project files from approved design research. Tool input must contain only message.",
  model: eveableModels.codeWriter,
});
