import * as assert from "assert";

import * as vscode from "vscode";
import { insertGeneratedFile } from "../../assetEditor";
import { createTutorialMarkdown, validateTutorialMarkdown } from "../../tutorials";

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

	suite("tutorial authoring", () => {
		test("generated tutorial scaffold validates", () => {
			const markdown = createTutorialMarkdown("Test Tutorial");
			const issues = validateTutorialMarkdown(markdown);
			assert.deepStrictEqual(issues.filter(issue => issue.severity === vscode.DiagnosticSeverity.Error), []);
		});

		test("missing title reports error", () => {
			const issues = validateTutorialMarkdown("## Step 1\n\nDo a thing.");
			assert.ok(issues.some(issue => issue.severity === vscode.DiagnosticSeverity.Error));
		});

		test("unsupported snippet reports warning", () => {
			const issues = validateTutorialMarkdown("# Test\n\n## Step 1\n\n```unknown\nfoo\n```");
			assert.ok(issues.some(issue => issue.severity === vscode.DiagnosticSeverity.Warning));
		});
	});
});
