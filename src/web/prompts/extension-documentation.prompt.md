Ensure documentation exists for the blocks (functions exposed with an `//% block` annotation) in the users extension. Any .ts files that are listed under 'files' field in `pxt.json` should be considered. When adding documentation, be sure it is added to the files field, that a `// help=` annotation is added, and that the file is put into an appropriately named md file in the `docs` folder to keep it separate from the code.

When writing an extension, documentation is important to ensure users can understand what the blocks mean. Any function block that is exposed to the user should have document. As an example, the `arcade-storytelling` extension, located at https://github.com/microsoft/arcade-storytelling, has a block defined in it like this:

```typescript
namespace story {
    /**
     * Cancels all text from the story extension that is currently visible on the screen.
     */
    //% blockId="story_clear_all_text"
    //% block="cancel current text"
    //% help=github:arcade-story/docs/cancel-current-text.md
    //% group="Cutscene"
    //% blockGap=8
    //% weight=20
    export function clearAllText() {
        for (const bubble of getAllBubbles()) {
            bubble.destroy();
        }
    }
}
```

in the repo, the associated docs file is located in `/docs/cancel-current-text.md`, with the following content:

````md# cancel current text

Removes all text that is currently being drawn to the screen by blocks from the Story extension.

This will also cause any currently paused text blocks to immediately advance.

```sig
story.clearAllText()
```

## Example #example

This example uses the cancel current text block inside a button event to allow the player to skip text in a cutscene.

```blocks
controller.A.onEvent(ControllerButtonEvent.Pressed, function () {
    story.clearAllText()
})
story.startCutscene(function () {
    story.printDialog("This game contains an epic tale of the rise and fall of the kingdom of Chambrela!", 80, 60, 120, 150)
    story.printDialog("One that couldn't possibly be understood without knowing the history of the royal family, as well as their ancestry", 80, 60, 120, 150)
    story.printDialog("Our story begins with Prince Rupert, whose father, Bartholomew, was a little known fish merchant", 80, 60, 120, 150)
    story.printDialog("Before marrying the queen, Bartholomew....", 80, 60, 120, 150)
})
```

```package
arcade-story=github:microsoft/arcade-storytelling
```
````

the `package` snippet refers to the current repository or any needed dependencies, the `sig` snippet shows the block and it's equivalent in typescript and python, and the example with `blocks` shows a short example usage. If one cannot be made, leave a "todo" snippet in it's place explaining what to put there.

The response to this request should contain json where the key is the file path for the new documentation, and the value is the associated documentation page; e.g. for a 'story.clearLastText()' could be:

```json
{
    "docs/clear-last-text.md": "# clear last text\n\nRemoves the last text bubble that was displayed on the screen by the Story extension.\n\nThis block is useful for selectively removing the most recent text without affecting other text bubbles.\n\n```sig\nstory.clearLastText()\n```\n\n## Example #example\n\nThis example uses the clear last text block to remove the most recent text bubble when the player presses the B button.\n\n```blocks\ncontroller.B.onEvent(ControllerButtonEvent.Pressed, function () {\n    story.clearLastText()\n})\nstory.startCutscene(function () {\n    story.printDialog(\"Welcome to the adventure!\", 80, 60, 120, 150)\n    story.printDialog(\"Prepare yourself for an epic journey.\", 80, 60, 120, 150)\n})\n```\n\n```package\narcade-story=github:microsoft/arcade-storytelling\n```\n"
}
```