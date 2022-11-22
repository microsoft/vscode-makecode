import * as vscode from 'vscode';

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

async function fileExistsAsync(path: vscode.Uri) {
    try {
        const stat = await vscode.workspace.fs.stat(path);
        return true;
    }
    catch {
        return false
    }
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