import * as vscode from "vscode";
import { AssetKind, getCurrentJresNodes, JResTreeNode } from "./jres";

export function codeActionsProvider() {
    return vscode.languages.registerCodeActionsProvider(
        "typescript",
        {
            provideCodeActions(document, range, context, token) {
                const jresNodes = getCurrentJresNodes();
                if (!jresNodes)
                    return undefined;
                const start = range.start;
                const line = document.lineAt(start.line);
                const matchRegex = /assets\.(image|tile|tilemap|animation|song)`([a-z0-9 _-]+)`/ig;

                let match: RegExpExecArray | null;
                let output = [];
                while (match = matchRegex.exec(line.text)) {
                    const assetType = match[1].toLowerCase() as AssetKind;
                    const givenAssetName = match[2];

                    if (assetType === "tile" && /transparency\d+/.test(givenAssetName)) {
                        continue;
                    }

                    const asset = jresNodes.find(node => node.name === givenAssetName || node.id === givenAssetName);
                    output.push(
                        asset?.uri
                            ? editCodeAction(asset, givenAssetName)
                            : createCodeAction(assetType, givenAssetName)
                    );
                }

                return output;
            }
        },
        {
            providedCodeActionKinds: [
                vscode.CodeActionKind.Refactor,
                vscode.CodeActionKind.QuickFix
            ]
        }
    )
}

function editCodeAction(asset: JResTreeNode, givenName: string) {
    return ({
        title: vscode.l10n.t("Edit {0} '{1}'", asset.kind, givenName),
        command: {
            title: vscode.l10n.t("Open MakeCode asset"),
            command: "makecode.openAsset",
            arguments: [
                asset.uri
            ],
        },
        isPreferred: true
    });
}

function createCodeAction(type: AssetKind, name: string) {
    return ({
        title: vscode.l10n.t("Create new {0} '{1}'", type, name),
        command: {
            title: vscode.l10n.t("Create MakeCode Asset"),
            command: "makecode.createAsset",
            arguments: [
                type,
                name
            ]
        },
        isPreferred: true
    })
}