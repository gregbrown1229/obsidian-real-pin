import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Validate the cross-file and release-mechanics rules that ESLint can't see.
 *
 * Manifest *field* rules (id/name/description/forbidden-words/required-keys/types)
 * are owned by eslint-plugin-obsidianmd's `validate-manifest` rule, which lints
 * manifest.json directly and more thoroughly than hand-rolled checks. This script
 * covers only what no ESLint rule does: version consistency across manifest.json,
 * package.json, and versions.json; the release tag; and required repository files.
 *
 * Pure and dependency-free: reads from `root`, returns a list of error messages
 * (empty means valid), so it is unit-testable and reusable by the CLI, CI, and
 * git hooks.
 *
 * @param {{ root?: string, releaseTag?: string }} [options]
 * @returns {string[]} human-readable errors; empty array when the plugin is valid
 */
export function validatePlugin({ root = ".", releaseTag } = {}) {
	const errors = [];

	const readJSON = (name) => {
		const path = join(root, name);
		if (!existsSync(path)) {
			errors.push(`Missing required file: ${name}`);
			return undefined;
		}
		try {
			return JSON.parse(readFileSync(path, "utf8"));
		} catch (e) {
			errors.push(`${name} is not valid JSON: ${e.message}`);
			return undefined;
		}
	};

	// --- Required repository files (not covered by any ESLint rule) -----------
	for (const file of ["README.md", "LICENSE"]) {
		if (!existsSync(join(root, file))) errors.push(`Missing required file: ${file}`);
	}

	const manifest = readJSON("manifest.json");
	const pkg = readJSON("package.json");
	const versions = readJSON("versions.json");

	// --- Version formats (validate-manifest checks the type, not x.y.z) -------
	if (manifest) {
		if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
			errors.push(`manifest.version "${manifest.version}" must be x.y.z (no 'v' prefix)`);
		}
		if (typeof manifest.minAppVersion !== "string" || !SEMVER.test(manifest.minAppVersion)) {
			errors.push(`manifest.minAppVersion "${manifest.minAppVersion}" must be x.y.z`);
		}
	}

	// --- Cross-file version consistency --------------------------------------
	if (manifest && pkg && typeof manifest.version === "string" && manifest.version !== pkg.version) {
		errors.push(`manifest.version (${manifest.version}) must match package.json version (${pkg.version})`);
	}

	if (versions !== undefined) {
		if (typeof versions !== "object" || versions === null || Array.isArray(versions)) {
			errors.push(`versions.json must be an object of { "version": "minAppVersion" }`);
		} else {
			for (const [version, min] of Object.entries(versions)) {
				if (!SEMVER.test(version)) errors.push(`versions.json key "${version}" must be x.y.z`);
				if (typeof min !== "string" || !SEMVER.test(min)) {
					errors.push(`versions.json["${version}"] must be an x.y.z minAppVersion`);
				}
			}
			if (manifest && typeof manifest.version === "string") {
				if (!(manifest.version in versions)) {
					errors.push(`versions.json is missing an entry for the current version ${manifest.version}`);
				} else if (versions[manifest.version] !== manifest.minAppVersion) {
					errors.push(
						`versions.json["${manifest.version}"] (${versions[manifest.version]}) must equal manifest.minAppVersion (${manifest.minAppVersion})`,
					);
				}
			}
		}
	}

	// --- Release mode: the pushed tag is the source of truth ------------------
	if (releaseTag !== undefined) {
		if (manifest && typeof manifest.version === "string" && releaseTag !== manifest.version) {
			errors.push(
				`release tag "${releaseTag}" must equal manifest.version "${manifest.version}" (tags carry no 'v' prefix)`,
			);
		}
		if (versions && typeof versions === "object" && !Array.isArray(versions) && !(releaseTag in versions)) {
			errors.push(`release tag "${releaseTag}" is missing from versions.json`);
		}
	}

	return errors;
}

// --- CLI ---------------------------------------------------------------------
const invokedDirectly =
	process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
	const args = process.argv.slice(2);
	const tagIndex = args.indexOf("--release-tag");
	const releaseTag = tagIndex !== -1 ? args[tagIndex + 1] : undefined;

	const errors = validatePlugin({ root: process.cwd(), releaseTag });
	if (errors.length > 0) {
		console.error(`✗ Plugin validation failed (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
		for (const error of errors) console.error(`  • ${error}`);
		process.exit(1);
	}
	console.log(`✓ Plugin validation passed${releaseTag ? ` (release tag ${releaseTag})` : ""}`);
}
