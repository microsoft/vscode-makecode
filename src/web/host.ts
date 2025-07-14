import { Host, HttpRequestOptions, HttpResponse } from "makecode-core/built/host";
import { BrowserLanguageService } from "makecode-browser/built/languageService";
import * as vscode from "vscode";
import * as path from "path-browserify"

let _activeWorkspace: vscode.WorkspaceFolder;

export function createVsCodeHost(): Host {
    return {
        readFileAsync: async (p, e) => readFileAsync(rmFolderPrefix(p), e as any),
        writeFileAsync: async (p, c, e) => writeFileAsync(rmFolderPrefix(p), c, e),
        mkdirAsync: async (p) => mkdirAsync(rmFolderPrefix(p)),
        rmdirAsync: async (p, o) => rmdirAsync(rmFolderPrefix(p), o),
        existsAsync: async (p) => existsAsync(rmFolderPrefix(p)),
        unlinkAsync: async (p) => unlinkAsync(rmFolderPrefix(p)),
        cwdAsync: async () => getFolderName(),
        symlinkAsync: async () => { },
        listFilesAsync: async (d, f) => listFilesAsync(rmFolderPrefix(d), f),
        requestAsync: httpRequestCoreAsync,
        createLanguageServiceAsync: async (editor) => new BrowserLanguageService(editor),
        getDeployDrivesAsync: async () => [],
        getEnvironmentVariable: () => "",
        exitWithStatus: code => {
            throw new Error(`Exit with status ${code}`);
        },
        bufferToString: buffer => new TextDecoder().decode(buffer),
        stringToBuffer,
        base64EncodeBufferAsync
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
    if (encoding === "base64") {
        content = Uint8Array.from(atob(content), c => c.charCodeAt(0));
    } else if (typeof content === "string") {
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
        const resolvedPath = resolvePath(path);
        const stat = await vscode.workspace.fs.stat(resolvedPath);
        return true;
    }
    catch (e) {
        return false;
    }
}

async function unlinkAsync(path: string): Promise<void> {
    await vscode.workspace.fs.delete(resolvePath(path));
}

// pxt-mkc only has access under the current workspace folder (see resolvePath),
// so give an alias for that path.
function getFolderName() {
    return `file:${path.basename(activeWorkspace().uri.path)}`;
}

function rmFolderPrefix(p: string) {
    const cwd = getFolderName();
    p = p.replace(/^[\/]+/, "")
    if (p.startsWith(cwd))
        return p.slice(cwd.length);
    return p;
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

export async function httpRequestCoreAsync(options: HttpRequestOptions) {
    const headers = options.headers || {};
    const data = options.data;
    const method = options.method || (data == null ? "GET" : "POST");

    let buf: null | Uint8Array | string;

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

    const requestHeaders = new Headers();
    Object.keys(headers).forEach(k => {
        requestHeaders.set(k, headers[k]);
    });

    const resp = await fetch(options.url, {
        method,
        headers: requestHeaders,
        body: buf
    });

    const body = await resp.arrayBuffer();

    let text: string | undefined;

    try {
        text = new TextDecoder().decode(body);
    }
    catch (e) {
        // binary data
    }

    const res: HttpResponse = {
        statusCode: resp.status,
        headers: {},
        buffer: new Uint8Array(body),
        text,
    };

    resp.headers.forEach((value, key) => res.headers[key.toLowerCase()] = value);

    return res;
}

function resolvePath(path: string) {
    return vscode.Uri.joinPath(activeWorkspace().uri, path);
}

export function stringToBuffer(str: string, encoding?: string) {
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

function base64EncodeBufferAsync(buffer: Uint8Array | ArrayBuffer): Promise<string> {
    return new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => {
            const url = reader.result as string;
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.readAsDataURL(new Blob([buffer]));
    });
}