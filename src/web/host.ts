import { Host, HttpRequestOptions, HttpResponse } from "makecode-core/built/host";
import { BrowserLanguageService } from "makecode-browser/built/languageService";
import * as vscode from "vscode";
import * as path from "path-browserify"

let _activeWorkspace: vscode.WorkspaceFolder;

export function createVsCodeHost(): Host {
    return {
        readFileAsync,
        writeFileAsync,
        mkdirAsync,
        rmdirAsync,
        existsAsync,
        unlinkAsync,
        cwdAsync,
        symlinkAsync: async () => {},
        listFilesAsync: listFilesAsync,
        requestAsync: httpRequestCoreAsync,
        createLanguageServiceAsync: async (editor) => new BrowserLanguageService(editor),
        getDeployDrivesAsync: async () => [],
        getEnvironmentVariable: () => "",
        exitWithStatus: code => {
            throw new Error(`Exit with status ${code}`);
        },
        bufferToString: buffer => new TextDecoder().decode(buffer),
        stringToBuffer
    };
}

export function readFileAsync(path: string, encoding: "utf8"): Promise<string>;
export async function readFileAsync(path: string, encoding?: "utf8") {
    const contents = await vscode.workspace.fs.readFile(resolvePath(path));
    if (encoding) {
        return new TextDecoder().decode(contents);
    }
    return contents;
}

export async function writeFileAsync(path: string, content: any, encoding?: "base64" | "utf8"): Promise<void> {
    if (typeof content === "string") {
        content = new TextEncoder().encode(content);
    }

    await vscode.workspace.fs.writeFile(
        resolvePath(path),
        content
    );
}

async function mkdirAsync(path: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(resolvePath(path));
}

async function rmdirAsync(path: string, options: any): Promise<void> {
    await vscode.workspace.fs.delete(
        resolvePath(path),
        {
            recursive: options.recursive
        }
    );
}

export async function existsAsync(path: string): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(resolvePath(path));
        return true;
    }
    catch (e) {
        return false;
    }
}

async function unlinkAsync(path: string): Promise<void> {
    await vscode.workspace.fs.delete(resolvePath(path));
}

async function cwdAsync() {
    return activeWorkspace().uri.fsPath;
}

async function listFilesAsync(directory: string, filename: string) {
    const root = vscode.Uri.joinPath(activeWorkspace().uri, directory);
    const files = await findFilesAsync(filename, root, true);

    return files.map(uri => {
        if (uri.fsPath.startsWith(root.fsPath)) {
            return uri.fsPath.replace(root.fsPath, "").replace(/\\/g, "/")
        }
        return uri.fsPath;
    });
}

export function httpRequestCoreAsync(options: HttpRequestOptions) {
    return new Promise<HttpResponse>((resolve, reject) => {
        let client: XMLHttpRequest;
        let resolved = false;

        let headers = options.headers || {};

        client = new XMLHttpRequest();
        client.onreadystatechange = () => {
            if (resolved) {return;} // Safari/iOS likes to call this thing more than once

            if (client.readyState === 4) {
                resolved = true;
                let res: HttpResponse = {
                    statusCode: client.status,
                    headers: {},
                    buffer: (client as any).responseBody || client.response,
                    text: client.responseText,
                };

                if (typeof res.buffer === "string") {
                    res.buffer = new TextEncoder().encode(res.buffer);
                }
                const allHeaders = client.getAllResponseHeaders();
                allHeaders.split(/\r?\n/).forEach(l => {
                    let m = /^\s*([^:]+): (.*)/.exec(l);
                    if (m) {
                        res.headers[m[1].toLowerCase()] = m[2];
                    }
                });
                resolve(res);
            }
        };

        let data = options.data;
        let method = options.method || (data == null ? "GET" : "POST");

        let buf: any;

        if (data == null) {
            buf = null;
        } else if (data instanceof Uint8Array) {
            buf = data;
        } else if (typeof data === "object") {
            buf = JSON.stringify(data);
            headers["content-type"] = "application/json; charset=utf8";
        } else if (typeof data === "string") {
            buf = data;
        } else {
            throw new Error("bad data");
        }

        client.open(method, options.url);

        Object.keys(headers).forEach(k => {
            client.setRequestHeader(k, headers[k]);
        });

        if (buf == null) {
            client.send();
        }
        else {
            client.send(buf);
        }
    });
}

function resolvePath(path: string) {
    path = path.replace("\\/", "");
    return vscode.Uri.joinPath(activeWorkspace().uri, path);
}

export function stringToBuffer(str: string, encoding?: string){
    let contents: string;
    if (encoding === "base64") {
        try {
            contents = atob(str);
        }
        catch (e) {
            // mimic Buffer.from() in node.js which just ignores invalid characters

            contents = atob(str.replace(/[^a-zA-Z\d+/]/g, ""));
        }
    }
    else {
        contents = str;
    }

    return new TextEncoder().encode(contents);
}

export function setActiveWorkspace(folder: vscode.WorkspaceFolder) {
    _activeWorkspace = folder;
}

export function activeWorkspace() {
    if (!_activeWorkspace) {
        _activeWorkspace = vscode.workspace.workspaceFolders![0];
    }
    return _activeWorkspace;
}

export async function findFilesAsync(extension: string, root: vscode.Uri, matchWholeName: boolean, maxDepth = 5) {
    // For some reason, vscode.workspace.findFiles doesn't work on virtual filesystems. If we aren't on a
    // virtual file system, we can still use it.
    if (root.scheme === "file") {
        return await vscode.workspace.findFiles("**/" + (matchWholeName ? extension : `*.${extension}`))
    }

    if (maxDepth === 0) return [];

    const files = await vscode.workspace.fs.readDirectory(root);
    const result: vscode.Uri[] = [];
    const recursivePromises: Promise<vscode.Uri[]>[] = [];
    for (const file of files) {
        const [fileName, type] = file;

        const uri = vscode.Uri.joinPath(root, fileName);

        if (type === vscode.FileType.Directory) {
            recursivePromises.push(findFilesAsync(extension, uri, matchWholeName, maxDepth - 1))
        }
        else if (type === vscode.FileType.File) {
            if (matchWholeName) {
                if (fileName === extension) {
                    result.push(uri);
                }
            }
            else if (fileName.endsWith("." + extension)) {
                result.push(uri);
            }
        }
    }

    const subdirs = await Promise.all(recursivePromises);
    for (const dir of subdirs) {
        result.push(...dir);
    }

    return result;
}