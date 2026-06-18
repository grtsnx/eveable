import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  GeneratedFileSchema,
  SecurityReviewResultSchema,
} from "../lib/schemas.js";

const inputSchema = z.object({
  files: z.array(GeneratedFileSchema).min(1),
  context: z.string().optional(),
});

type Finding = z.infer<typeof SecurityReviewResultSchema>["findings"][number];

export default defineTool({
  description:
    "Deterministically review generated source files after validation and preview pass. Use this release gate before deploy_to_vercel.",
  inputSchema,
  outputSchema: SecurityReviewResultSchema,
  async execute({ files }) {
    const findings: Finding[] = [];
    const reviewedFiles = files.map((file) => file.path);

    for (const file of files) {
      collectFileFindings(file, findings);
    }

    if (!files.some((file) => file.content.trim().length > 0)) {
      findings.push({
        severity: "medium",
        category: "source-review",
        file: null,
        issue: "No readable generated source content was provided.",
        evidence: "All reviewed file contents were empty.",
        recommendation:
          "Call read_generated_files with the generated file manifest before deployment.",
      });
    }

    const blockingFindings = findings.filter((finding) =>
      ["critical", "high", "medium"].includes(finding.severity),
    );
    const status =
      blockingFindings.length > 0
        ? ("needs_fixes" as const)
        : ("passed" as const);

    return {
      agent: "security_review" as const,
      status,
      summary:
        status === "passed"
          ? "Deterministic security review passed. No blocking source, secret, unsafe HTML, command execution, form submission, or remote image policy issues were found."
          : "Deterministic security review found fixable issues that should be patched before deployment.",
      reviewedFiles,
      findings,
      hardeningNotes: [
        "Keep generated forms as explicit no-op demos unless a server-side endpoint with validation is added.",
        "Do not place real secrets in generated source, .env files, or NEXT_PUBLIC_* variables.",
        "Keep remote image allowlists narrow and avoid wildcard hostnames.",
        "Rerun validation, preview, and security review after any autofix.",
      ],
      nextAgent: status === "passed" ? ("complete" as const) : ("autofix" as const),
    };
  },
});

function collectFileFindings(
  file: z.infer<typeof GeneratedFileSchema>,
  findings: Finding[],
) {
  const content = file.content;
  const lowerPath = file.path.toLowerCase();

  if (/\b(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"']+["']/i.test(content)) {
    findings.push({
      severity: "high",
      category: "secret-exposure",
      file: file.path,
      issue: "Potential secret-like value is hardcoded in generated source.",
      evidence: "A key, token, or secret assignment pattern was detected.",
      recommendation:
        "Remove hardcoded credentials and read server-only values from runtime environment variables.",
    });
  }

  if (/\bNEXT_PUBLIC_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*\b/.test(content)) {
    findings.push({
      severity: "high",
      category: "client-secret-exposure",
      file: file.path,
      issue: "A secret-like NEXT_PUBLIC_* variable appears in generated source.",
      evidence: "NEXT_PUBLIC variable name includes KEY, TOKEN, or SECRET.",
      recommendation:
        "Do not expose secret-bearing values to browser bundles. Route privileged work through server code.",
    });
  }

  if (/dangerouslySetInnerHTML|eval\s*\(|new Function\s*\(/.test(content)) {
    findings.push({
      severity: "high",
      category: "unsafe-code-execution",
      file: file.path,
      issue: "Generated source contains unsafe dynamic HTML or code execution.",
      evidence: "Detected dangerouslySetInnerHTML, eval(), or new Function().",
      recommendation:
        "Remove dynamic execution and render trusted structured data through React components.",
    });
  }

  if (
    lowerPath.endsWith("page.tsx") &&
    /<form\b/i.test(content) &&
    !/onSubmit=\{handleContactSubmit\}/.test(content) &&
    !/method=["']post["']/i.test(content)
  ) {
    findings.push({
      severity: "medium",
      category: "input-handling",
      file: file.path,
      issue: "A form may submit with the browser's implicit GET behavior.",
      evidence: "A form tag was found without an explicit no-op onSubmit or POST method.",
      recommendation:
        "Use a no-op onSubmit for demo forms or a server-side POST handler with validation.",
    });
  }

  if (
    lowerPath.endsWith("next.config.ts") &&
    /remotePatterns/.test(content) &&
    /hostname:\s*["']\*["']|hostname:\s*["'][^"']*\*/.test(content)
  ) {
    findings.push({
      severity: "medium",
      category: "remote-content",
      file: file.path,
      issue: "Next image remotePatterns allowlist is too broad.",
      evidence: "A wildcard hostname was detected in next.config.ts.",
      recommendation:
        "Restrict remote image hosts to the specific domains used by the generated app.",
    });
  }
}
