import * as path from "path-browserify"
import * as vscode from "vscode"
import { importUrlCommand } from "./extension";

export class VFS implements vscode.FileSystemProvider {
    private initializedDirs: {[index: string]: boolean} = {}
    private initializePromises: {[index: string]: Promise<void> | undefined} = {}
    constructor(private context: vscode.ExtensionContext) {
    }

    // --- manage file metadata

    async stat(uri: vscode.Uri) {
        return vscode.workspace.fs.stat(await this.remapURI(uri));
    }

    async readDirectory(uri: vscode.Uri) {
        return vscode.workspace.fs.readDirectory(await this.remapURI(uri));
    }

    async readFile(uri: vscode.Uri) {
        return vscode.workspace.fs.readFile(await this.remapURI(uri));
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; readonly?: true }) {
        await vscode.workspace.fs.writeFile(await this.remapURI(uri), content);
        this._fireSoon({ type: vscode.FileChangeType.Changed, uri })
    }

    // --- manage files/folders

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }) {
        await vscode.workspace.fs.rename(await this.remapURI(oldUri), await this.remapURI(newUri), options);
        this._fireSoon({ type: vscode.FileChangeType.Deleted, uri: oldUri }, { type: vscode.FileChangeType.Created, uri: newUri })
    }

    async delete(uri: vscode.Uri, options: { readonly recursive: boolean }) {
        await vscode.workspace.fs.delete(await this.remapURI(uri), options);
        const dirname = uri.with({ path: path.posix.dirname(uri.path) })
        this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { uri, type: vscode.FileChangeType.Deleted })
    }

    async createDirectory(uri: vscode.Uri) {
        await vscode.workspace.fs.createDirectory(await this.remapURI(uri));
        const dirname = uri.with({ path: path.posix.dirname(uri.path) })

        this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { type: vscode.FileChangeType.Created, uri })
    }

    private async existsAsync(uri: vscode.Uri) {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return !!stat
        }
        catch (e) {
            return false;
        }
    }

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    private _bufferedEvents: vscode.FileChangeEvent[] = []
    private _fireSoonHandle?: any;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event

    watch(_resource: vscode.Uri): vscode.Disposable {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => {})
    }

    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events)

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle)
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents)
            this._bufferedEvents.length = 0
        }, 5)
    }

    private async remapURI(uri: vscode.Uri) {
        const uriPath = uri.path;

        const parts = uriPath.split(/\/|\\/);
        while (!parts[0] && parts.length) parts.shift();

        if (parts.length) {
            if (/^(?:S?\d{4}[\d\-]+|_[a-zA-Z0-9]{10,})$/.test(parts[0])) {
                if (!this.initializedDirs[parts[0]]) {
                    if (!this.initializePromises[parts[0]]) {
                        this.initializePromises[parts[0]] = this.initializeDir(parts[0])
                    }
                    await this.initializePromises[parts[0]];
                }
            }
            else if (/^(?:(?:S?\d{4}[\d\-]+|_[a-zA-Z0-9]{10,})\.code-workspace)$/.test(parts[0])) {
                if (!this.initializedDirs[parts[0]]) {
                    if (!this.initializePromises[parts[0]]) {
                        this.initializePromises[parts[0]] = this.initializeWorkspace(parts[0])
                    }
                    await this.initializePromises[parts[0]];
                }
            }
        }

        return vscode.Uri.joinPath(this.context.globalStorageUri, uriPath);
    }

    private async initializeDir(shareId:  string) {
        const projectDir = vscode.Uri.joinPath(this.context.globalStorageUri, shareId);
        const pxtJSON = vscode.Uri.joinPath(projectDir, "pxt.json");

        if (!(await this.existsAsync(projectDir))) {
            await vscode.workspace.fs.createDirectory(projectDir);
        }
        if (!(await this.existsAsync(pxtJSON))) {
            await importUrlCommand(shareId, { name: shareId, uri: projectDir, index: 0 })
        }
        this.initializedDirs[shareId] = true;
    }

    private async initializeWorkspace(name: string) {
        const workspacePath = vscode.Uri.joinPath(this.context.globalStorageUri, name);
        if (!(await this.existsAsync(workspacePath))) {
            const shareId = /^(S?\d{4}[\d\-]+|_[a-zA-Z0-9]{10,})\.code-workspace$/.exec(name)![1];
            await vscode.workspace.fs.writeFile(workspacePath, new TextEncoder().encode(JSON.stringify({ folders: [ { path: "./" + shareId } ] })))
        }
        this.initializedDirs[name] = true;
    }
}