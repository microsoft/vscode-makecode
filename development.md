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

