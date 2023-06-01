declare namespace pxsim {
    type Map<U> = {[index: string]: U};

    export interface SimulatorRunMessage extends SimulatorMessage {
        type: "run";
        id?: string;
        boardDefinition?: BoardDefinition;
        frameCounter?: number;
        refCountingDebug?: boolean;
        options?: any;
        parts?: string[];
        builtinParts?: string[];
        partDefinitions?: Map<PartDefinition>
        fnArgs?: any;
        code: string;
        mute?: boolean;
        highContrast?: boolean;
        light?: boolean;
        cdnUrl?: string;
        localizedStrings?: Map<string>;
        version?: string;
        clickTrigger?: boolean;
        breakOnStart?: boolean;
        storedState?: Map<any>;
        ipc?: boolean;
        dependencies?: Map<string>;
        single?: boolean;
        traceDisabled?: boolean;
        activePlayer?: 1 | 2 | 3 | 4 | undefined;
        theme?: string | pxt.Map<string>;
    }

    export interface SimulatorMuteMessage extends SimulatorMessage {
        type: "mute";
        mute: boolean;
    }

    export interface SimulatorStopSoundMessage extends SimulatorMessage {
        type: "stopsound";
    }

    export interface SimulatorDocMessage extends SimulatorMessage {
        type: "localtoken" | "docfailed";
        docType?: string;
        src?: string;
        localToken?: string;
    }

    export interface SimulatorFileLoadedMessage extends SimulatorMessage {
        type: "fileloaded";
        name: string;
        // localeInfo NOT userLanguage
        locale: string;
        content?: string;
    }

    export interface SimulatorReadyMessage extends SimulatorMessage {
        type: "ready";
        frameid: string;
    }

    export interface SimulatorTopLevelCodeFinishedMessage extends SimulatorMessage {
        type: "toplevelcodefinished";
    }

    export interface SimulatorOpenDocMessage extends SimulatorMessage {
        type: "opendoc";
        url: string;
    }

    export interface SimulatorStateMessage extends SimulatorMessage {
        type: "status";
        frameid?: string;
        runtimeid?: string;
        state: string;
    }
    export interface SimulatorBroadcastMessage extends SimulatorMessage {
        broadcast: boolean;
        toParentIFrameOnly?: boolean;
    }

    export interface SimulatorControlMessage extends SimulatorBroadcastMessage {
        type: "messagepacket";
        channel: string;
        data: Uint8Array;
    }

    export interface SimulatorEventBusMessage extends SimulatorBroadcastMessage {
        type: "eventbus";
        broadcast: true;
        id: number;
        eventid: number;
        value?: number;
    }
    export interface SimulatorSerialMessage extends SimulatorMessage {
        type: "serial";
        id: string;
        data: string;
        sim?: boolean;
        csvType?: undefined | "headers" | "row"; // if non-nullish pass to csv view instead
        receivedTime?: number;
    }
    export interface SimulatorBulkSerialMessage extends SimulatorMessage {
        type: "bulkserial";
        id: string;
        data: { data: string, time: number }[];
        sim?: boolean;
    }
    export interface SimulatorCommandMessage extends SimulatorMessage {
        type: "simulator",
        command: "modal" | "restart" | "reload" | "setstate" | "focus" | "blur"
        stateKey?: string;
        stateValue?: any;
        header?: string;
        body?: string;
        copyable?: string;
        linkButtonHref?: string;
        linkButtonLabel?: string;
        displayOnceId?: string; // An id for the modal command, if the sim wants the modal to be displayed only once in the session
        modalContext?: string; // Modal context of where to show the modal
        timestamp?: number;
    }
    export interface SimulatorRadioPacketMessage extends SimulatorBroadcastMessage {
        type: "radiopacket";
        broadcast: true;
        rssi: number;
        serial: number;
        time: number;

        payload: SimulatorRadioPacketPayload;
    }
    export interface SimulatorInfraredPacketMessage extends SimulatorBroadcastMessage {
        type: "irpacket";
        broadcast: true;
        packet: Uint8Array; // base64 encoded
    }
    export interface SimulatorBLEPacketMessage extends SimulatorBroadcastMessage {
        type: "blepacket";
        broadcast: true;
        packet: Uint8Array;
    }
    export interface SimulatorI2CMessage extends SimulatorMessage {
        type: "i2c";
        data: Uint8Array;
    }

    export interface SimulatorRadioPacketPayload {
        type: number;
        groupId: number;
        stringData?: string;
        numberData?: number;
    }

    export interface SimulatorCustomMessage extends SimulatorMessage {
        type: "custom";
        content: any;
    }

    export interface SimulatorScreenshotMessage extends SimulatorMessage {
        type: "screenshot";
        data: ImageData;
        delay?: number;
        modalContext?: string;
    }

    export interface SimulatorAutomaticThumbnailMessage extends SimulatorMessage {
        type: "thumbnail";
        frames: ImageData[];
    }

    export interface SimulatorAddExtensionsMessage extends SimulatorMessage {
        type: "addextensions",
        /**
         * List of repositories to add
         */
        extensions: string[]
    }

    export interface SimulatorAspectRatioMessage extends SimulatorMessage {
        type: "aspectratio",
        value: number,
        frameid: string
    }

    export interface SimulatorRecorderMessage extends SimulatorMessage {
        type: "recorder";
        action: "start" | "stop";
        width?: number;
    }

    export interface TutorialMessage extends SimulatorMessage {
        type: "tutorial";
        tutorial: string;
        subtype: string;
    }

    export interface ImportFileMessage extends SimulatorMessage {
        type: "importfile";
        filename: string;
        parts: (string | ArrayBuffer)[];
    }

    export interface TutorialStepInfo {
        fullscreen?: boolean;
        contentMd?: string;
        headerContentMd?: string;
        hintContentMd?: string;
    }

    export interface TutorialLoadedMessage extends TutorialMessage {
        subtype: "loaded";
        showCategories?: boolean;
        stepInfo: TutorialStepInfo[];
        toolboxSubset?: { [index: string]: number };
    }

    export interface TutorialStepChangeMessage extends TutorialMessage {
        subtype: "stepchange";
        step: number;
    }

    export interface TutorialFailedMessage extends TutorialMessage {
        subtype: "error";
        message?: string;
    }

    export interface RenderReadyResponseMessage extends SimulatorMessage {
        source: "makecode",
        type: "renderready",
        versions: pxt.TargetVersions
    }

    export interface RenderBlocksRequestMessage extends SimulatorMessage {
        type: "renderblocks",
        id: string;
        code?: string;
        options?: {
            packageId?: string;
            package?: string;
            snippetMode?: boolean;
        }
    }

    export interface RenderBlocksResponseMessage extends SimulatorMessage {
        source: "makecode",
        type: "renderblocks",
        id: string;
        svg?: string;
        width?: number;
        height?: number;
        css?: string;
        uri?: string;
        error?: string;
    }

    export interface SetActivePlayerMessage extends SimulatorMessage {
        type: "setactiveplayer";
        playerNumber: 1 | 2 | 3 | 4 | undefined;
    }

    export interface SetSimThemeMessage extends SimulatorMessage {
        type: "setsimthemecolor";
        part:
            | "background-color"
            | "button-stroke"
            | "text-color"
            | "button-fill"
            | "dpad-fill";
        color: string;
    }
}