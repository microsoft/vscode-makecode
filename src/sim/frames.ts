import { getTargetConfigAsync } from "./service";

const FRAME_DATA_MESSAGE_CHANNEL = "messagechannel"
const FRAME_ASPECT_RATIO = "aspectratio"
const MESSAGE_SOURCE = "pxtdriver"
const PERMANENT = "permanent"


let simFrames: {[index: string]: HTMLIFrameElement} = {};
let _targetConfig: Promise<TargetConfigResponse>;


function nextId() {
    return crypto.randomUUID();
}

let pendingFrames: {[index: string]: Promise<void>} = {};

export function handleMessagePacket(message: any, source?: Window) {
    if (message.type === "messagepacket") {
        const channel = message.channel as string;

        if (!pendingFrames[channel]) {
            pendingFrames[channel] = (async () => {
                const { config, webConfig } = await targetConfigAsync();
                const simInfo = config.packages.approvedRepoLib[channel];

                if (simInfo.simx) {
                    startSimulatorExtension(
                        getSimxUrl(webConfig, channel, simInfo.simx.index),
                        true,
                        undefined,
                        channel
                    );
                }
            })();
        }

        pendingFrames[channel].then(() => {
            for (const frame of Object.keys(simFrames)) {
                const contentWindow = simFrames[frame].contentWindow;

                if (contentWindow && contentWindow !== source) {
                    simFrames[frame].contentWindow?.postMessage(message, "*");
                }
            }
        })

        const simFrame = getSimFrame();

        if (simFrame.contentWindow && simFrame.contentWindow !== source) {
            simFrame.contentWindow.postMessage(message, "*")
        }
    }
}

function getSimFrame() {
    return document.getElementById("simframe") as HTMLIFrameElement;
}


function getSimxUrl(webConfig: any, repo: string, index = "index.html") {
    const simUrl = new URL(webConfig.simUrl);

    // Ensure we preserve upload target path (/app/<sha>---simulator)
    const simPath = simUrl.pathname.replace(/---?.*/, "");
    // Construct the path. The "-" element delineates the extension key from the resource name.
    const simxPath = [simPath, "simx", repo, "-", index].join("/");
    // Create the fully-qualified URL, preserving the origin by removing all leading slashes
    return new URL(simxPath.replace(/^\/+/, ""), simUrl.origin).toString();
}


function createFrame(url: string): HTMLDivElement {
    const wrapper = document.createElement("div") as HTMLDivElement;
    wrapper.className = `simframe ui embed`;

    const frame = document.createElement('iframe') as HTMLIFrameElement;
    frame.id = 'sim-frame-' + nextId()
    frame.title = "Simulator";
    frame.allowFullscreen = true;
    frame.setAttribute('allow', 'autoplay;microphone');
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    frame.className = 'no-select';

    let furl = url;
    furl += '#' + frame.id;

    frame.src = furl;
    frame.frameBorder = "0";
    // frame.dataset['runid'] = this.runId;
    frame.dataset['origin'] = new URL(furl).origin || "*";
    frame.dataset['loading'] = "true";

    wrapper.appendChild(frame);

    const i = document.createElement("i");
    i.className = "videoplay xicon icon";
    i.style.display = "none";
    wrapper.appendChild(i);

    const l = document.createElement("div");
    l.className = "ui active loader";
    i.style.display = "none";
    wrapper.appendChild(l);

    return wrapper;
}

function startSimulatorExtension(url: string, permanent: boolean, aspectRatio?: number, messageChannel?: string) {
    const root = document.getElementById("root");
    if (root) {
        root.classList.add("simx");
    }

    aspectRatio = aspectRatio || 1.22;
    let wrapper = createFrame(url);
    getContainer().appendChild(wrapper);
    const messageFrame = wrapper.firstElementChild as HTMLIFrameElement;
    messageFrame.dataset[FRAME_DATA_MESSAGE_CHANNEL] = messageChannel;
    messageFrame.dataset[FRAME_ASPECT_RATIO] = aspectRatio + "";
    wrapper.classList.add("simmsg");
    if (permanent) {
        messageFrame.dataset[PERMANENT] = "true";
    }

    simFrames[messageChannel!] = messageFrame;
}

function getContainer() {
    return document.getElementById("simulator-extension-frames") as HTMLDivElement;
}

async function targetConfigAsync() {
    if (!_targetConfig) {
        _targetConfig = getTargetConfigAsync();
    }

    return _targetConfig;
}