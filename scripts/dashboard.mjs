import { activeParty, classLevel, esc, money, myCharacters, num, partyCharacters, sync, zenitOf } from './util.mjs';
import { ACTIVITIES, COMPLICATIONS, allProjects, costOf, dailyProgress, data, discountOf, downtime, owed, progressOf, status } from './model.mjs';
import { run } from './rpc.mjs';
import { ProjectWizard } from './wizard.mjs';

const { ApplicationV2 } = foundry.applications.api;

function clockSvg(current, max, size = 64) {
	const segs = Math.min(max, 24);
	const filled = Math.round((current / max) * segs);
	const r = size / 2 - 3;
	const c = size / 2;
	let out = '';
	for (let i = 0; i < segs; i++) {
		const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2;
		const a1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2;
		const p = (a) => `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
		out += `<path d="M${c},${c} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z" class="${i < filled ? 'on' : ''}"/>`;
	}
	return `<svg class="clock" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${out}</svg>`;
}

/** The shared downtime dashboard: every project the party has, who works on what today, and the GM's "end the day" */
export class Dashboard extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: 'fupj-dashboard',
		classes: ['fupj', 'fupj-dash'],
		window: { title: 'Projects & Downtime', icon: 'fa-solid fa-screwdriver-wrench', resizable: true },
		position: { width: 860, height: 720 },
		actions: {
			newProject: () => new ProjectWizard().render({ force: true }),
			endDay: Dashboard.#endDay,
			work: Dashboard.#work,
			pay: Dashboard.#pay,
			helpers: Dashboard.#helpers,
			special: Dashboard.#special,
			complicate: Dashboard.#complicate,
			resolve: Dashboard.#resolve,
			clock: Dashboard.#clock,
			sheet: Dashboard.#sheet,
			complete: Dashboard.#complete,
			toggleLog: Dashboard.#toggleLog,
		},
	};

	openLogs = new Set();

	async _renderHTML() {
		const dt = downtime();
		const projects = allProjects();
		const mine = myCharacters();
		const party = partyCharacters();
		const gm = game.user.isGM;
		const div = document.createElement('div');
		div.className = 'fupj-body';

		const people = party
			.map((a) => {
				const act = dt.activities[a.uuid] ?? {};
				const editable = a.isOwner;
				const working = projects.find((p) => data(p).workers.includes(a.uuid));
				const label = working ? `Working on ${working.name}` : ACTIVITIES[act.activity] ?? 'Not decided';
				return `<div class="who ${editable ? 'mine' : ''}"><img src="${esc(a.img)}" alt=""><div><b>${esc(a.name)}</b>
					${
						editable && !working
							? `<select data-activity="${a.uuid}"><option value="">Not decided</option>${Object.entries(ACTIVITIES)
									.filter(([k]) => k !== 'project')
									.map(([k, l]) => `<option value="${k}" ${k === act.activity ? 'selected' : ''}>${l}</option>`)
									.join('')}</select><input type="text" data-note="${a.uuid}" value="${esc(act.note ?? '')}" placeholder="Note">`
							: `<small>${esc(label)}${act.note && !working ? ` · ${esc(act.note)}` : ''}</small>`
					}</div></div>`;
			})
			.join('');

		const cards = projects.map((item) => this.#card(item, mine, gm)).join('');
		div.innerHTML = `<header class="dhead"><div><div class="kicker">Downtime</div><div class="day">Day ${dt.day}</div></div>
				<div class="people">${people || '<small>No party characters.</small>'}</div></header>
			<div class="projects">${cards || '<p class="empty">No projects yet. Start one with New project.</p>'}</div>
			<footer><button type="button" data-action="newProject"><i class="fa-solid fa-plus"></i> New project</button><span class="sp"></span>
				${gm ? `<button type="button" class="cta" data-action="endDay" data-tooltip="Every project with someone working on it (or helpers) advances, then a new day begins"><i class="fa-solid fa-moon"></i> End the day</button>` : ''}</footer>`;
		return div;
	}

	#card(item, mine, gm) {
		const d = data(item);
		const p = progressOf(item);
		const st = status(item);
		const dp = dailyProgress(item);
		const due = owed(item);
		const inventor = sync(d.inventor) ?? item.parent;
		const canEdit = gm || item.isOwner || inventor?.isOwner;
		const left = Math.max(0, p.max - p.current);
		const eta = dp.total ? Math.ceil(left / dp.total) : null;
		const workers = d.workers.map(sync).filter(Boolean);
		const workBtns = st.id === 'done' ? '' : mine.map((a) => `<button type="button" class="wk ${d.workers.includes(a.uuid) ? 'on' : ''}" data-action="work" data-item="${item.uuid}" data-actor="${a.uuid}" data-tooltip="${d.workers.includes(a.uuid) ? 'Stop working on this today' : `Work on this today (+1${classLevel(a, 'tinkerer') ? ', +1 Tinkerer' : ''})`}"><img src="${esc(a.img)}" alt="">${esc(a.name)}</button>`).join('');
		const comps = d.complications
			.map((c, i) => `<li class="${c.resolved ? 'res' : ''}"><b>${esc(c.name)}</b> ${esc(c.text)}${c.owed ? ` (${money(c.owed)})` : ''}${gm && !c.resolved ? ` <button type="button" data-action="resolve" data-item="${item.uuid}" data-i="${i}">Resolved</button>` : ''}</li>`)
			.join('');
		const payers = [...mine.filter((a) => a.isOwner)];
		const party = activeParty();
		return `<article class="proj st-${st.id}" data-item="${item.uuid}">
			<div class="top">${clockSvg(p.current, p.max)}
				<div class="info"><div class="nm">${esc(item.name)}</div>
					<div class="meta">${esc(inventor?.name ?? item.parent?.name ?? '')} · ${esc(item.system?.potency?.value)} · ${esc(item.system?.area?.value)} · ${esc(item.system?.use?.value)}${item.system?.isFlawed?.value ? ' · flawed' : ''}</div>
					<div class="prog"><b>${p.current}/${p.max}</b> progress · <span class="st">${esc(st.label)}</span>${st.id !== 'done' ? ` · ${dp.total}/day${eta ? ` · ≈ ${eta} day${eta > 1 ? 's' : ''}` : ''}` : ''}${d.deadline ? ` · <span class="dl">${d.deadline} day${d.deadline > 1 ? 's' : ''} to the deadline</span>` : ''}</div>
				</div>
				<div class="tools">
					<button type="button" data-action="sheet" data-item="${item.uuid}" data-tooltip="Open the project sheet"><i class="fa-solid fa-file-lines"></i></button>
					${gm ? `<button type="button" data-action="clock" data-item="${item.uuid}" data-tooltip="${d.clockScene ? 'Remove the clock from the scene' : 'Show as a clock on this scene (Battle UI)'}" class="${d.clockScene ? 'on' : ''}"><i class="fa-solid fa-clock"></i></button>
					<button type="button" data-action="complicate" data-item="${item.uuid}" data-tooltip="Complication"><i class="fa-solid fa-burst"></i></button>
					${st.id !== 'done' ? `<button type="button" data-action="complete" data-item="${item.uuid}" data-tooltip="Finish it now"><i class="fa-solid fa-flag-checkered"></i></button>` : ''}` : ''}
				</div>
			</div>
			<div class="grid">
				<div class="cell"><small>Cost</small><b>${money(costOf(item) - discountOf(item))}</b>${due ? `<span class="due">${money(due)} owed</span>${canEdit || payers.length ? `<span class="pay"><select data-paysrc="${item.uuid}">${payers.map((a) => `<option value="${a.uuid}">${esc(a.name)} (${money(zenitOf(a))})</option>`).join('')}${party ? `<option value="party">Party fund (${money(zenitOf(party))})</option>` : ''}</select><button type="button" data-action="pay" data-item="${item.uuid}">Pay</button></span>` : ''}` : '<span class="okk">Paid</span>'}
					<div class="drop" data-drop="material" data-item="${item.uuid}">Drop a valuable item to put it towards the cost</div></div>
				<div class="cell"><small>Special material</small>${d.special.needed ? `<b>${esc(d.special.needed)}</b>${d.special.have ? `<span class="okk">Found${d.special.item ? `: ${esc(d.special.item)}` : ''}</span>` : '<span class="due">Missing</span>'}${gm ? `<button type="button" data-action="special" data-item="${item.uuid}">${d.special.have ? 'Mark missing' : 'Mark found'}</button>` : ''}<div class="drop" data-drop="special" data-item="${item.uuid}">Drop the material here</div>` : '<span class="muted">None needed</span>'}</div>
				<div class="cell"><small>Helpers</small><b>${num(d.helpers)}</b><span class="muted">+1 progress each per day</span>${canEdit && st.id !== 'done' ? `<span class="pay"><button type="button" data-action="helpers" data-item="${item.uuid}" data-n="1" data-tooltip="Hire one (half the project's cost)">Hire</button>${gm ? `<button type="button" data-action="helpers" data-item="${item.uuid}" data-n="1" data-free="1" data-tooltip="A helper who works for free">Free</button>` : ''}${num(d.helpers) ? `<button type="button" data-action="helpers" data-item="${item.uuid}" data-n="-1">Dismiss</button>` : ''}</span>` : ''}</div>
				<div class="cell"><small>When done</small>${d.result ? `<span><img class="ri" src="${esc(d.result.img)}" alt=""> ${esc(d.result.name)}</span>` : `<span class="muted">A new ${item.system?.use?.value === 'consumable' ? 'consumable' : 'item'} named after the project</span>`}<span class="muted">to ${d.resultTo === 'party' ? 'the party stash' : esc(inventor?.name ?? 'the inventor')}</span>${canEdit ? `<div class="drop" data-drop="result" data-item="${item.uuid}">Drop an item to make this instead</div>` : ''}</div>
			</div>
			${st.id !== 'done' ? `<div class="today"><small>Today</small>${workers.length ? workers.map((w) => `<span class="chip">${esc(w.name)}</span>`).join('') : '<span class="muted">Nobody yet</span>'}<span class="sp"></span>${workBtns}</div>` : ''}
			${comps ? `<ul class="comps">${comps}</ul>` : ''}
			<button type="button" class="logbtn" data-action="toggleLog" data-item="${item.uuid}">${this.openLogs.has(item.uuid) ? 'Hide' : 'Show'} log (${d.log.length})</button>
			${this.openLogs.has(item.uuid) ? `<ul class="log">${d.log.map((l) => `<li><small>${new Date(l.t).toLocaleDateString()}</small> ${esc(l.text)}</li>`).join('')}</ul>` : ''}
		</article>`;
	}

	_replaceHTML(result, content) {
		const scroll = content.querySelector('.projects')?.scrollTop ?? 0;
		content.replaceChildren(result);
		const box = content.querySelector('.projects');
		if (box) box.scrollTop = scroll;
	}

	_onRender() {
		const el = this.element;
		el.querySelectorAll('[data-activity]').forEach((s) => s.addEventListener('change', () => run('activity', { actor: s.dataset.activity, activity: s.value, note: el.querySelector(`[data-note="${s.dataset.activity}"]`)?.value ?? '' })));
		el.querySelectorAll('[data-note]').forEach((i) => i.addEventListener('change', () => run('activity', { actor: i.dataset.note, activity: el.querySelector(`[data-activity="${i.dataset.note}"]`)?.value ?? 'other', note: i.value })));
		el.querySelectorAll('[data-drop]').forEach((z) => {
			z.addEventListener('dragover', (e) => {
				e.preventDefault();
				z.classList.add('over');
			});
			z.addEventListener('dragleave', () => z.classList.remove('over'));
			z.addEventListener('drop', async (e) => {
				e.preventDefault();
				z.classList.remove('over');
				const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
				const d = TE.getDragEventData(e);
				if (d?.type !== 'Item' || !d.uuid) return;
				const kind = z.dataset.drop;
				const item = z.dataset.item;
				if (kind === 'result') {
					const it = await fromUuid(d.uuid);
					if (it) run('update', { item, result: { uuid: it.uuid, name: it.name, img: it.img } });
				} else if (kind === 'special') run('material', { item, uuid: d.uuid, special: true, have: true, consume: true });
				else run('material', { item, uuid: d.uuid });
			});
		});
	}

	static async #endDay() {
		const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: 'End the day' }, content: '<p>Every project someone worked on (or with helpers) advances, and a new downtime day begins.</p>' });
		if (ok) run('endDay');
	}

	static #work(e, t) {
		run('work', { item: t.dataset.item, actor: t.dataset.actor });
	}

	static #pay(e, t) {
		const src = this.element.querySelector(`[data-paysrc="${t.dataset.item}"]`)?.value;
		run('pay', { item: t.dataset.item, source: src });
	}

	static async #helpers(e, t) {
		const item = await fromUuid(t.dataset.item);
		const n = Math.max(0, num(data(item).helpers) + num(t.dataset.n));
		const src = this.element.querySelector(`[data-paysrc="${t.dataset.item}"]`)?.value ?? myCharacters().find((a) => a.isOwner)?.uuid;
		run('hireHelpers', { item: t.dataset.item, count: n, free: !!t.dataset.free, source: src });
	}

	static async #special(e, t) {
		const item = await fromUuid(t.dataset.item);
		run('material', { item: t.dataset.item, special: true, have: !data(item).special.have });
	}

	static async #complicate(e, t) {
		const D = foundry.applications.api.DialogV2;
		const id = await D.wait({
			window: { title: 'Complication' },
			content: '<p>Pick one or roll at random.</p>',
			buttons: [{ action: 'random', label: 'Roll', default: true }, ...COMPLICATIONS.map((c) => ({ action: c.id, label: c.name }))],
			rejectClose: false,
		});
		if (id) run('complication', { item: t.dataset.item, id: id === 'random' ? null : id });
	}

	static #resolve(e, t) {
		run('resolve', { item: t.dataset.item, index: num(t.dataset.i) });
	}

	static async #clock(e, t) {
		const item = await fromUuid(t.dataset.item);
		run('clock', { item: t.dataset.item, on: !data(item).clockScene, scene: canvas.scene?.id });
	}

	static async #sheet(e, t) {
		(await fromUuid(t.dataset.item))?.sheet?.render(true);
	}

	static async #complete(e, t) {
		const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: 'Finish now' }, content: '<p>Complete the project now and hand over the result?</p>' });
		if (ok) run('complete', { item: t.dataset.item });
	}

	static #toggleLog(e, t) {
		const id = t.dataset.item;
		if (this.openLogs.has(id)) this.openLogs.delete(id);
		else this.openLogs.add(id);
		this.render();
	}
}
