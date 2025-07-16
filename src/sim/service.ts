/// <reference path="../localtypings/simulatorExtensionMessages.d.ts" />

let vscode: VSCodeAPI;
const pendingMessages: {[index: string]: (resp: SimulatorExtensionResponse) => void} = {};

export async function getTargetConfigAsync() {
    const resp = await sendMessageAsync({
        type: "simulator-extension",
        src: "simulator",
        action: "targetConfig"
    }) as TargetConfigResponse;

    return resp;
}

function sendMessageAsync(message: SimulatorExtensionMessage): Promise<VSCodeResponse> {
    return new Promise((resolve, reject) => {
        const toSend: BaseMessage = {
            ...message,
            id: crypto.randomUUID()
        };

        pendingMessages[toSend.id!] = resp => {
            if (resp.success) {
                resolve(resp);
            }
            else {
                reject(resp);
            }
        };

        vscode.postMessage(toSend);
    });
}

export function initService(api: VSCodeAPI) {
    vscode = api;

    window.addEventListener("message", function (m) {
        if (m.data?.type === "simulator-extension") {
            const response = m.data as SimulatorExtensionResponse;

            const handler = pendingMessages[response.id];
            if (handler) {
                delete pendingMessages[response.id];
                handler(response);
            }
        }
    });
}