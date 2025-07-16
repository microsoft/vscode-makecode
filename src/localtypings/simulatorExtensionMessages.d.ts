interface VSCodeAPI {
    postMessage(data: any): void;
}

interface BaseMessage {
    type: "simulator-extension"
    src: "simulator" | "extension";
    action: string;
    id?: string;
}

interface VSCodeResponse extends BaseMessage {
    success: boolean;
    id: string;
}

interface TargetConfigMessage extends BaseMessage {
    action: "targetConfig";
}

interface TargetConfigResponse extends VSCodeResponse {
    action: "targetConfig";
    config: any;
    webConfig: any;
}

type SimulatorExtensionMessage = TargetConfigMessage;
type SimulatorExtensionResponse = TargetConfigResponse | VSCodeResponse;