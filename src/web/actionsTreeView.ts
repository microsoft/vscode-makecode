import * as vscode from "vscode";

interface ActionTreeNode {
    label: string;
    icon: vscode.ThemeIcon;
    command: vscode.Command;
}

const actions: ActionTreeNode[] = [
    {
        label: vscode.l10n.t("Create a New Project"),
        icon: new vscode.ThemeIcon("preview"),
        command: {
            title: vscode.l10n.t("Create an New Project"),
            command: "makecode.create"
        }
    },
    {
        label: vscode.l10n.t("Import Project From URL"),
        icon: new vscode.ThemeIcon("cloud-download"),
        command: {
            title: vscode.l10n.t("Import Project From URL"),
            command: "makecode.importUrl"
        }
    },
    {
        label: vscode.l10n.t("Start MakeCode Simulator"),
        icon: new vscode.ThemeIcon("play-circle"),
        command: {
            title: vscode.l10n.t("Start MakeCode Simulator"),
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
        label: vscode.l10n.t("Build Project for Hardware"),
        icon: new vscode.ThemeIcon("desktop-download"),
        command: {
            title: vscode.l10n.t("Build Project for Hardware"),
            command: "makecode.build"
        },
    },
    {
        label: vscode.l10n.t("Add an Extension"),
        icon: new vscode.ThemeIcon("add"),
        command: {
            title: vscode.l10n.t("Add an Extension"),
            command: "makecode.addDependency"
        }
    },
    {
        label: vscode.l10n.t("Install Project Dependencies"),
        icon: new vscode.ThemeIcon("sync"),
        command: {
            title: vscode.l10n.t("Install Project Dependencies"),
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