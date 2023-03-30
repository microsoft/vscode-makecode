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
import { getPxtJson, readTextFileAsync, setPxtJson, showQuickPickAsync, writeTextFileAsync } from "./util";
import { VFS } from "./vfs";
import TelemetryReporter from "@vscode/extension-telemetry";
import { codeActionsProvider } from "./codeActionsProvider";
import { MakeCodeEditor } from "./editor";

let diagnosticsCollection: vscode.DiagnosticCollection;
let applicationInsights: TelemetryReporter;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    setHost(createVsCodeHost());

    const addCmd = (id: string, fn: () => Promise<void>) => {
        const cmd = vscode.commands.registerCommand(id, () => {
            const mkcdTickPrefix = "makecode.";
            if (id.startsWith(mkcdTickPrefix)) {
                tickEvent(id.slice(mkcdTickPrefix.length));
            }
            return fn().catch(err => {
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

    const vfs = new VFS(context);
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider("mkcdfs", vfs, { isCaseSensitive: true }));

    addCmd("makecode.build", buildCommand);
    addCmd("makecode.simulate", () => simulateCommand(context));
    addCmd("makecode.create", createCommand);
    addCmd("makecode.install", installCommand);
    addCmd("makecode.clean", cleanCommand);
    addCmd("makecode.shareProject", shareCommandAsync);
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

    maybeShowConfigNotificationAsync();
    maybeShowDependenciesNotificationAsync();

    // Set a context key to indicate that we have activated, so context menu commands can show
    vscode.commands.executeCommand('setContext', 'makecode.extensionActive', true);
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