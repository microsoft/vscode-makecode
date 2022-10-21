// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { createVsCodeHost, readFileAsync, stringToBuffer } from './host';
import { setHost } from 'makecode-core/built/host';

import { initCommand, buildCommandOnce, BuildOptions } from "makecode-core/built/commands";
import { Simulator } from './simulator';
import { delay, throttle } from './util';
import { JresTreeProvider } from './jres';
import { AssetEditor } from './assetEditor';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    setHost(createVsCodeHost());

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "pxt-vscode-web" is now active in the web extension host!');

    const addCmd = (id: string, fn: () => Promise<void>) => {
        const cmd = vscode.commands.registerCommand(id, () => fn()
            .catch( err => {
                console.error("MakeCode Ext Exception", err)
            }));
        context.subscriptions.push(cmd);
    }

    addCmd('makecode.build', buildCommand)
    addCmd('makecode.simulate', () => simulateCommand(context))
    addCmd('makecode.choosehw', choosehwCommand)
    addCmd('makecode.create', createCommand)

    context.subscriptions.push(
        vscode.commands.registerCommand('makecode.openAsset', uri => {
            openAssetEditor(context, uri);
        })
    );

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("assetExplorer", new JresTreeProvider())
    );
}

async function buildCommand() {
    console.log("Build command");

    await buildCommandOnce({ watch: true });
}

async function simulateCommand(context: vscode.ExtensionContext) {
    console.log("Simulate command");

    const opts: BuildOptions = {
        javaScript: true,
        update: true,
        watch: true
    };

    let building = false
    let buildPending = false
    const buildAsync = async (ev?: string, filename?: string) => {
        if (ev) console.log(`detected ${ev} ${filename}`)

        buildPending = true

        await delay(100) // wait for other change events, that might have piled-up to arrive

        // don't trigger 2 build, wait and do it again
        if (building) {
            console.log(` build in progress, waiting...`)
            return
        }

        // start a build
        try {
            building = true
            while (buildPending) {
                buildPending = false
                const opts0 = {
                    ...opts
                }
                if (ev) {
                    // if not first time, don't update
                    opts0.update = false
                }

                await buildCommandOnce(opts0);

                Simulator.createOrShow(context);
                Simulator.currentSimulator?.simulateAsync(await readFileAsync("built/binary.js", "utf8"));
            }
        } catch (e) {
            showError(e + "");
        } finally {
            building = false
        }
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Building project...",
        cancellable: false
    }, () => {

        vscode.workspace.onDidSaveTextDocument( // auto-compile simulator
            throttle(
                (doc: vscode.TextDocument) => {
                    if (!Simulator.currentSimulator) return;

                    // skip node_modules, pxt_modules, built, .git
                    if (/\/?((node|pxt)_modules|built|\.git)/i.test(doc.fileName)) return;
                    // only watch for source files
                    if (!/\.(json|ts|asm|cpp|c|h|hpp)$/i.test(doc.fileName)) return;
                    buildAsync("save", doc.fileName);
                },
            500, true)
        )

        return buildAsync();
    })
}

async function choosehwCommand() {
    console.log("Choose hardware command")
}

async function createCommand()  {
    console.log("Create command")

    const qp = vscode.window.createQuickPick();

    qp.items = [
        {
            label: "arcade",
        },
        {
            label: "micro:bit",
        }
    ];
    qp.onDidAccept(() => {
        const selected = qp.selectedItems[0];
        initCommand(selected.label, [], {})
        qp.dispose();
    })

    qp.show();
}

async function openAssetEditor(context: vscode.ExtensionContext, uri: vscode.Uri) {
    AssetEditor.createOrShow(context);
    AssetEditor.currentSimulator?.openURIAsync(uri);
}

// This method is called when your extension is deactivated
export function deactivate() {}


function showError(message: string) {
    vscode.window.showErrorMessage(message);
}