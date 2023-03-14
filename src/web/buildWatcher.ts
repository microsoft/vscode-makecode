import * as vscode from 'vscode';

import { BuildOptions } from "makecode-core/built/commands";
import { delay, debounce } from './util';
import { clearBuildErrors, reportBuildErrors } from './extension';
import { buildProjectAsync } from './makecodeOperations';

export class BuildWatcher {
    public static watcher: BuildWatcher;

    public static register(context: vscode.ExtensionContext) {
        BuildWatcher.watcher = new BuildWatcher(context);
    }

    protected buildOpts: BuildOptions;
    protected running = false;
    protected building = false;
    protected buildPending = false;
    protected pendingCancelToken: vscode.CancellationTokenSource | undefined;

    protected errorListeners: ((error: any) => void)[] = [];
    protected buildCompletedListeners: (() => void)[] = [];

    protected watcherDisposable: vscode.Disposable | undefined;
    protected folder: vscode.WorkspaceFolder | undefined;

    private constructor(protected context: vscode.ExtensionContext) {
        this.buildOpts = {
            javaScript: true,
            watch: true
        };
    }

    startWatching(folder: vscode.WorkspaceFolder) {
        if (this.running && this.folder === folder) {return;}
        this.stop();

        this.folder = folder;
        this.running = true;

        const debounceTimer = vscode.workspace.getConfiguration().get(
            "makecode.simulatorBuildWatcherDebounce",
            1500
        );

        const debouncedBuild = debounce(
            () => this.buildAsync(false),
            debounceTimer
        );

        const fsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**"));
        const watchHandler = (uri: vscode.Uri) => {
            if (!this.running) {
                return;
            }

            // skip node_modules, pxt_modules, built, .git
            if (/\/?((node|pxt)_modules|built|\.git)/i.test(uri.path)) {
                return;
            }
            // only watch for source files
            if (!/\.(json|jres|ts|asm|cpp|c|h|hpp)$/i.test(uri.path)) {
                return;
            }

            debouncedBuild();
        }

        fsWatcher.onDidChange(watchHandler);
        fsWatcher.onDidCreate(watchHandler);
        fsWatcher.onDidDelete(watchHandler);
        this.watcherDisposable = fsWatcher;
        this.context.subscriptions.push(this.watcherDisposable);
        this.buildAsync(true);
    }

    stop() {
        if (this.running) {
            clearBuildErrors();
        }

        this.running = false;
        if (this.watcherDisposable) {
            this.watcherDisposable.dispose();
            this.watcherDisposable = undefined;
        }
        if (this.pendingCancelToken) {
            this.pendingCancelToken.cancel();
            this.pendingCancelToken.dispose();
        }
    }

    isEnabled() {
        return this.running;
    }

    async buildNowAsync(folder: vscode.WorkspaceFolder) {
        if (this.isEnabled()) {
            await this.buildAsync(false);
        }
        else {
            this.startWatching(folder);
        }
    }

    addEventListener(event: "error", handler: (error: any) => void): void;
    addEventListener(event: "build-completed", handler: () => void): void;
    addEventListener(event: "error" | "build-completed", handler: Function): void {
        if (event === "build-completed") {
            this.buildCompletedListeners.push(handler as any);
        }
        else {
            this.errorListeners.push(handler as any);
        }
    }

    removeEventListener(event: "error", handler: (error: any) => void): void;
    removeEventListener(event: "build-completed", handler: () => void): void;
    removeEventListener(event: "error" | "build-completed", handler: Function): void {
        if (event === "build-completed") {
            this.buildCompletedListeners = this.buildCompletedListeners.filter(h => h !== handler);
        }
        else {
            this.errorListeners = this.errorListeners.filter(h => h !== handler);
        }
    }

    protected async buildAsync(firstBuild = false) {
        this.buildPending = true;

        // delay just in case there are multiple events firing
        await delay(100);

        // if already building, bail out
        if (this.building) {
            console.log(` build in progress, waiting...`);
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Building project...",
            cancellable: false
        }, async () => {
            // start a build
            try {
                this.building = true;
                while (this.buildPending) {
                    this.buildPending = false;
                    const opts0 = {
                        ...this.buildOpts
                    };
                    if (!firstBuild) {
                        // if not first time, don't update
                        opts0.update = false;
                    }

                    clearBuildErrors();

                    this.newCancelToken();
                    const token = this.pendingCancelToken;
                    const result = await buildProjectAsync(this.folder!, this.buildOpts, token?.token);
                    token?.dispose();

                    if (result.diagnostics.length) {
                        reportBuildErrors(result);
                        for (const errorHandler of this.errorListeners) {
                            errorHandler(result.diagnostics);
                        }
                        return;
                    }

                    if (!this.running) {return;}

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
                this.building = false;
            }
        });
    }

    protected newCancelToken() {
        if (this.pendingCancelToken) {
            this.pendingCancelToken.cancel();
            this.pendingCancelToken.dispose();
        }

        const cancelEvent = new vscode.EventEmitter<void>();

        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: cancelEvent.event
        };

        const tokenSource = {
            token,
            cancel: () => {
                cancelEvent.fire();
                token.isCancellationRequested = true;
            },
            dispose: () => {
                cancelEvent.dispose();
                if (this.pendingCancelToken === tokenSource) {
                    this.pendingCancelToken = undefined;
                }
            }
        };

        this.pendingCancelToken = tokenSource;
        this.context.subscriptions.push(cancelEvent);
    }
}