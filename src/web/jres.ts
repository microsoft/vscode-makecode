import * as vscode from "vscode";


export interface JResTreeNode {
    kind: "image" | "tile" | "tilemap" | "animation" | "song";
    id?: string;
    name?: string;
    sourceFile?: vscode.Uri;
    uri?: vscode.Uri;
}

let model: JResTreeModel;

class JResTreeModel {
    nodes: JResTreeNode [] = [];
    eventEmitter: vscode.EventEmitter<JResTreeNode[]>;

    constructor() {
        this.eventEmitter = new vscode.EventEmitter<JResTreeNode[]>();
        this.refreshJresAsync();
    }


    async refreshJresAsync() {
        this.nodes = await readProjectJRESAsync();

        this.eventEmitter.fire(this.nodes);
    }
}

export class JResTreeProvider implements vscode.TreeDataProvider<JResTreeNode> {

    onDidChangeTreeData: vscode.Event<JResTreeNode[]>;

    constructor(public kind: "image" | "tile" | "tilemap" | "animation" | "song") {
        if (!model) {
            model = new JResTreeModel();
        }
        this.onDidChangeTreeData = model.eventEmitter.event
    }

    getTreeItem(element: JResTreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return {
            label: element.name || kindToDisplayName(element.kind),
            resourceUri: element.uri,
            command: element.id ? {
                title: "Open MakeCode asset",
                command: "makecode.openAsset",
                arguments: [element.uri],
            } : undefined,
            collapsibleState: element.id ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
        }
    }

    getChildren(element?: JResTreeNode | undefined): vscode.ProviderResult<JResTreeNode[]> {
        if (!element) return model.nodes.filter(node => node.kind === this.kind);
        return [];
    }

    getParent(element: JResTreeNode): vscode.ProviderResult<JResTreeNode> {
        return undefined;
    }
}


async function readProjectJRESAsync() {
    const nodes: JResTreeNode[] = [];
    const files = await vscode.workspace.findFiles("**/*.jres");

    for (const file of files) {
        if (file.fsPath.indexOf("pxt_modules") !== -1 || file.fsPath.indexOf("node_modules") !== -1) continue;
        const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
        const jres = JSON.parse(contents);

        const defaultMimeType: string | undefined = jres["*"]?.mimeType;
        const globalNamespace: string | undefined = jres["*"]?.namespace;

        for (const key of Object.keys(jres)) {
            if (key === "*") continue;

            const value = jres[key];
            const id = (jres[key].namespace || globalNamespace) + "." + key;

            if (typeof value === "string") {
                nodes.push({
                    kind: mimeTypeToKind(defaultMimeType!),
                    id: id,
                    name: id,
                    sourceFile: file,
                    uri: vscode.Uri.from({
                        scheme: "vscode.env.uriScheme",
                        authority: "makecode",
                        path: "/asset." + mimeTypeToKind(defaultMimeType!) + "." + id
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
                        path: "/asset." + mimeTypeToKind(jres[key].mimeType || defaultMimeType, jres[key].tilemapTile) + "." + id
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

function kindToDisplayName(kind: string) {
    return kind.charAt(0).toUpperCase() + kind.substring(1) + "s";
}