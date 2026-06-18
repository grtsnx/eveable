import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "agent/agent.ts",
  "agent/instructions.md",
  "agent/lib/model.ts",
  "agent/lib/schemas.ts",
  "agent/lib/sandbox.ts",
  "agent/sandbox/sandbox.ts",
  "agent/subagents/intent/agent.ts",
  "agent/subagents/orchestrator/agent.ts",
  "agent/subagents/design_research/agent.ts",
  "agent/subagents/code_writer/agent.ts",
  "agent/subagents/autofix/agent.ts",
  "agent/subagents/security_review/agent.ts",
  "agent/subagents/conversation/agent.ts",
  "agent/tools/write_generated_files.ts",
  "agent/tools/generate_next_app_from_spec.ts",
  "agent/tools/run_quality_commands.ts",
  "agent/tools/start_preview.ts",
  "agent/tools/read_generated_files.ts",
  "agent/tools/deploy_to_vercel.ts",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "env.sample",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
];

const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exitCode = 1;
};

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    fail(`missing required file ${file}`);
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.version !== "1.0.0") {
  fail(`expected package version 1.0.0, got ${pkg.version}`);
}
if (!pkg.scripts?.dev?.includes("--no-ui")) {
  fail("dev script must use no-UI server mode for stable local builder runs");
}
if (!pkg.scripts?.dev?.includes("--subagents hidden")) {
  fail("dev script must hide subagent streams to avoid rendering generated source blobs");
}
if (!pkg.scripts?.dev?.includes("--tools collapsed")) {
  fail("dev script must collapse tool calls for stable local runs");
}
if (!pkg.scripts?.["dev:tui"]?.includes("eve dev --subagents hidden")) {
  fail("dev:tui script must preserve a quiet interactive mode");
}
if (!pkg.scripts?.["dev:verbose"]?.includes("--subagents full")) {
  fail("dev:verbose script must preserve a full debugging mode");
}

const modelConfig = readFileSync(join(root, "agent/lib/model.ts"), "utf8");
for (const key of [
  "EVEABLE_ROOT_MODEL",
  "INTENT_AGENT_MODEL",
  "ORCHESTRATOR_AGENT_MODEL",
  "DESIGN_RESEARCH_AGENT_MODEL",
  "CODE_WRITER_AGENT_MODEL",
  "AUTOFIX_AGENT_MODEL",
  "SECURITY_REVIEW_AGENT_MODEL",
  "CONVERSATION_AGENT_MODEL",
]) {
  if (!modelConfig.includes(key)) {
    fail(`model config does not mention ${key}`);
  }
}

const sandboxLib = readFileSync(join(root, "agent/lib/sandbox.ts"), "utf8");
if (!sandboxLib.includes("portablePackageRunnerCommand")) {
  fail("sandbox command normalization must support portable bunx/npx quality commands");
}
if (!sandboxLib.includes("command -v bunx") || !sandboxLib.includes("command -v npx")) {
  fail("portable package runner must fall back from bunx to npx");
}
const qualityTool = readFileSync(join(root, "agent/tools/run_quality_commands.ts"), "utf8");
if (!qualityTool.includes("nextRequiredTool: \"start_preview\"")) {
  fail("run_quality_commands must tell the model to start preview next");
}

const instructions = readFileSync(join(root, "agent/instructions.md"), "utf8");
if (!instructions.includes("Every declared subagent call payload must contain exactly one key")) {
  fail("root instructions are missing the Eve subagent call discipline");
}
if (!instructions.includes("Never include `outputSchema`")) {
  fail("root instructions must forbid extra subagent payload keys such as outputSchema");
}
if (!instructions.includes("Approval continuation rule")) {
  fail("root instructions are missing the design approval continuation rule");
}
if (!instructions.includes("Do not call `intent` or `conversation` for an")) {
  fail("approval continuation must bypass fresh intent/conversation routing");
}
if (!instructions.includes("immediately call")) {
  fail("approval continuation must force same-turn build execution");
}
if (!instructions.includes("Approval label exception")) {
  fail("root instructions must treat exact approval labels as continuation state");
}
if (!instructions.includes("For every non-approval user message")) {
  fail("normal routing must exclude approval continuation messages");
}
if (!instructions.includes("This first step must contain no other")) {
  fail("intent routing must require intent to be the only first-step call");
}
if (!instructions.includes("generate_next_app_from_spec")) {
  fail("root instructions must expand compact CodeWriter specs through generate_next_app_from_spec");
}
if (!instructions.includes("Do not call `write_generated_files` after `generate_next_app_from_spec`")) {
  fail("root instructions must skip write_generated_files after direct generator writes");
}
if (!instructions.includes("success synonym")) {
  fail("root instructions must tolerate CodeWriter success status synonyms");
}
if (!instructions.includes("skip `code_writer` and call")) {
  fail("root instructions must use the direct generator fast path for normal one-page sites");
}
if (!instructions.includes("Do not call") || !instructions.includes("fast path")) {
  fail("approval continuation must not call code_writer for normal one-page fast path");
}
if (!instructions.includes("not source file")) {
  fail("root instructions must keep source file generation out of CodeWriter");
}
if (!instructions.includes("call `autofix` with the exact")) {
  fail("security autofix handoff must include the exact generated source snapshot");
}
if (!instructions.includes("If no current source snapshot is available")) {
  fail("security autofix must reread generated source before patching");
}

const readme = readFileSync(join(root, "README.md"), "utf8");
if (readme.includes("docs/")) {
  fail("README should be self-contained and must not link to docs/");
}

if (existsSync(join(root, "docs"))) {
  fail("docs folder should not exist; keep project documentation in README.md");
}

if (existsSync(join(root, ".env.example"))) {
  fail("use env.sample instead of .env.example");
}

const codeWriterInstructions = readFileSync(
  join(root, "agent/subagents/code_writer/instructions.md"),
  "utf8",
);
if (!codeWriterInstructions.includes("at most 7 files total")) {
  fail("code writer instructions must cap one-page generated apps");
}
if (!codeWriterInstructions.includes("under 420 lines")) {
  fail("code writer instructions must cap one-page page component size");
}
if (!codeWriterInstructions.includes("under 360 lines")) {
  fail("code writer instructions must cap one-page stylesheet size");
}
if (!codeWriterInstructions.includes("under 180 lines")) {
  fail("code writer instructions must prefer smaller one-page page components");
}
if (!codeWriterInstructions.includes("under 180 lines")) {
  fail("code writer instructions must prefer smaller one-page stylesheets");
}
if (!codeWriterInstructions.includes("streaming-friendly")) {
  fail("code writer instructions must explicitly avoid huge streamed source output");
}
if (!codeWriterInstructions.includes("Do not return source file contents")) {
  fail("code writer instructions must forbid large source-file responses");
}
if (!codeWriterInstructions.includes("status:\"spec_ready\"")) {
  fail("code writer instructions must require exact spec_ready status");
}
if (!codeWriterInstructions.includes("Keep the entire spec under 2,500 characters")) {
  fail("code writer instructions must cap compact implementation specs");
}

const generatorTool = readFileSync(
  join(root, "agent/tools/generate_next_app_from_spec.ts"),
  "utf8",
);
if (!generatorTool.includes("ImplementationSpecSchema")) {
  fail("generate_next_app_from_spec must accept the shared ImplementationSpec schema");
}
if (!generatorTool.includes("GeneratedAppBundleSchema")) {
  fail("generate_next_app_from_spec must return the compact GeneratedAppBundle schema");
}
if (generatorTool.includes("toModelOutput")) {
  fail("generate_next_app_from_spec should return a compact output directly, not rely on model projection");
}
if (!generatorTool.includes("writeTextFile")) {
  fail("generate_next_app_from_spec must write generated files directly into the sandbox");
}
if (!generatorTool.includes("normalizeQualityCommands")) {
  fail("generate_next_app_from_spec must run quality commands internally");
}
if (!generatorTool.includes("sandbox.spawn")) {
  fail("generate_next_app_from_spec must start preview internally");
}
if (!codeWriterInstructions.includes("Do not use negative letter spacing")) {
  fail("code writer instructions must forbid negative letter spacing");
}
if (!codeWriterInstructions.includes("implicit GET submission")) {
  fail("code writer instructions must prevent generated forms from leaking data via GET");
}
if (!codeWriterInstructions.includes("do not call `search_unsplash_images` on the")) {
  fail("code writer instructions must keep one-page image sourcing off the critical path");
}

const autofixInstructions = readFileSync(
  join(root, "agent/subagents/autofix/instructions.md"),
  "utf8",
);
if (
  !/source\s+snapshot\s+with\s+file\s+contents/.test(autofixInstructions)
) {
  fail("autofix instructions must require source contents for security repair");
}
if (!autofixInstructions.includes("implicit GET submission")) {
  fail("autofix instructions must know how to repair unsafe generated forms");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("smoke: Eveable project structure, release version, and model config look good.");
