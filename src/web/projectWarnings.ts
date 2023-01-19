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

    const selection = await vscode.window.showWarningMessage(vscode.l10n.t("MakeCode project is missing a tsconfig.json file."), vscode.l10n.t("Add tsconfig.json"));

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

    const selection = await vscode.window.showInformationMessage(vscode.l10n.t("Do you want to install the dependencies of all open MakeCode projects?"), vscode.l10n.t("Install dependencies"));
    if (!selection) {
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Installing dependencies..."),
        cancellable: false
    }, async progress => {
        for (const folder of foldersToFix) {
            progress.report({
                message: vscode.l10n.t('Installing dependencies for {0}', folder.name)
            });

            try {
                await installDependenciesAsync(folder);
            }
            catch (e) {
                let errorMessage = '';
                if (typeof e === 'string') {
                    errorMessage = e;
                } else if (e instanceof Error) {
                    errorMessage = e.message;
                }
                vscode.window.showErrorMessage(vscode.l10n.t('Error while installing dependencies for {0}: {1}', folder.name, errorMessage));
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