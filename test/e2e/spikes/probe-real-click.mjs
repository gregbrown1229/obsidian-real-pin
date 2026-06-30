// Reproduce the REAL left-click on the chip using trusted CDP mouse events
// (Input.dispatchMouseEvent), which behave exactly like a user's mouse —
// unlike dispatched DOM events. Tells us definitively whether a real press
// toggles collapse, and lets us iterate on the fix.
import { fileURLToPath } from "node:url";
import CDP from "chrome-remote-interface";
import { launchObsidian } from "../obsidian-harness.mjs";

const VAULT = fileURLToPath(new URL("../vault", import.meta.url));
const PORT = Number(process.env.RP_E2E_CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const obs = await launchObsidian({ vault: VAULT });
let result = {};
try {
	const setup = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		rp.settings.enableTabGroups = true; rp.tabGroups.apply();
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['rp-a.md','rp-b.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('rp-a.md'), b = await open('rp-b.md');
		await new Promise(r=>setTimeout(r,150));
		const g = rp.tabGroups.createGroup([a.id, b.id]);
		app.workspace.setActiveLeaf(a, { focus: true });
		await new Promise(r=>setTimeout(r,200));
		window.__t = { rp, a, gid: g.id };
		const c = a.tabHeaderEl.parentElement.querySelector('.real-pin-group-chip').getBoundingClientRect();
		return { x: c.x, y: c.y, w: c.width, h: c.height, dpr: window.devicePixelRatio, appVersion: app.appVersion || 'unknown' };
	`);

	const targets = await CDP.List({ port: PORT });
	const target =
		targets.find((t) => t.type === "page" && t.url.startsWith("app://")) ||
		targets.find((t) => t.type === "page");
	const client = await CDP({ port: PORT, target });

	const cx = setup.x + setup.w / 2;
	const cy = setup.y + setup.h / 2;
	result.chipRect = setup;

	const flagBefore = await obs.evalInApp(
		`return (window.__t.rp.tabGroups.getGroups().find(g=>g.id===window.__t.gid)||{}).collapsed;`,
	);
	result.flagBefore = flagBefore;

	// A real trusted left click at the chip's center.
	await client.Input.dispatchMouseEvent({ type: "mouseMoved", x: cx, y: cy });
	await client.Input.dispatchMouseEvent({ type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
	await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
	await sleep(300);

	result.afterRealClick = await obs.evalInApp(`
		const t = window.__t;
		const g = t.rp.tabGroups.getGroups().find(x=>x.id===t.gid) || {};
		return { collapsed: g.collapsed, aDisplay: getComputedStyle(t.a.tabHeaderEl).display };
	`);

	await client.close();
} finally {
	await obs.close();
}
console.log("RP_REAL " + JSON.stringify(result, null, 2));
