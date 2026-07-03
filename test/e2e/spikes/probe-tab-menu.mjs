// Verify our grouping items render in Obsidian's native TAB right-click menu on
// a REAL right-click (trusted CDP mouse events), and that the underlying ops
// work.
import { fileURLToPath } from "node:url";
import CDP from "chrome-remote-interface";
import { launchObsidian } from "../obsidian-harness.mjs";

const VAULT = fileURLToPath(new URL("../vault", import.meta.url));
const PORT = Number(process.env.RP_E2E_CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const obs = await launchObsidian({ vault: VAULT });
let out = {};
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
		rp.tabGroups.createGroup([a.id]); // an existing group, so "existing group" item shows
		await new Promise(r=>setTimeout(r,150));
		const r = b.tabHeaderEl.getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	`);

	const targets = await CDP.List({ port: PORT });
	const target =
		targets.find((t) => t.type === "page" && t.url.startsWith("app://")) ||
		targets.find((t) => t.type === "page");
	const client = await CDP({ port: PORT, target });
	const cx = setup.x + setup.w / 2;
	const cy = setup.y + setup.h / 2;
	await client.Input.dispatchMouseEvent({ type: "mouseMoved", x: cx, y: cy });
	await client.Input.dispatchMouseEvent({ type: "mousePressed", x: cx, y: cy, button: "right", clickCount: 1 });
	await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: cx, y: cy, button: "right", clickCount: 1 });
	await sleep(300);

	out = await obs.evalInApp(`
		const titles = [...document.querySelectorAll('.menu .menu-item-title')].map(e => e.textContent);
		document.querySelectorAll('.menu').forEach(m => m.remove());
		return {
			menuItemTitles: titles,
			hasNewGroup: titles.some(t => /Add tab to new group/i.test(t)),
			hasExistingGroup: titles.some(t => /Add tab to existing group/i.test(t)),
		};
	`);
	await client.close();
} finally {
	await obs.close();
}
console.log("RP_TABMENU " + JSON.stringify(out, null, 2));
