Steps to release prerelease MakeCode extension to vscode marketplace.

1.	Increment the version in package.json to new version: https://github.com/microsoft/pxt-vscode-web/blob/main/package.json#L6  This step is necessary as this version number is also extension version to be published.
2.	Run the pipeline: https://devdiv.visualstudio.com/DevDiv/_build?definitionId=17903 This will pick the latest checkin from the repo to build the extension.
3.	Test the vsix generated (ms-edu.pxt-vscode-web.[version].[version].[version].vsix). Today it can only be tested in desktop vscode.
![image](https://user-images.githubusercontent.com/6107272/217672797-32e1d54b-2179-4af4-8470-d702e7564a87.png)
![image](https://user-images.githubusercontent.com/6107272/217672808-2c8f9614-8cef-4cab-99d4-402c3f203238.png)
4.	Approve the release and this will publish to the marketplace under Microsoft.
