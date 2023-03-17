import * as vscode from "vscode";

interface ActionTreeNode {
    label: string;
    icon: vscode.ThemeIcon;
    command: vscode.Command;
}

const actions: ActionTreeNode[] = [
    {
        label: vscode.l10n.t("Create an empty project"),
        icon: new vscode.ThemeIcon("preview"),
        command: {
            title: vscode.l10n.t("Create an empty project"),
            command: "makecode.create"
        }
    },
    {
        label: vscode.l10n.t("Import project from URL"),
        icon: new vscode.ThemeIcon("cloud-download"),
        command: {
            title: vscode.l10n.t("Import project from URL"),
            command: "makecode.importUrl"
        }
    },
    {
        label: vscode.l10n.t("Start MakeCode simulator"),
        icon: new vscode.ThemeIcon("play-circle"),
        command: {
            title: vscode.l10n.t("Start MakeCode simulator"),
            command: "makecode.simulate"
        }
    },
    {
        label: vscode.l10n.t("Create MakeCode Share Link"),
        icon: new vscode.ThemeIcon("export"),
        command: {
            title: vscode.l10n.t("Create MakeCode Share Link"),
            command: "makecode.shareProject"
        }
    },
    {
        label: vscode.l10n.t("Compile project to uf2/hex"),
        icon: new vscode.ThemeIcon("desktop-download"),
        command: {
            title: vscode.l10n.t("Build MakeCode project"),
            command: "makecode.build"
        }
    },
    {
        label: vscode.l10n.t("Add an extension"),
        icon: new vscode.ThemeIcon("add"),
        command: {
            title: vscode.l10n.t("Add an extension"),
            command: "makecode.addDependency"
        }
    },
    {
        label: vscode.l10n.t("Install project dependencies"),
        icon: new vscode.ThemeIcon("sync"),
        command: {
            title: vscode.l10n.t("Install project dependencies"),
            command: "makecode.install"
        }
    },
    {
        label: vscode.l10n.t("Open Arcade Docs"),
        icon: new vscode.ThemeIcon("question"),
        command: {
            title: vscode.l10n.t("Open Arcade Docs"),
            command: "makecode.openHelpDocs"
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