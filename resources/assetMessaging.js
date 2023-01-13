(function () {
    let frame;
    let toastContainer;
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
            if (m.data.type === "save") {
                showToast("Project assets saved!", 3000);
            }
        }
    });
    document.addEventListener("DOMContentLoaded", function (event) {
        frame = document.getElementById("asset-editor-frame");
        toastContainer = document.getElementById("toast-container");
    });

    function showToast(message, millis) {
        clearToastContainer();
        const toastDiv = document.createElement("div");
        toastContainer.appendChild(toastDiv);

        toastDiv.textContent = message;

        setTimeout(() => clearToastContainer(), millis)
    }

    function clearToastContainer() {
        while (toastContainer.firstChild) toastContainer.firstChild.remove();
    }
}())
