import * as vscode from "vscode";
import { activeWorkspace } from "./host";
import { debounce, getPxtJson, guidGen, readTextFileAsync } from "./util";

let extensionContext: vscode.ExtensionContext;
// const editorUrl = "http://localhost:3232/?controller=1";
const editorUrl = "https://arcade.makecode.com/?controller=1&skillmap=1";

export class MakeCodeEditor {
    public static readonly viewType = "mkcdeditor";
    public static currentEditor: MakeCodeEditor | undefined;
    public simStateTimer: any;

    public static createOrShow() {
        let column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
        column = column! < 9 ? column! + 1 : column;

        if (MakeCodeEditor.currentEditor) {
            MakeCodeEditor.currentEditor.panel.reveal(
                undefined /** keep current column **/,
                true
            );
            return;
        }

        const panel = vscode.window.createWebviewPanel(MakeCodeEditor.viewType, vscode.l10n.t("Microsoft MakeCode Editor"), {
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true,
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true
        });

        MakeCodeEditor.currentEditor = new MakeCodeEditor(panel);
    }

    public static register(context: vscode.ExtensionContext) {
        extensionContext = context;
        vscode.window.registerWebviewPanelSerializer('mkcdeditor', new MakeCodeEditorSerializer());
    }

    public static revive(panel: vscode.WebviewPanel) {
        MakeCodeEditor.currentEditor = new MakeCodeEditor(panel);
    }

    protected panel: vscode.WebviewPanel;
    protected disposables: vscode.Disposable[];
    protected pendingMessages: {[index: string]: (res: any) => void} = {};
    protected nextId = 0;

    protected running = false;
    protected building = false;
    protected buildPending = false;

    protected watcherDisposable: vscode.Disposable | undefined;
    protected folder: vscode.WorkspaceFolder | undefined;
    protected currentHeaderId: string | undefined;

    constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;

        this.panel.webview.onDidReceiveMessage(message => {
            this.handleEditorMessage(message);
        });

        this.panel.onDidDispose(() => {
            if (MakeCodeEditor.currentEditor === this) {
                MakeCodeEditor.currentEditor = undefined;
            }

            this.disposables.forEach(d => d.dispose());

            this.stop();
        });

        this.disposables = [];

        this.initWebviewHtmlAsync();
    }

    startWatching(folder: vscode.WorkspaceFolder) {
        if (this.running && this.folder === folder) {return;}
        this.stop();

        this.folder = folder;
        this.running = true;

        const debounceTimer = vscode.workspace.getConfiguration().get(
            "makecode.simulatorBuildWatcherDebounce",
            1500
        );

        const debouncedBuild = debounce(
            // Ideally we'd just send the project again instead of reloading the webview but because makecode aggressively
            // caches the blocks in the toolbox we have to do a full reload.
            () => this.initWebviewHtmlAsync(),
            debounceTimer
        );

        const fsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**"));
        const watchHandler = (uri: vscode.Uri) => {
            if (!this.running) {
                return;
            }

            // skip node_modules, pxt_modules, built, .git
            if (/\/?((node|pxt)_modules|built|\.git)/i.test(uri.path)) {
                return;
            }
            // only watch for source files
            if (!/\.(json|jres|ts|asm|cpp|c|h|hpp)$/i.test(uri.path)) {
                return;
            }

            debouncedBuild();
        }

        fsWatcher.onDidChange(watchHandler);
        fsWatcher.onDidCreate(watchHandler);
        fsWatcher.onDidDelete(watchHandler);
        this.watcherDisposable = fsWatcher;
        extensionContext.subscriptions.push(this.watcherDisposable);
        this.sendProjectAsync(folder);
    }

    stop() {
        this.running = false;
        if (this.watcherDisposable) {
            this.watcherDisposable.dispose();
            this.watcherDisposable = undefined;
        }
    }

    handleEditorMessage(message: any) {
        if (this.pendingMessages[message.id]) {
            this.pendingMessages[message.id](message);
            delete this.pendingMessages[message.id];
            return;
        }

        switch (message.type) {
            case "pxthost":
                this.handleHostMessage(message);
                break;
            case "ready":
                this.onReadyMessageReceivedAsync();
                break;
        }
    }

    async handleHostMessage(message: any) {
        if (message.action === "workspacesync") {
            message.projects = [];
            message._fromVscode = true;
            this.panel.webview.postMessage(message);
        }
    }

    async sendProjectAsync(workspace: vscode.WorkspaceFolder) {
        const text = await createProjectBlobAsync(workspace);
        const header = createHeader();
        await this.sendMessageAsync({
            type: "pxteditor",
            action: "importproject",
            project: {
                header,
                text
            }
        });
    }

    sendMessageAsync(message: any) {
        message._fromVscode = true;
        message.id = this.nextId++;

        return new Promise<any>(resolve => {
            this.pendingMessages[message.id] = resolve;
            this.panel.webview.postMessage(message);
        });
    }

    addDisposable(d: vscode.Disposable) {
        this.disposables.push(d);
    }

    protected async initWebviewHtmlAsync() {
        this.panel.webview.html = "";
        const simulatorHTML = await getMakeCodeEditorHtmlAsync(this.panel.webview);
        this.panel.webview.html = simulatorHTML;
    }

    protected async onReadyMessageReceivedAsync() {
        if (!this.running) {
            await this.startWatching(activeWorkspace());
        }
        else {
            this.sendProjectAsync(this.folder || activeWorkspace());
        }
    }
}

export class MakeCodeEditorSerializer implements vscode.WebviewPanelSerializer {
    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
        MakeCodeEditor.revive(webviewPanel);
    }
}


async function getMakeCodeEditorHtmlAsync(webview: vscode.Webview) {
    const uri = vscode.Uri.joinPath(extensionContext.extensionUri, "resources", "editorframe.html");
    const contents = await readTextFileAsync(uri);

    const pathURL = (s: string) =>
        webview.asWebviewUri(vscode.Uri.joinPath(extensionContext.extensionUri, "resources", s)).toString();

    return contents
        .replace(/@RES@\/([\w\-\.]+)/g, (f, fn) => pathURL(fn))
        .replace("@EDITORURL@", editorUrl);
}

async function createProjectBlobAsync(workspace: vscode.WorkspaceFolder) {
    const project: {[index: string]: string} = {};
    const config = await getPxtJson(workspace);

    const processFileAsync = async (file: string) => {
        const outFile = file === "main.ts" ? "old_main.ts" : file;

        try {
            const contents = await readTextFileAsync(vscode.Uri.joinPath(workspace.uri, file));
            project[outFile] = contents;
        }
        catch (e) {
            project[outFile] = "";
        }
    }

    for (const file of config.files) {
        if (file === "main.blocks") continue;
        await processFileAsync(file);
    }

    if (config.testFiles) {
        for (const file of config.testFiles) {
            await processFileAsync(file);
        }
    }

    if (!config.files.some(f => f === "main.blocks")) {
        config.files.push("main.blocks");
    }

    if (config.files.some(f => f === "main.ts")) {
        config.files.push("old_main.ts");
    }
    else {
        config.files.push("main.ts");
    }

    config.preferredEditor = "blocksprj";

    project["pxt.json"] = JSON.stringify(config);
    project["main.blocks"] = `<xml xmlns="http://www.w3.org/1999/xhtml"><variables></variables><block type="pxt-on-start" x="0" y="0"></block></xml>`;
    project["main.ts"] = "";

    return project;
}

function createHeader() {
    return {
        "name": "Untitled",
        "meta": {},
        "editor": "blocksprj",
        "pubId": "",
        "pubCurrent": false,
        "target": "arcade",
        "targetVersion": "1.12.26",
        "cloudUserId": null,
        "id": guidGen(),
        "recentUse": Date.now(),
        "modificationTime": Date.now(),
        "path": "Untitled",
        "cloudCurrent": false,
        "saveId": null
    }
}
