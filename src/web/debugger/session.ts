import { ContinuedEvent, DebugSession, InitializedEvent, StoppedEvent, TerminatedEvent } from "@vscode/debugadapter";
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
    private startPromise: Promise<void>

    constructor() {
        super();

        this.driver = new SimDriver();

        this.driver.addEventListener("breakpoint", b => this.onDebuggerBreakpoint(b));
        this.driver.addEventListener("warning", w => this.onDebuggerWarning(w));
        this.driver.addEventListener("resume", () => this.onDebuggerResume());
        this.driver.addEventListener("stateChange", s => this.onStateChanged(s));

        this.startPromise = this.startSimulator();
    }

    dispose() {
        super.dispose();
        this.driver.dispose();
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// if (args.supportsProgressReporting) {
		// 	this._reportProgress = true;
		// }
		// if (args.supportsInvalidatedEvent) {
		// 	this._useInvalidatedEvent = true;
		// }

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDone request.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = false;

		// make VS Code show a 'step back' button
		response.body.supportsStepBack = false;

		// make VS Code support data breakpoints
		response.body.supportsDataBreakpoints = false;

		// make VS Code support completion in REPL
		response.body.supportsCompletionsRequest = false;

		// make VS Code send cancel request
		response.body.supportsCancelRequest = true;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = false;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = false;

		// the adapter defines two exceptions filters, one with support for conditions.
		response.body.supportsExceptionFilterOptions = false;

		// make VS Code send exceptionInfo request
		response.body.supportsExceptionInfoRequest = false;

		// make VS Code send setVariable request
		response.body.supportsSetVariable = false;

		// make VS Code send setExpression request
		response.body.supportsSetExpression = false;

		// make VS Code send disassemble request
		response.body.supportsDisassembleRequest = false;
		response.body.supportsSteppingGranularity = false;
		response.body.supportsInstructionBreakpoints = false;

		// make VS Code able to read and write variable memory
		response.body.supportsReadMemoryRequest = false;
		response.body.supportsWriteMemoryRequest = false;

		response.body.supportSuspendDebuggee = false;
		response.body.supportTerminateDebuggee = false;
		response.body.supportsFunctionBreakpoints = false;
		response.body.supportsDelayedStackTraceLoading = false;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.

        this.startPromise.then(() => {
            this.sendEvent(new InitializedEvent());
        })
	}

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments, request?: DebugProtocol.Request): void {
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
            await this.startPromise;
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
                const [id, bp] = this.breakpoints.verifyBreakpoint(args.source!.path!, requestedBp);
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

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
        if (this.state) {
            const variables = await this.state.getVariables(args.variablesReference);
            response.body = { variables };
        }

        this.sendResponse(response);
    }

    private onDebuggerBreakpoint(breakMsg: pxsim.DebuggerBreakpointMessage) {
        this.lastBreak = breakMsg;
        this.state = new StoppedState(this.lastBreak, this.breakpoints!, this.driver);

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

    private async startSimulator() {
        const pxtBreakpoints = await this.driver.start();

        const breakpoints: [number, DebugProtocol.Breakpoint][] = [];

        // The breakpoints are in the format returned by the compiler
        // and need to be converted to the format used by the DebugProtocol
        for (const bp of pxtBreakpoints) {
            breakpoints.push([
                bp.id,
                {
                    verified: true,
                    line: bp.line,
                    column: bp.column,
                    endLine: bp.endLine,
                    endColumn: bp.endColumn,
                    source: {
                        path: bp.fileName
                    }
                }
            ]);
        }

        this.breakpoints = new BreakpointMap(breakpoints);
        this.fixBreakpoints();
    }
}