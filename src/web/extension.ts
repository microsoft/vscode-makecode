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
import { buildProjectAsync, cleanProjectFolderAsync, createEmptyProjectAsync, downloadSharedProjectAsync, installDependenciesAsync, listHardwareVariantsAsync } from "./makecodeOperations";
import { ActionsTreeViewProvider } from "./actionsTreeView";
import { BuildOptions } from "makecode-core/built/commands";
import { getHardwareVariantsAsync } from "./hardwareVariants";
import { shareProjectAsync } from "./shareLink";


let diagnosticsCollection: vscode.DiagnosticCollection;
export function activate(context: vscode.ExtensionContext) {
    setHost(createVsCodeHost());
    console.log("Congratulations, your extension 'pxt-vscode-web' is now active in the web extension host!");

    const addCmd = (id: string, fn: () => Promise<void>) => {
        const cmd = vscode.commands.registerCommand(id, () => fn()
            .catch( err => {
                console.error("MakeCode Ext Exception", err);
            }));
        context.subscriptions.push(cmd);
    };

    Simulator.register(context);
    AssetEditor.register(context);
    BuildWatcher.register(context);

    addCmd("makecode.build", buildCommand);
    addCmd("makecode.simulate", () => simulateCommand(context));
    addCmd("makecode.choosehw", choosehwCommand);
    addCmd("makecode.create", createCommand);
    addCmd("makecode.install", installCommand);
    addCmd("makecode.clean", cleanCommand);
    addCmd("makecode.importUrl", importUrlCommand);
    addCmd("makecode.shareProject", shareCommandAsync);

    addCmd("makecode.createImage", () => createAssetCommand("image"));
    addCmd("makecode.createTile", () => createAssetCommand("tile"));
    addCmd("makecode.createTilemap", () => createAssetCommand("tilemap"));
    addCmd("makecode.createAnimation", () => createAssetCommand("animation"));
    addCmd("makecode.createSong", () => createAssetCommand("song"));

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

    BuildWatcher.watcher.addEventListener("error", showError);

    diagnosticsCollection = vscode.languages.createDiagnosticCollection("MakeCode");
    context.subscriptions.push(diagnosticsCollection);

    maybeShowConfigNotificationAsync();
    maybeShowDependenciesNotificationAsync();
}

async function chooseWorkspaceAsync(onlyProjects: boolean): Promise<vscode.WorkspaceFolder | undefined> {
    if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showInformationMessage("Open a workspace to use this command");
        return;
    }

    let folders = onlyProjects ? [] : vscode.workspace.workspaceFolders.slice();

    if (onlyProjects) {
        for (const folder of vscode.workspace.workspaceFolders) {
            if (await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "pxt.json"))) {
                folders.push(folder);
            }
        }
    }

    if (folders.length === 0) {
        showError("You must have a MakeCode project open to use this command");
        return;
    }
    else if (folders.length === 1) {
        return folders[0];
    }

    const choice = await vscode.window.showQuickPick(folders.map(f => f.name), { placeHolder: "Choose a workspace" });

    for (const folder of folders) {
        if (folder.name === choice) {
            return folder;
        }
    }

    return undefined;
}

async function buildCommand() {
    console.log("Build command");

    const workspace = await chooseWorkspaceAsync(true);
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
        title: "Building project...",
        cancellable: false
    }, async () => {
        const result = await buildProjectAsync(workspace, opts);

        if (result.diagnostics.length) {
            reportBuildErrors(result);
        }
    });
}

export async function installCommand() {
    console.log("Install command");

    const workspace = await chooseWorkspaceAsync(true);
    if (!workspace) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Installing project dependencies...",
        cancellable: false
    }, async progress => {
        await installDependenciesAsync(workspace);
    });
}

async function cleanCommand() {
    console.log("Clean command");

    const workspace = await chooseWorkspaceAsync(true);
    if (!workspace) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Cleaning project folders...",
        cancellable: false
    }, async progress => {
        await cleanProjectFolderAsync(workspace);
    });
}

async function importUrlCommand() {
    console.log("Import URL command");

    const workspace = await chooseWorkspaceAsync(true);
    if (!workspace) {
        return;
    }

    const input = await vscode.window.showInputBox({
        prompt: "Paste a shared project URL or GitHub repo"
    });

    if (!input) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Downloading URL...",
        cancellable: false
    }, async progress => {
        try {
            await downloadSharedProjectAsync(workspace, input);
        }
        catch (e) {
            showError("Unable to download project");
            return;
        }

        progress.report({
            message: "Creating tsconfig.json..."
        });

        await writeTSConfigAsync(workspace.uri);

        progress.report({
            message: "Installing dependencies..."
        });

        try {
            await installDependenciesAsync(workspace);
        }
        catch (e) {
            showError("Unable to install project dependencies");
        }
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
    const workspace = await chooseWorkspaceAsync(false);
    if (workspace) {
        setActiveWorkspace(workspace);
    }
    else {
        return;
    }

    if (!BuildWatcher.watcher.isEnabled()) {
        const runSimulator = async () => {
            if (!Simulator.currentSimulator) {
                BuildWatcher.watcher.stop();
                BuildWatcher.watcher.removeEventListener("build-completed", runSimulator);
                return;
            }

            Simulator.createOrShow(context);
            Simulator.currentSimulator.simulateAsync(await readFileAsync("built/binary.js", "utf8"));
        };
        BuildWatcher.watcher.addEventListener("build-completed", runSimulator);
        BuildWatcher.watcher.startWatching(workspace);
    }
    else {
        await BuildWatcher.watcher.buildNowAsync(workspace);
    }

    Simulator.createOrShow(context);
}

async function createAssetCommand(type: string) {
    AssetEditor.createOrShow();
    AssetEditor.currentSimulator?.createAssetAsync(type);
}

async function duplicateAssetCommand(node: JResTreeNode) {
    AssetEditor.createOrShow();
    AssetEditor.currentSimulator?.duplicateAssetAsync(node.kind, node.id!);
}

async function deleteAssetCommand(node: JResTreeNode) {
    await deleteAssetAsync(node);
}

async function refreshAssetsCommand(justFireEvent: boolean) {
    if (justFireEvent) {
        fireChangeEvent();
    }
    else {
        await syncJResAsync();
    }
}

async function choosehwCommand() {
    console.log("Choose hardware command");
}

interface HardwareQuickpick extends vscode.QuickPickItem {
    id: string;
}

async function createCommand()  {
    console.log("Create command");

    const workspace = await chooseWorkspaceAsync(true);
    if (!workspace) {
        return;
    }

    const qp = vscode.window.createQuickPick<HardwareQuickpick>();

    qp.items = [
        {
            label: "MakeCode Arcade",
            detail: "Create a retro-style video game",
            id: "arcade"
        },
        {
            label: "Micro:bit",
            detail: "Create a project for the Micro:bit",
            id: "microbit"
        }
    ];

    qp.onDidAccept(() => {
        const selected = qp.selectedItems[0];
        qp.dispose();

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Creating project...",
            cancellable: false
        }, async progress => {
            try {
                await createEmptyProjectAsync(workspace, selected.id);
            }
            catch (e) {
                showError("Unable to create project");
                return;
            }

            progress.report({
                message: "Installing dependencies..."
            });

            try {
                await installDependenciesAsync(workspace);
            }
            catch (e) {
                showError("Unable to install project dependencies");
            }
        });
    });

    qp.show();
}

async function openAssetEditor(context: vscode.ExtensionContext, uri: vscode.Uri) {
    AssetEditor.createOrShow();
    AssetEditor.currentSimulator?.openURIAsync(uri);
}

async function shareCommandAsync() {
    const workspace = await chooseWorkspaceAsync(true);
    if (!workspace) {
        return;
    }

    const link = await shareProjectAsync(workspace);

    if (link) {
        const output = vscode.window.createOutputChannel("MakeCode");
        output.show();
        output.append("Congratulations! Your project is shared at " + link)
    }
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