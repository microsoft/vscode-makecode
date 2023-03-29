import * as vscode from "vscode";

import { simloaderFiles } from "makecode-core/built/simloaderfiles";
import { existsAsync, readFileAsync } from "./host";
import { simulateCommand } from "./extension";

let extensionContext: vscode.ExtensionContext;

export class Simulator {
    public static readonly viewType = "mkcdsim";
    public static currentSimulator: Simulator | undefined;
    public simState: any;
    public simStateTimer: any;
    private static simconsole: vscode.OutputChannel;

    public static register(extCtx: vscode.ExtensionContext) {
        extensionContext = extCtx;
        vscode.window.registerWebviewPanelSerializer('mkcdsim', new SimulatorSerializer(extCtx));
    }

    public static createOrShow(extCtx: vscode.ExtensionContext) {
        extensionContext = extCtx;

        if (Simulator.simconsole) {
            Simulator.simconsole.clear();
        } else {
            Simulator.simconsole = vscode.window.createOutputChannel("MakeCode");
        }

        if (Simulator.currentSimulator) {
            Simulator.currentSimulator.simState = null;
            Simulator.currentSimulator.panel.reveal(
                undefined /** keep current column **/,
                true
            );
            return;
        }

        const panel = vscode.window.createWebviewPanel(Simulator.viewType, vscode.l10n.t("Microsoft MakeCode Simulator"), {
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true,
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true
        });

        Simulator.currentSimulator = new Simulator(panel);
    }

    public static revive(panel: vscode.WebviewPanel) {
        Simulator.currentSimulator = new Simulator(panel);
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
        this.panel.webview.html = "";
        const simulatorHTML = await getSimHtmlAsync();
        if (this.simState == null) {
            this.simState = await extensionContext.workspaceState.get("simstate", {});
        }
        this.panel.webview.html = simulatorHTML;
    }

    setPanelTitle(title: string) {
        this.panel.title = title;
    }

    stopSimulator() {
        this.postMessage({
            type: "stop-sim"
        });
    }

    handleSimulatorMessage(message: any) {
        switch (message.type) {
            case "fetch-js":
                this.postMessage({
                    ...message,
                    text: this.binaryJS
                });
                break;
            case "bulkserial":
                const data: { data: string, time: number }[] = message.data;
                for (const entry of data) {
                    Simulator.simconsole.appendLine(entry.data);
                }
                break;
            case "debugger":
                if (message.subtype === "breakpoint" && message.exceptionMessage) {
                    let stackTrace = "Uncaught " + message.exceptionMessage + "\n";
                    for (let s of message.stackframes) {
                        let fi = s.funcInfo;
                        stackTrace += `   at ${fi.functionName} (${fi.fileName
                            }:${fi.line + 1}:${fi.column + 1})\n`;
                    }
                    Simulator.simconsole.appendLine(stackTrace);
                    Simulator.simconsole.show(false);
                    this.stopSimulator();
                }
        }
    }

    postMessage(msg: any) {
        msg._fromVscode = true;
        this.panel.webview.postMessage(msg);
    }

    addDisposable(d: vscode.Disposable) {
        this.disposables.push(d);
    }
}

export class SimulatorSerializer implements vscode.WebviewPanelSerializer {
    constructor(public context: vscode.ExtensionContext) {}
    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: unknown) {
        Simulator.revive(webviewPanel);
        await simulateCommand(this.context);
    }
}

const vscodeExtensionExtraLoaderJs = `
window.addEventListener("DOMContentLoaded", () => {
    const fs = document.getElementById("fullscreen");
    if (fs) {
        fs.remove();
    }
});
`;


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

    // In order to avoid using a server, we inline the loader and custom js files
    return index.replace(/<\s*script\s+type="text\/javascript"\s+src="([^"]+)"\s*>\s*<\/\s*script\s*>/g, (substring, match) => {
        if (match === "loader.js") {
            return `
            <script type="text/javascript">
                ${loaderJs}
            </script>
            <script type="text/javascript">
                ${vscodeExtensionExtraLoaderJs}
            </script>
            `;
        }
        else if (match === "custom.js") {
            return `
            <script type="text/javascript">
                ${customJs}
            </script>
            `;
        }
        return "";
    }).replace("usePostMessage: false", "usePostMessage: true");
}