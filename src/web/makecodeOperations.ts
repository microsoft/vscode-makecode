import * as vscode from "vscode";

import { setActiveWorkspace } from "./host";
import * as cmd from "makecode-core/built/commands";
import { AsyncActionQueue } from "./util";

const queue = new AsyncActionQueue();

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
function enqueueOperationAsync<U>(folder: vscode.WorkspaceFolder, action: () => Promise<U>, cancellationToken?: vscode.CancellationToken): Promise<U | undefined> {
    return queue.enqueue(async () => {
        if (cancellationToken?.isCancellationRequested) return undefined;

        setActiveWorkspace(folder);
        return await action();
    });
}