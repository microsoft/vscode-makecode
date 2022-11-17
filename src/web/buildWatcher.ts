import * as vscode from 'vscode';

import { buildCommandOnce, BuildOptions } from "makecode-core/built/commands";
import { delay, throttle } from './util';

export class BuildWatcher {
    public static watcher: BuildWatcher;

    public static register(context: vscode.ExtensionContext) {
        BuildWatcher.watcher = new BuildWatcher(context);
    }

    protected buildOpts: BuildOptions;
    protected running = false;
    protected building = false;
    protected buildPending = false;

    protected errorListeners: ((error: any) => void)[] = [];
    protected buildCompletedListeners: (() => void)[] = [];

    protected watcherDisposable: vscode.Disposable | undefined;

    private constructor(protected context: vscode.ExtensionContext) {
        this.buildOpts = {
            javaScript: true,
            update: true,
            watch: true
        };
    }

    setEnabled(enabled: boolean) {
        if (enabled === this.running) return;

        this.running = enabled;

        if (!enabled) {
            if (this.watcherDisposable) {
                this.watcherDisposable.dispose();
            }
            return;
        }

        this.watcherDisposable = vscode.workspace.onDidSaveTextDocument(
            throttle(
                (doc: vscode.TextDocument) => {
                    if (!this.running) return;

                    // skip node_modules, pxt_modules, built, .git
                    if (/\/?((node|pxt)_modules|built|\.git)/i.test(doc.fileName)) return;
                    // only watch for source files
                    if (!/\.(json|ts|asm|cpp|c|h|hpp)$/i.test(doc.fileName)) return;
                    this.buildAsync(false);
                },
            500, true)
        )

        this.context.subscriptions.push(this.watcherDisposable);
        this.buildAsync(true);
    }

    isEnabled() {
        return this.running;
    }

    addEventListener(event: "error", handler: (error: any) => void): void;
    addEventListener(event: "build-completed", handler: () => void): void;
    addEventListener(event: "error" | "build-completed", handler: Function): void {
        if (event === "build-completed") this.buildCompletedListeners.push(handler as any);
        else this.errorListeners.push(handler as any);
    }

    removeEventListener(event: "error", handler: (error: any) => void): void;
    removeEventListener(event: "build-completed", handler: () => void): void;
    removeEventListener(event: "error" | "build-completed", handler: Function): void {
        if (event === "build-completed") this.buildCompletedListeners = this.buildCompletedListeners.filter(h => h !== handler)
        else this.errorListeners = this.errorListeners.filter(h => h !== handler)
    }

    protected async buildAsync(firstBuild = false) {
        this.buildPending = true

        // delay just in case there are multiple events firing
        await delay(100)

        // if already building, bail out
        if (this.building) {
            console.log(` build in progress, waiting...`)
            return
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Building project...",
            cancellable: false
        }, async () => {
            // start a build
            try {
                this.building = true
                while (this.buildPending) {
                    this.buildPending = false
                    const opts0 = {
                        ...this.buildOpts
                    }
                    if (!firstBuild) {
                        // if not first time, don't update
                        opts0.update = false
                    }

                    await buildCommandOnce(opts0);

                    if (!this.running) return;

                    for (const handler of this.buildCompletedListeners) {
                        handler();
                    }
                }
            }
            catch (e) {
                for (const errorHandler of this.errorListeners) {
                    errorHandler(e);
                }
            }
            finally {
                this.building = false
            }
        });
    }
}