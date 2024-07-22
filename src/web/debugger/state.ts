import { DebugProtocol } from "@vscode/debugprotocol";
import { normalizePath } from "../host";
import { SimDriver } from "./simDriver";

interface LocationInfo {
    fileName: string;
    start: number;
    length: number;
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
}

export interface PxtBreakpoint extends LocationInfo {
    id: number;
    isDebuggerStmt: boolean;
    binAddr?: number;
}

export interface SimFrame {
    locals: pxsim.Variables;
    breakpointId: number;

    // pxtc.FunctionLocationInfo
    // FIXME: Make this dependency explicit
    funcInfo: {
        functionName: string;
        fileName: string;
        start: number;
        length: number;
        line: number;
        column: number;
        endLine?: number;
        endColumn?: number;
    };
}

export class BreakpointMap {
    public fileMap: { [index: string]: [number, DebugProtocol.Breakpoint][] } = {};
    public idMap: { [index: number]: DebugProtocol.Breakpoint } = {};

    constructor(breakpoints: [number, DebugProtocol.Breakpoint][]) {
        breakpoints.forEach(tuple => {
            const [id, bp] = tuple;
            if (!this.fileMap[bp.source!.path!]) {
                this.fileMap[bp.source!.path!] = [];
            }

            this.fileMap[bp.source!.path!].push(tuple);
            this.idMap[id] = bp;
        });

        for (const file in this.fileMap) {
            const bps = this.fileMap[file];

            // Sort the breakpoints to make finding the closest breakpoint to a
            // given line easier later. Order first by start line and then from
            // worst to best choice for each line.
            this.fileMap[file] = bps.sort(([, a], [, b]) => {
                if (a.line === b.line) {
                    if (b.endLine === a.endLine) {
                        return a.column! - b.column!;
                    }

                    // We want the closest breakpoint, so give preference to breakpoints
                    // that span fewer lines (i.e. breakpoints that are "tighter" around
                    // the line being searched for)
                    return b.endLine! - a.endLine!;
                }
                return a.line! - b.line!;
            });
        }
    }

    public getById(id: number): DebugProtocol.Breakpoint {
        return this.idMap[id];
    }

    public verifyBreakpoint(path: string, breakpoint: DebugProtocol.SourceBreakpoint): [number, DebugProtocol.Breakpoint] {
        path = normalizePath(path);
        const breakpoints = this.fileMap[path];

        let best: [number, DebugProtocol.Breakpoint];
        if (breakpoints) {
            // Breakpoints are pre-sorted for each file. The last matching breakpoint
            // in the list should be the best match
            for (const [id, bp] of breakpoints) {
                if (bp.line! <= breakpoint.line && bp.endLine! >= breakpoint.line) {
                    best = [id, bp];
                }
            }
        }

        if (best!) {
            best[1].verified = true;
            return best;
        }

        return [-1, { verified: false }];
    }
}


/**
 * Maintains the state at the current breakpoint and handles lazy
 * queries for stack frames, scopes, variables, etc. The protocol
 * expects requests to be made in the order:
 *      Frames -> Scopes -> Variables
 */
export class StoppedState {
    private _currentId: number = 1;
    private _frames: { [index: number]: SimFrame } = {};
    private _vars: { [index: number]: Lazy<DebugProtocol.Variable[]> } = {};
    private _globalScope: DebugProtocol.Scope;

    constructor(private _message: pxsim.DebuggerBreakpointMessage, private _map: BreakpointMap, private driver: SimDriver) {
        const globalId = this.nextId();
        this._vars[globalId] = this.getScopeVariables(this._message.globals);
        this._globalScope = {
            name: "Globals",
            variablesReference: globalId,
            expensive: false
        };
    }

    /**
     * Get stack frames for current breakpoint.
     */
    getFrames(): DebugProtocol.StackFrame[] {
        return this._message.stackframes.map((s: SimFrame, i: number) => {
            const bp = this._map.getById(s.breakpointId);
            if (bp) {
                this._frames[s.breakpointId] = s;
                return {
                    id: s.breakpointId,
                    name: s.funcInfo ? s.funcInfo.functionName : (i === 0 ? "main" : "anonymous"),
                    line: bp.line,
                    column: bp.column,
                    endLine: bp.endLine,
                    endColumn: bp.endLine,
                    source: bp.source
                };
            }
            return undefined;
        }).filter(b => !!b) as DebugProtocol.StackFrame[];
    }

    /**
     * Returns scopes visible to the given stack frame.
     *
     * TODO: Currently, we only support locals and globals (no closures)
     */
    getScopes(frameId: number): DebugProtocol.Scope[] {
        const frame = this._frames[frameId];

        if (frame) {
            const localId = this.nextId();
            this._vars[localId] = this.getScopeVariables(frame.locals);
            return [{
                name: "Locals",
                variablesReference: localId,
                expensive: false
            }, this._globalScope];
        }

        return [this._globalScope];
    }

    /**
     * Returns variable information (and object properties)
     */
    async getVariables(variablesReference: number): Promise<DebugProtocol.Variable[]> {
        const lz = this._vars[variablesReference];
        if (lz) {
            return lz.value;
        }
        return [];
    }

    private getVariableReferences(id: number): Lazy<DebugProtocol.Variable[]> {
        return new Lazy(async () => {
            const vars = await this.driver.variablesAsync(id);

            return this.getVariableValues(vars.variables);
        });
    }

    private getVariableValues(v: pxsim.Variables): DebugProtocol.Variable[] {
        const result: DebugProtocol.Variable[] = [];

        for (const name of Object.keys(v)) {
            const value = v[name];
            let vString: string;
            let variablesReference = 0;

            if (value === null) {
                vString = "null";
            }
            else if (value === undefined) {
                vString = "undefined"
            }
            else if (typeof value === "object") {
                vString = value.preview;
                variablesReference = this.nextId();
                // Variables should be requested lazily, so reference loops aren't an issue
                this._vars[variablesReference] = this.getVariableReferences(value.id);
            }
            else {
                vString = value.toString();
            }

            // Remove the metadata from the name
            const displayName = name.indexOf("___") > -1 ? name.substr(0, name.lastIndexOf("___")) : name;

            result.push({
                name: displayName,
                value: vString,
                variablesReference
            });
        }
        return result;
    }

    private getScopeVariables(v: pxsim.Variables) {
        return new Lazy(async() => this.getVariableValues(v));
    }

    private nextId(): number {
        return this._currentId++;
    }
}

export class Lazy<T> {
    private _value: Promise<T> | undefined;
    private _evaluated = false;

    constructor(private _func: () => Promise<T>) { }

    get value(): Promise<T> {
        if (!this._evaluated) {
            this._value = this._func();
            this._evaluated = true;
        }
        return this._value!;
    }
}