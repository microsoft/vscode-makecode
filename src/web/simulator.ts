import * as vscode from "vscode";
import * as mkc from 'makecode-core/built/mkc';

import { simloaderFiles } from "makecode-core/built/simloaderfiles";
import { existsAsync, readFileAsync } from "./host";

let extensionContext: vscode.ExtensionContext;

export class Simulator {
    public static readonly viewType = "mkcdsim";
    public static currentSimulator: Simulator | undefined;
    public simState: any;
    public simStateTimer: any;
    private static simconsole: vscode.OutputChannel;

    public static createOrShow(extCtx: vscode.ExtensionContext) {
        let column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
        column = column! < 9 ? column! + 1 : column;

        extensionContext = extCtx

        if (Simulator.simconsole) {
            Simulator.simconsole.clear();
        } else {
            Simulator.simconsole = vscode.window.createOutputChannel("MakeCode");
        }

        if (Simulator.currentSimulator) {
            Simulator.currentSimulator.simState = null;
            Simulator.currentSimulator.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(Simulator.viewType, "MakeCode Arcade Simulator", {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true
        });

        Simulator.currentSimulator = new Simulator(panel)
    }

    public static revive(panel: vscode.WebviewPanel) {
        Simulator.currentSimulator = new Simulator(panel)
    }

    protected panel: vscode.WebviewPanel;
    protected binaryJS: string | undefined;
    protected disposables: vscode.Disposable[];

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;

        this.panel.webview.onDidReceiveMessage(message => {
            this.handleSimulatorMessage(message);
        });

        this.panel.onDidDispose(() => {
            if (Simulator.currentSimulator === this) {
                Simulator.currentSimulator = undefined;
            }

            this.disposables.forEach(d => d.dispose());
        });

        this.disposables = [];
    }

    async simulateAsync(binaryJS: string) {
        this.binaryJS = binaryJS;
        this.panel.webview.html = ""
        const simulatorHTML = await getSimHtmlAsync();
        if (this.simState == null) {
            this.simState = await extensionContext.workspaceState.get("simstate", {})
        }
        this.panel.webview.html = simulatorHTML;
    }

    handleSimulatorMessage(message: any) {
        if (message.type === "fetch-js") {
            this.postMessage({
                ...message,
                text: this.binaryJS
            })
        }
    }


    postMessage(msg: any) {
        this.panel.webview.postMessage(msg);
        msg._fromVscode = true;
        console.log("sending", msg)
    }

    addDisposable(d: vscode.Disposable) {
        this.disposables.push(d);
    }
}


async function getSimHtmlAsync() {
    const index = simloaderFiles["index.html"];
    const loaderJs = simloaderFiles["loader.js"];
    let customJs = simloaderFiles["custom.js"];
    const customPath = "custom.js";

    if (await existsAsync("assets/" + customPath)) {
        customJs = await readFileAsync("assets/" + customPath, "utf8");
    }
    else if (await existsAsync("assets/js/" + customPath)) {
        customJs = await readFileAsync("assets/js/" + customPath, "utf8");
    }
    // <script type="text/javascript" src="loader.js"></script>
    return index.replace(/<\s*script\s+type="text\/javascript"\s+src="([^"]+)"\s*>\s*<\/\s*script\s*>/g, (substring, match) => {
        if (match === "loader.js") {
            return `
            <script type="text/javascript">
                ${loaderJs}
            </script>
            `
        }
        else if (match === "custom.js") {
            return `
            <script type="text/javascript">
                ${customJs}
            </script>
            `
        }
        return "";
    }).replace("usePostMessage: false", "usePostMessage: true");
}