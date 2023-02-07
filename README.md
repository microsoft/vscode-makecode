# Microsoft MakeCode extension for vscode.dev

This repo contains a vscode web extension for creating and editing MakeCode Projects.

## Using the extension

### Create a new project

1. Open an empty folder where you want your new project to live
2. Run the "MakeCode: Create empty project" command from the command palette
3. Select the desired MakeCode target from the list that appears

### Import a share link

1. Open an empty folder where you want your imported project to live
2. Run the "MakeCode: Import project from URL" command
3. Paste the share URL into the text input that appears and press enter

### Run your project in the simulator

To run your project in the simulator, run the "MakeCode: Start MakeCode simulator" command.
This will also start a file watcher that will automatically reload the simulator whenever you change a file.
To use your keyboard to control the simulator, make sure you have the simulator pane focused.

#### Viewing the simulator console

All serial messages and exceptions from the simulator are printed in vscode's output view pane.

1. Open the "Output" view pane (View > Output in the top bar).
2. In the top-right of the pane that appears, change the dropdown to "MakeCode".

### Managing your project assets (images, tilemaps, animations, etc.)

The asset explorer can be accessed by clicking the MakeCode logo located in vscode's "Action Bar".
Inside the explorer, there are collapsible sections for each type of project asset.

> Important: when editing an asset, be sure to press the "Done" button in the bottom right of the asset editor to save your work

#### Creating an asset

To create a new asset, hit the "Create File" icon next to the asset type in the asset explorer.

#### Editing assets

To edit an existing asset, click on its name in the asset explorer.

To duplicate or delete the asset, click on the icons that appear next to its name when you hover over it.

To rename the asset, change its name in the text input that appears in the bottom of the asset editor. If you don't see the text input, you may need to increase the width of the pane that the asset editor is in (this is a known bug).

#### Referencing your assets inside your code

To reference an asset you've created inside your code, use one of the tagged templates that MakeCode defines:

```ts
let myImage = assets.image`imageName`;
let myAnimation = assets.animation`animName`;
let myTile = assets.tile`tileName`;
let myTilemap = assets.tilemap`tilemapName`;
let mySong = assets.song`songName`;
```

### Adding a dependency to your project

To add a MakeCode extension to your project, add an entry in the dependency map inside your project's `pxt.json`.

For example, to add the [character-animations](https://github.com/microsoft/arcade-character-animations) extension the entry should look like this:

```json
{
    "name": "Untitled",
    "description": "",
    "dependencies": {
        "device": "*",
        "arcade-character-animations": "github:microsoft/arcade-character-animations#v0.0.2"
    },
    "files": [
        "main.blocks",
        "main.ts",
        "README.md",
        "assets.json"
    ]
}
```

After you save `pxt.json`, run the "MakeCode: Install project dependencies" command to update your project's pxt_modules

## Local development of pxt-vscode-web

Prerequisites:
1. Install node
2. Install yarn:
    `npm install -g yarn`

After you clone the repo, install the dependencies with yarn:

```
yarn install
```

### Running the extension locally

To run and debug the extension locally, open the extension in vscode and press F5.

To debug the webviews in the extension host, run ctrl+shift+i to open the dev tools.

### Running the extension in the browser

To run the extension in the browser, run:

```
yarn run-in-browser
```

### Creating a vsix file

To create a vsix file, first install vsce:

```
npm install -g @vscode/vsce
```

Then use vsce to package the vsix

```
vsce package
```

## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
