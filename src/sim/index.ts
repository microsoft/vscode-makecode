import { handleMessagePacket } from "./frames";
import { initService } from "./service";

const acquireApi = (window as any).acquireVsCodeApi;
const vscode = acquireApi();

(window as any).acquireVsCodeApi = () => vscode;

window.addEventListener("message", function (m) {
    handleMessagePacket(m.data, m.source as Window);
});

document.addEventListener("DOMContentLoaded", function (event) {
    const fs = document.getElementById("fullscreen");
    if (fs) {
        fs.remove();
    }

    const simFrame = document.getElementById("simframe") as HTMLIFrameElement;

    const framesContainer = document.createElement("div");
    framesContainer.id = "simulator-extension-frames";
    simFrame.insertAdjacentElement("afterend", framesContainer);
});

initService(vscode);