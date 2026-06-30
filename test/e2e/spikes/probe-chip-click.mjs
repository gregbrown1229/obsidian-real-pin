// Reproduce: clicking the group chip should collapse the group. Tests the real
// event path (mousedown/mouseup/click sequence) vs. a direct .click().
import { fileURLToPath } from "node:url";
import { launchObsidian } from "../obsidian-harness.mjs";

const VAULT = fileURLToPath(new URL("../vault", import.meta.url));
const obs = await launchObsidian({ vault: VAULT });
let out;
try {
	out = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		rp.settings.enableTabGroups = true; rp.tabGroups.apply();
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['rp-a.md','rp-b.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('rp-a.md'), b = await open('rp-b.md');
		await new Promise(r=>setTimeout(r,150));
		rp.tabGroups.createGroup([a.id, b.id]);
		await new Promise(r=>setTimeout(r,150));

		const out = {};
		const stripBefore = a.tabHeaderEl.parentElement;
		out.chipsBefore = stripBefore.querySelectorAll('.real-pin-group-chip').length;
		out.docChipsBefore = document.querySelectorAll('.real-pin-group-chip').length;

		// force a reconcile, as active-leaf-change would
		app.workspace.setActiveLeaf(a, { focus: true });
		await new Promise(r=>setTimeout(r,200));

		const gid = rp.tabGroups.getGroups()[0].id;
		const flag = () => (rp.tabGroups.getGroups().find(g=>g.id===gid)||{}).collapsed;
		const stripAfter = a.tabHeaderEl.parentElement;
		out.stripIdentitySame = stripBefore === stripAfter;
		const chips = [...stripAfter.querySelectorAll('.real-pin-group-chip')];
		out.chipsAfterInStrip = chips.length;

		// click the FIRST chip
		chips[0].click(); await new Promise(r=>setTimeout(r,150));
		out.firstChipWorks = flag();
		if (flag()) { rp.tabGroups.toggleCollapse(gid); await new Promise(r=>setTimeout(r,120)); }

		// click the SECOND chip (if any)
		if (chips[1]) { chips[1].click(); await new Promise(r=>setTimeout(r,150)); out.secondChipWorks = flag(); }
		out.dbg = window.__rpdbg;
		return out;
	`);
} finally {
	await obs.close();
}
console.log("RP_CLICK " + JSON.stringify(out, null, 2));
