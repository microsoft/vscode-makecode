import * as vscode from "vscode";

import { readTextFileAsync } from "./util";

export type MakeCodeAgentKind = "tutorial" | "project" | "skillmap";

interface AgentQueryOptions {
    extensionUri: vscode.Uri;
    document: vscode.TextDocument;
    request: string;
    selection?: string;
}

export async function buildTutorialAgentQueryAsync(options: AgentQueryOptions) {
    const relativePath = getRelativePath(options.document);
    const selectionContext = formatSelectionContext("tutorial excerpt", "md", options.selection);
    const basePrompt = await getPromptBaseAsync(
        options.extensionUri,
        "tutorial-authoring.prompt.md",
        `Use the MakeCode tutorial-authoring guidance as the base prompt:
- Keep a clear # title and sequential ## Step N headings unless this tutorial intentionally uses activity format.
- Preserve existing code fences unless there is a clear bug.
- Prefer MakeCode snippets such as blocks, typescript/javascript, template, package, ghost, sig, and assetjson.
- In learner prose, wrap every MakeCode block pill in Markdown inline-code backticks, e.g. \`\`||sprites:Sprite||\`\`; raw ||sprites:Sprite|| breaks rendering.
- Use local project API context when code changes are involved: read pxt.json, project files, and pxt_modules packages when available. The project may be a normal folder or an imported mkcdfs-backed folder; pxt_modules contains target base libraries and extension dependencies after MakeCode: Install Project Dependencies.
- Keep snippets compatible with MakeCode Static TypeScript and avoid DOM, Node, imports, eval, generators, JSX, or unavailable packages.
- Preserve and update package and assetjson snippets when required; omit package snippets entirely when no dependencies are required, because empty package snippets break tutorial parsing.
- Make minimal, reviewable edits to this tutorial file and explain any changes that need validation.`
    );

    return `Act as the MakeCode Tutorial Agent.

Help me update this Microsoft MakeCode tutorial Markdown file: #file:${relativePath}

User request: ${options.request}

${basePrompt}

After the edit, suggest running MakeCode: Validate Tutorial and Launch Tutorial Preview.${selectionContext}`;
}

export async function buildProjectAgentQueryAsync(options: AgentQueryOptions) {
    const relativePath = getRelativePath(options.document);
    const selectionContext = formatSelectionContext("project code", "ts", options.selection);
    const basePrompt = await getPromptBaseAsync(
        options.extensionUri,
        "static-typescript.prompt.md",
        `Use the MakeCode Static TypeScript guidance as the base prompt:
- MakeCode uses the PXT compiler and Static TypeScript; avoid DOM APIs, Node APIs, arbitrary imports, generators, JSX, eval, and browser-only APIs.
- Prefer APIs exposed as blocks with //% block annotations when possible.
- Do not hallucinate functions, methods, or packages outside the current project, pxt.json dependencies, and nearest pxt_modules package APIs.
- Avoid deprecated APIs and identifiers prefixed with _ unless there is a strong reason.
- If adding files, update pxt.json correctly.
- When creating assets, use editable tagged templates such as assets.image\`name\`, assets.tile\`name\`, assets.tilemap\`name\`, assets.animation\`name\`, or assets.song\`name\`; do not edit generated asset files.
- Make minimal, reviewable edits to the project and explain any follow-up validation.`
    );

    return `Act as the MakeCode Project Agent.

Help me update this Microsoft MakeCode Arcade project entry point: #file:${relativePath}

User request: ${options.request}

Inspect local project API context before changing code: read pxt.json, project files, and pxt_modules packages when available. The project may be a normal folder or an imported mkcdfs-backed folder; pxt_modules contains target base libraries and extension dependencies after MakeCode: Install Project Dependencies.

${basePrompt}

After the edit, suggest running MakeCode: Start MakeCode Simulator.${selectionContext}`;
}

export async function buildSkillmapAgentQueryAsync(options: AgentQueryOptions) {
    const relativePath = getRelativePath(options.document);
    const selectionContext = formatSelectionContext("skillmap excerpt", "md", options.selection);
    const basePrompt = await getPromptBaseAsync(
        options.extensionUri,
        "skillmap-authoring.prompt.md",
        `Use the MakeCode skillmap-authoring guidance as the base prompt:
- Skillmaps are Markdown graph definitions for learning paths.
- Preserve the existing H1/H2/H3 structure, node ids, graph links, and parser-compatible metadata.
- Do not invent tutorial URLs, share ids, assets, certificates, target aliases, or APIs.
- Inspect linked tutorials, pxt.json, project files, and pxt_modules only when available.
- Make minimal, reviewable edits and explain any graph validation or preview steps the user should take.`
    );

    return `Act as the MakeCode Skillmap Agent.

Help me update this Microsoft MakeCode skillmap Markdown file: #file:${relativePath}

User request: ${options.request}

${basePrompt}

When changes affect linked tutorials, use the tutorial-authoring prompt as the secondary guidance. After the edit, suggest validating the skillmap structure and previewing linked tutorials if applicable.${selectionContext}`;
}

async function getPromptBaseAsync(extensionUri: vscode.Uri, fileName: string, fallback: string) {
    const prompt = await readBundledPromptFileAsync(extensionUri, fileName);
    if (!prompt) {
        return fallback;
    }

    return `Use the following bundled MakeCode prompt as the base instructions:

---
${prompt}
---`;
}

async function readBundledPromptFileAsync(extensionUri: vscode.Uri, fileName: string) {
    try {
        return await readTextFileAsync(vscode.Uri.joinPath(extensionUri, "src", "web", "prompts", fileName));
    }
    catch {
        return undefined;
    }
}

function getRelativePath(document: vscode.TextDocument) {
    return vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
}

function formatSelectionContext(label: string, language: string, selection?: string) {
    if (!selection) {
        return "";
    }

    return `\n\nFocus on this selected ${label} if relevant:\n\`\`\`${language}\n${selection}\n\`\`\``;
}
