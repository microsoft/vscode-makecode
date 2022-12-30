import * as vscode from "vscode";

interface ActionTreeNode {
    label: string;
    icon: vscode.ThemeIcon;
    command: vscode.Command;
}

const actions: ActionTreeNode[] = [
    {
        label: "Start MakeCode simulator",
        icon: new vscode.ThemeIcon("play-circle"),
        command: {
            title: "Start MakeCode simulator",
            command: "makecode.simulate"
        }
    },
    {
        label: "Install project dependencies",
        icon: new vscode.ThemeIcon("sync"),
        command: {
            title: "Install project dependencies",
            command: "makecode.install"
        }
    },
    {
        label: "Compile project to uf2/hex",
        icon: new vscode.ThemeIcon("desktop-download"),
        command: {
            title: "Build MakeCode project",
            command: "makecode.build"
        }
    },
    {
        label: "Create a share link",
        icon: new vscode.ThemeIcon("export"),
        command: {
            title: "Install project dependencies",
            command: "makecode.install"
        }
    }
]

export class ActionsTreeViewProvider implements vscode.TreeDataProvider<ActionTreeNode> {
    onDidChangeTreeData?: vscode.Event<void | ActionTreeNode | ActionTreeNode[] | null | undefined> | undefined;

    getTreeItem(element: ActionTreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return {
            label: element.label,
            iconPath: element.icon,
            command: element.command,
            collapsibleState: vscode.TreeItemCollapsibleState.None
        };
    }

    getChildren(element?: ActionTreeNode | undefined): vscode.ProviderResult<ActionTreeNode[]> {
        if (!element) return actions;
        return [];
    }
}