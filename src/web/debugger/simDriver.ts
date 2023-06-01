import { Simulator } from "../simulator";
import * as vscode from "vscode";

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
    "resume": undefined;
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

    constructor() {
        this.handlers = {
            "breakpoint": [],
            "warning": [],
            "resume": [],
            "stateChange": []
        };

        this.disposables.push(Simulator.onEvent(m => this.handleSimMessage(m)));
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

        Simulator.postMessage({ type: "debugger", subtype: msg, source: MESSAGE_SOURCE } as pxsim.DebuggerMessage);
    }

    setBreakpoints(breakPoints: number[]) {
        this.breakpointsSet = true;
        Simulator.postMessage({
            type: "debugger",
            source: MESSAGE_SOURCE,
            subtype: "config",
            setBreakpoints: breakPoints
        } as pxsim.DebuggerConfigMessage)
    }

    dispose() {
        for (const disposable of this.disposables) disposable.dispose();
    }

    protected handleSimMessage(message: pxsim.SimulatorMessage) {
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
            Simulator.postMessage({ type: 'stop', source: MESSAGE_SOURCE });
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
}