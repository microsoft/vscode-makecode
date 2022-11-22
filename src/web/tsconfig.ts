import * as vscode from 'vscode';
import { fileExistsAsync } from './extension';

export async function maybeShowConfigNotificationAsync() {
    if (!vscode.workspace.workspaceFolders) return;

    const foldersToFix: vscode.WorkspaceFolder[] = [];
    for (const folder of vscode.workspace.workspaceFolders) {
        if (await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "tsconfig.json"))) continue;
        if (!(await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "pxt.json")))) continue;
        foldersToFix.push(folder);
    }

    if (foldersToFix.length == 0) return;

    const selection = await vscode.window.showWarningMessage("MakeCode project is missing a tsconfig.json file.", "Add tsconfig.json");

    if (!selection) return;

    for (const folder of foldersToFix) {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder.uri, "tsconfig.json"), new TextEncoder().encode(templateConfig));
    }
}

export async function writeTSConfigAsync(folder: vscode.Uri) {
    if (await fileExistsAsync(vscode.Uri.joinPath(folder, "tsconfig.json"))) return;

    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, "tsconfig.json"), new TextEncoder().encode(templateConfig));
}


const templateConfig = `{
    "compilerOptions": {
        "target": "ES5",
        "noImplicitAny": true,
        "outDir": "built",
        "rootDir": "."
    },
    "include": [
        "**/*.ts"
    ],
    "exclude": [
        "built/**",
        "pxt_modules/**/*test.ts"
    ]
}
`;