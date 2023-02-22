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

export function delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export async function readTextFileAsync(uri: vscode.Uri): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export async function writeTextFileAsync(uri: vscode.Uri, contents: string) {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(contents));
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