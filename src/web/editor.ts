import * as vscode from "vscode";
import { fileExistsAsync } from "./extension";
import { activeWorkspace } from "./host";
import { debounce, getPxtJson, guidGen, readTextFileAsync, writeTextFileAsync } from "./util";

let extensionContext: vscode.ExtensionContext;
// const editorUrl = "http://localhost:3232/?controller=1";
const editorUrl = "https://arcade.makecode.com/?controller=1&skillmap=1";

interface Header {
    name: string;
    meta: {};
    editor: string;
    pubId: string;
    pubCurrent: boolean;
    target: string;
    targetVersion: string;
    cloudUserId: string | null;
    id: string;
    recentUse: number;
    modificationTime: number;
    path: string;
    cloudCurrent: boolean;
    saveId: string | null;
    extensionUnderTest?: string;
}

interface Project {
    text: {[index: string]: string};
    header: Header;
}

export class MakeCodeEditor {
    public static readonly viewType = "mkcdeditor";
    public static currentEditor: MakeCodeEditor | undefined;
    public simStateTimer: any;

    public static createOrShow(tutorialPreviewMode = false) {
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

        MakeCodeEditor.currentEditor = new MakeCodeEditor(panel, tutorialPreviewMode);
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
    protected extHeaderId: string | undefined;
    protected testHeaderId: string | undefined;
    protected ready = false;
    protected editorContentLoaded = false;
    protected tutorialPreviewMode = false;
    protected pendingTutorialPreview: {
        markdown: string;
        resolve: () => void;
        reject: (e: any) => void;
    } | undefined;

    constructor(panel: vscode.WebviewPanel, tutorialPreviewMode = false) {
        this.panel = panel;
        this.tutorialPreviewMode = tutorialPreviewMode;

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

    startWatching(folder: vscode.WorkspaceFolder, skipOpenTestProject = false) {
        if (this.running && this.folder === folder) {return;}
        this.stop();

        if (!skipOpenTestProject) {
            this.tutorialPreviewMode = false;
        }

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
        };

        fsWatcher.onDidChange(watchHandler);
        fsWatcher.onDidCreate(watchHandler);
        fsWatcher.onDidDelete(watchHandler);
        this.watcherDisposable = fsWatcher;
        extensionContext.subscriptions.push(this.watcherDisposable);
        if (!skipOpenTestProject) {
            this.openTestProjectAsync();
        }
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
            case "pxteditor":
                if (message.action === "editorcontentloaded") {
                    this.onReadyMessageReceivedAsync(true);
                }
                break;
            case "ready":
                this.onReadyMessageReceivedAsync();
                break;
        }
    }

    async handleHostMessage(message: any) {
        if (message.action === "workspacesync") {
            const project = await this.readProjectAsync(this.folder || activeWorkspace());
            const testProject = await this.readTestProjectAsync(this.folder || activeWorkspace());
            message.projects = [project];

            if (testProject) {
                this.extHeaderId = testProject.header.extensionUnderTest;
                this.testHeaderId = testProject.header.id;
                message.projects.push(testProject);
            }

            if (this.extHeaderId) {
                project.header.id = this.extHeaderId;
            }
            else {
                this.extHeaderId = project.header.id;
            }


            message._fromVscode = true;
            this.panel.webview.postMessage(message);
        }
        else if (message.action === "workspacesave") {
            const project = message.project as Project;
            if (project?.header.extensionUnderTest === this.extHeaderId) {
                this.saveTestProjectAsync(this.folder || activeWorkspace(), project);
            }
        }
        else if (message.action === "editorcontentloaded") {
            await this.onReadyMessageReceivedAsync(true);
        }
    }

    async openTestProjectAsync() {
        if (this.testHeaderId) {
            await this.sendMessageAsync({
                type: "pxteditor",
                action: "openheader",
                headerId: this.testHeaderId
            });
        }
    }

    async previewTutorialAsync(markdown: string) {
        const previewPromise = new Promise<void>((resolve, reject) => {
            this.pendingTutorialPreview = {
                markdown,
                resolve,
                reject
            };
        });

        try {
            if (!this.tutorialPreviewMode) {
                await this.prepareForTutorialPreviewAsync();
            }

            if (this.editorContentLoaded) {
                await this.importPendingTutorialAsync();
            }
        }
        catch (e) {
            this.rejectPendingTutorialPreview(e);
        }

        return previewPromise;
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
        this.ready = false;
        this.editorContentLoaded = false;
        this.pendingMessages = {};
        const testProject = await this.readTestProjectAsync(this.folder || activeWorkspace());
        if (testProject) {
            this.testHeaderId = testProject.header.id;
            this.extHeaderId = testProject.header.extensionUnderTest;
        }
        else if (!this.extHeaderId) {
            this.extHeaderId = guidGen();
        }

        this.panel.webview.html = "";
        let hash: string | undefined;
        if (!this.tutorialPreviewMode) {
            hash = this.testHeaderId ? "header:" + this.testHeaderId : "testproject:" + this.extHeaderId;
        }
        const simulatorHTML = await getMakeCodeEditorHtmlAsync(this.panel.webview, hash);
        this.panel.webview.html = simulatorHTML;
    }

    protected async prepareForTutorialPreviewAsync() {
        if (this.tutorialPreviewMode) {
            return;
        }

        this.tutorialPreviewMode = true;
        await this.initWebviewHtmlAsync();
    }

    protected async onReadyMessageReceivedAsync(editorContentLoaded = false) {
        this.ready = true;
        if (editorContentLoaded) {
            this.editorContentLoaded = true;
        }
        const hasPendingTutorialPreview = !!this.pendingTutorialPreview;
        if (!this.running) {
            await this.startWatching(activeWorkspace(), hasPendingTutorialPreview);
        }
        else if (!hasPendingTutorialPreview && !this.tutorialPreviewMode) {
            this.openTestProjectAsync();
        }

        if (this.editorContentLoaded) {
            await this.importPendingTutorialAsync();
        }
    }

    protected async importPendingTutorialAsync() {
        const pending = this.pendingTutorialPreview;
        if (!pending) {
            return;
        }

        this.pendingTutorialPreview = undefined;
        try {
            const response = await this.sendMessageAsync({
                type: "pxteditor",
                action: "importtutorial",
                markdown: pending.markdown,
                response: true
            });
            const errorMessage = response?.error || response?.resp?.error || response?.resp?.message;
            if (errorMessage) {
                throw new Error(errorMessage);
            }
            pending.resolve();
        }
        catch (e) {
            pending.reject(e);
        }
    }

    protected rejectPendingTutorialPreview(e: any) {
        const pending = this.pendingTutorialPreview;
        this.pendingTutorialPreview = undefined;
        if (pending) {
            pending.reject(e);
        }
    }

    protected async readProjectAsync(workspace: vscode.WorkspaceFolder): Promise<Project> {
        const text = await createProjectBlobAsync(workspace);
        const header = createHeader();
        return {
            text,
            header
        };
    }

    protected async readTestProjectAsync(workspace: vscode.WorkspaceFolder): Promise<Project | undefined> {
        const uri = vscode.Uri.joinPath(workspace.uri, ".pxt", "test_project");
        if (await fileExistsAsync(uri)) {
            return JSON.parse(await readTextFileAsync(uri));
        }
        return undefined;
    }

    protected async saveTestProjectAsync(workspace: vscode.WorkspaceFolder, project: Project) {
        const uri = vscode.Uri.joinPath(workspace.uri, ".pxt", "test_project");
        await writeTextFileAsync(uri, JSON.stringify(project));
    }
}

export class MakeCodeEditorSerializer implements vscode.WebviewPanelSerializer {
    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
        MakeCodeEditor.revive(webviewPanel);
    }
}


async function getMakeCodeEditorHtmlAsync(webview: vscode.Webview, hash?: string) {
    const uri = vscode.Uri.joinPath(extensionContext.extensionUri, "resources", "editorframe.html");
    const contents = await readTextFileAsync(uri);

    const pathURL = (s: string) =>
        webview.asWebviewUri(vscode.Uri.joinPath(extensionContext.extensionUri, "resources", s)).toString();

    const url = hash ? editorUrl + "#" + hash : editorUrl;

    return contents
        .replace(/@RES@\/([\w\-\.]+)/g, (f, fn) => pathURL(fn))
        .replace("@EDITORURL@", url);
}

async function createProjectBlobAsync(workspace: vscode.WorkspaceFolder) {
    const project: {[index: string]: string} = {};
    const config = await getPxtJson(workspace);

    const processFileAsync = async (file: string) => {
        try {
            const contents = await readTextFileAsync(vscode.Uri.joinPath(workspace.uri, file));
            project[file] = contents;
        }
        catch (e) {
            project[file] = "";
        }
    };

    for (const file of config.files) {
        await processFileAsync(file);
    }

    if (config.testFiles) {
        for (const file of config.testFiles) {
            await processFileAsync(file);
        }
    }

    project["pxt.json"] = JSON.stringify(config);

    return project;
}

function createHeader(): Header {
    return {
        name: "Untitled",
        meta: {},
        editor: "blocksprj",
        pubId: "",
        pubCurrent: false,
        target: "arcade",
        targetVersion: "1.12.26",
        cloudUserId: null,
        id: guidGen(),
        recentUse: Date.now(),
        modificationTime: Date.now(),
        path: "Untitled",
        cloudCurrent: false,
        saveId: null
    };
}
