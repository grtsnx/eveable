import { defineTool } from "eve/tools";
import { z } from "zod";
import { GeneratedFileSchema } from "../lib/schemas.js";
import {
  buildSandboxFilePath,
  generatedWorkspacePath,
} from "../lib/sandbox.js";

export default defineTool({
  description:
    "Write a complete generated app file set into the Eve sandbox under /workspace/generated-app. Use this after generate_next_app_from_spec returns files. After this tool succeeds, the root agent must immediately call run_quality_commands with the generated quality plan.",
  inputSchema: z.object({
    files: z.array(GeneratedFileSchema).min(1),
    resetWorkspace: z.boolean().default(true),
  }),
  async execute({ files, resetWorkspace }, ctx) {
    const sandbox = await ctx.getSandbox();

    if (resetWorkspace) {
      await sandbox.removePath({
        path: generatedWorkspacePath,
        force: true,
        recursive: true,
      });
    }

    for (const file of files) {
      await sandbox.writeTextFile({
        path: buildSandboxFilePath(file.path),
        content: file.content,
      });
    }

    return {
      agent: "sandbox" as const,
      status: "ready_for_review" as const,
      sandboxId: sandbox.id,
      workspacePath: generatedWorkspacePath,
      message: `Wrote ${files.length} generated file(s) into the sandbox.`,
      filesWritten: files.map((file) => file.path),
      notes: [
        "Generated files were written under /workspace/generated-app.",
        "This is not a completed build; run_quality_commands must run next.",
        "A public URL is created later by deploy_to_vercel after validation, preview, and security review pass.",
      ],
      nextRequiredTool: "run_quality_commands" as const,
    };
  },
});
