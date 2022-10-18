// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { createVsCodeHost, readFileAsync } from './host';
import { setHost } from 'makecode-core/built/host';

import { initCommand, buildCommandOnce } from "makecode-core/built/commands";
import { Simulator } from './simulator';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    setHost(createVsCodeHost());

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "pxt-vscode-web" is now active in the web extension host!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('pxt-vscode-web.helloWorld', () => {
        // The code you place here will be executed every time your command is executed

        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World asdfasdf!');
    });

    context.subscriptions.push(disposable);

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
}

async function buildCommand() {
    console.log("Build command");

    await buildCommandOnce({})
}

async function simulateCommand(context: vscode.ExtensionContext) {
    console.log("Simulate command")
    try {
        await buildCommandOnce({ javaScript: true });
    }
    catch (e) {}
    Simulator.createOrShow(context);
    Simulator.currentSimulator?.simulateAsync(await readFileAsync("built/binary.js", "utf8"), )
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

// This method is called when your extension is deactivated
export function deactivate() {}
