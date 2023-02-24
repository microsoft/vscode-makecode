# Microsoft MakeCode extension for Visual Studio Code

This repo contains a VS Code web extension for creating and editing MakeCode Projects.

For information on using the extension, see [the getting started guide](./getting-started.md).

## Local development of vscode-makecode

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

### Linking pxt-mkc

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
