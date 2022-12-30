import * as vscode from "vscode";

// Returns a function, that, as long as it continues to be invoked, will only
// trigger every N milliseconds. If `immediate` is passed, trigger the
// function on the leading edge, instead of the trailing.
export function throttle(func: (...args: any[]) => any, wait: number, immediate?: boolean): any {
    let timeout: any;
    return function (this: any) {
        const context = this;
        const args = arguments;
        const later = () => {
            timeout = null;
            if (!immediate) {
                func.apply(context, args as any);
            }
        };
        const callNow = immediate && !timeout;
        if (!timeout) {
            timeout = setTimeout(later, wait);
        }
        if (callNow) {
            func.apply(context, args as any);
        }
    };
}

export function delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export async function readTextFileAsync(uri: vscode.Uri): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}