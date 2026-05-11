import * as vscode from "vscode";

import { httpRequestCoreAsync } from "./host";
import { getAppTargetAsync } from "./makecodeOperations";
import { guidGen, readTextFileAsync, writeTextFileAsync } from "./util";

const apiRoot = "https://www.makecode.com";
const arcadeShareRoot = "https://arcade.makecode.com/";
const tutorialAssetFiles = [
    "assets.json",
    "images.g.jres",
    "images.g.ts",
    "tilemap.g.jres",
    "tilemap.g.ts"
];

export interface TutorialValidationIssue {
    line: number;
    startColumn: number;
    endColumn: number;
    message: string;
    severity: vscode.DiagnosticSeverity;
}

export function isTutorialDocument(document: vscode.TextDocument) {
    return document.languageId === "markdown" || /\.md$/i.test(document.uri.path);
}

export function isTutorialFileDocument(document: vscode.TextDocument) {
    if (!isTutorialDocument(document)) {
        return false;
    }

    if (/\/docs\/tutorials\/[^/]+\.md$/i.test(document.uri.path)) {
        return true;
    }

    const text = document.getText();
    return /^#\s+\S/m.test(text) && /^##\s+Step\s+\d+\b/im.test(text);
}

export async function createTutorialFileAsync(workspace: vscode.WorkspaceFolder, title: string) {
    const fileName = titleToFileName(title);
    const tutorialDir = vscode.Uri.joinPath(workspace.uri, "docs", "tutorials");

    await vscode.workspace.fs.createDirectory(tutorialDir);
    const tutorialUri = await getAvailableTutorialUriAsync(tutorialDir, fileName);
    await writeTextFileAsync(tutorialUri, createTutorialMarkdown(title));

    return tutorialUri;
}

export function createTutorialMarkdown(title: string) {
    return `# ${title}

## Step 1

Introduce the goal of this tutorial and tell learners what they will build.

\`\`\`blocks
// Add a small starter snippet here
\`\`\`

## Step 2

Explain the next action in one or two short sentences.

\`\`\`blocks
// Add the blocks learners should use in this step
\`\`\`

## Step 3

Congratulations, you finished the tutorial!
`;
}

export function validateTutorialMarkdown(markdown: string): TutorialValidationIssue[] {
    const issues: TutorialValidationIssue[] = [];
    const lines = markdown.split(/\r?\n/);
    const titleLine = lines.findIndex(line => /^#\s+\S/.test(line));

    if (titleLine < 0) {
        issues.push(createIssue(0, 0, Math.max(1, lines[0]?.length || 1), vscode.l10n.t("Tutorials should start with a top-level '# Title' heading."), vscode.DiagnosticSeverity.Error));
    }

    const secondLevelHeadings: { line: number; text: string }[] = [];
    lines.forEach((line, index) => {
        if (/^##\s+/.test(line)) {
            secondLevelHeadings.push({ line: index, text: line });
        }
    });

    const stepHeadings = secondLevelHeadings.filter(heading => isLikelyStepHeading(heading.text));

    if (!stepHeadings.length) {
        issues.push(createIssue(titleLine >= 0 ? titleLine : 0, 0, Math.max(1, lines[titleLine]?.length || 1), vscode.l10n.t("Tutorials need at least one '## Step' heading."), vscode.DiagnosticSeverity.Error));
    }

    stepHeadings.forEach((heading, index) => {
        const expected = index + 1;
        const match = /^##\s+Step\s+(\d+)\s*(?:@\w[\w-]*(?:\s+@\w[\w-]*)*)?\s*$/i.exec(heading.text);
        if (!match) {
            issues.push(createIssue(heading.line, 0, heading.text.length, vscode.l10n.t("Tutorial step headings should use the form '## Step {0}'.", expected), vscode.DiagnosticSeverity.Warning));
        }
        else if (parseInt(match[1], 10) !== expected) {
            issues.push(createIssue(heading.line, 0, heading.text.length, vscode.l10n.t("Expected this heading to be '## Step {0}'.", expected), vscode.DiagnosticSeverity.Warning));
        }

        const nextHeadingLine = secondLevelHeadings.find(candidate => candidate.line > heading.line)?.line ?? lines.length;
        const body = lines.slice(heading.line + 1, nextHeadingLine).join("\n").trim();
        if (!body) {
            issues.push(createIssue(heading.line, 0, heading.text.length, vscode.l10n.t("Tutorial steps should include instructions or a code snippet."), vscode.DiagnosticSeverity.Warning));
        }
    });

    const fenceStack: { line: number; language: string; text: string }[] = [];
    const supportedFences = /^(blocks|typescript|javascript|python|template|package|sig|ghost|validation|spy|sim|assetjson|customts|filterblocks|namespaces)$/i;
    lines.forEach((line, index) => {
        const match = /^```\s*([^\s`]*)/.exec(line);
        if (!match) {
            return;
        }

        if (fenceStack.length && line.trim() === "```") {
            fenceStack.pop();
            return;
        }

        const language = match[1];
        fenceStack.push({ line: index, language, text: line });
        if (language && !supportedFences.test(language)) {
            issues.push(createIssue(index, 3, line.length, vscode.l10n.t("'{0}' is not a recognized MakeCode tutorial snippet type.", language), vscode.DiagnosticSeverity.Warning));
        }
    });

    for (const fence of fenceStack) {
        issues.push(createIssue(fence.line, 0, fence.text.length, vscode.l10n.t("Code fence is missing a closing ``` line."), vscode.DiagnosticSeverity.Error));
    }

    if (/github:/i.test(markdown) && !/^```\s*package\b/im.test(markdown)) {
        issues.push(createIssue(0, 0, Math.max(1, lines[0]?.length || 1), vscode.l10n.t("Tutorials that use GitHub extensions should include a package snippet."), vscode.DiagnosticSeverity.Information));
    }

    lines.forEach((line, index) => {
        if (!/^```\s*package\b/i.test(line)) {
            return;
        }

        const closingLine = lines.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.trim() === "```");
        if (closingLine > index) {
            const body = lines.slice(index + 1, closingLine).join("\n").trim();
            if (!body) {
                issues.push(createIssue(index, 0, line.length || 1, vscode.l10n.t("Omit package snippets when there are no dependencies; empty package snippets can break tutorial parsing."), vscode.DiagnosticSeverity.Error));
            }
        }
    });

    validateHighlightMarkers(lines, issues);

    return issues;
}

function isLikelyStepHeading(text: string) {
    return /^##\s+Step\s+\d+\b/i.test(text)
        || /^##\s+\d+[.)]?\s+\S/.test(text)
        || /^##\s+\{\s*(?:Step\s+)?\d+\b/i.test(text);
}

function validateHighlightMarkers(lines: string[], issues: TutorialValidationIssue[]) {
    let currentFence: { language: string; body: { line: number; text: string }[] } | undefined;

    lines.forEach((line, index) => {
        const fenceMatch = /^```\s*([^\s`]*)/.exec(line);
        if (fenceMatch) {
            if (currentFence && line.trim() === "```") {
                validateFenceHighlightMarkers(currentFence, issues);
                currentFence = undefined;
            }
            else if (!currentFence) {
                currentFence = { language: fenceMatch[1], body: [] };
            }
            return;
        }

        if (currentFence) {
            currentFence.body.push({ line: index, text: line });
        }
    });
}

function validateFenceHighlightMarkers(fence: { language: string; body: { line: number; text: string }[] }, issues: TutorialValidationIssue[]) {
    const language = fence.language.toLowerCase();
    const usesHashHighlight = language === "python" || language === "spy";
    const standaloneMarker = usesHashHighlight ? /^#\s*@highlight\s*$/i : /^\/\/\s*@highlight\s*$/i;
    const anyMarker = usesHashHighlight ? /#\s*@highlight\b/i : /\/\/\s*@highlight\b/i;

    fence.body.forEach((bodyLine, index) => {
        const trimmed = bodyLine.text.trim();
        if (!anyMarker.test(trimmed)) {
            return;
        }

        if (!standaloneMarker.test(trimmed)) {
            const startColumn = bodyLine.text.search(anyMarker);
            issues.push(createIssue(bodyLine.line, Math.max(0, startColumn), bodyLine.text.length || 1, vscode.l10n.t("Put highlight markers on their own line immediately before the code line they highlight."), vscode.DiagnosticSeverity.Warning));
            return;
        }

        const nextLine = fence.body[index + 1];
        if (!nextLine?.text.trim() || standaloneMarker.test(nextLine.text.trim())) {
            issues.push(createIssue(bodyLine.line, 0, bodyLine.text.length || 1, vscode.l10n.t("A highlight marker must be immediately followed by the code line it highlights."), vscode.DiagnosticSeverity.Warning));
        }
    });
}

export async function createTutorialAssetJsonAsync(workspace: vscode.WorkspaceFolder) {
    const files: {[index: string]: string} = {};

    for (const file of tutorialAssetFiles) {
        const uri = vscode.Uri.joinPath(workspace.uri, file);
        if (await fileExistsAsync(uri)) {
            files[file] = await readTextFileAsync(uri);
        }
    }

    return files;
}

export function updateTutorialAssetJsonSnippet(markdown: string, assetFiles: {[index: string]: string}) {
    const snippet = `\`\`\`assetjson
${JSON.stringify(assetFiles, null, 2)}
\`\`\``;
    const assetJsonRegex = /```\s*assetjson\s*\r?\n[\s\S]*?\r?\n```/i;

    if (assetJsonRegex.test(markdown)) {
        return markdown.replace(assetJsonRegex, snippet);
    }

    return markdown.replace(/\s*$/, "") + "\n\n" + snippet + "\n";
}

export async function shareTutorialAsync(workspace: vscode.WorkspaceFolder, markdown: string) {
    const req = await createTutorialShareRequestAsync(workspace, markdown);
    const res = await httpRequestCoreAsync({
        url: apiRoot + "/api/scripts",
        data: req
    });

    if (res.statusCode !== 200 || !res.text) {
        return undefined;
    }

    try {
        const resJSON = JSON.parse(res.text);
        const id = resJSON.id || resJSON.shortid;
        return id ? arcadeShareRoot + "#tutorial:" + id : undefined;
    }
    catch (e) {
        return undefined;
    }
}

async function getAvailableTutorialUriAsync(tutorialDir: vscode.Uri, baseFileName: string) {
    let suffix = 0;
    let uri = vscode.Uri.joinPath(tutorialDir, `${baseFileName}.md`);

    while (await fileExistsAsync(uri)) {
        suffix++;
        uri = vscode.Uri.joinPath(tutorialDir, `${baseFileName}-${suffix}.md`);
    }

    return uri;
}

async function fileExistsAsync(uri: vscode.Uri) {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch (e) {
        return false;
    }
}

async function createTutorialShareRequestAsync(workspace: vscode.WorkspaceFolder, markdown: string) {
    const title = /^#\s+(.+)$/m.exec(markdown);
    const name = title ? title[1].trim() : "Tutorial";
    const target = await getAppTargetAsync(workspace);
    const pxtJson = JSON.stringify({
        name,
        dependencies: {
            core: "*"
        },
        description: "",
        files: [
            "main.blocks",
            "main.ts",
            "README.md"
        ]
    });

    const text: {[index: string]: string} = {};
    text["README.md"] = markdown;
    text["main.blocks"] = "";
    text["main.ts"] = "";
    text["pxt.json"] = pxtJson;

    return {
        name,
        target: target.id,
        targetVersion: target.versions?.target,
        description: "Made with ❤️ in Microsoft MakeCode Arcade.",
        editor: "blocksprj",
        text,
        meta: {
            versions: target.versions
        }
    };
}

function createIssue(line: number, startColumn: number, endColumn: number, message: string, severity: vscode.DiagnosticSeverity): TutorialValidationIssue {
    return {
        line,
        startColumn,
        endColumn,
        message,
        severity
    };
}

function titleToFileName(title: string) {
    const cleaned = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return cleaned || guidGen();
}
