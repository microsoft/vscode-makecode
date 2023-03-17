import * as vscode from "vscode";
import { getCurrentJresNodes } from "./jres";

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
                // TODO; g to match multiple assets? e.g. if they have [assets.image`coolimage1`, assets.image`coolimage2`]; give two suggestions
                const match = /assets\.(image|tile|tilemap|animation|song)`([a-z0-9]+)`/i.exec(line.text);
                if (match) {
                    const assetType = match[1].toLowerCase();
                    const assetName = match[2];

                    const asset = jresNodes.find(node => node.name === assetName || node.id === assetName);
                    if (asset?.uri) {
                        return [
                            {
                                title: vscode.l10n.t("Edit {0} '{1}'", asset.kind, assetName),
                                command: {
                                    title: vscode.l10n.t("Open MakeCode asset"),
                                    command: "makecode.openAsset",
                                    arguments: [
                                        asset.uri
                                    ],
                                },
                                isPreferred: true
                            }
                        ]
                    } else {
                        return [
                            {
                                title: vscode.l10n.t("Create new {0} '{1}'", assetType, assetName),
                                command: {
                                    title: vscode.l10n.t("Create MakeCode asset"),
                                    command: "makecode.createAsset",
                                    arguments: [
                                        assetType,
                                        assetName
                                    ]
                                },
                                isPreferred: true
                            }
                        ]
                    }
                }
                return undefined;

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