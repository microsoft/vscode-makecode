(function () {
    let frame;
    let vscode = acquireVsCodeApi();

    window.addEventListener("message", function (m) {
        if (m.data._fromVscode) {
            frame.contentWindow.postMessage(m.data, "*");
        } else {
            vscode.postMessage(m.data);
        }
    });
    document.addEventListener("DOMContentLoaded", function (event) {
        frame = document.getElementById("asset-editor-frame");
        // handle messages sent from extension to webview
    });
}())
