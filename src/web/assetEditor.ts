import * as vscode from "vscode";
import { readFileAsync, writeFileAsync } from "./host";
import { syncJResAsync } from "./jres";

let extensionContext: vscode.ExtensionContext;
// const assetUrl = "http://localhost:3232/asseteditor.html";
const assetUrl = "https://arcade.makecode.com/beta--asseteditor";

interface EditingState {
    type: "edit";
    assetType: string;
    assetId: string;
}

interface DuplicatingState {
    type: "duplicate";
    assetType: string;
    assetId: string;
}

interface CreatingState {
    type: "create";
    assetType: string;
}

type AssetEditorState = EditingState | DuplicatingState | CreatingState;

export class AssetEditor {
    public static readonly viewType = "mkcdasset";
    public static currentSimulator: AssetEditor | undefined;
    public simStateTimer: any;

    public static createOrShow() {
        let column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
        column = column! < 9 ? column! + 1 : column;

        if (AssetEditor.currentSimulator) {
            AssetEditor.currentSimulator.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(AssetEditor.viewType, "Microsoft MakeCode Asset Editor", {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true
        });

        AssetEditor.currentSimulator = new AssetEditor(panel)
    }

    public static register(context: vscode.ExtensionContext) {
        extensionContext = context;
        vscode.window.registerWebviewPanelSerializer('mkcdasset', new AssetEditorSerializer());
    }

    public static revive(panel: vscode.WebviewPanel) {
        AssetEditor.currentSimulator = new AssetEditor(panel)
    }

    protected panel: vscode.WebviewPanel;
    protected editing: AssetEditorState | undefined;
    protected disposables: vscode.Disposable[];
    protected pendingMessages: {[index: string]: (res: any) => void} = {};
    protected nextId = 0;

    constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;

        this.panel.webview.onDidReceiveMessage(message => {
            this.handleSimulatorMessage(message);
        });

        this.panel.onDidDispose(() => {
            if (AssetEditor.currentSimulator === this) {
                AssetEditor.currentSimulator = undefined;
            }

            this.disposables.forEach(d => d.dispose());
        });

        this.disposables = [];
    }

    async openURIAsync(uri: vscode.Uri) {
        const parts = uri.path.split(".");
        const assetType = parts[1];
        const assetId = parts.slice(2).join(".");

        await this.openAssetAsync(assetType, assetId);
    }

    async openAssetAsync(assetType: string, assetId: string) {
        this.editing = {
            type: "edit",
            assetType,
            assetId
        };

        await this.initWebviewHtmlAsync();
    }

    async duplicateAssetAsync(assetType: string, assetId: string) {
        this.editing = {
            type: "duplicate",
            assetType,
            assetId
        };

        await this.initWebviewHtmlAsync();
    }

    async createAssetAsync(assetType: string) {
        this.editing = {
            type: "create",
            assetType
        };

        await this.initWebviewHtmlAsync();
    }

    handleSimulatorMessage(message: any) {
        if (this.pendingMessages[message.id]) {
            this.pendingMessages[message.id](message);
            delete this.pendingMessages[message.id];
            return;
        }

        switch (message.type) {
            case "event":
                this.handleSimulatorEventAsync(message);
                break;
        }
    }

    async handleSimulatorEventAsync(message: any) {
        switch (message.kind) {
            case "ready":
                await this.onReadyMessageReceivedAsync();
                break;
            case "done-clicked":
                const saved = await this.sendMessageAsync({
                    type: "save"
                });
                await saveFilesAsync(saved.files);
                break;
        }
    }

    sendMessageAsync(message: any) {
        message._fromVscode = true;
        message.id = this.nextId++;

        return new Promise<any>(resolve => {
            this.pendingMessages[message.id] = resolve;
            this.panel.webview.postMessage(message);
        })
    }

    addDisposable(d: vscode.Disposable) {
        this.disposables.push(d);
    }

    protected async initWebviewHtmlAsync() {
        this.panel.webview.html = ""
        const simulatorHTML = await getAssetEditorHtmlAsync(this.panel.webview);
        this.panel.webview.html = simulatorHTML;
    }

    protected async onReadyMessageReceivedAsync() {
        if (!this.editing) return;

        switch (this.editing.type) {
            case "edit":
                this.sendMessageAsync({
                    type: "open",
                    assetType: this.editing.assetType,
                    assetId: this.editing.assetId,
                    files: await readProjectJResAsync()
                });
                break;
            case "duplicate":
                this.sendMessageAsync({
                    type: "duplicate",
                    assetType: this.editing.assetType,
                    assetId: this.editing.assetId,
                    files: await readProjectJResAsync()
                });
                break;
            case "create":
                this.sendMessageAsync({
                    type: "create",
                    assetType: this.editing.assetType,
                    files: await readProjectJResAsync()
                });
                break;
        }
    }
}

export class AssetEditorSerializer implements vscode.WebviewPanelSerializer {
    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
        AssetEditor.revive(webviewPanel);
        await AssetEditor.currentSimulator?.openAssetAsync(state.editing!.assetType, state.editing!.assetId)
    }
}


async function getAssetEditorHtmlAsync(webview: vscode.Webview) {
    const uri = vscode.Uri.joinPath(extensionContext.extensionUri, "resources", "assetframe.html");
    const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));

    const pathURL = (s: string) =>
        webview.asWebviewUri(vscode.Uri.joinPath(extensionContext.extensionUri, "resources", s)).toString();

    return contents
        .replace(/@RES@\/([\w\-\.]+)/g, (f, fn) => pathURL(fn))
        .replace("@ASSETURL@", assetUrl);
}

async function readProjectJResAsync() {
    const files = await vscode.workspace.findFiles("**/*.jres");
    const fileSystem: {[index: string]: string} = {};

    for (const file of files) {
        const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
        fileSystem[vscode.workspace.asRelativePath(file)] = contents;

        const pathParts = file.path.split(".");
        const tsFile = file.with({
            path: pathParts.slice(0, pathParts.length - 1).join(".") + ".ts"
        });

        try {
            const tsContents = new TextDecoder().decode(await vscode.workspace.fs.readFile(tsFile));
            fileSystem[vscode.workspace.asRelativePath(tsFile)] = tsContents;
        }
        catch (e) {
            // file does not exist
        }

        const gtsFile = file.with({
            path: pathParts.slice(0, pathParts.length - 1).join(".") + ".ts"
        });

        try {
            const gtsContents = new TextDecoder().decode(await vscode.workspace.fs.readFile(gtsFile));
            fileSystem[vscode.workspace.asRelativePath(gtsFile)] = gtsContents;
        }
        catch (e) {
            // file does not exist
        }
    }

    return fileSystem;
}

async function saveFilesAsync(files: {[index: string]: string}) {
    const config = await readFileAsync("./pxt.json", "utf8");
    const parsed = JSON.parse(config);
    const configFiles = parsed.files as string[];
    let didChangeConfig = false;

    for (const file of Object.keys(files)) {
        await writeFileAsync(file, files[file]);

        if (configFiles.indexOf(file) === -1) {
            insertGeneratedFile(configFiles, file);
            didChangeConfig = true
        }
    }

    await writeFileAsync("./pxt.json", JSON.stringify(parsed, null, 4), "utf8");
    await syncJResAsync();
}

/**
 * Logic for inserting a file generated by the asset editor into the config files list:
 *
 * 1. If this is a .ts file corresponding to an existing .jres file, insert after the existing file
 * 2. If there are *.g.ts or *.g.jres files in the file list, insert after the last one
 * 3. If there are any .jres files in the files list, insert after the last one
 * 4. Insert at the beginning of the array
 */
export function insertGeneratedFile(arr: string[], toInsert: string) {
    let lastGenIndex = -1;
    let lastJRESIndex = -1;

    const basename = toInsert.split(".").slice(0, -1).join(".");

    for (let i = 0; i < arr.length; i++) {
        const currentBasename = arr[i].split(".").slice(0, -1).join(".");

        if (currentBasename === basename) {
            arr.splice(i + 1, 0, toInsert);
            return;
        }

        const current = arr[i].toLowerCase();
        if (current.endsWith(".g.ts") || current.endsWith(".g.jres")) {
            lastGenIndex = i;
        }
        else if (current.endsWith(".jres")) {
            lastJRESIndex = i;
        }
    }

    if (lastGenIndex !== -1) {
        arr.splice(lastGenIndex + 1, 0, toInsert);
    }
    else {
        arr.splice(lastJRESIndex + 1, 0, toInsert);
    }
}