import * as vscode from "vscode";
import { httpRequestCoreAsync } from "./host";
import { getAppTargetAsync } from "./makecodeOperations";
import { guidGen, readTextFileAsync } from "./util";

const apiRoot = "https://www.makecode.com";

export async function shareProjectAsync(workspace: vscode.WorkspaceFolder) {
    const req = await createShareLinkRequestAsync(workspace);

    const res = await httpRequestCoreAsync({
        url: apiRoot + "/api/scripts",
        data: req
    });

    if (res.statusCode === 200) {
        const resJSON = JSON.parse(res.text!)
        return apiRoot + "/" + resJSON.shortid
    }

    return undefined
}

async function createShareLinkRequestAsync(workspace: vscode.WorkspaceFolder) {
    const config = await readTextFileAsync(vscode.Uri.joinPath(workspace.uri, "pxt.json"));
    const parsed = JSON.parse(config) as pxt.PackageConfig;

    const files: {[index: string]: string} = {
        "pxt.json": config
    };

    for (const file of parsed.files) {
        const content = await readTextFileAsync(vscode.Uri.joinPath(workspace.uri, file));
        files[file] = content;
    }

    const target = await getAppTargetAsync(workspace)

    const header = {
        "name": parsed.name,
        "meta": {
            "versions": target.versions
        },
        "editor": "tsprj",
        "pubId": undefined,
        "pubCurrent": false,
        "target": target.id,
        "targetVersion": target.versions.target,
        "id": guidGen(),
        "recentUse": Date.now(),
        "modificationTime": Date.now(),
        "path": parsed.name,
        "saveId": {},
        "githubCurrent": false,
        "pubVersions": []
    }

    return {
        id: header.id,
        name: parsed.name,
        target: target.id,
        targetVersion: target.versions.target,
        description: parsed.description || `Made with ❤️ in MakeCode for Visual Studio Code .`,
        editor: "tsprj",
        header: JSON.stringify(header),
        text: JSON.stringify(files),
        meta: {
            versions: target.versions
        }
    }
}