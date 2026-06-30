// Capture a screenshot of the feature: two colored groups in the tab bar plus
// the saved-groups sidebar panel.
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import CDP from "chrome-remote-interface";
import { launchObsidian } from "../obsidian-harness.mjs";

const VAULT = fileURLToPath(new URL("../vault", import.meta.url));
const OUT = fileURLToPath(new URL("./tab-groups.png", import.meta.url));
const PORT = Number(process.env.RP_E2E_CDP_PORT || 9222);

const obs = await launchObsidian({ vault: VAULT });
try {
	await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		rp.settings.enableTabGroups = true; rp.tabGroups.apply();
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['Plan.md','Research.md','Notes.md','Budget.md','Specs.md','Daily.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('Plan.md'), b = await open('Research.md'), c = await open('Notes.md');
		const d = await open('Budget.md'), e = await open('Specs.md');
		await open('Daily.md');
		await new Promise(r=>setTimeout(r,200));
		const g1 = rp.tabGroups.createGroup([a.id, b.id, c.id]);
		rp.tabGroups.renameGroup(g1.id, 'Project');
		const g2 = rp.tabGroups.createGroup([d.id, e.id]);
		rp.tabGroups.renameGroup(g2.id, 'Finance');
		rp.tabGroups.recolorGroup(g2.id, 'green');
		rp.tabGroups.saveGroup(g1.id);
		rp.tabGroups.saveGroup(g2.id);
		await rp.activateSavedGroupsView();
		await new Promise(r=>setTimeout(r,250));
		return true;
	`);
	const targets = await CDP.List({ port: PORT });
	const target =
		targets.find((t) => t.type === "page" && t.url.startsWith("app://")) ||
		targets.find((t) => t.type === "page");
	const client = await CDP({ port: PORT, target });
	await client.Page.enable();
	const { data } = await client.Page.captureScreenshot({ format: "png" });
	writeFileSync(OUT, Buffer.from(data, "base64"));
	await client.close();
	console.log("WROTE " + OUT);
} finally {
	await obs.close();
}
