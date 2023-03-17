import * as vscode from "vscode";
import { activeWorkspace, findFilesAsync } from "./host";
import { readTextFileAsync } from "./util";


export type AssetKind = "image" | "tile" | "tilemap" | "animation" | "song";
export interface JResTreeNode {
    kind: AssetKind;
    id?: string;
    name?: string;
    sourceFile?: vscode.Uri;
    uri?: vscode.Uri;
}

let model: JResTreeModel;

class JResTreeModel {
    nodes: JResTreeNode [] = [];
    eventEmitter: vscode.EventEmitter<JResTreeNode[]>;

    providers: JResTreeProvider[] = [];

    constructor() {
        this.eventEmitter = new vscode.EventEmitter<JResTreeNode[]>();
        this.refreshJresAsync();
    }


    async refreshJresAsync() {
        this.nodes = await readProjectJResAsync();
        vscode.commands.executeCommand("makecode.refreshAssets", true);
    }
}

export class JResTreeProvider implements vscode.TreeDataProvider<JResTreeNode> {

    _onDidChangeTreeData: vscode.EventEmitter<JResTreeNode[] | undefined | void>;
    onDidChangeTreeData: vscode.Event<JResTreeNode[] | undefined | void>;

    constructor(public kind: "image" | "tile" | "tilemap" | "animation" | "song") {
        if (!model) {
            model = new JResTreeModel();
        }
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        model.providers.push(this);
    }

    getTreeItem(element: JResTreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return {
            label: element.name || kindToDisplayName(element.kind),
            resourceUri: element.uri,
            command: element.id ? {
                title: vscode.l10n.t("Open MakeCode Asset"),
                command: "makecode.openAsset",
                arguments: [element.uri],
            } : undefined,
            collapsibleState: element.id ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
        };
    }

    getChildren(element?: JResTreeNode | undefined): vscode.ProviderResult<JResTreeNode[]> {
        if (!element) {
            return model.nodes.filter(node => node.kind === this.kind);
        }
        return [];
    }

    getParent(element: JResTreeNode): vscode.ProviderResult<JResTreeNode> {
        return undefined;
    }
}

export async function syncJResAsync() {
    if (!model) {
        model = new JResTreeModel();
    }
    await model.refreshJresAsync();
}

export function fireChangeEvent() {
    if (!model) {
        model = new JResTreeModel();
    }
    for (const provider of model.providers) {
        provider._onDidChangeTreeData.fire();
    }
}

export async function deleteAssetAsync(node: JResTreeNode) {
    if (!node.sourceFile || !node.id) {
        return;
    }

    const sourceText = await readTextFileAsync(node.sourceFile);
    const sourceJRes = JSON.parse(sourceText);

    if (sourceJRes[node.id]) {
        delete sourceJRes[node.id];
    }
    else {
        const parts = node.id.split(".");

        const ns = parts.slice(0, parts.length - 1).join(".");
        const id = parts[parts.length - 1];

        const entry = sourceJRes[id];
        if (entry?.namespace === ns || entry?.namespace === ns + "." || sourceJRes["*"]?.namespace === ns || sourceJRes["*"]?.namespace === ns + ".") {
            delete sourceJRes[id];
        }
    }

    await vscode.workspace.fs.writeFile(node.sourceFile, new TextEncoder().encode(JSON.stringify(sourceJRes, null, 4)));
    await syncJResAsync();
}


export function getCurrentJresNodes() {
    return model?.nodes;
}

async function readProjectJResAsync() {
    const nodes: JResTreeNode[] = [];
    const ws = activeWorkspace()?.uri;
    if (!ws)
        return [];

    const files = await findFilesAsync("jres", activeWorkspace().uri, false);

    for (const file of files) {
        if (file.fsPath.indexOf("pxt_modules") !== -1 || file.fsPath.indexOf("node_modules") !== -1) {
            continue;
        }
        const contents = await readTextFileAsync(file);
        const jres = JSON.parse(contents);

        const defaultMimeType: string | undefined = jres["*"]?.mimeType;
        const globalNamespace: string | undefined = jres["*"]?.namespace;

        for (const key of Object.keys(jres)) {
            if (key === "*") {
                continue;
            }

            const value = jres[key];
            const ns = jres[key].namespace || globalNamespace;
            const id = key.startsWith(ns) ? key : namespaceJoin(ns, key);

            if (typeof value === "string") {
                nodes.push({
                    kind: mimeTypeToKind(defaultMimeType!),
                    id: id,
                    name: id,
                    sourceFile: file,
                    uri: vscode.Uri.from({
                        scheme: "vscode.env.uriScheme",
                        authority: "makecode",
                        path: "/" + namespaceJoin("asset", mimeTypeToKind(defaultMimeType!), id!)
                    })
                });
            }
            else {
                nodes.push({
                    kind: mimeTypeToKind(jres[key].mimeType || defaultMimeType, jres[key].tilemapTile),
                    id: id,
                    name: jres[key].displayName,
                    sourceFile: file,
                    uri: vscode.Uri.from({
                        scheme: "vscode.env.uriScheme",
                        authority: "makecode",
                        path: "/" + namespaceJoin("asset", mimeTypeToKind(jres[key].mimeType || defaultMimeType, jres[key].tilemapTile), id!)
                    })
                });
            }
        }
    }

    return nodes;
}

function mimeTypeToKind(mime: string, isTile?: boolean) {
    switch (mime) {
        case "image/x-mkcd-f4":
            return isTile ? "tile" : "image";
        case "application/mkcd-tilemap":
            return "tilemap";
        case "application/mkcd-animation":
            return "animation";
        case "application/mkcd-song":
            return "song";
    }

    return "image";
}

function namespaceJoin(...parts: string[]) {
    let res = parts.shift();
    while (parts.length) {
        res = namespaceJoinCore(res!, parts.shift()!);
    }
    return res;
}

function namespaceJoinCore(a: string, b: string) {
    if (a.endsWith(".")) {
        a = a.slice(0, a.length - 1);
    }
    if (b.startsWith(".")) {
        b = b.slice(1);
    }
    return a + "." + b;
}

function kindToDisplayName(kind: string) {
    return kind.charAt(0).toUpperCase() + kind.substring(1) + "s";
}