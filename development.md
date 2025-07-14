# Developer guide

Prerequisites:
1. Install node
2. Install yarn:
    `npm install -g yarn`

After you clone the repo, install the dependencies with yarn:

```
yarn install
```

## Running the extension locally

To run and debug the extension locally, open the extension in vscode and press F5.

To debug the webviews in the extension host, run ctrl+shift+i to open the dev tools.

## Running the extension in the browser

To run the extension in the browser, run:

```
yarn run-in-browser
```

## Creating a vsix file

To create a vsix file, first install vsce:

```
npm install -g @vscode/vsce
```

Then use vsce to package the vsix

```
vsce package
```

## Linking pxt-mkc

If you want to develop using your local clone of [pxt-mkc](https://github.com/microsoft/pxt-mkc), you need to link the `makecode-core` and `makecode-browser` packages.

```
cd pxt-mkc/packages/makecode-core
yarn link
cd ../makecode-browser
yarn link
cd ../../vscode-makecode
yarn link makecode-core makecode-browser
```

Make sure you run `yarn compile` inside of `makecode-core` and `makecode-browser` to build the packages!

## Publishing the Extension

The extension is published through an Azure DevOps Pipeline: [vscode-makecode release publishing pipeline](https://dev.azure.com/devdiv/DevDiv/_build?definitionId=18132)

Click "Run Pipeline" in the upper right, then check (or uncheck) the `isPrerelease` box in the flyout that appears as needed. The other fields should be okay with their default values.

You will likely need to update the PAT used to auth to the vscode marketplace. To do this:
1. Go to your Azure DevOps User Settings -> Personal Access Tokens ([here](https://dev.azure.com/devdiv/_usersSettings/tokens)).
2. Create a new PAT. Set the scope to "Custom Defined" and then scroll down to "Marketplace" and give "Read", "Publish", and "Manage" permissions to the PAT.
3. With the new PAT, go to the "makecode-marketplace-pat" variable group under Pipelines -> Library. ([here](https://dev.azure.com/devdiv/DevDiv/_library?itemType=VariableGroups&view=VariableGroupView&variableGroupId=462&path=makecode-marketplace-pat))
4. Find the `marketplace-pat` variable, update it with your new PAT, and click "Save" at the top of the page.
5. Now run the pipeline
