// End-to-end harness: launch a real, sandboxed Obsidian (with Real Pin + Iconize
// installed) and drive its renderer over the Chrome DevTools Protocol.
//
// Why raw CDP and not Playwright: Obsidian ships as a packaged Electron app with
// security fuses, so Playwright's `_electron.launch` can't attach to its main
// process, and `connectOverCDP` fails because Electron's endpoint isn't a full
// Chromium browser ("Browser context management is not supported"). The renderer
// CDP target, however, is fully drivable directly — which is what the Obsidian
// CLI and the WebdriverIO service use under the hood.
//
// `obsidian-launcher` does the heavy lifting (download Obsidian, sandbox the
// config dir, install + enable the plugins); we just connect and evaluate.
import OL from "obsidian-launcher";
import CDP from "chrome-remote-interface";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PORT = Number(process.env.RP_E2E_CDP_PORT || 9222);
const APP_VERSION = process.env.OBSIDIAN_APP_VERSION || "latest";
const INSTALLER_VERSION = process.env.OBSIDIAN_INSTALLER_VERSION || "earliest";
const ICONIZE_VERSION = process.env.OBSIDIAN_ICONIZE_VERSION || "2.14.7";

// Electron flags that make it run headless-as-root under xvfb, plus the CDP
// endpoint. `--remote-allow-origins=*` is required since Chrome 111 or the
// WebSocket upgrade is rejected.
const ELECTRON_ARGS = [
	"--no-sandbox",
	"--disable-gpu",
	"--disable-dev-shm-usage",
	"--disable-software-rasterizer",
	"--remote-allow-origins=*",
	`--remote-debugging-port=${PORT}`,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch Obsidian against a copy of `vault`, with Real Pin (this repo) and
 * Iconize installed and enabled, then attach to the renderer.
 *
 * @param {{ vault: string }} opts
 * @returns {Promise<{ evalInApp(body: string): Promise<any>, waitFor(expr: string, opts?: {timeout?: number, interval?: number}): Promise<void>, close(): Promise<void> }>}
 */
export async function launchObsidian({ vault }) {
	if (!existsSync(`${REPO_ROOT}main.js`)) {
		throw new Error(
			"main.js not found — run `npm run build` before the e2e tests so the plugin can be installed.",
		);
	}

	const launcher = new OL();
	const { proc } = await launcher.launch({
		appVersion: APP_VERSION,
		installerVersion: INSTALLER_VERSION,
		vault,
		copy: true, // never mutate the committed fixture
		plugins: [
			{ path: REPO_ROOT },
			{ id: "obsidian-icon-folder", version: ICONIZE_VERSION },
		],
		args: ELECTRON_ARGS,
		spawnOptions: { stdio: "ignore" },
	});

	let client;
	const close = async () => {
		if (client) await client.close().catch(() => {});
		proc.kill("SIGKILL");
	};

	try {
		// Find the renderer page target (prefer the app:// window).
		let target;
		for (let i = 0; i < 120 && !target; i++) {
			try {
				const targets = await CDP.List({ port: PORT });
				target =
					targets.find((t) => t.type === "page" && t.url.startsWith("app://")) ||
					targets.find((t) => t.type === "page");
			} catch {
				/* endpoint not up yet */
			}
			if (!target) await sleep(500);
		}
		if (!target) throw new Error("Obsidian CDP page target never appeared");

		client = await CDP({ port: PORT, target });
		await client.Runtime.enable();

		const evalInApp = async (body) => {
			const { result, exceptionDetails } = await client.Runtime.evaluate({
				expression: `(async () => { ${body} })()`,
				awaitPromise: true,
				returnByValue: true,
			});
			if (exceptionDetails) {
				throw new Error(
					exceptionDetails.exception?.description ||
						JSON.stringify(exceptionDetails),
				);
			}
			return result.value;
		};

		const waitFor = async (expr, { timeout = 60000, interval = 250 } = {}) => {
			const deadline = Date.now() + timeout;
			for (;;) {
				if (await evalInApp(`return !!(${expr});`)) return;
				if (Date.now() > deadline) {
					throw new Error(`waitFor timed out: ${expr}`);
				}
				await sleep(interval);
			}
		};

		// Wait until the workspace is ready (root tab group exists) and both
		// plugins have loaded — acting earlier hits "No tab group found".
		await waitFor(
			`window.app?.workspace?.layoutReady
				&& window.app.plugins.plugins['real-pin']
				&& window.app.plugins.plugins['obsidian-icon-folder']`,
		);

		return { evalInApp, waitFor, close };
	} catch (e) {
		await close();
		throw e;
	}
}
