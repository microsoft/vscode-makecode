import * as vscode from "vscode";

// Returns a function, that, as long as it continues to be invoked, will only
// trigger every N milliseconds. If `immediate` is passed, trigger the
// function on the leading edge, instead of the trailing.
export function throttle(func: (...args: any[]) => any, wait: number, immediate?: boolean): any {
    let timeout: any;
    let lastArgs: IArguments | undefined;
    return function (this: any) {
        const context = this;
        lastArgs = arguments;
        const later = () => {
            timeout = null;
            if (!immediate) {
                func.apply(context, lastArgs as any);
                lastArgs = undefined;
            }
        };
        const callNow = immediate && !timeout;
        if (!timeout) {
            timeout = setTimeout(later, wait);
        }
        if (callNow) {
            func.apply(context, lastArgs as any);
            lastArgs = undefined;
        }
    };
}

// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
export function debounce(func: (...args: any[]) => any, wait: number, immediate?: boolean): any {
    let timeout: any;
    return function (this: any) {
        const context = this
        const args = arguments;
        const later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args as any);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args as any);
        return timeout;
    };
}

export function delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export async function readTextFileAsync(uri: vscode.Uri): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export async function writeTextFileAsync(uri: vscode.Uri, contents: string) {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(contents));
}

export async function getPxtJson(workspace: vscode.WorkspaceFolder) {
    const configPath = vscode.Uri.joinPath(workspace.uri, "pxt.json");

    const config = await readTextFileAsync(configPath);
    const parsed = JSON.parse(config) as pxt.PackageConfig;
    return parsed;
}

export async function setPxtJson(workspace: vscode.WorkspaceFolder, pxtJson: pxt.PackageConfig) {
    const configPath = vscode.Uri.joinPath(workspace.uri, "pxt.json");
    await writeTextFileAsync(
        configPath,
        JSON.stringify(pxtJson, null, 4)
    );
}


function getRandomBuf(buf: Uint8Array) {
    if (crypto)
        crypto.getRandomValues(buf);
    else {
        for (let i = 0; i < buf.length; ++i)
            buf[i] = Math.floor(Math.random() * 255);
    }
}

function randomUint32() {
    let buf = new Uint8Array(4)
    getRandomBuf(buf)
    return new Uint32Array(buf.buffer)[0]
}

export function guidGen() {
    function f() { return (randomUint32() | 0x10000).toString(16).slice(-4); }
    return f() + f() + "-" + f() + "-4" + f().slice(-3) + "-" + f() + "-" + f() + f() + f();
}

export function showQuickPickAsync<U extends vscode.QuickPickItem>(qp: vscode.QuickPick<U>) {
    return new Promise<U>((resolve, reject) => {
        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0];
            qp.dispose();
            resolve(selected);
        });
        qp.show();
    });
}