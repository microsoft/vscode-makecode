import * as assert from "assert";

import * as vscode from "vscode";
import { insertGeneratedFile } from "../../assetEditor";

suite("Web Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	suite("insertGeneratedFile", () => {
		test("next to existing file", () => {
			const files = [
				"a.ts",
				"images.g.jres",
				"b.ts"
			];
			insertGeneratedFile(files, "images.g.ts");
			assert.deepStrictEqual(files, ["a.ts", "images.g.jres", "images.g.ts", "b.ts"]);
		});

		test("after all generated files", () => {
			const files = [
				"a.ts",
				"b.g.jres",
				"c.g.ts",
				"d.ts"
			];
			insertGeneratedFile(files, "images.g.ts");
			assert.deepStrictEqual(files, ["a.ts", "b.g.jres", "c.g.ts", "images.g.ts", "d.ts"]);
		});

		test("after jres files", () => {
			const files = [
				"a.ts",
				"b.jres",
				"c.ts"
			];
			insertGeneratedFile(files, "images.g.ts");
			assert.deepStrictEqual(files, ["a.ts", "b.jres", "images.g.ts", "c.ts"]);
		});

		test("at beginning of list", () => {
			const files = [
				"a.ts",
				"b.ts"
			];
			insertGeneratedFile(files, "images.g.ts");
			assert.deepStrictEqual(files, ["images.g.ts", "a.ts", "b.ts"]);
		});
	});
});
