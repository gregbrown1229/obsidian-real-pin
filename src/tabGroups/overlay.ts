/**
 * DOM helpers for the tab-group overlay. Kept separate from the controller so
 * the "what the chip/header look like" concern is isolated and the controller
 * stays about orchestration. Pure DOM — no Obsidian imports — so styling is all
 * `data-*` attributes + classes that `styles.css` keys on (the same idiom as the
 * shipped compact-pinned-tabs feature). Nothing here uses `innerHTML`.
 */
import type { GroupColor, GroupPos } from "./model";

/** Body-class gate: `styles.css` is inert until this is present. */
export const TAB_GROUPS_CLASS = "real-pin-tab-groups";

export const CHIP_CLASS = "real-pin-group-chip";
const CHIP_DOT_CLASS = "real-pin-group-chip-dot";
const CHIP_NAME_CLASS = "real-pin-group-chip-name";

/** Tag a member tab header so CSS draws its band/color/rounding/collapse. */
export function setHeaderAttrs(
	header: HTMLElement,
	groupId: string,
	color: GroupColor,
	pos: GroupPos,
	collapsed: boolean,
): void {
	header.dataset.rpGroup = groupId;
	header.dataset.rpColor = color;
	header.dataset.rpPos = pos;
	if (collapsed) header.dataset.rpCollapsed = "1";
	else delete header.dataset.rpCollapsed;
}

/** Remove every group attribute from a tab header (full revert). */
export function clearHeaderAttrs(header: HTMLElement): void {
	delete header.dataset.rpGroup;
	delete header.dataset.rpColor;
	delete header.dataset.rpPos;
	delete header.dataset.rpCollapsed;
}

export interface ChipCallbacks {
	onToggle(): void;
	onContextMenu(evt: MouseEvent): void;
}

/** Build a group chip (colored dot + name) that lives in the tab strip. */
export function buildChip(doc: Document, cb: ChipCallbacks): HTMLElement {
	const chip = doc.createElement("div");
	chip.className = CHIP_CLASS;
	chip.setAttribute("role", "button");
	chip.tabIndex = 0;

	const dot = doc.createElement("span");
	dot.className = CHIP_DOT_CLASS;
	chip.appendChild(dot);

	const name = doc.createElement("span");
	name.className = CHIP_NAME_CLASS;
	chip.appendChild(name);

	chip.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		cb.onToggle();
	});
	chip.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			cb.onToggle();
		}
	});
	chip.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		cb.onContextMenu(e);
	});
	return chip;
}

/** Reflect a group's name/color/collapsed state onto its chip. Idempotent. */
export function updateChip(
	chip: HTMLElement,
	name: string,
	color: GroupColor,
	collapsed: boolean,
): void {
	chip.dataset.rpColor = color;
	if (collapsed) chip.dataset.rpCollapsed = "1";
	else delete chip.dataset.rpCollapsed;

	const nameEl = chip.querySelector("." + CHIP_NAME_CLASS);
	if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;

	const verb = collapsed ? "Expand" : "Collapse";
	chip.setAttribute("aria-label", `${verb} tab group ${name}`);
	chip.setAttribute("aria-expanded", collapsed ? "false" : "true");
}
