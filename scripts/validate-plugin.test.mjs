import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePlugin } from "./validate-plugin.mjs";

const VALID_MANIFEST = {
	id: "real-pin",
	name: "Real Pin",
	version: "1.0.3",
	minAppVersion: "1.4.0",
	description: "Confirms before closing a pinned tab via any close hotkey or command.",
	author: "Greg Brown",
	isDesktopOnly: false,
};

/**
 * Materialize a temp plugin repo. `overrides` can replace the manifest/package/
 * versions objects, and `omit` lists files to leave out entirely.
 */
function makeRepo({ manifest = {}, pkg = {}, versions, omit = [] } = {}) {
	const root = mkdtempSync(join(tmpdir(), "validate-plugin-"));
	const files = {
		"manifest.json": { ...VALID_MANIFEST, ...manifest },
		"package.json": { name: "real-pin", version: "1.0.3", ...pkg },
		"versions.json": versions ?? { "1.0.0": "1.4.0", "1.0.3": "1.4.0" },
	};
	for (const [name, obj] of Object.entries(files)) {
		if (!omit.includes(name)) writeFileSync(join(root, name), JSON.stringify(obj, null, "\t"));
	}
	if (!omit.includes("README.md")) writeFileSync(join(root, "README.md"), "# Real Pin\n");
	if (!omit.includes("LICENSE")) writeFileSync(join(root, "LICENSE"), "MIT\n");
	return root;
}

/** Run validatePlugin against a fresh fixture and clean it up afterward. */
function check(opts = {}, { releaseTag } = {}) {
	const root = makeRepo(opts);
	try {
		return validatePlugin({ root, releaseTag });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const hasError = (errors, needle) => errors.some((e) => e.includes(needle));

// Note: manifest *field* rules (forbidden words, description format, required
// keys, types) are owned by eslint-plugin-obsidianmd's validate-manifest rule and
// are intentionally NOT tested here — this script only owns cross-file/release rules.

test("a valid plugin reports no errors", () => {
	assert.deepEqual(check(), []);
});

test("a valid plugin with a matching release tag reports no errors", () => {
	assert.deepEqual(check({}, { releaseTag: "1.0.3" }), []);
});

test("rejects a non-semver manifest version", () => {
	assert.ok(hasError(check({ manifest: { version: "1.0" } }), "must be x.y.z"));
});

test("rejects a non-semver minAppVersion", () => {
	assert.ok(hasError(check({ manifest: { minAppVersion: "1.x" } }), "minAppVersion"));
});

test("rejects manifest/package.json version mismatch", () => {
	assert.ok(hasError(check({ pkg: { version: "1.0.2" } }), "must match package.json version"));
});

test("rejects a version missing from versions.json", () => {
	assert.ok(
		hasError(check({ versions: { "1.0.0": "1.4.0" } }), "missing an entry for the current version"),
	);
});

test("rejects a versions.json minAppVersion that disagrees with the manifest", () => {
	assert.ok(
		hasError(check({ versions: { "1.0.0": "1.4.0", "1.0.3": "1.2.0" } }), "must equal manifest.minAppVersion"),
	);
});

test("rejects a malformed versions.json (array)", () => {
	assert.ok(hasError(check({ versions: ["1.0.0"] }), "versions.json must be an object"));
});

test("reports a missing LICENSE file", () => {
	assert.ok(hasError(check({ omit: ["LICENSE"] }), "Missing required file: LICENSE"));
});

test("reports a missing README file", () => {
	assert.ok(hasError(check({ omit: ["README.md"] }), "Missing required file: README.md"));
});

test("rejects a release tag that does not match the manifest version", () => {
	assert.ok(hasError(check({}, { releaseTag: "9.9.9" }), 'must equal manifest.version "1.0.3"'));
});

test("rejects a release tag absent from versions.json", () => {
	const errors = check({ manifest: { version: "1.0.4" }, pkg: { version: "1.0.4" } }, { releaseTag: "1.0.4" });
	assert.ok(hasError(errors, 'release tag "1.0.4" is missing from versions.json'));
});
