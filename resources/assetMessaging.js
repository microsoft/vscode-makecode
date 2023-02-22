(function () {
    let frame;
    let vscode = acquireVsCodeApi();

    window.addEventListener("message", function (m) {
        if (m.data._fromVscode) {
            frame.contentWindow.postMessage(m.data, "*");

            if (m.data.type === "open") {
                vscode.setState({
                    editing: {
                        assetType: m.data.assetType,
                        assetId: m.data.assetId
                    }
                })
            }
        } else {
            vscode.postMessage(m.data);
        }
    });
    document.addEventListener("DOMContentLoaded", function (event) {
        frame = document.getElementById("asset-editor-frame");
    });
}())
