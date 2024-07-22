import { chooseWorkspaceAsync } from "../extension";
import { buildProjectAsync } from "../makecodeOperations";
import { Simulator } from "../simulator";
import * as vscode from "vscode";
import { PxtBreakpoint } from "./state";

export enum SimulatorState {
    Unloaded,
    Stopped,
    Pending,
    Starting,
    Running,
    Paused,
    Suspended
}

export enum SimulatorDebuggerCommand {
    StepInto,
    StepOver,
    StepOut,
    Resume,
    Pause
}

interface SimulatorEventMap {
    "breakpoint": pxsim.DebuggerBreakpointMessage;
    "warning": pxsim.DebuggerWarningMessage;
    "resume": never;
    "stateChange": SimulatorState;
}

type SimulatorEventMapStore = {
    [K in keyof SimulatorEventMap]: ((ev: SimulatorEventMap[K]) => void)[]
}

const MESSAGE_SOURCE = "pxtdriver";

export class SimDriver implements vscode.Disposable {
    protected handlers: SimulatorEventMapStore;
    protected breakpointsSet = false;
    protected disposables: vscode.Disposable[] = [];
    protected simulator: Simulator | undefined;
    protected seq = 1000;
    protected pendingMessages: {[index: number]: [pxsim.DebuggerMessage, (resp: any) => void]} = {};

    constructor() {
        this.handlers = {
            "breakpoint": [],
            "warning": [],
            "resume": [],
            "stateChange": []
        };
    }

    async start(): Promise<PxtBreakpoint[]> {
        if (this.simulator) return [];

        const workspace = await chooseWorkspaceAsync("project");

        if (!workspace) {
            throw new Error("No workspace selected");
        }

        const result = await buildProjectAsync(workspace, { emitBreakpoints: true, watch: true, javaScript: true });

        if (!result?.success) {
            throw new Error("Build failed");
        }

        const binaryPath = vscode.Uri.joinPath(workspace.uri, "built/binary.js");
        const binary = new TextDecoder().decode(await vscode.workspace.fs.readFile(binaryPath));

        const panel = vscode.window.createWebviewPanel(Simulator.viewType, vscode.l10n.t("Debug Microsoft MakeCode Simulator"), {
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true,
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true
        });

        this.simulator = new Simulator(panel);
        this.disposables.push(this.simulator.event(m => this.handleSimMessage(m)));
        this.disposables.push(panel);

        await this.simulator.simulateAsync(binary);

        return (result as any).breakpoints;
    }

    addEventListener<K extends keyof SimulatorEventMap>(event: K, handler: (ev: SimulatorEventMap[K]) => void): void {
        this.handlers[event].push(handler);
    }

    removeEventListener<K extends keyof SimulatorEventMap>(event: K, handler: (ev: SimulatorEventMap[K]) => void): void {
        this.handlers[event] = (this.handlers[event].filter(h => h !== handler) as any);
    }

    resume(c: SimulatorDebuggerCommand) {
        let msg: string;
        switch (c) {
            case SimulatorDebuggerCommand.Resume:
                msg = "resume";
                this.setState(SimulatorState.Running);
                break;
            case SimulatorDebuggerCommand.StepInto:
                msg = "stepinto";
                this.setState(SimulatorState.Running);
                break;
            case SimulatorDebuggerCommand.StepOut:
                msg = "stepout";
                this.setState(SimulatorState.Running);
                break;
            case SimulatorDebuggerCommand.StepOver:
                msg = "stepover";
                this.setState(SimulatorState.Running);
                break;
            case SimulatorDebuggerCommand.Pause:
                msg = "pause";
                break;
            default:
                console.debug("unknown command")
                return;
        }

        this.simulator!.postMessage({ type: "debugger", subtype: msg, source: MESSAGE_SOURCE } as pxsim.DebuggerMessage);
    }

    setBreakpoints(breakPoints: number[]) {
        this.breakpointsSet = true;
        this.simulator!.postMessage({
            type: "debugger",
            source: MESSAGE_SOURCE,
            subtype: "config",
            setBreakpoints: breakPoints
        } as pxsim.DebuggerConfigMessage)
    }

    public async variablesAsync(id: number, fields?: string[]): Promise<pxsim.VariablesMessage> {
        const resp = await this.sendRequestAsync({
            type: "debugger",
            source: MESSAGE_SOURCE,
            subtype: "variables",
            variablesReference: id as unknown,
            fields
        } as pxsim.VariablesRequestMessage);

        return resp;
    }

    dispose() {
        for (const disposable of this.disposables) disposable.dispose();
    }

    protected handleSimMessage(message: pxsim.SimulatorMessage) {
        if ((message as pxsim.DebuggerMessage).req_seq) {
            const [original, resolve] = this.pendingMessages[(message as pxsim.DebuggerMessage).req_seq!];
            resolve(message);
            delete this.pendingMessages[(message as pxsim.DebuggerMessage).req_seq!]
        }
        switch (message.type) {
            case "debugger":
                this.handleDebuggerMessage(message as pxsim.DebuggerMessage);
                break;
            case "status":
                this.handleStateMessage(message as pxsim.SimulatorStateMessage);
                break;
        }
    }

    protected handleDebuggerMessage(message: pxsim.DebuggerMessage) {
        switch (message.subtype) {
            case "warning":
                this.fireEvent("warning", message as pxsim.DebuggerWarningMessage);
                break;
            case "breakpoint":
                this.handleBreakpointMessage(message as pxsim.DebuggerBreakpointMessage);
                break;
        }
    }

    protected handleStateMessage(message: pxsim.SimulatorStateMessage) {
        switch (message.state) {
            case "running":
                this.setState(SimulatorState.Running);
                break;
            case "killed":
                this.setState(SimulatorState.Stopped);
                break;
        }
    }

    protected handleBreakpointMessage(message: pxsim.DebuggerBreakpointMessage) {
        if (message.exceptionMessage) {
            this.simulator!.postMessage({ type: 'stop', source: MESSAGE_SOURCE });
            this.setState(SimulatorState.Suspended);
        }
        else {
            this.setState(SimulatorState.Paused);
        }

        this.fireEvent("breakpoint", message);
    }

    protected setState(state: SimulatorState) {
        this.fireEvent("stateChange", state);
    }

    protected fireEvent<K extends keyof SimulatorEventMap>(event: K, ev: SimulatorEventMap[K]) {
        for (const handler of this.handlers[event]) handler(ev);
    }

    protected sendRequestAsync(request: pxsim.DebuggerMessage) {
        return new Promise<any>(resolve => {
            request.seq = this.seq++;

            this.pendingMessages[request.seq] = [request, resolve];
            this.simulator!.postMessage(request);
        });
    }
}