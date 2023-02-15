import * as vscode from "vscode";

import { setActiveWorkspace } from "./host";
import * as cmd from "makecode-core/built/commands";

interface Operation<U> {
    folder: vscode.WorkspaceFolder;
    action: () => Promise<U>;
    resolve: (result: U) => void;
    reject: (e?: any) => void;
    cancellationToken?: vscode.CancellationToken;
}

let operationQueue: Operation<any>[] = [];
let currentlyWorking = false;


export function buildProjectAsync(folder: vscode.WorkspaceFolder, options?: cmd.BuildOptions, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(folder, () => cmd.buildCommandOnce(options || { watch: true }), cancellationToken);
}

export function installDependenciesAsync(folder: vscode.WorkspaceFolder, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(folder, () => cmd.installCommand({}), cancellationToken);
}

export function cleanProjectFolderAsync(folder: vscode.WorkspaceFolder, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(folder, () => cmd.cleanCommand({}), cancellationToken);
}

export function createEmptyProjectAsync(folder: vscode.WorkspaceFolder, projectKind: string, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(
        folder,
        () => cmd.initCommand(projectKind, [], {
            vscodeProject: true,
            gitIgnore: true,
            update: true,
        }),
        cancellationToken
    );
}

export function downloadSharedProjectAsync(folder: vscode.WorkspaceFolder, url: string, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(
        folder,
        () => cmd.initCommand("shared", [], {
            vscodeProject: true,
            gitIgnore: true,
            importUrl: url,
            update: true,
        }),
        cancellationToken
    );
}

export function listHardwareVariantsAsync(folder: vscode.WorkspaceFolder, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(folder, () => cmd.listHardwareVariantsAsync({}), cancellationToken);
}

export function getAppTargetAsync(folder: vscode.WorkspaceFolder, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(folder, () => cmd.getAppTargetAsync({}), cancellationToken);
}

export function getTargetConfigAsync(folder: vscode.WorkspaceFolder, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(folder, () => cmd.getTargetConfigAsync({}), cancellationToken);
}

export function addDependencyAsync(folder: vscode.WorkspaceFolder, repo: string, cancellationToken?: vscode.CancellationToken) {
    return enqueueOperationAsync(folder, () => cmd.addCommand(repo, undefined as any /* the name is optional */, {}), cancellationToken);
}

/**
 * The mkc CLI uses global state, so we need to perform operations in a queue just in case the
 * user is doing things in multiple workspaces at once
 */
function enqueueOperationAsync<U>(folder: vscode.WorkspaceFolder, action: () => Promise<U>, cancellationToken?: vscode.CancellationToken): Promise<U> {
    return new Promise((resolve, reject) => {
        const op = {
            folder,
            action,
            resolve,
            reject,
            cancellationToken
        };
        operationQueue.push(op);

        if (cancellationToken) {
            cancellationToken.onCancellationRequested(e => {
                reject(e);
                operationQueue = operationQueue.filter(o => o !== op);
            });
        }
        pokeQueueAsync();
    });
}

async function pokeQueueAsync() {
    if (currentlyWorking) {
        return;
    }

    while (operationQueue.length) {
        const op = operationQueue.shift()!;
        if (op.cancellationToken?.isCancellationRequested) {
            continue;
        }

        currentlyWorking = true;
        setActiveWorkspace(op.folder);

        try {
            const res = await op.action();
            op.resolve(res);
        }
        catch (e) {
            op.reject(e);
        }
        finally {
            currentlyWorking = false;
        }
    }
}