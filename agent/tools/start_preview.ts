import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  commandInGeneratedWorkspace,
  generatedWorkspacePath,
  normalizePreviewCommand,
  redactSensitive,
} from "../lib/sandbox.js";

export default defineTool({
  description:
    "Start the generated app preview process in the Eve sandbox and verify it responds over HTTP before reporting success. Tries the generated preview command first, then safe Next.js fallbacks before reporting failure. This tool reports sandbox preview metadata; deploy_to_vercel resolves the public Vercel URL.",
  inputSchema: z.object({
    previewCommand: z.string().min(1),
    previewPort: z.number().int().positive().default(4173),
  }),
  async execute({ previewCommand, previewPort }, ctx) {
    const sandbox = await ctx.getSandbox();
    const probeCommand = buildProbeCommand(previewPort);
    const attempts = [];

    for (const candidate of previewCommandCandidates(
      previewCommand,
      previewPort,
    )) {
      const processHandle = await sandbox.spawn({
        command: commandInGeneratedWorkspace(candidate.command),
      });
      const probeResult = await sandbox.run({
        command: commandInGeneratedWorkspace(probeCommand),
      });
      const attempt = {
        label: candidate.label,
        command: redactSensitive(candidate.command),
        probeExitCode: probeResult.exitCode ?? null,
        probeStdout: redactSensitive(probeResult.stdout ?? ""),
        probeStderr: redactSensitive(probeResult.stderr ?? ""),
      };

      if (probeResult.exitCode === 0 || probeResult.exitCode === null) {
        return {
          agent: "sandbox" as const,
          status: "preview_ready" as const,
          sandboxId: sandbox.id,
          workspacePath: generatedWorkspacePath,
          message:
            "Preview process was started and responded to the HTTP health check.",
          previewCommand: redactSensitive(candidate.command),
          previewPort,
          previewProcessStarted: true,
          previewHealthCheck: {
            ok: true,
            command: redactSensitive(probeCommand),
            exitCode: probeResult.exitCode ?? null,
            stdout: redactSensitive(probeResult.stdout ?? ""),
            stderr: redactSensitive(probeResult.stderr ?? ""),
          },
          attempts: [...attempts, attempt],
          process: {
            waitAvailable: typeof processHandle.wait === "function",
            killAvailable: typeof processHandle.kill === "function",
          },
          notes: [
            `Preview is reachable inside the Eve sandbox on the reported port using ${candidate.label}.`,
            "Call deploy_to_vercel after security_review passes to create a public Vercel preview URL.",
          ],
          nextAgent: "security_review" as const,
        };
      }

      attempts.push(attempt);

      if (typeof processHandle.kill === "function") {
        await processHandle.kill();
      }
    }

    return {
      agent: "sandbox" as const,
      status: "build_failed" as const,
      sandboxId: sandbox.id,
      workspacePath: generatedWorkspacePath,
      message:
        "Preview startup was attempted with the generated command and safe Next.js fallbacks, but no command passed the HTTP health check.",
      previewCommand: redactSensitive(
        normalizePreviewCommand(previewCommand, previewPort),
      ),
      previewPort,
      previewProcessStarted: true,
      previewHealthCheck: {
        ok: false,
        command: redactSensitive(probeCommand),
        exitCode: attempts.at(-1)?.probeExitCode ?? null,
        stdout: attempts.at(-1)?.probeStdout ?? "",
        stderr: attempts.at(-1)?.probeStderr ?? "",
      },
      attempts,
      notes: [
        "The generated app is not preview-ready until one preview command responds over HTTP.",
        "Call autofix with these preview attempts, then rerun quality commands and start_preview.",
      ],
      nextAgent: "autofix" as const,
    };
  },
});

function previewCommandCandidates(command: string, port: number) {
  const normalized = normalizePreviewCommand(command, port);

  return uniqueCandidates([
    {
      label: "generated preview command",
      command: normalized,
    },
    {
      label: "portable production start script",
      command: portableRunScriptCommand("start", `-H 0.0.0.0 -p ${port}`),
    },
    {
      label: "direct Next.js production start",
      command: `if [ -x node_modules/.bin/next ]; then node_modules/.bin/next start -H 0.0.0.0 -p ${port}; else npx --yes next start -H 0.0.0.0 -p ${port}; fi`,
    },
    {
      label: "direct Next.js dev server",
      command: `if [ -x node_modules/.bin/next ]; then node_modules/.bin/next dev -H 0.0.0.0 -p ${port}; else npx --yes next dev -H 0.0.0.0 -p ${port}; fi`,
    },
  ]);
}

function buildProbeCommand(port: number): string {
  return [
    `for i in $(seq 1 60); do`,
    `node -e "fetch('http://127.0.0.1:${port}').then(r=>process.exit(r.status < 500 ? 0 : 1)).catch(()=>process.exit(1))"`,
    `&& exit 0;`,
    `sleep 2;`,
    `done;`,
    `echo 'Preview did not respond on port ${port}' >&2;`,
    `exit 1`,
  ].join(" ");
}

function portableRunScriptCommand(script: string, args: string): string {
  return [
    "if command -v bun >/dev/null 2>&1; then",
    `bun run ${script} ${args};`,
    "elif command -v npm >/dev/null 2>&1; then",
    `npm run ${script} -- ${args};`,
    "else",
    "echo 'No supported package manager found in sandbox' >&2; exit 127;",
    "fi",
  ].join(" ");
}

function uniqueCandidates(
  candidates: Array<{ label: string; command: string }>,
): Array<{ label: string; command: string }> {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.command)) return false;
    seen.add(candidate.command);
    return true;
  });
}
