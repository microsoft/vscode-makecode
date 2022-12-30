import * as vscode from "vscode";
import { httpRequestCoreAsync } from "./host";
import { listHardwareVariantsAsync } from "./makecodeOperations";
import { readTextFileAsync } from "./util";

const apiRoot = "https://pxt.azureedge.net";

export interface HardwareVariant {
    id: string;
    label: string;
    detail: string;
}

export async function getHardwareVariantsAsync(workspace: vscode.WorkspaceFolder) {
    const variants = await listHardwareVariantsAsync(workspace);

    if (variants.length === 1) return [];

    const info = await fetchHardwareInfoAsync(workspace);

    const res: HardwareVariant[] = [];

    for (const card of info) {
        if (!variants.some(v => v.name === card.variant) || !card.name || !card.description) continue;

        res.push({
            label: card.name,
            detail: card.description,
            id: card.variant!
        });
    }

    for (const config of variants) {
        if (config.name.toLowerCase() === "vm") continue;

        res.push({
            id: config.name,
            detail: config.card?.description || config.description!,
            label: config.name.split("---").pop()!
        });
    }

    return res;
}

async function fetchHardwareInfoAsync(workspace: vscode.WorkspaceFolder) {
    const config = await readTextFileAsync(vscode.Uri.joinPath(workspace.uri, "pxt.json"));
    const parsed = JSON.parse(config) as pxt.PackageConfig;
    const res: pxt.CodeCard[] = [];

    if (!parsed.supportedTargets) return res;

    for (const target of parsed.supportedTargets) {
        const md = await fetchHardwareMarkdownAsync(target);
        if (!md) continue;

        const galleries = parseGalleryMardown(md);

        if (!galleries.length) continue;

        for (const gallery of galleries) {
            res.push(...gallery.cards.filter(card => !!card.variant));
        }
    }

    return res;
}

async function fetchHardwareMarkdownAsync(target: string) {
    const res = await httpRequestCoreAsync({
        url: apiRoot + "/api/md/" + target + "/hardware"
    });

    if (res.statusCode === 200) return res.text;

    console.log("Could not fetch hardware info for " + target);

    return undefined;
}


// copied form pxt
function parseGalleryMardown(md: string) {
    if (!md) return [];

    // second level titles are categories
    // ## foo bar
    // fenced code ```cards are sections of cards
    const galleries: { name: string; cards: pxt.CodeCard[] }[] = [];
    let incard = false;
    let name: string | undefined = undefined;
    let cardsSource: string = "";
    md.split(/\r?\n/).forEach(line => {
        // new category
        if (/^## /.test(line)) {
            name = line.substr(2).trim();
        } else if (/^(### ~ |```)codecard$/.test(line)) {
            incard = true;
        } else if (/^(### ~|```)$/.test(line)) {
            incard = false;
            if (name && cardsSource) {
                const cards = parseCodeCards(cardsSource);
                if (cards?.length)
                    galleries.push({ name, cards });
                else
                    console.log(`invalid gallery format`)
            }
            cardsSource = "";
            name = undefined;
        } else if (incard)
            cardsSource += line + '\n';
    })

    return galleries;
}

// copied from pxt
function parseCodeCards(md: string): pxt.CodeCard[] | undefined {
    // try to parse code cards as JSON
    let cards = tryJSONParse(md) as pxt.CodeCard[];
    if (cards && !Array.isArray(cards))
        cards = [cards];
    if (cards?.length)
        return cards;

    // not json, try parsing as sequence of key,value pairs, with line splits
    cards = md.split(/^---$/gm)
        .filter(cmd => !!cmd)
        .map(cmd => {
            let cc: any = {};
            cmd.replace(/^\s*(?:-|\*)\s+(\w+)\s*:\s*(.*)$/gm, (m, n, v) => {
                if (n == "flags")
                    cc[n] = v.split(',')
                else if (n === "otherAction") {
                    const parts: string[] = v.split(',').map((p: string) => p?.trim())
                    const oas = (cc["otherActions"] || (cc["otherActions"] = []));
                    oas.push({
                        url: parts[0],
                        editor: parts[1],
                        cardType: parts[2]
                    })
                }
                else
                    cc[n] = v
                return ''
            })
            return !!Object.keys(cc).length && cc as pxt.CodeCard;
        })
        .filter(cc => !!cc) as pxt.CodeCard[];
    if (cards?.length)
        return cards;

    return undefined;
}

function tryJSONParse(json: string) {
    try {
        return JSON.parse(json)
    }
    catch {
        return undefined;
    }
}