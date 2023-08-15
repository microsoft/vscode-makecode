import { ContinuedEvent, DebugSession, StoppedEvent, TerminatedEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { StoppedState, BreakpointMap } from "./state";
import * as path from "path-browserify";
import { SimDriver, SimulatorDebuggerCommand, SimulatorState } from "./simDriver";

export interface SimLaunchArgs extends DebugProtocol.LaunchRequestArguments {
    /* Root directory of the project workspace being debugged */
    projectDir: string;
}

export class SimDebugSession extends DebugSession {
    // We only have one thread
    // TODO: We could theoretically visualize the individual fibers
    private static THREAD_ID = 1;
    private lastBreak?: pxsim.DebuggerBreakpointMessage;
    private state?: StoppedState;
    private projectDir?: string;

    private breakpoints?: BreakpointMap;
    private driver: SimDriver;

    constructor() {
        super();

        this.driver = new SimDriver();

        this.driver.addEventListener("breakpoint", b => this.onDebuggerBreakpoint(b));
        this.driver.addEventListener("warning", w => this.onDebuggerWarning(w));
        this.driver.addEventListener("resume", () => this.onDebuggerResume());
        this.driver.addEventListener("stateChange", s => this.onStateChanged(s));
    }

    dispose() {
        super.dispose();
        this.driver.dispose();
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        if (!response.body) response.body = {};
        response.body.supportsConditionalBreakpoints = false;
        response.body.supportsHitConditionalBreakpoints = false;
        response.body.supportsFunctionBreakpoints = false;
        response.body.supportsEvaluateForHovers = false;
        response.body.supportsStepBack = false;
        response.body.supportsSetVariable = false;
        response.body.supportsRestartFrame = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsGotoTargetsRequest = false;
        response.body.supportsCompletionsRequest = false;

        // This default debug adapter implements the 'configurationDone' request.
        response.body.supportsConfigurationDoneRequest = true;

        this.sendResponse(response);
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        this.sendResponse(response);
        this.shutdown();
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: SimLaunchArgs) {
        if (!this.projectDir) {
            this.projectDir = path.normalize(args.projectDir);
            if (this.breakpoints) {
                this.fixBreakpoints();
            }
        }

        try {
            await this.driver.start();
            this.sendResponse(response);
        }
        catch (e) {
            this.sendErrorResponse(response, 1234);
        }
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        response.body = { breakpoints: [] };

        const ids: number[] = [];

        args.breakpoints!.forEach(requestedBp => {
            if (this.breakpoints) {
                const [id, bp] = this.breakpoints.verifyBreakpoint(path.relative(this.projectDir!, args.source!.path!), requestedBp);
                response.body.breakpoints.push(bp);

                if (bp.verified) {
                    ids.push(id);
                }
            }
            else {
                response.body.breakpoints.push({ verified: false });
            }
        });

        this.driver.setBreakpoints(ids);

        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.driver.resume(SimulatorDebuggerCommand.Resume);
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.driver.resume(SimulatorDebuggerCommand.StepOver);
        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this.driver.resume(SimulatorDebuggerCommand.StepInto);
        this.sendResponse(response);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        this.driver.resume(SimulatorDebuggerCommand.StepOut);
        this.sendResponse(response);
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
        this.driver.resume(SimulatorDebuggerCommand.Pause);
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: [{ id: SimDebugSession.THREAD_ID, name: "main" }] }
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        if (this.lastBreak && this.state) {
            const frames = this.state.getFrames();
            response.body = { stackFrames: frames };
        }
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        if (this.state) {
            response.body = { scopes: this.state.getScopes(args.frameId) }
        }

        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        if (this.state) {
            response.body = { variables: this.state.getVariables(args.variablesReference) };
        }

        this.sendResponse(response);
    }

    private onDebuggerBreakpoint(breakMsg: pxsim.DebuggerBreakpointMessage) {
        this.lastBreak = breakMsg;
        this.state = new StoppedState(this.lastBreak, this.breakpoints!, this.projectDir!);

        if (breakMsg.exceptionMessage) {
            const message = breakMsg.exceptionMessage.replace(/___\d+/g, '');
            this.sendEvent(new StoppedEvent("exception", SimDebugSession.THREAD_ID, message));
        }
        else {
            this.sendEvent(new StoppedEvent("breakpoint", SimDebugSession.THREAD_ID));
        }
    }

    private onDebuggerWarning(warnMsg: pxsim.DebuggerWarningMessage) {
    }

    private onDebuggerResume() {
        this.sendEvent(new ContinuedEvent(SimDebugSession.THREAD_ID, true));
    }

    private onStateChanged(state: SimulatorState) {
        switch (state) {
            case SimulatorState.Paused:
                // Sending a stopped event here would be redundant
                break;
            case SimulatorState.Running:
                this.sendEvent(new ContinuedEvent(SimDebugSession.THREAD_ID, true))
                break;
            case SimulatorState.Stopped:
                this.sendEvent(new TerminatedEvent())
                break;
            //case SimulatorState.Unloaded:
            //case SimulatorState.Pending:
            default:
        }
    }

    private fixBreakpoints() {
        // Fix breakpoint locations from the debugger's format to the client's
        for (const bpId in this.breakpoints!.idMap) {
            const bp = this.breakpoints!.idMap[bpId];
            bp.source!.path = path.join(this.projectDir!, bp.source!.path!);

            bp.line = this.convertDebuggerLineToClient(bp.line!);
            bp.endLine = this.convertDebuggerLineToClient(bp.endLine!);
            bp.column = this.convertDebuggerColumnToClient(bp.column!);
            bp.endColumn = this.convertDebuggerColumnToClient(bp.endColumn!);
        }
    }
}