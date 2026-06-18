export type EveableModelRole =
  | "root"
  | "intent"
  | "orchestrator"
  | "designResearch"
  | "codeWriter"
  | "autofix"
  | "securityReview"
  | "conversation";

const fromEnv = (keys: string | readonly string[], fallback: string) => {
  const envKeys = Array.isArray(keys) ? keys : [keys];

  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  return fallback;
};

export const eveableModels = {
  root: fromEnv(
    ["EVEABLE_ROOT_MODEL", "MAYAR_ROOT_MODEL"],
    "openai/gpt-5.4-mini",
  ),
  intent: fromEnv("INTENT_AGENT_MODEL", "openai/gpt-5.4-mini"),
  orchestrator: fromEnv("ORCHESTRATOR_AGENT_MODEL", "openai/gpt-5.4-mini"),
  designResearch: fromEnv("DESIGN_RESEARCH_AGENT_MODEL", "openai/gpt-5.5"),
  codeWriter: fromEnv("CODE_WRITER_AGENT_MODEL", "openai/gpt-5.5"),
  autofix: fromEnv("AUTOFIX_AGENT_MODEL", "openai/gpt-5.5"),
  securityReview: fromEnv("SECURITY_REVIEW_AGENT_MODEL", "openai/gpt-5.5"),
  conversation: fromEnv("CONVERSATION_AGENT_MODEL", "openai/gpt-5.4-mini"),
} satisfies Record<EveableModelRole, string>;
