import * as vscode from 'vscode';
import { fileExistsAsync } from './extension';
import { installDependenciesAsync } from './makecodeOperations';
import { readTextFileAsync, writeTextFileAsync } from './util';

export async function maybeShowConfigNotificationAsync() {
    if (!vscode.workspace.workspaceFolders) {
        return;
    }

    const foldersToFix: vscode.WorkspaceFolder[] = [];
    for (const folder of vscode.workspace.workspaceFolders) {
        if (await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "tsconfig.json"))) {
            continue;
        }
        if (!(await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "pxt.json")))) {
            continue;
        }
        foldersToFix.push(folder);
    }

    if (foldersToFix.length === 0) {
        return;
    }

    const selection = await vscode.window.showWarningMessage("MakeCode project is missing a tsconfig.json file.", "Add tsconfig.json");

    if (!selection) {
        return;
    }

    for (const folder of foldersToFix) {
        await writeTextFileAsync(vscode.Uri.joinPath(folder.uri, "tsconfig.json"), templateConfig);
    }
}

export async function writeTSConfigAsync(folder: vscode.Uri) {
    if (await fileExistsAsync(vscode.Uri.joinPath(folder, "tsconfig.json"))) {return;}

    await writeTextFileAsync(vscode.Uri.joinPath(folder, "tsconfig.json"), templateConfig);
}

export async function maybeShowDependenciesNotificationAsync() {
    if (!vscode.workspace.workspaceFolders) {
        return;
    }

    const foldersToFix: vscode.WorkspaceFolder[] = [];
    for (const folder of vscode.workspace.workspaceFolders) {
        if (!(await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "pxt.json")))) {
            continue;
        }
        if (await fileExistsAsync(vscode.Uri.joinPath(folder.uri, "pxt_modules"))) {
            continue;
        }

        try {
            const config = await readTextFileAsync(vscode.Uri.joinPath(folder.uri, "pxt.json"));
            const parsed = JSON.parse(config);

            if (Object.keys(parsed.dependencies).length > 0) {
                foldersToFix.push(folder);
            }
        }
        catch {
            continue;
        }
    }

    if (foldersToFix.length === 0) {
        return;
    }

    const selection = await vscode.window.showInformationMessage("Do you want to install the dependencies of all open MakeCode projects?", "Install dependencies");
    if (!selection) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Installing dependencies...",
        cancellable: false
    }, async progress => {
        for (const folder of foldersToFix) {
            progress.report({
                message: `Installing dependencies for ${folder.name}...`
            });

            try {
                await installDependenciesAsync(folder);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error while installing dependencies for ${folder.name}: ${e}`);
            }
        }
    });
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