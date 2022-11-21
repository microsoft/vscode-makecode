// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { createVsCodeHost, readFileAsync, stringToBuffer } from './host';
import { setHost } from 'makecode-core/built/host';

import { initCommand, buildCommandOnce } from "makecode-core/built/commands";
import { Simulator } from './simulator';
import { JResTreeProvider, JResTreeNode, fireChangeEvent } from './jres';
import { AssetEditor } from './assetEditor';
import { BuildWatcher } from './buildWatcher';

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

    Simulator.register(context);
    AssetEditor.register(context);
    BuildWatcher.register(context);

    addCmd('makecode.build', buildCommand)
    addCmd('makecode.simulate', () => simulateCommand(context))
    addCmd('makecode.choosehw', choosehwCommand)
    addCmd('makecode.create', createCommand)

    addCmd('makecode.createImage', () => createAssetCommand("image"))
    addCmd('makecode.createTile', () => createAssetCommand("tile"))
    addCmd('makecode.createTilemap', () => createAssetCommand("tilemap"))
    addCmd('makecode.createAnimation', () => createAssetCommand("animation"))
    addCmd('makecode.createSong', () => createAssetCommand("song"))
    addCmd('makecode.refreshAssets', async () => fireChangeEvent())

    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.duplicateAsset", duplicateAssetCommand)
    )
    context.subscriptions.push(
        vscode.commands.registerCommand("makecode.deleteAsset", deleteAssetCommand)
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('makecode.openAsset', uri => {
            openAssetEditor(context, uri);
        })
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
}

async function buildCommand() {
    console.log("Build command");

    await buildCommandOnce({ watch: true });
}

export async function simulateCommand(context: vscode.ExtensionContext) {
    if (BuildWatcher.watcher.isEnabled()) {
        console.log("Simulator already running");
        return;
    }

    const runSimulator = async () => {
        if (!Simulator.currentSimulator) {
            BuildWatcher.watcher.setEnabled(false);
            BuildWatcher.watcher.removeEventListener("build-completed", runSimulator);
            return;
        }

        Simulator.createOrShow(context);
        Simulator.currentSimulator.simulateAsync(await readFileAsync("built/binary.js", "utf8"));
    }

    BuildWatcher.watcher.addEventListener("build-completed", runSimulator);
    BuildWatcher.watcher.setEnabled(true);
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
            label: "microbit",
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
    AssetEditor.createOrShow();
    AssetEditor.currentSimulator?.openURIAsync(uri);
}

// This method is called when your extension is deactivated
export function deactivate() {}


function showError(message: string) {
    vscode.window.showErrorMessage(message);
}