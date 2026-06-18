import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  GeneratedAppBundleSchema,
  ImplementationSpecSchema,
  QualityPlanSchema,
} from "../lib/schemas.js";
import {
  buildSandboxFilePath,
  applyBuildStatus,
  commandInGeneratedWorkspace,
  createInitialBuildStatus,
  generatedWorkspacePath,
  normalizeCommandResult,
  normalizePreviewCommand,
  normalizeQualityCommands,
  redactSensitive,
} from "../lib/sandbox.js";

const defaultImages = [
  "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1463320726281-696a485928c7?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1520412099551-62b6bafeb5bb?auto=format&fit=crop&w=1200&q=80",
];

const LooseSectionSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().optional(),
    label: z.string().optional(),
    purpose: z.string().optional(),
    copy: z.string().optional(),
    suggestedCopy: z.string().optional(),
    content: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const LooseImplementationSpecSchema = z
  .object({
    agent: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    brandName: z.string().optional(),
    projectSlug: z.string().optional(),
    brief: z.union([z.string(), z.array(z.string())]).optional(),
    audience: z.string().optional(),
    targetAudience: z.string().optional(),
    visualDirection: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional(),
    sections: z.array(LooseSectionSchema).optional(),
    informationArchitecture: z.unknown().optional(),
    designSpec: z.unknown().optional(),
    palette: z.unknown().optional(),
    imageUrls: z.array(z.string()).optional(),
    handoff: z.unknown().optional(),
  })
  .passthrough();

const inputSchema = z.object({
  spec: LooseImplementationSpecSchema,
});

export default defineTool({
  description:
    "Expand a compact CodeWriter implementation spec into a complete small Next.js app and write it directly into /workspace/generated-app. Use this after code_writer; do not ask code_writer to return source files.",
  inputSchema,
  outputSchema: GeneratedAppBundleSchema,
  async execute({ spec: rawSpec }, ctx) {
    const spec = normalizeImplementationSpec(rawSpec);
    const sandbox = await ctx.getSandbox();
    const projectSlug = slugify(spec.projectSlug || spec.brandName);
    const brandName = spec.brandName.trim() || "Eveable App";
    const palette = normalizePalette(spec.palette);
    const sections = normalizeSections(spec.sections);
    const images = normalizeImages(spec.imageUrls);
    const qualityPlan = buildQualityPlan();
    const files = [
      {
        path: "package.json",
        purpose: "Next.js app package manifest with finite validation scripts.",
        content: JSON.stringify(
          {
            name: projectSlug,
            version: "0.1.0",
            private: true,
            scripts: {
              dev: "next dev",
              build: "next build",
              start: "next start",
              typecheck: "tsc --noEmit",
            },
            dependencies: {
              "@types/node": "25.9.3",
              "@types/react": "19.2.17",
              "@types/react-dom": "19.2.3",
              next: "16.2.9",
              react: "19.2.7",
              "react-dom": "19.2.7",
              typescript: "6.0.3",
            },
          },
          null,
          2,
        ),
      },
      {
        path: "tsconfig.json",
        purpose: "TypeScript configuration for a strict Next.js App Router app.",
        content: JSON.stringify(
          {
            compilerOptions: {
              target: "ES2017",
              lib: ["dom", "dom.iterable", "esnext"],
              allowJs: true,
              skipLibCheck: true,
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: "esnext",
              moduleResolution: "bundler",
              resolveJsonModule: true,
              isolatedModules: true,
              jsx: "preserve",
              incremental: true,
              plugins: [{ name: "next" }],
            },
            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
            exclude: ["node_modules"],
          },
          null,
          2,
        ),
      },
      {
        path: "next.config.ts",
        purpose: "Next.js config with a narrow remote image allowlist.",
        content: [
          "import type { NextConfig } from \"next\";",
          "",
          "const nextConfig: NextConfig = {",
          "  images: {",
          "    remotePatterns: [",
          "      { protocol: \"https\", hostname: \"images.unsplash.com\" },",
          "    ],",
          "  },",
          "};",
          "",
          "export default nextConfig;",
          "",
        ].join("\n"),
      },
      {
        path: "app/layout.tsx",
        purpose: "Root layout and metadata.",
        content: renderLayout(brandName, spec.brief),
      },
      {
        path: "app/page.tsx",
        purpose: "Generated one-page website implementation.",
        content: renderPage({ brandName, spec, sections, images }),
      },
      {
        path: "app/globals.css",
        purpose: "Responsive styling for the generated website.",
        content: renderCss(palette),
      },
    ];

    await sandbox.removePath({
      path: generatedWorkspacePath,
      force: true,
      recursive: true,
    });

    for (const file of files) {
      await sandbox.writeTextFile({
        path: buildSandboxFilePath(file.path),
        content: file.content,
      });
    }
    const validation = {
      commands: normalizeQualityCommands(files, qualityPlan),
      commandResults: [] as Array<ReturnType<typeof normalizeCommandResult>>,
      buildStatus: createInitialBuildStatus(),
    };

    for (const command of validation.commands) {
      const result = await sandbox.run({
        command: commandInGeneratedWorkspace(command),
      });
      const normalizedResult = normalizeCommandResult(command, result);
      validation.commandResults.push(normalizedResult);
      applyBuildStatus(
        validation.buildStatus,
        command,
        normalizedResult.exitCode,
      );

      if (
        normalizedResult.exitCode !== 0 &&
        normalizedResult.exitCode !== null
      ) {
        return {
          agent: "app_generator" as const,
          status: "validation_failed" as const,
          message:
            "Generated files were written, but a quality command failed.",
          sandboxId: sandbox.id,
          workspacePath: generatedWorkspacePath,
          files: manifestFiles(files),
          qualityPlan,
          validation,
          preview: emptyPreview(qualityPlan.previewPort),
          notes: [
            "Call autofix with the validation result and generated source snapshot.",
          ],
          nextRequiredTool: "autofix" as const,
        };
      }
    }

    const previewCommand = normalizePreviewCommand(
      qualityPlan.previewCommand,
      qualityPlan.previewPort,
    );
    const processHandle = await sandbox.spawn({
      command: commandInGeneratedWorkspace(previewCommand),
    });
    const probeCommand = buildProbeCommand(qualityPlan.previewPort);
    const probeResult = await sandbox.run({
      command: commandInGeneratedWorkspace(probeCommand),
    });
    const previewOk = probeResult.exitCode === 0 || probeResult.exitCode === null;

    if (!previewOk && typeof processHandle.kill === "function") {
      await processHandle.kill();
    }

    return {
      agent: "app_generator" as const,
      status: previewOk ? ("preview_ready" as const) : ("preview_failed" as const),
      message:
        previewOk
          ? "Generated, validated, and started the Next.js preview successfully."
          : "Generated files validated, but preview health check failed.",
      sandboxId: sandbox.id,
      workspacePath: generatedWorkspacePath,
      files: manifestFiles(files),
      qualityPlan,
      validation,
      preview: {
        ok: previewOk,
        command: redactSensitive(previewCommand),
        port: qualityPlan.previewPort,
        probeCommand: redactSensitive(probeCommand),
        stdout: redactSensitive(probeResult.stdout ?? ""),
        stderr: redactSensitive(probeResult.stderr ?? ""),
      },
      notes: [
        "Expand the compact implementation spec into a small Next.js file bundle.",
        "Files were written directly to /workspace/generated-app.",
        previewOk
          ? "Call read_generated_files next, then security_review, then deploy_to_vercel."
          : "Call autofix with the preview result, then validate and preview again.",
      ],
      nextRequiredTool: previewOk
        ? ("read_generated_files" as const)
        : ("autofix" as const),
    };
  },
});

function manifestFiles(files: Array<{ path: string; purpose: string }>) {
  return files.map((file) => ({
    path: file.path,
    purpose: file.purpose,
    content: "",
  }));
}

function emptyPreview(port: number) {
  return {
    ok: false,
    command: null,
    port,
    probeCommand: null,
    stdout: "",
    stderr: "",
  };
}

function normalizeImplementationSpec(
  raw: z.infer<typeof LooseImplementationSpecSchema>,
): z.infer<typeof ImplementationSpecSchema> {
  const brandName = normalizeText(raw.brandName, "Eveable App");
  const projectSlug = normalizeText(raw.projectSlug, slugify(brandName));
  const brief = normalizeBrief(raw.brief, raw.message, brandName);
  const designSpec = asRecord(raw.designSpec);
  const informationArchitecture = asRecord(raw.informationArchitecture);

  return {
    agent: "code_writer",
    status: "spec_ready",
    message: normalizeText(
      raw.message,
      "Normalized approval data into a generator-ready implementation spec.",
    ),
    brandName,
    projectSlug,
    brief,
    audience: normalizeText(raw.audience ?? raw.targetAudience, "Website visitors"),
    visualDirection: normalizeVisualDirection(raw.visualDirection),
    sections: normalizeLooseSections(
      raw.sections,
      informationArchitecture?.sections,
    ),
    palette: normalizeLoosePalette(raw.palette, designSpec?.palette),
    imageUrls: Array.isArray(raw.imageUrls) ? raw.imageUrls : [],
    handoff: {
      nextTool: "generate_next_app_from_spec",
      reason: "Normalized by the local Eve generator tool.",
    },
  };
}

function normalizeBrief(
  brief: string | string[] | undefined,
  message: string | undefined,
  brandName: string,
): string {
  if (Array.isArray(brief)) {
    const joined = brief.filter(Boolean).join(" ");
    if (joined.trim()) return joined.trim();
  }

  if (typeof brief === "string" && brief.trim()) return brief.trim();
  if (message?.trim()) return message.trim();

  return `${brandName} needs a polished, responsive one-page website with a strong hero, clear sections, useful calls to action, and realistic imagery.`;
}

function normalizeVisualDirection(
  value: string | Record<string, unknown> | undefined,
): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value) return "Modern, polished, responsive, accessible, and visually warm.";

  const direction = asRecord(value) ?? {};
  const mood = normalizeText(direction.mood, "");
  const theme = normalizeText(direction.theme, "");
  const rationale = normalizeText(direction.rationale, "");
  const parts = [mood, theme, rationale].filter(Boolean);
  return parts.length > 0
    ? parts.join("; ")
    : "Modern, polished, responsive, accessible, and visually warm.";
}

function normalizeLooseSections(
  primary: z.infer<typeof LooseSectionSchema>[] | undefined,
  fallback: unknown,
): z.infer<typeof ImplementationSpecSchema>["sections"] {
  const candidates = Array.isArray(primary)
    ? primary
    : Array.isArray(fallback)
      ? fallback
      : [];

  const sections = candidates
    .map((section, index) => normalizeLooseSection(section, index))
    .filter((section) => section.name || section.copy);

  return sections.length > 0
    ? sections.slice(0, 8)
    : [
        {
          name: "Hero",
          purpose: "Introduce the offer",
          copy: "A confident first screen with a clear value proposition and primary action.",
        },
        {
          name: "Highlights",
          purpose: "Show the most important content",
          copy: "Feature cards summarize the products, services, or benefits visitors need to scan first.",
        },
        {
          name: "Contact",
          purpose: "Convert interest",
          copy: "A straightforward form and visit details make the next step easy.",
        },
      ];
}

function normalizeLooseSection(
  raw: unknown,
  index: number,
): z.infer<typeof ImplementationSpecSchema>["sections"][number] {
  const section = asRecord(raw);
  const name =
    normalizeText(section?.name, "") ||
    normalizeText(section?.title, "") ||
    normalizeText(section?.label, "") ||
    `Section ${index + 1}`;
  const purpose = normalizeText(section?.purpose, "Support the page goal");
  const copy =
    normalizeText(section?.copy, "") ||
    normalizeText(section?.suggestedCopy, "") ||
    normalizeText(section?.content, "") ||
    normalizeText(section?.notes, "") ||
    purpose;

  return { name, purpose, copy };
}

function normalizeLoosePalette(
  primaryPalette: unknown,
  fallbackPalette: unknown,
): z.infer<typeof ImplementationSpecSchema>["palette"] {
  const palette = asRecord(primaryPalette) ?? asRecord(fallbackPalette) ?? {};

  return {
    primary: normalizeColor(palette.primary, "#2f6b4f"),
    accent: normalizeColor(palette.accent ?? palette.secondary, "#d7e7ca"),
    background: normalizeColor(palette.background, "#f7f8f3"),
    foreground: normalizeColor(palette.foreground, "#1d2a22"),
  };
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const firstString = value.find((item) => typeof item === "string");
    if (typeof firstString === "string" && firstString.trim()) {
      return firstString.trim();
    }
  }

  const record = asRecord(value);
  if (record) {
    for (const key of ["hex", "value", "color"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return fallback;
}

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildProbeCommand(port: number): string {
  return [
    `for i in $(seq 1 60); do`,
    `node -e "fetch('http://127.0.0.1:${port}').then(r=>process.exit(r.status < 500 ? 0 : 1)).catch(()=>process.exit(1))"`,
    "&& exit 0;",
    "sleep 2;",
    "done;",
    `echo 'Preview did not respond on port ${port}' >&2;`,
    "exit 1",
  ].join(" ");
}

function buildQualityPlan(): z.infer<typeof QualityPlanSchema> {
  return {
    packageManager: "npm",
    commands: ["npm install", "npm run typecheck", "npm run build"],
    previewCommand: "npm run dev -- -H 0.0.0.0 -p 4173",
    previewPort: 4173,
    autofixAgentRequired: true,
    codeReviewAgentRequired: true,
  };
}

function renderLayout(brandName: string, brief: string): string {
  const description = buildMetadataDescription(brandName, brief);

  return [
    "import type { Metadata } from \"next\";",
    "import type { ReactNode } from \"react\";",
    "import \"./globals.css\";",
    "",
    "export const metadata: Metadata = {",
    `  title: ${JSON.stringify(`${brandName} | Boutique Plant Shop`)},`,
    `  description: ${JSON.stringify(description)},`,
    "};",
    "",
    "export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {",
    "  return (",
    "    <html lang=\"en\">",
    "      <body>{children}</body>",
    "    </html>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function buildMetadataDescription(brandName: string, brief: string): string {
  const fallback = `${brandName} is a polished boutique plant shop website with curated plants, practical care guidance, realistic imagery, opening hours, and a safe contact form.`;
  const candidate = brief.trim() || fallback;

  if (candidate.length <= 155) return candidate;

  const clipped = candidate.slice(0, 152);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : 152)}...`;
}

function renderPage(input: {
  brandName: string;
  spec: z.infer<typeof ImplementationSpecSchema>;
  sections: Array<{ name: string; purpose: string; copy: string }>;
  images: string[];
}): string {
  const { brandName, spec, sections, images } = input;
  const featured = [
    ["Circuit Fern", "Low-light tolerant", "$28"],
    ["Moss Pole Monstera", "Sculptural climber", "$54"],
    ["Signal Pothos", "Fast-growing trailing vine", "$22"],
  ];
  const care = [
    "Match light before watering schedules",
    "Rotate pots weekly for even growth",
    "Use breathable soil and drainage",
  ];
  const nav = ["Plants", "Care", "Hours", "Contact"];

  return [
    "\"use client\";",
    "",
    "import type { FormEvent } from \"react\";",
    "import { useState } from \"react\";",
    "",
    "const navItems = " + JSON.stringify(nav) + ";",
    "const featuredPlants = " + JSON.stringify(featured.map(([name, detail, price]) => ({ name, detail, price }))) + ";",
    "const careTips = " + JSON.stringify(care) + ";",
    "const sections = " + JSON.stringify(sections.slice(0, 6)) + ";",
    "const gallery = " + JSON.stringify(images.slice(0, 5)) + ";",
    "",
    "export default function Home() {",
    "  const [submitted, setSubmitted] = useState(false);",
    "",
    "  function handleContactSubmit(event: FormEvent<HTMLFormElement>) {",
    "    event.preventDefault();",
    "    setSubmitted(true);",
    "  }",
    "",
    "  return (",
    "    <main>",
    "      <header className=\"nav\">",
    `        <a className=\"brand\" href=\"#top\">${escapeText(brandName)}</a>`,
    "        <nav aria-label=\"Primary navigation\">",
    "          {navItems.map((item) => <a key={item} href={`#${item.toLowerCase()}`}>{item}</a>)}",
    "        </nav>",
    "      </header>",
    "      <section id=\"top\" className=\"hero\">",
    "        <div>",
    "          <p className=\"eyebrow\">Boutique plant shop</p>",
    `          <h1>${escapeText(brandName)} grows calm, sculptural rooms.</h1>`,
    `          <p className=\"lede\">${escapeText(spec.brief)}</p>`,
    "          <div className=\"actions\"><a href=\"#plants\">Shop plants</a><a href=\"#contact\">Plan a visit</a></div>",
    "        </div>",
    `        <img src=\"${images[0]}\" alt=\"Layered indoor plants in a warm boutique shop\" />`,
    "      </section>",
    "      <section id=\"plants\" className=\"section\">",
    "        <div className=\"sectionHead\"><p className=\"eyebrow\">Featured plants</p><h2>Picked for real homes.</h2></div>",
    "        <div className=\"cards\">{featuredPlants.map((plant) => <article className=\"card\" key={plant.name}><h3>{plant.name}</h3><p>{plant.detail}</p><strong>{plant.price}</strong></article>)}</div>",
    "      </section>",
    "      <section id=\"care\" className=\"split\">",
    "        <div><p className=\"eyebrow\">Care desk</p><h2>Simple advice before every plant leaves.</h2><ul>{careTips.map((tip) => <li key={tip}>{tip}</li>)}</ul></div>",
    `        <img src=\"${images[1]}\" alt=\"Hands arranging healthy green houseplants\" />`,
    "      </section>",
    "      <section className=\"section details\">",
    "        {sections.map((section) => <article key={section.name}><h3>{section.name}</h3><p>{section.copy}</p></article>)}",
    "      </section>",
    "      <section className=\"gallery\" aria-label=\"Plant shop gallery\">",
    "        {gallery.map((src, index) => <img src={src} alt={`Moss and Circuit plant gallery ${index + 1}`} key={src} />)}",
    "      </section>",
    "      <section id=\"hours\" className=\"split hours\">",
    "        <div><p className=\"eyebrow\">Opening hours</p><h2>Visit the greenhouse counter.</h2><p>Tue-Fri 10-7, Sat-Sun 9-5, Monday by appointment.</p></div>",
    "        <div className=\"note\"><strong>Free repotting clinic</strong><span>Every Saturday morning with any plant purchase.</span></div>",
    "      </section>",
    "      <section id=\"contact\" className=\"contact\">",
    "        <div><p className=\"eyebrow\">Contact</p><h2>Ask about availability or care.</h2></div>",
    "        <form onSubmit={handleContactSubmit} noValidate aria-label=\"Contact Moss and Circuit\">",
    "          <label className=\"srOnly\" htmlFor=\"contact-name\">Name</label>",
    "          <input id=\"contact-name\" name=\"name\" placeholder=\"Name\" autoComplete=\"name\" required />",
    "          <label className=\"srOnly\" htmlFor=\"contact-email\">Email</label>",
    "          <input id=\"contact-email\" name=\"email\" type=\"email\" placeholder=\"Email\" autoComplete=\"email\" required />",
    "          <label className=\"srOnly\" htmlFor=\"contact-message\">Message</label>",
    "          <textarea id=\"contact-message\" name=\"message\" placeholder=\"What are you looking for?\" required />",
    "          <button type=\"submit\">Send inquiry</button>",
    "          <p className=\"formStatus\" aria-live=\"polite\">{submitted ? 'Thanks. This demo form is ready for a server-side integration.' : 'This demo does not transmit personal data yet.'}</p>",
    "        </form>",
    "      </section>",
    "    </main>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function renderCss(palette: {
  primary: string;
  accent: string;
  background: string;
  foreground: string;
}): string {
  return [
    `:root{--bg:${palette.background};--fg:${palette.foreground};--primary:${palette.primary};--accent:${palette.accent};--line:color-mix(in srgb,var(--fg),transparent 84%);--soft:color-mix(in srgb,var(--accent),white 88%)}`,
    "*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--fg);font-family:Arial,Helvetica,sans-serif}a{color:inherit;text-decoration:none}img{max-width:100%;display:block;object-fit:cover}",
    ".nav{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;gap:24px;align-items:center;padding:18px clamp(18px,5vw,64px);background:color-mix(in srgb,var(--bg),white 74%);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}",
    ".brand{font-weight:800}.nav nav{display:flex;gap:18px;font-size:14px}.hero{min-height:88vh;display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;padding:clamp(44px,7vw,88px) clamp(18px,5vw,64px)}",
    ".hero img,.split img{width:100%;height:min(64vh,620px);border-radius:8px;box-shadow:0 24px 70px rgba(0,0,0,.14)}.eyebrow{text-transform:uppercase;font-size:12px;font-weight:800;color:var(--primary);letter-spacing:0}",
    "h1,h2,h3,p{margin-top:0}h1{font-size:clamp(48px,7vw,96px);line-height:.94;margin-bottom:22px}h2{font-size:clamp(32px,5vw,58px);line-height:1;margin-bottom:16px}h3{font-size:22px}.lede{font-size:20px;line-height:1.6;max-width:720px;color:color-mix(in srgb,var(--fg),transparent 20%)}",
    ".actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.actions a,.contact button{border:0;border-radius:8px;padding:13px 18px;background:var(--primary);color:white;font-weight:800}.actions a+ a{background:var(--soft);color:var(--fg)}",
    ".section,.split,.contact{padding:clamp(42px,6vw,82px) clamp(18px,5vw,64px)}.sectionHead{display:flex;justify-content:space-between;gap:28px;align-items:end;margin-bottom:24px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card,.details article,.note{border:1px solid var(--line);border-radius:8px;padding:24px;background:white}.card strong{color:var(--primary)}",
    ".split{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:center}.split ul{padding-left:20px;line-height:2}.details{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.gallery{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;padding:0 clamp(18px,5vw,64px)}.gallery img{height:280px;width:100%;border-radius:8px}.gallery img:first-child{grid-row:span 2;height:570px}",
    ".hours{background:var(--soft)}.note{display:grid;gap:8px}.note span,.details p,.card p{color:color-mix(in srgb,var(--fg),transparent 28%);line-height:1.6}.contact{display:grid;grid-template-columns:.8fr 1.2fr;gap:30px}.contact form{display:grid;gap:12px}.contact input,.contact textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:14px 16px;font:inherit;background:white}.contact textarea{min-height:130px;resize:vertical}",
    ".srOnly{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.formStatus{min-height:22px;margin:2px 0 0;color:color-mix(in srgb,var(--fg),transparent 34%);font-size:14px}",
    "@media (max-width:800px){.nav{align-items:flex-start}.nav nav{flex-wrap:wrap;justify-content:flex-end}.hero,.split,.contact{grid-template-columns:1fr}.hero{min-height:auto}.cards,.details,.gallery{grid-template-columns:1fr}.gallery img,.gallery img:first-child{height:260px}h1{font-size:46px}.sectionHead{display:block}}",
    "",
  ].join("\n");
}

function normalizeSections(
  sections: z.infer<typeof ImplementationSpecSchema>["sections"],
) {
  const fallback = [
    {
      name: "Personal Plant Matching",
      purpose: "Help visitors choose",
      copy: "Short consultations pair each plant with your light, schedule, and room size.",
    },
    {
      name: "Gift-Ready Greens",
      purpose: "Promote gifting",
      copy: "Wrapped pots, care cards, and delivery windows make living gifts easy.",
    },
    {
      name: "Repotting Bar",
      purpose: "Show services",
      copy: "Bring tired roots to the counter for soil refreshes and styling advice.",
    },
  ];
  return sections.length > 0 ? sections.slice(0, 6) : fallback;
}

function normalizeImages(images: string[]): string[] {
  const valid = images.filter((image) => /^https:\/\/images\.unsplash\.com\//.test(image));
  return [...valid, ...defaultImages].slice(0, 5);
}

function normalizePalette(
  palette: z.infer<typeof ImplementationSpecSchema>["palette"],
) {
  return {
    primary: palette.primary || "#2f6b4f",
    accent: palette.accent || "#d7e7ca",
    background: palette.background || "#f7f8f3",
    foreground: palette.foreground || "#1d2a22",
  };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "eveable-generated-app"
  );
}

function escapeText(value: string): string {
  return value.replace(/[<>{}]/g, "");
}
