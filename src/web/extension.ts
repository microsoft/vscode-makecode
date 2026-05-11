// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { setHost } from "makecode-core/built/host";
import { CompileResult } from "makecode-core/built/service";

import { activeWorkspace, createVsCodeHost, readFileAsync, setActiveWorkspace } from "./host";
import { Simulator } from "./simulator";
import { JResTreeProvider, JResTreeNode, fireChangeEvent, deleteAssetAsync, syncJResAsync } from "./jres";
import { AssetEditor } from "./assetEditor";
import { BuildWatcher } from "./buildWatcher";
import { maybeShowConfigNotificationAsync, maybeShowDependenciesNotificationAsync, writeTSConfigAsync } from "./projectWarnings";
import { addDependencyAsync, buildProjectAsync, cleanProjectFolderAsync, createEmptyProjectAsync, downloadSharedProjectAsync, getTargetConfigAsync, installDependenciesAsync, listHardwareVariantsAsync } from "./makecodeOperations";
import { ActionsTreeViewProvider } from "./actionsTreeView";
import { BuildOptions } from "makecode-core/built/commands";
import { getHardwareVariantsAsync, getProjectTemplatesAsync } from "./makecodeGallery";
import { shareProjectAsync } from "./shareLink";
import { getPxtJson, setPxtJson, showQuickPickAsync, writeTextFileAsync } from "./util";
import { VFS } from "./vfs";
import TelemetryReporter from "@vscode/extension-telemetry";
import { codeActionsProvider } from "./codeActionsProvider";
import { MakeCodeEditor } from "./editor";
import { createTutorialAssetJsonAsync, createTutorialFileAsync, isTutorialDocument, isTutorialFileDocument, shareTutorialAsync, updateTutorialAssetJsonSnippet, validateTutorialMarkdown } from "./tutorials";
import { MakeCodeAgentKind, buildProjectAgentQueryAsync, buildSkillmapAgentQueryAsync, buildTutorialAgentQueryAsync } from "./aiPrompts";

let diagnosticsCollection: vscode.DiagnosticCollection;
let tutorialDiagnosticsCollection: vscode.DiagnosticCollection;
let applicationInsights: TelemetryReporter;
let extensionContext: vscode.ExtensionContext;
let lastTutorialDocumentUri: vscode.Uri | undefined;
let lastSkillmapDocumentUri: vscode.Uri | undefined;
let lastMakeCodeAgentKind: MakeCodeAgentKind | undefined;
let makeCodeChatDebugOutput: vscode.OutputChannel | undefined;
const MAKECODE_CHAT_PARTICIPANT_ID = "ms-edu.makecode";
const MAKECODE_AGENT_DIFF_SCHEME = "makecode-agent-diff";
const MAKECODE_CHAT_RESULT_METADATA_KEY = "makecode";
const makeCodeAgentDiffs = new Map<string, { uri: vscode.Uri; oldText: string; title: string }>();

interface MakeCodeChatResultMetadata {
    agentKind: MakeCodeAgentKind;
    uri: string;
    suggestions: string[];
}

function logMakeCodeChatDebug(message: string, data?: Record<string, unknown>) {
    const line = data ? `${message} ${JSON.stringify(data)}` : message;
    console.warn(line);
    if (!makeCodeChatDebugOutput) {
        makeCodeChatDebugOutput = vscode.window.createOutputChannel("MakeCode Chat Debug");
    }
    makeCodeChatDebugOutput.appendLine(line);
}

export function activate(context: vscode.ExtensionContext) {
    logMakeCodeChatDebug("MAKECODE_EXTENSION_ACTIVATE_CALLED", {
        extensionId: context.extension.id,
        vscodeVersion: vscode.version
    });

    extensionContext = context;
    setHost(createVsCodeHost());

    const addCmd = (id: string, fn: (...args: any[]) => Promise<void>) => {
        const cmd = vscode.commands.registerCommand(id, (...args: any[]) => {
            const mkcdTickPrefix = "makecode.";
            if (id.startsWith(mkcdTickPrefix)) {
                tickEvent(id.slice(mkcdTickPrefix.length));
            }
            return fn(...args).catch(err => {
                console.error("MakeCode Ext Exception", err);
            });
        });
        context.subscriptions.push(cmd);
    };
    context.subscriptions.push(
        codeActionsProvider()
    );

    Simulator.register(context);
    AssetEditor.register(context);
    BuildWatcher.register(context);
    MakeCodeEditor.register(context);
    registerMakeCodeAgentCommands(context);
    registerMakeCodeChatParticipant(context);

    const vfs = new VFS(context);
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider("mkcdfs", vfs, { isCaseSensitive: true }));

    addCmd("makecode.build", buildCommand);
    addCmd("makecode.simulate", () => simulateCommand(context));
    addCmd("makecode.create", createCommand);
    addCmd("makecode.install", installCommand);
    addCmd("makecode.clean", cleanCommand);
    addCmd("makecode.shareProject", shareCommandAsync);
    addCmd("makecode.editProjectWithAI", editProjectWithAICommandAsync);
    addCmd("makecode.createTutorial", createTutorialCommandAsync);
    addCmd("makecode.addTutorialAssets", addTutorialAssetsCommandAsync);
    addCmd("makecode.editTutorialWithAI", editTutorialWithAICommandAsync);
    addCmd("makecode.editSkillmapWithAI", editSkillmapWithAICommandAsync);
    addCmd("makecode.previewTutorial", previewTutorialCommandAsync);
    addCmd("makecode.shareTutorial", shareTutorialCommandAsync);
    addCmd("makecode.validateTutorial", validateTutorialCommandAsync);
    addCmd("makecode.openTutorialDocs", openTutorialDocsCommandAsync);
    addCmd("makecode.addDependency", addDependencyCommandAsync);
    addCmd("makecode.removeDependency", removeDependencyCommandAsync);

    addCmd("makecode.createImage", () => createAssetCommand("image"));
    addCmd("makecode.createTile", () => createAssetCommand("tile"));
    addCmd("makecode.createTilemap", () => createAssetCommand("tilemap"));
    addCmd("makecode.createAnimation", () => createAssetCommand("animation"));
    addCmd("makecode.createSong", () => createAssetCommand("song"));
    addCmd("makecode.testBlocks", testBlocksCommandAsync);

    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.createAsset", createAssetCommand)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.duplicateAsset", duplicateAssetCommand)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.deleteAsset", deleteAssetCommand)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.refreshAssets", refreshAssetsCommand)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.importUrl", importUrlCommand)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.openHelpDocs", openHelpDocs)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.openAsset", uri => {
            openAssetEditor(context, uri);
        })
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("makecodeActions", new ActionsTreeViewProvider())
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("imageExplorer", new JResTreeProvider("image"))
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("animationExplorer", new JResTreeProvider("animation"))
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("tileExplorer", new JResTreeProvider("tile"))
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("tilemapExplorer", new JResTreeProvider("tilemap"))
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("songExplorer", new JResTreeProvider("song"))
    );

    // This key is not sensitive, and is publicly available in client side apps logging to AI
    const appInsightsKey = "0c6ae279ed8443289764825290e4f9e2-1a736e7c-1324-4338-be46-fc2a58ae4d14-7255";
    applicationInsights = new TelemetryReporter(appInsightsKey);
    context.subscriptions.push(applicationInsights);

    BuildWatcher.watcher.addEventListener("error", showError);

    diagnosticsCollection = vscode.languages.createDiagnosticCollection("MakeCode");
    context.subscriptions.push(diagnosticsCollection);
    tutorialDiagnosticsCollection = vscode.languages.createDiagnosticCollection("MakeCode Tutorials");
    context.subscriptions.push(tutorialDiagnosticsCollection);
    rememberAuthoringDocuments(vscode.window.activeTextEditor?.document);
    updateAuthoringFileContext();
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        rememberAuthoringDocuments(editor?.document);
        updateAuthoringFileContext(editor?.document);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()) {
            rememberAuthoringDocuments(event.document);
            updateAuthoringFileContext(event.document);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        if (lastTutorialDocumentUri?.toString() === document.uri.toString()) {
            lastTutorialDocumentUri = undefined;
        }
        if (lastSkillmapDocumentUri?.toString() === document.uri.toString()) {
            lastSkillmapDocumentUri = undefined;
        }
    }));

    maybeShowConfigNotificationAsync();
    maybeShowDependenciesNotificationAsync();

    // Set a context key to indicate that we have activated, so context menu commands can show
    vscode.commands.executeCommand('setContext', 'makecode.extensionActive', true);
}

function registerMakeCodeAgentCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(MAKECODE_AGENT_DIFF_SCHEME, {
        provideTextDocumentContent(uri) {
            return makeCodeAgentDiffs.get(uri.query)?.oldText ?? "";
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("makecode.openAgentPreview", async (args?: { agentKind?: MakeCodeAgentKind; uri?: string }) => {
        if (!args?.agentKind) {
            return;
        }

        const uri = args.uri ? vscode.Uri.parse(args.uri) : undefined;
        await openAgentPreviewAsync(args.agentKind, uri, context);
    }));

    context.subscriptions.push(vscode.commands.registerCommand("makecode.openAgentDiff", async (diffId?: string) => {
        const diff = diffId ? makeCodeAgentDiffs.get(diffId) : undefined;
        if (!diff) {
            vscode.window.showInformationMessage(vscode.l10n.t("The MakeCode agent change is no longer available."));
            return;
        }

        const leftUri = vscode.Uri.from({
            scheme: MAKECODE_AGENT_DIFF_SCHEME,
            path: `/${getFileName(diff.uri)}`,
            query: diffId
        });
        await vscode.commands.executeCommand("vscode.diff", leftUri, diff.uri, diff.title);
    }));

}

async function chooseWorkspaceAsync(kind: "empty" | "project" | "any", silent = false): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = [];
    let hasWorkspaceOpen = false;

    if (vscode.workspace.workspaceFolders) {
        hasWorkspaceOpen = !!vscode.workspace.workspaceFolders.length;
        for (const folder of vscode.workspace.workspaceFolders) {
            if (kind === "any") {
                folders.push(folder);
            }
            else {
                const pxtJSONExists = await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "pxt.json"));

                if ((kind === "project" && pxtJSONExists) || (kind === "empty" && !pxtJSONExists)) {
                    folders.push(folder);
                }
            }
        }
    }


    if (folders.length === 0) {
        if (!silent) {
            if (kind === "project") {
                showError(vscode.l10n.t("You need to open a MakeCode project to use this command."));
            }
            else if (kind === "empty" && hasWorkspaceOpen) {
                showError(vscode.l10n.t("The open workspace already contains a MakeCode project. Open an empty folder to use this command."));
            }
            else {
                showError(vscode.l10n.t("You need to open a folder to use this command."));
            }
        }
        return;
    }
    else if (folders.length === 1) {
        return folders[0];
    }

    const choice = await vscode.window.showQuickPick(folders.map(f => f.name), { placeHolder: vscode.l10n.t("Choose a workspace") });

    for (const folder of folders) {
        if (folder.name === choice) {
            return folder;
        }
    }

    return undefined;
}

async function buildCommand() {
    console.log("Build command");

    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    clearBuildErrors();

    const opts: BuildOptions = {
        watch: true,
        hw: await pickHardwareVariantAsync(workspace)
    };

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Building project..."),
        cancellable: false
    }, async () => {
        const result = await buildProjectAsync(workspace, opts);

        if (result.diagnostics.length) {
            reportBuildErrors(result);
        }

        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");

        if (!result.binaryPath) return;

        const showNotifcationConfig = vscode.workspace.getConfiguration().get("makecode.showCompileNotification")
        if (!showNotifcationConfig) return;

        setTimeout(async () => {
            const dontShowAgain = vscode.l10n.t("Don't show this again");
            const selection = await vscode.window.showInformationMessage(
                vscode.l10n.t("Compiled file written to {0}", result.binaryPath!),
                vscode.l10n.t("Done"),
                dontShowAgain
            );

            if (selection === dontShowAgain) {
                await vscode.workspace.getConfiguration().update("makecode.showCompileNotification", false, vscode.ConfigurationTarget.Global)
            }
        }, 0)

    });
}

export async function installCommand() {
    console.log("Install command");

    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Installing project dependencies..."),
        cancellable: false
    }, async progress => {
        await installDependenciesAsync(workspace);

        await vscode.commands.executeCommand("makecode.refreshAssets");
        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
    });
}

async function cleanCommand() {
    console.log("Clean command");

    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Cleaning project folders..."),
        cancellable: false
    }, async progress => {
        await cleanProjectFolderAsync(workspace);
        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
    });
}

export async function importUrlCommand(url?: string, useWorkspace?: vscode.WorkspaceFolder, isTemplate?: boolean) {
    console.log("Import URL command");
    tickEvent("importUrl");

    const match = url && /^(?:S?\d{4}[\d\-]+|_[a-zA-Z0-9]{10,})$/.exec(url);
    let workspace = useWorkspace || (await chooseWorkspaceAsync("empty", !!match));
    if (!workspace) {
        if (match) {
            vscode.workspace.updateWorkspaceFolders(0, 0,
                {
                    uri: vscode.Uri.parse("mkcdfs:/" + url),
                    name: vscode.l10n.t("Imported Project ({0})", url)
                }
            );
            await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
        }
        return;
    }

    let toOpen = url;

    if (!toOpen) {
        toOpen = await vscode.window.showInputBox({
            prompt: vscode.l10n.t("Paste a shared project URL or GitHub repo")
        });

        if (!toOpen) {
            return;
        }
    }


    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: isTemplate ? vscode.l10n.t("Downloading template...") : vscode.l10n.t("Downloading URL..."),
        cancellable: false
    }, async progress => {
        try {
            await downloadSharedProjectAsync(workspace!, toOpen!);
        }
        catch (e) {
            showError(vscode.l10n.t("Unable to download project"));
            return;
        }

        await vscode.commands.executeCommand("makecode.refreshAssets");
        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
    });
}

async function pickHardwareVariantAsync(workspace: vscode.WorkspaceFolder) {
    const variants = await getHardwareVariantsAsync(workspace);

    if (variants.length <= 1) return;

    const qp = vscode.window.createQuickPick<HardwareQuickpick>();
    qp.items = variants;

    return new Promise<string>((resolve, reject) => {
        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0];
            qp.dispose();

            resolve(selected?.id);
        });
        qp.show();
    });
}

export async function simulateCommand(context: vscode.ExtensionContext) {
    const workspace = await chooseWorkspaceAsync("project");
    if (workspace) {
        setActiveWorkspace(workspace);
    }
    else {
        return;
    }
    let clearBuildListener: (() => void) | undefined;
    if (!BuildWatcher.watcher.isEnabled()) {
        let runSimulator: () => Promise<void>;
        let handleError: () => Promise<void>;
        clearBuildListener = () => {
            BuildWatcher.watcher.stop();
            BuildWatcher.watcher.removeEventListener("build-completed", runSimulator);
            BuildWatcher.watcher.removeEventListener("error", handleError);
        }
        runSimulator = async () => {
            if (!Simulator.currentSimulator) {
                clearBuildListener?.();
                return;
            }

            Simulator.currentSimulator.setPanelTitle(vscode.l10n.t("Arcade Simulator"));
            Simulator.currentSimulator.simulateAsync(await readFileAsync("built/binary.js", "utf8"));
        };
        handleError = async () => {
            if (!Simulator.currentSimulator) {
                clearBuildListener?.();
                return;
            }
            Simulator.currentSimulator?.setPanelTitle(vscode.l10n.t("{0} Arcade Simulator", "⚠️"));
            Simulator.currentSimulator?.stopSimulator();
        }
        BuildWatcher.watcher.addEventListener("build-completed", runSimulator);
        BuildWatcher.watcher.addEventListener("error", handleError);
        BuildWatcher.watcher.startWatching(workspace);
    }
    else {
        await BuildWatcher.watcher.buildNowAsync(workspace);
    }

    Simulator.createOrShow(context);
    if (clearBuildListener) {
        Simulator.currentSimulator!.addDisposable(new vscode.Disposable(clearBuildListener));
    }
}

async function createAssetCommand(type: string, displayName?: string) {
    if (displayName) {
        // called directly
        tickEvent("createasset");
    }
    AssetEditor.createOrShow();
    AssetEditor.currentEditor?.createAssetAsync(type, displayName);
}

async function duplicateAssetCommand(node: JResTreeNode) {
    tickEvent("duplicateAsset");
    AssetEditor.createOrShow();
    AssetEditor.currentEditor?.duplicateAssetAsync(node.kind, node.id!);
}

async function deleteAssetCommand(node: JResTreeNode) {
    tickEvent("deleteAsset");
    await deleteAssetAsync(node);
}

async function refreshAssetsCommand(justFireEvent: boolean) {
    tickEvent("refreshAssets");
    if (justFireEvent) {
        fireChangeEvent();
    }
    else {
        await syncJResAsync();
    }
}

interface HardwareQuickpick extends vscode.QuickPickItem {
    id: string;
}

interface TemplateQuickpick extends vscode.QuickPickItem {
    shareId?: string;
}

async function createCommand()  {
    console.log("Create command");

    const workspace = await chooseWorkspaceAsync("empty");
    if (!workspace) {
        return;
    }

    const qp = vscode.window.createQuickPick<TemplateQuickpick>();
    qp.busy = true;

    const options: TemplateQuickpick[] = [
        {
            label: vscode.l10n.t("Blank project")
        }
    ];

    qp.placeholder = vscode.l10n.t("Choose a template for this project");
    qp.items = options;

    const getTemplateOptionsAsync = async () => {
        const templates = await getProjectTemplatesAsync(workspace);

        qp.items = options.concat(
            templates.map(
                card => ({
                    label: card.name!,
                    shareId: card.url,
                    description: card.description
                })
            )
        );

        qp.busy = false;
    };

    getTemplateOptionsAsync();

    const input = await showQuickPickAsync(qp);

    if (!input) return;

    let projectName = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Enter a name for this project"),
        placeHolder: vscode.l10n.t("Untitled")
    });

    projectName = projectName || vscode.l10n.t("Untitled");

    if (input.shareId) {
        await importUrlCommand(input.shareId, workspace, true);
    }
    else {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t("Creating empty project..."),
            cancellable: false
        }, async progress => {
            try {
                await createEmptyProjectAsync(workspace, "arcade");
            }
            catch (e) {
                showError(vscode.l10n.t("Unable to create project"));
                return;
            }

            const mainTs = await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(
                    extensionContext.extensionUri,
                    "resources",
                    "template-main.txt"
                )
            );

            vscode.workspace.fs.writeFile(
                vscode.Uri.joinPath(workspace.uri, "main.ts"),
                mainTs
            );

            await vscode.commands.executeCommand("makecode.refreshAssets");
            await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
        });
    }

    await renameProjectAsync(workspace, projectName);
}

async function renameProjectAsync(workspace: vscode.WorkspaceFolder, newName: string) {
    const config = await getPxtJson(workspace);
    config.name = newName;
    await setPxtJson(workspace, config);
}

async function openAssetEditor(context: vscode.ExtensionContext, uri: vscode.Uri) {
    tickEvent("openAsset");
    AssetEditor.createOrShow();
    AssetEditor.currentEditor?.openURIAsync(uri);
}

async function shareCommandAsync() {
    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    const link = await shareProjectAsync(workspace);

    if (link) {
        try {
            await vscode.env.clipboard.writeText(link);
        } catch (e) {
            tickEvent("clipboard.failed");
        }
        const output = vscode.window.createOutputChannel("MakeCode");
        output.show();
        output.append(vscode.l10n.t("Congratulations! Your project is shared at {0} and has been copied into your clipboard.", link));
    }
}

async function createTutorialCommandAsync() {
    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    const title = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Enter a title for this tutorial"),
        placeHolder: vscode.l10n.t("My Tutorial")
    });

    if (!title) {
        return;
    }

    const starterRequest = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("What should AI help you get started with?"),
        placeHolder: vscode.l10n.t("Optional: outline a tutorial about collecting stars, teach loops, add 5 beginner steps...")
    });

    const uri = await createTutorialFileAsync(workspace, title);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await validateTutorialDocumentAsync(document);

    if (starterRequest) {
        if (!await openMakeCodeChatAsync("tutorial", document, starterRequest)) {
            await vscode.env.clipboard.writeText(buildAgentInvocationQuery("tutorial", document, starterRequest));
            vscode.window.showInformationMessage(vscode.l10n.t("The tutorial agent prompt was copied to the clipboard. Paste it into Chat to continue."));
        }
    }
}

async function addTutorialAssetsCommandAsync(uri?: vscode.Uri) {
    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    const document = await getTutorialDocumentAsync(uri);
    if (!document) {
        return;
    }

    const assetFiles = await createTutorialAssetJsonAsync(workspace);
    if (!Object.keys(assetFiles).length) {
        vscode.window.showInformationMessage(vscode.l10n.t("No generated MakeCode asset files were found in this project."));
        return;
    }

    const updatedText = updateTutorialAssetJsonSnippet(document.getText(), assetFiles);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), updatedText);
    await vscode.workspace.applyEdit(edit);
    await vscode.window.showTextDocument(document);
    await validateTutorialDocumentAsync(document);
}

async function editTutorialWithAICommandAsync(uri?: vscode.Uri) {
    const document = await getTutorialDocumentAsync(uri);
    if (!document) {
        return;
    }

    if (document.isDirty) {
        await document.save();
    }

    const request = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("What should AI help change in this tutorial?"),
        placeHolder: vscode.l10n.t("Improve pacing, add a step, check snippets, make instructions clearer...")
    });

    if (!request) {
        return;
    }

    if (!await openMakeCodeChatAsync("tutorial", document, request)) {
        await vscode.env.clipboard.writeText(buildAgentInvocationQuery("tutorial", document, request));
        vscode.window.showInformationMessage(vscode.l10n.t("The tutorial agent prompt was copied to the clipboard. Paste it into Chat to continue."));
    }
}

async function editProjectWithAICommandAsync(uri?: vscode.Uri) {
    const document = await getMainTsDocumentAsync(uri);
    if (!document) {
        return;
    }

    if (document.isDirty) {
        await document.save();
    }

    const request = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("What should AI help change in this MakeCode project?"),
        placeHolder: vscode.l10n.t("Add a feature, fix gameplay, improve code, use assets...")
    });

    if (!request) {
        return;
    }

    if (!await openMakeCodeChatAsync("project", document, request)) {
        await vscode.env.clipboard.writeText(buildAgentInvocationQuery("project", document, request));
        vscode.window.showInformationMessage(vscode.l10n.t("The project agent prompt was copied to the clipboard. Paste it into Chat to continue."));
    }
}

async function editSkillmapWithAICommandAsync(uri?: vscode.Uri) {
    const document = await getSkillmapDocumentAsync(uri);
    if (!document) {
        return;
    }

    if (document.isDirty) {
        await document.save();
    }

    const request = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("What should AI help change in this skillmap?"),
        placeHolder: vscode.l10n.t("Add a node, fix graph metadata, review tutorial links...")
    });

    if (!request) {
        return;
    }

    if (!await openMakeCodeChatAsync("skillmap", document, request)) {
        await vscode.env.clipboard.writeText(buildAgentInvocationQuery("skillmap", document, request));
        vscode.window.showInformationMessage(vscode.l10n.t("The skillmap agent prompt was copied to the clipboard. Paste it into Chat to continue."));
    }
}

async function previewTutorialCommandAsync(uri?: vscode.Uri) {
    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    const document = await getTutorialDocumentAsync(uri);
    if (!document) {
        return;
    }

    await validateTutorialDocumentAsync(document);
    setActiveWorkspace(workspace);
    MakeCodeEditor.createOrShow(true);
    try {
        await MakeCodeEditor.currentEditor?.previewTutorialAsync(document.getText());
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        showError(vscode.l10n.t("Unable to preview tutorial: {0}", message));
    }
}

async function shareTutorialCommandAsync(uri?: vscode.Uri) {
    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    const document = await getTutorialDocumentAsync(uri);
    if (!document) {
        return;
    }

    const diagnostics = await validateTutorialDocumentAsync(document);
    if (diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error)) {
        showError(vscode.l10n.t("Fix tutorial validation errors before sharing."));
        return;
    }

    const link = await shareTutorialAsync(workspace, document.getText());
    if (link) {
        try {
            await vscode.env.clipboard.writeText(link);
        } catch (e) {
            tickEvent("clipboard.failed");
        }
        const output = vscode.window.createOutputChannel("MakeCode");
        output.show();
        output.append(vscode.l10n.t("Congratulations! Your tutorial is shared at {0} and has been copied into your clipboard.", link));
    }
    else {
        showError(vscode.l10n.t("Unable to share tutorial."));
    }
}

async function validateTutorialCommandAsync(uri?: vscode.Uri) {
    const document = await getTutorialDocumentAsync(uri);
    if (!document) {
        return;
    }

    const diagnostics = await validateTutorialDocumentAsync(document);
    if (!diagnostics.length) {
        vscode.window.showInformationMessage(vscode.l10n.t("No tutorial validation issues found."));
    }
}

async function openTutorialDocsCommandAsync() {
    vscode.env.openExternal(vscode.Uri.parse("https://makecode.com/writing-docs/tutorials"));
}

async function getTutorialDocumentAsync(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (uri) {
        const document = await vscode.workspace.openTextDocument(uri);
        if (isTutorialDocument(document)) {
            rememberAuthoringDocuments(document);
            return document;
        }
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && isTutorialDocument(activeDocument)) {
        rememberAuthoringDocuments(activeDocument);
        return activeDocument;
    }

    const visibleDocument = vscode.window.visibleTextEditors.map(editor => editor.document).find(isTutorialDocument);
    if (visibleDocument) {
        rememberAuthoringDocuments(visibleDocument);
        return visibleDocument;
    }

    if (lastTutorialDocumentUri) {
        const lastDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === lastTutorialDocumentUri?.toString())
            || await openTextDocumentIfExistsAsync(lastTutorialDocumentUri);
        if (lastDocument && isTutorialDocument(lastDocument)) {
            return lastDocument;
        }
    }

    showError(vscode.l10n.t("Open a MakeCode tutorial Markdown file to use this command."));
    return undefined;
}

async function getMainTsDocumentAsync(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (uri) {
        const document = await vscode.workspace.openTextDocument(uri);
        if (isMainTsDocument(document)) {
            return document;
        }
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && isMainTsDocument(activeDocument)) {
        return activeDocument;
    }

    const visibleDocument = vscode.window.visibleTextEditors.map(editor => editor.document).find(isMainTsDocument);
    if (visibleDocument) {
        return visibleDocument;
    }

    const workspace = await chooseWorkspaceAsync("project");
    if (workspace) {
        const mainTsUri = vscode.Uri.joinPath(workspace.uri, "main.ts");
        const document = await openTextDocumentIfExistsAsync(mainTsUri);
        if (document && isMainTsDocument(document)) {
            return document;
        }
    }

    showError(vscode.l10n.t("Open main.ts in a MakeCode project to use this command."));
    return undefined;
}

function isMainTsDocument(document: vscode.TextDocument) {
    return document.languageId === "typescript" && /(^|\/)main\.ts$/i.test(document.uri.path);
}

async function getSkillmapDocumentAsync(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (uri) {
        const document = await vscode.workspace.openTextDocument(uri);
        if (isSkillmapFileDocument(document)) {
            rememberAuthoringDocuments(document);
            return document;
        }
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && isSkillmapFileDocument(activeDocument)) {
        rememberAuthoringDocuments(activeDocument);
        return activeDocument;
    }

    const visibleDocument = vscode.window.visibleTextEditors.map(editor => editor.document).find(isSkillmapFileDocument);
    if (visibleDocument) {
        rememberAuthoringDocuments(visibleDocument);
        return visibleDocument;
    }

    if (lastSkillmapDocumentUri) {
        const lastDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === lastSkillmapDocumentUri?.toString())
            || await openTextDocumentIfExistsAsync(lastSkillmapDocumentUri);
        if (lastDocument && isSkillmapFileDocument(lastDocument)) {
            return lastDocument;
        }
    }

    showError(vscode.l10n.t("Open a MakeCode skillmap Markdown file to use this command."));
    return undefined;
}

function isSkillmapFileDocument(document: vscode.TextDocument) {
    if (!isTutorialDocument(document)) {
        return false;
    }

    if (/\/docs\/skillmap\/[^/]+\.md$/i.test(document.uri.path)) {
        return true;
    }

    const text = document.getText();
    return /^#\s+\S/m.test(text)
        && /^##\s+\S/m.test(text)
        && /^###\s+\S/m.test(text)
        && /^\*\s+(type:\s*tutorial|layout:\s*|allowcodecarryover:|primarycolor:)/im.test(text);
}

function rememberAuthoringDocuments(document: vscode.TextDocument | undefined) {
    rememberTutorialDocument(document);
    rememberSkillmapDocument(document);
}

function rememberTutorialDocument(document: vscode.TextDocument | undefined) {
    if (document && isTutorialDocument(document)) {
        lastTutorialDocumentUri = document.uri;
    }
}

function rememberSkillmapDocument(document: vscode.TextDocument | undefined) {
    if (document && isSkillmapFileDocument(document)) {
        lastSkillmapDocumentUri = document.uri;
    }
}

function updateAuthoringFileContext(document = vscode.window.activeTextEditor?.document) {
    vscode.commands.executeCommand("setContext", "makecode.isTutorialFile", !!document && isTutorialFileDocument(document));
    vscode.commands.executeCommand("setContext", "makecode.isSkillmapFile", !!document && isSkillmapFileDocument(document));
}


function registerMakeCodeChatParticipant(context: vscode.ExtensionContext) {
    logMakeCodeChatDebug("MAKECODE_CHAT_PARTICIPANT_REGISTERING", {
        participantId: MAKECODE_CHAT_PARTICIPANT_ID,
        hasChatApi: !!vscode.chat,
        hasCreateChatParticipant: typeof vscode.chat?.createChatParticipant === "function"
    });

    const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
        logMakeCodeChatDebug("MAKECODE_CHAT_HANDLER_CALLED", {
            command: request.command,
            promptLength: request.prompt?.length ?? 0,
            referenceCount: request.references?.length ?? 0,
            historyLength: chatContext.history?.length ?? 0,
            cancelled: token.isCancellationRequested
        });

        try {
            if (token.isCancellationRequested) {
                return;
            }

            const agentKind = getAgentKindForChatRequest(request.command);
            lastMakeCodeAgentKind = agentKind;
            stream.progress(`Resolving MakeCode ${agentKind} context...`);

            const document = await withTimeout(getAgentDocumentAsync(agentKind, request, chatContext), 5000, "Timed out resolving MakeCode file context.");
            if (!document) {
                stream.markdown(getMissingAgentDocumentMessage(agentKind));
                return;
            }
            const documentVersion = document.version;

            stream.reference(document.uri);
            stream.progress("Building MakeCode prompt...");

            const prompt = buildAgentEditPrompt(
                await withTimeout(buildAgentPromptAsync(agentKind, document, request.prompt), 10000, "Timed out building the MakeCode prompt."),
                agentKind,
                document
            );

            const MAX_HISTORY_TURNS = 6;
            const MAX_HISTORY_CHARS = 12000;
            const messages: vscode.LanguageModelChatMessage[] = [];
            const recentHistory = (chatContext.history ?? []).slice(-MAX_HISTORY_TURNS);
            let historyCharBudget = MAX_HISTORY_CHARS;
            for (const turn of recentHistory) {
                if (historyCharBudget <= 0) {
                    break;
                }
                if (turn instanceof vscode.ChatResponseTurn) {
                    let response = turn.response
                        .map(part => part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : "")
                        .join("");
                    if (!response) {
                        continue;
                    }
                    if (response.length > historyCharBudget) {
                        response = response.slice(0, historyCharBudget);
                    }
                    historyCharBudget -= response.length;
                    messages.push(vscode.LanguageModelChatMessage.Assistant(response));
                }
            }

            stream.progress("Selecting language model...");

            const model: vscode.LanguageModelChat | undefined = (request as any).model;
            if (!model) {
                stream.markdown("Pick a language model in the chat input (the model picker next to the send button), then try `@makecode` again.");
                return;
            }

            messages.push(vscode.LanguageModelChatMessage.User(constrainPromptToModel(prompt, model)));

            stream.progress("Asking MakeCode agent...");

            if (token.isCancellationRequested) {
                return;
            }

            const response = await withTimeout(model.sendRequest(messages, {}, token), 20000, "Timed out starting the language model request.");
            let receivedResponse = false;
            let responseText = "";
            for await (const fragment of response.text) {
                if (token.isCancellationRequested) {
                    break;
                }
                receivedResponse = true;
                responseText += fragment;
            }

            if (!receivedResponse) {
                stream.markdown("The language model completed without returning text. Try a shorter request or choose another model.");
                return;
            }

            const parsedResponse = parseAgentEditResponse(responseText);
            if (!parsedResponse.updatedText) {
                stream.markdown(parsedResponse.message || "The MakeCode agent did not return file edits. Try asking for a concrete change to the active file.");
                return;
            }

            if (document.version !== documentVersion) {
                stream.markdown("The file changed while the MakeCode agent was working. Review the chat response and try again so I do not overwrite newer edits.");
                return;
            }

            if (parsedResponse.updatedText === document.getText()) {
                stream.markdown("The MakeCode agent did not make any changes to the file.");
                return;
            }

            const oldText = document.getText();
            const diffId = storeAgentDiff(document, oldText);
            stream.progress("Applying MakeCode edits...");
            await applyWholeDocumentEditAsync(document, parsedResponse.updatedText);
            await vscode.window.showTextDocument(document);
            await saveDocumentIfDirtyAsync(document);

            if (agentKind === "tutorial") {
                await validateTutorialDocumentAsync(document);
            }

            renderAgentEditResponse(agentKind, document, parsedResponse, diffId, stream);
            return createAgentChatResult(agentKind, document, parsedResponse.suggestions);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            stream.markdown(`The MakeCode agent could not complete the request: ${message}`);
        }
    };

    const participant = vscode.chat.createChatParticipant(MAKECODE_CHAT_PARTICIPANT_ID, handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "logo.svg");
    participant.followupProvider = {
        provideFollowups(result) {
            const metadata = getMakeCodeChatResultMetadata(result);
            if (!metadata?.suggestions.length) {
                return [];
            }

            return metadata.suggestions.map(suggestion => ({
                label: suggestion,
                prompt: suggestion,
                participant: MAKECODE_CHAT_PARTICIPANT_ID,
                command: metadata.agentKind
            }));
        }
    };
    context.subscriptions.push(participant);
    logMakeCodeChatDebug("MAKECODE_CHAT_PARTICIPANT_REGISTERED", {
        participantId: participant.id
    });
}

function getAgentKindForChatRequest(command: string | undefined): MakeCodeAgentKind {
    switch (command) {
        case "tutorial":
        case "project":
        case "skillmap":
            return command;
        default:
            return lastMakeCodeAgentKind || inferAgentKindFromWorkspaceContext() || "project";
    }
}

function inferAgentKindFromWorkspaceContext(): MakeCodeAgentKind | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (document) {
        if (isSkillmapFileDocument(document)) {
            return "skillmap";
        }
        if (isTutorialFileDocument(document)) {
            return "tutorial";
        }
        if (isMainTsDocument(document)) {
            return "project";
        }
    }

    const visibleDocuments = vscode.window.visibleTextEditors.map(editor => editor.document);
    if (visibleDocuments.some(isSkillmapFileDocument)) {
        return "skillmap";
    }
    if (visibleDocuments.some(isTutorialFileDocument)) {
        return "tutorial";
    }
    if (visibleDocuments.some(isMainTsDocument)) {
        return "project";
    }

    if (lastSkillmapDocumentUri) {
        return "skillmap";
    }
    if (lastTutorialDocumentUri) {
        return "tutorial";
    }

    return undefined;
}

async function getAgentDocumentAsync(agentKind: MakeCodeAgentKind, request?: vscode.ChatRequest, chatContext?: vscode.ChatContext) {
    const referencedDocument = await getReferencedAgentDocumentAsync(agentKind, request);
    if (referencedDocument) {
        return referencedDocument;
    }

    const historyDocument = await getAgentDocumentFromChatHistoryAsync(agentKind, chatContext);
    if (historyDocument) {
        return historyDocument;
    }

    return findAgentDocumentWithoutPrompting(agentKind);
}

async function getAgentDocumentFromChatHistoryAsync(agentKind: MakeCodeAgentKind, chatContext?: vscode.ChatContext) {
    const matcher = getAgentDocumentMatcher(agentKind);
    for (const turn of [...(chatContext?.history ?? [])].reverse()) {
        if (!(turn instanceof vscode.ChatResponseTurn)) {
            continue;
        }

        const metadata = getMakeCodeChatResultMetadata(turn.result);
        if (metadata?.agentKind !== agentKind) {
            continue;
        }

        const document = await openTextDocumentIfExistsAsync(vscode.Uri.parse(metadata.uri));
        if (document && matcher(document)) {
            return document;
        }
    }

    return undefined;
}

function findAgentDocumentWithoutPrompting(agentKind: MakeCodeAgentKind) {
    const matcher = getAgentDocumentMatcher(agentKind);
    const lastUri = agentKind === "tutorial" ? lastTutorialDocumentUri
        : agentKind === "skillmap" ? lastSkillmapDocumentUri
            : undefined;

    const active = vscode.window.activeTextEditor?.document;
    if (active && matcher(active)) {
        return active;
    }

    const visible = vscode.window.visibleTextEditors.map(editor => editor.document).find(matcher);
    if (visible) {
        return visible;
    }

    if (lastUri) {
        const cached = vscode.workspace.textDocuments.find(document => document.uri.toString() === lastUri.toString());
        if (cached && matcher(cached)) {
            return cached;
        }
    }

    return undefined;
}

function getAgentDocumentMatcher(agentKind: MakeCodeAgentKind): (document: vscode.TextDocument) => boolean {
    switch (agentKind) {
        case "tutorial":
            return isTutorialDocument;
        case "skillmap":
            return isSkillmapFileDocument;
        case "project":
        default:
            return isMainTsDocument;
    }
}

async function getReferencedAgentDocumentAsync(agentKind: MakeCodeAgentKind, request?: vscode.ChatRequest) {
    for (const reference of request?.references ?? []) {
        const uri = getUriFromChatReference(reference);
        if (!uri) {
            continue;
        }

        const document = await openTextDocumentIfExistsAsync(uri);
        if (!document) {
            continue;
        }

        if ((agentKind === "tutorial" && isTutorialDocument(document))
            || (agentKind === "skillmap" && isSkillmapFileDocument(document))
            || (agentKind === "project" && isMainTsDocument(document))) {
            rememberAuthoringDocuments(document);
            return document;
        }
    }

    return undefined;
}

function getUriFromChatReference(reference: vscode.ChatPromptReference) {
    if (reference.value instanceof vscode.Uri) {
        return reference.value;
    }

    if (reference.value instanceof vscode.Location) {
        return reference.value.uri;
    }

    return undefined;
}

async function buildAgentPromptAsync(agentKind: MakeCodeAgentKind, document: vscode.TextDocument, request: string) {
    const options = {
        extensionUri: extensionContext.extensionUri,
        document,
        request,
        selection: getActiveSelectionText(document)
    };

    switch (agentKind) {
        case "tutorial":
            return buildTutorialAgentQueryAsync(options);
        case "skillmap":
            return buildSkillmapAgentQueryAsync(options);
        case "project":
        default:
            return buildProjectAgentQueryAsync(options);
    }
}

function buildAgentEditPrompt(basePrompt: string, agentKind: MakeCodeAgentKind, document: vscode.TextDocument) {
    const relativePath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    const language = agentKind === "project" ? "typescript" : "markdown";

    return `${basePrompt}

You are editing exactly this file: ${relativePath}

Return the complete updated contents of that file between <makecode-file> and </makecode-file> tags. Do not return a diff. Also return a one sentence summary between <makecode-summary> and </makecode-summary> tags. Then return 2 or 3 concise future content or feature ideas in separate <makecode-suggestion> tags. Suggestions must propose edits, additions, or clarifications to this file only. Do not suggest validation, previewing, running the simulator, saving files, compiling, building, testing, committing, installing dependencies, or other operational tasks. If you cannot safely edit the file, return a short explanation between <makecode-message> and </makecode-message> tags instead.

Current ${language} file contents:
<makecode-current-file>
${document.getText()}
</makecode-current-file>`;
}

function parseAgentEditResponse(responseText: string): { updatedText?: string; message?: string; summary?: string; suggestions: string[] } {
    const fileMatch = /<makecode-file>([\s\S]*?)<\/makecode-file>/i.exec(responseText);
    const summaryMatch = /<makecode-summary>([\s\S]*?)<\/makecode-summary>/i.exec(responseText);
    const suggestions = Array.from(responseText.matchAll(/<makecode-suggestion>([\s\S]*?)<\/makecode-suggestion>/gi))
        .map(match => match[1].trim())
        .filter(suggestion => !!suggestion && !isOperationalSuggestion(suggestion))
        .slice(0, 3);

    if (fileMatch) {
        return {
            updatedText: normalizeAgentFileText(fileMatch[1]),
            summary: summaryMatch?.[1].trim(),
            suggestions
        };
    }

    const messageMatch = /<makecode-message>([\s\S]*?)<\/makecode-message>/i.exec(responseText);
    if (messageMatch) {
        return { message: messageMatch[1].trim(), suggestions: [] };
    }

    const fencedFileMatch = /```(?:makecode-file|typescript|ts)\s*\r?\n([\s\S]*?)\r?\n```/i.exec(responseText);
    if (fencedFileMatch) {
        return { updatedText: normalizeAgentFileText(fencedFileMatch[1]), suggestions: [] };
    }

    return { suggestions: [] };
}

function isOperationalSuggestion(suggestion: string) {
    const normalized = suggestion.trim().toLowerCase().replace(/\s+/g, " ");
    return /^(?:validate|check|verify|lint|scan|audit|review)\b.*\b(?:tutorial|markdown|syntax|code|errors?|changes?|file)\b/.test(normalized)
        || /^(?:run|execute|launch|start|open)\b.*\b(?:simulator|project|preview|tests?|debugger?|compilation|build)\b/.test(normalized)
        || /^(?:test|debug|profile|benchmark|try)\b.*\b(?:code|changes?|project|result|output|game)\b/.test(normalized)
        || /^(?:preview|watch|view|display|show|render|open)\b.*\b(?:tutorial|preview|result|changes?|output|panel|editor|simulator)\b/.test(normalized)
        || /^(?:save|commit|push|upload|export|download)\b.*\b(?:file|changes?|project|code|assets?)\b/.test(normalized)
        || /^(?:compile|build|make|generate|process|transpile)\b.*\b(?:project|code|file|changes?|typescript|markdown)\b/.test(normalized)
        || /^(?:install|add|remove|update|manage)\b.*\b(?:dependencies|packages|extensions|assets?)\b/.test(normalized)
        || /^(?:format|lint|beautify)\b.*\b(?:code|file|formatting|indentation)\b/.test(normalized)
        || /^next\b.*\b(?:run|test|validate|validation|build|preview|simulator)\b/.test(normalized);
}

function normalizeAgentFileText(text: string) {
    return text.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

async function applyWholeDocumentEditAsync(document: vscode.TextDocument, updatedText: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), updatedText);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
        throw new Error("VS Code rejected the file edit.");
    }
}

async function saveDocumentIfDirtyAsync(document: vscode.TextDocument) {
    if (document.isDirty) {
        await document.save();
    }
}

function storeAgentDiff(document: vscode.TextDocument, oldText: string) {
    const diffId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    makeCodeAgentDiffs.set(diffId, {
        uri: document.uri,
        oldText,
        title: vscode.l10n.t("MakeCode Agent Changes: {0}", vscode.workspace.asRelativePath(document.uri, false))
    });
    return diffId;
}

function renderAgentEditResponse(agentKind: MakeCodeAgentKind, document: vscode.TextDocument, response: { summary?: string; suggestions: string[] }, diffId: string, stream: vscode.ChatResponseStream) {
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    const summary = response.summary?.trim() || `Updated ${relativePath}.`;
    stream.reference(document.uri);
    stream.filetree(buildFileTreeForDocument(document), getFileTreeBaseUri(document));

    stream.markdown(`### Summary\n\n${summary}\n\n### Review\n\n`);
    stream.button({
        title: vscode.l10n.t("View Changes"),
        command: "makecode.openAgentDiff",
        arguments: [diffId]
    });

    const previewButton = getAgentPreviewButton(agentKind, document);
    if (previewButton) {
        stream.button(previewButton);
    }
}

function createAgentChatResult(agentKind: MakeCodeAgentKind, document: vscode.TextDocument, suggestions: string[]): vscode.ChatResult {
    const metadata: MakeCodeChatResultMetadata = {
        agentKind,
        uri: document.uri.toString(),
        suggestions: suggestions.map(suggestion => suggestion.trim()).filter(Boolean)
    };
    return {
        metadata: {
            [MAKECODE_CHAT_RESULT_METADATA_KEY]: metadata
        }
    };
}

function getMakeCodeChatResultMetadata(result: vscode.ChatResult): MakeCodeChatResultMetadata | undefined {
    const metadata = result.metadata?.[MAKECODE_CHAT_RESULT_METADATA_KEY] as MakeCodeChatResultMetadata | undefined;
    if (!metadata || !isMakeCodeAgentKind(metadata.agentKind) || !metadata.uri || !Array.isArray(metadata.suggestions)) {
        return undefined;
    }

    return {
        agentKind: metadata.agentKind,
        uri: metadata.uri,
        suggestions: metadata.suggestions.map(suggestion => String(suggestion).trim()).filter(Boolean).slice(0, 3)
    };
}

function isMakeCodeAgentKind(value: unknown): value is MakeCodeAgentKind {
    return value === "project" || value === "tutorial" || value === "skillmap";
}

function getAgentPreviewButton(agentKind: MakeCodeAgentKind, document: vscode.TextDocument): vscode.Command | undefined {
    switch (agentKind) {
        case "project":
            return {
                title: vscode.l10n.t("Open Simulator"),
                command: "makecode.openAgentPreview",
                arguments: [{ agentKind, uri: document.uri.toString() }]
            };
        case "tutorial":
            return {
                title: vscode.l10n.t("Open Tutorial Preview"),
                command: "makecode.openAgentPreview",
                arguments: [{ agentKind, uri: document.uri.toString() }]
            };
        case "skillmap":
            return undefined;
    }
}

function buildFileTreeForDocument(document: vscode.TextDocument): vscode.ChatResponseFileTree[] {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const relativePath = (workspaceFolder ? vscode.workspace.asRelativePath(document.uri, false) : getFileName(document.uri)).replace(/\\/g, "/");
    const pathParts = relativePath.split("/").filter(Boolean);

    return pathParts.reduceRight<vscode.ChatResponseFileTree[]>((children, name) => [{
        name,
        children: children.length ? children : undefined
    }], []);
}

function getFileTreeBaseUri(document: vscode.TextDocument) {
    return vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? document.uri;
}

function getFileName(uri: vscode.Uri) {
    const path = uri.path || uri.fsPath;
    return path.split(/[\\/]/).filter(Boolean).pop() || "file";
}

async function openAgentPreviewAsync(agentKind: MakeCodeAgentKind, uri: vscode.Uri | undefined, context: vscode.ExtensionContext) {
    switch (agentKind) {
        case "tutorial":
            await previewTutorialCommandAsync(uri);
            return;
        case "project":
            await simulateCommand(context);
            return;
        case "skillmap":
            vscode.window.showInformationMessage(vscode.l10n.t("No MakeCode skillmap preview is available yet."));
            return;
    }
}

function buildAgentInvocationQuery(agentKind: MakeCodeAgentKind, document: vscode.TextDocument, request: string) {
    const relativePath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
    return `@makecode /${agentKind} ${request}\n\nUse #file:${relativePath} as the primary file context.`;
}

function getMissingAgentDocumentMessage(agentKind: MakeCodeAgentKind) {
    switch (agentKind) {
        case "tutorial":
            return vscode.l10n.t("Open a MakeCode tutorial Markdown file, then ask @makecode /tutorial again.");
        case "skillmap":
            return vscode.l10n.t("Open a MakeCode skillmap Markdown file, then ask @makecode /skillmap again.");
        case "project":
        default:
            return vscode.l10n.t("Open main.ts in a MakeCode project, then ask @makecode /project again.");
    }
}

function constrainPromptToModel(prompt: string, model: vscode.LanguageModelChat) {
    const maxPromptChars = Math.max(4000, Math.min(32000, Math.floor(model.maxInputTokens * 3)));
    if (prompt.length <= maxPromptChars) {
        return prompt;
    }

    const headLength = Math.floor(maxPromptChars * 0.7);
    const tailLength = maxPromptChars - headLength;
    return prompt.substring(0, headLength)
        + "\n\n---\nThe bundled prompt was shortened to fit the selected model context. Preserve the instructions above and the active file request below.\n---\n\n"
        + prompt.substring(prompt.length - tailLength);
}

function getActiveSelectionText(document: vscode.TextDocument) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== document.uri.toString() || editor.selection.isEmpty) {
        return "";
    }

    const text = document.getText(editor.selection).trim();
    return text.length > 2000 ? text.substring(0, 2000) + "\n..." : text;
}

async function openMakeCodeChatAsync(agentKind: MakeCodeAgentKind, document: vscode.TextDocument, request: string) {
    const query = buildAgentInvocationQuery(agentKind, document, request);
    logMakeCodeChatDebug("MAKECODE_CHAT_OPEN_REQUEST", {
        participantId: MAKECODE_CHAT_PARTICIPANT_ID,
        slashCommand: agentKind,
        queryLength: query.length
    });

    try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
            query,
            isPartialQuery: false,
            mode: "ask"
        });
        return true;
    }
    catch (e) {
        logMakeCodeChatDebug("MAKECODE_CHAT_OPEN_FAILED", {
            message: e instanceof Error ? e.message : String(e)
        });
        return false;
    }
}

async function openTextDocumentIfExistsAsync(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    try {
        return await vscode.workspace.openTextDocument(uri);
    }
    catch (e) {
        return undefined;
    }
}

async function validateTutorialDocumentAsync(document: vscode.TextDocument) {
    const issues = validateTutorialMarkdown(document.getText());
    const diagnostics = issues.map(issue => {
        const line = document.lineAt(Math.min(issue.line, document.lineCount - 1));
        const range = new vscode.Range(
            line.lineNumber,
            Math.min(issue.startColumn, line.text.length),
            line.lineNumber,
            Math.min(issue.endColumn, line.text.length)
        );
        const diagnostic = new vscode.Diagnostic(range, issue.message, issue.severity);
        diagnostic.source = "MakeCode Tutorials";
        return diagnostic;
    });

    tutorialDiagnosticsCollection.set(document.uri, diagnostics);
    return diagnostics;
}

export interface ExtensionInfo {
    id: string;
    label: string;
    detail?: string;
}

async function addDependencyCommandAsync() {
    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }
    const qp = vscode.window.createQuickPick<ExtensionInfo>();
    qp.busy = true;
    let defaultPreferredExtensions: ExtensionInfo[] = [];
    const getExtensionInfoAsync = async () => {
        const pxtJson = await getPxtJson(workspace);
        const deps = pxtJson?.dependencies ?? {};
        const currentBuiltinDeps = Object.keys(deps).filter(dep => deps[dep] === "*");
        const currentGhDeps = Object.keys(deps)
            .filter(dep => deps[dep].startsWith("github:"))
            .map(dep => /^github:([^#]+)/.exec(deps[dep])?.[1]?.toLowerCase());

        const targetConfig = await getTargetConfigAsync(workspace);
        const approvedRepoLib = targetConfig?.packages?.approvedRepoLib ?? {};
        const builtInRepo = targetConfig?.packages?.builtinExtensionsLib ?? {};
        const preferredExts = Object.keys(builtInRepo)
            .filter(builtin => builtInRepo[builtin]?.preferred && currentBuiltinDeps.indexOf(builtin) === -1)
            .concat(Object.keys(approvedRepoLib)
                .filter(repo => approvedRepoLib[repo]?.preferred
                    && currentGhDeps.indexOf(repo) === -1
                )
            );
        defaultPreferredExtensions = preferredExts.map(ext => ({
            id: ext,
            label: ext
        }));
        const newQpItems = [
            ...defaultPreferredExtensions
        ];
        if (!!qp.value) {
            const userEnteredSuggestion = {
                id: qp.value,
                label: qp.value,
            };
            newQpItems.unshift(userEnteredSuggestion);
        }
        qp.items = newQpItems;
        qp.busy = false;
    }

    // Kick this off, but don't wait;
    // user could theoretically enter a repo and submit before this completes.
    /** await **/ getExtensionInfoAsync();

    qp.items = defaultPreferredExtensions;
    qp.placeholder = vscode.l10n.t("Enter the GitHub repo or name of the extension to add");

    const input = await new Promise<string>((resolve, reject) => {
        qp.onDidChangeValue(() => {
            if (!qp.items.find(item => item.label === qp.value)) {
                // inject to allow custom values to be entered
                const userEnteredSuggestion = {
                    id: qp.value,
                    label: qp.value,
                };
                qp.items = [
                    userEnteredSuggestion,
                    ...defaultPreferredExtensions
                ].filter(el => !!el.id);
            }
        });
        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0] || qp.value;
            qp.dispose();
            resolve(selected?.id);
        });
        qp.show();
    });

    if (!input) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Adding Extension..."),
        cancellable: false
    }, async progress => {
        try {
            await addDependencyAsync(workspace, input);
        }
        catch (e) {
            showError(vscode.l10n.t("Unable to add dependency. Are you connected to the Internet?"));
            return;
        }
    });
}



async function removeDependencyCommandAsync() {
    const workspace = await chooseWorkspaceAsync("project");
    if (!workspace) {
        return;
    }

    const pxtJson = await getPxtJson(workspace);

    const extensions: vscode.QuickPickItem[] = Object.keys(pxtJson.dependencies).map(depName => {
        return {
            label: depName,
            description: pxtJson.dependencies[depName]
        }
    });

    const toRemove = await vscode.window.showQuickPick(extensions, {
        title: vscode.l10n.t("Choose which extensions to remove from this project"),
        canPickMany: true
    });

    if (!toRemove?.length) return;

    for (const ext of toRemove) {
        delete pxtJson.dependencies[ext.label];
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Removing Extensions..."),
        cancellable: false
    }, async () => {
        await setPxtJson(workspace, pxtJson);

        try {
            vscode.workspace.fs.delete(vscode.Uri.joinPath(workspace.uri, "pxt_modules"), {
                recursive: true
            });
        }
        catch (e) {

        }

        await installDependenciesAsync(workspace);

        await vscode.commands.executeCommand("makecode.refreshAssets");
        await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
    })
}

function openHelpDocs() {
    vscode.env.openExternal(vscode.Uri.parse("https://github.com/microsoft/vscode-makecode#microsoft-makecode-extension-for-visual-studio-code"));
}

async function testBlocksCommandAsync() {
    MakeCodeEditor.createOrShow();
}

// This method is called when your extension is deactivated
export function deactivate() {}


function showError(message: string) {
    vscode.window.showErrorMessage(message);
}

export async function fileExistsAsync(path: vscode.Uri) {
    try {
        const stat = await vscode.workspace.fs.stat(path);
        return true;
    }
    catch {
        return false;
    }
}

export function clearBuildErrors() {
    diagnosticsCollection.clear();
}

export function reportBuildErrors(res: CompileResult) {
    const diagnostics: {[index: string]: vscode.Diagnostic[]} = {};

    for (const d of res.diagnostics) {
        const range = new vscode.Range(d.line, d.column, d.endLine ?? d.line, d.endColumn ?? d.column);

        let message: string;

        if (typeof d.messageText === "string") {
            message = d.messageText;
        }
        else {
            let diagnosticChain = d.messageText;
            message = "";

            let indent = 0;
            while (diagnosticChain) {
                if (indent) {
                    message += "\n";

                    for (let i = 0; i < indent; i++) {
                        message += "  ";
                    }
                }
                message += diagnosticChain.messageText;
                indent++;
                diagnosticChain = diagnosticChain.next!;
            }
        }

        if (!diagnostics[d.fileName]) {
            diagnostics[d.fileName] = [];
        }

        diagnostics[d.fileName].push(new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error));
    }

    for (const filename of Object.keys(diagnostics)) {
        const uri = vscode.Uri.joinPath(activeWorkspace().uri, filename);
        diagnosticsCollection.set(uri, diagnostics[filename]);
    }
}

export function tickEvent(
    eventName: string,
    properties?: { [key: string]: string },
    measurements?: { [key: string]: number }
) {
    const baseProperties = {
        "target": "arcade"
    };
    applicationInsights?.sendTelemetryEvent(
        eventName,
        {
            ...baseProperties,
            ...(properties || {})
        },
        measurements
    );
}

function withTimeout<T>(promise: Thenable<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            value => {
                clearTimeout(timeout);
                resolve(value);
            },
            error => {
                clearTimeout(timeout);
                reject(error);
            }
        );
    });
}