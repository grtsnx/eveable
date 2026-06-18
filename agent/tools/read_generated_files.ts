import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  GeneratedFileSchema,
  GeneratedSourceSnapshotSchema,
} from "../lib/schemas.js";
import {
  buildSandboxFilePath,
  generatedWorkspacePath,
} from "../lib/sandbox.js";

const maxFileChars = 40_000;

export default defineTool({
  description:
    "Read generated app source files back from /workspace/generated-app so security_review receives inspectable source code. Use this after preview passes and before calling security_review.",
  inputSchema: z.object({
    files: z.array(GeneratedFileSchema).min(1),
  }),
  outputSchema: GeneratedSourceSnapshotSchema,
  async execute({ files }, ctx) {
    const sandbox = await ctx.getSandbox();
    const readableFiles = files.filter((file) => shouldReadForSecurity(file.path));
    const sourceFiles = [];
    const missingFiles = [];
    const notes = [
      "Read generated source files from the Eve sandbox for security review.",
    ];

    for (const file of readableFiles) {
      try {
        const content = await sandbox.readTextFile({
          path: buildSandboxFilePath(file.path),
        });
        if (content === null) {
          missingFiles.push(file.path);
          continue;
        }

        sourceFiles.push({
          path: file.path,
          purpose: file.purpose,
          content:
            content.length > maxFileChars
              ? `${content.slice(0, maxFileChars)}\n...[truncated ${
                  content.length - maxFileChars
                } chars]`
              : content,
        });
      } catch {
        missingFiles.push(file.path);
      }
    }

    if (sourceFiles.length !== readableFiles.length) {
      notes.push(
        "Some generated source files could not be read back from the sandbox.",
      );
    }

    return {
      agent: "sandbox" as const,
      status:
        sourceFiles.length > 0 && missingFiles.length === 0
          ? ("source_ready" as const)
          : ("source_incomplete" as const),
      sandboxId: sandbox.id,
      workspacePath: generatedWorkspacePath,
      files: sourceFiles,
      missingFiles,
      notes,
    };
  },
});

function shouldReadForSecurity(path: string): boolean {
  return ![
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".pdf",
    ".zip",
    ".gz",
  ].some((extension) => path.toLowerCase().endsWith(extension));
}
