import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterInlineImplementation, DebugSession, ExtensionContext, debug } from "vscode";
import { SimDebugSession } from "./session";


export class SimDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
    static register(context: ExtensionContext) {
        context.subscriptions.push(
            debug.registerDebugAdapterDescriptorFactory("makecode-simulator-debugger", new SimDebugAdapterDescriptorFactory())
        );
    }

    createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor> {
        return Promise.resolve(new DebugAdapterInlineImplementation(new SimDebugSession()));
    }
}