import { esc, money, myCharacters, num, skillLevel, sync, activeParty, classLevel } from './util.mjs';
import { AREA, AREA_HINT, POTENCY, POTENCY_HINT, USES, merchantDiscount } from './model.mjs';
import { run } from './rpc.mjs';

const { ApplicationV2 } = foundry.applications.api;

/** New project: the invention, its cost by the potency / area / uses tables, a flaw, the special material and the result */
export class ProjectWizard extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		tag: 'form',
		classes: ['fupj', 'fupj-wizard'],
		window: { title: 'New project', icon: 'fa-solid fa-screwdriver-wrench', resizable: true },
		position: { width: 620, height: 'auto' },
		form: { handler: ProjectWizard.#submit, closeOnSubmit: false },
		actions: { clearResult: ProjectWizard.#clearResult },
	};

	result = null;
	values = { potency: 'minor', area: 'individual', use: 'consumable', flawed: false, helpers: 0 };

	async _renderHTML() {
		const chars = myCharacters();
		const v = this.values;
		const opt = (map, sel, hint) => Object.keys(map).map((k) => `<label class="pick ${k === sel ? 'on' : ''}"><input type="radio" name="${hint}" value="${k}" ${k === sel ? 'checked' : ''}><b>${esc(k)}</b><small>${hint === 'potency' ? `${POTENCY[k]} z · ${esc(POTENCY_HINT[k])}` : hint === 'area' ? `×${AREA[k]} · ${esc(AREA_HINT[k])}` : `×${USES[k]}`}</small></label>`).join('');
		const div = document.createElement('div');
		div.className = 'fupj-wiz';
		div.innerHTML = `
			<fieldset><legend>1 · The invention</legend>
				<label>Name <input type="text" name="name" value="${esc(v.name ?? '')}" placeholder="Self-propelled lantern" required></label>
				<label class="col">What it does, how it works, what it runs on<textarea name="description" rows="3">${esc(v.description ?? '')}</textarea></label>
				<label>Inventor <select name="inventor">${chars.map((a) => `<option value="${a.uuid}" ${a.uuid === v.inventor ? 'selected' : ''}>${esc(a.name)}${classLevel(a, 'tinkerer') ? ' (Tinkerer)' : ''}</option>`).join('')}</select></label>
				<label>Kept on <select name="owner"><option value="inventor">The inventor's sheet</option>${activeParty() ? `<option value="party" ${v.owner === 'party' ? 'selected' : ''}>The party sheet</option>` : ''}</select></label>
			</fieldset>
			<fieldset><legend>2 · Cost (the GM has the final say)</legend>
				<div class="picks"><span>Potency</span>${opt(POTENCY, v.potency, 'potency')}</div>
				<div class="picks"><span>Area</span>${opt(AREA, v.area, 'area')}</div>
				<div class="picks"><span>Uses</span>${opt(USES, v.use, 'use')}</div>
				<label class="chk"><input type="checkbox" name="flawed" ${v.flawed ? 'checked' : ''}> A terrible flaw (−25% cost)</label>
				<label>Flaw <input type="text" name="flaw" value="${esc(v.flaw ?? '')}" placeholder="Needs recharging every night, very loud…"></label>
				<label>Special material <input type="text" name="special" value="${esc(v.special ?? '')}" placeholder="${v.potency === 'minor' ? 'Not needed for minor potency' : 'Required for medium potency or higher'}"></label>
				<label>Helpers <input type="number" name="helpers" min="0" max="10" value="${num(v.helpers)}"></label>
				<div class="sum"></div>
			</fieldset>
			<fieldset><legend>3 · When it's done</legend>
				<div class="result">${this.result ? `<img src="${esc(this.result.img)}" alt=""><span>${esc(this.result.name)}</span><button type="button" data-action="clearResult">Clear</button>` : 'Drop an item here to receive a copy of it on completion. Otherwise a new item with this name and description is made.'}</div>
				<label>Give it to <select name="resultTo"><option value="inventor">The inventor</option><option value="party" ${v.resultTo === 'party' ? 'selected' : ''}>The party stash</option></select></label>
				<label>Deadline in days (0 = none) <input type="number" name="deadline" min="0" value="${num(v.deadline)}"></label>
			</fieldset>
			<footer><span class="sp"></span><button type="submit" class="cta"><i class="fa-solid fa-hammer"></i> Start project</button></footer>`;
		return div;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
	}

	_onRender() {
		const form = this.element;
		const update = () => {
			const fd = new foundry.applications.ux.FormDataExtended(form).object;
			Object.assign(this.values, fd);
			form.querySelectorAll('.pick').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
			const base = POTENCY[fd.potency] * AREA[fd.area] * USES[fd.use] * (fd.flawed ? 0.75 : 1);
			const inv = sync(fd.inventor);
			const vision = skillLevel(inv, 'visionary');
			const merch = Math.round(Math.max(0, base - vision * 100) * merchantDiscount());
			const cost = Math.max(0, base - vision * 100 - merch);
			const progress = Math.max(1, Math.floor(base / 100));
			const perDay = 1 + (classLevel(inv, 'tinkerer') ? 1 : 0) + vision + num(fd.helpers);
			const helperFee = num(fd.helpers) * Math.ceil(base / 2);
			form.querySelector('.sum').innerHTML = `<div><span>Material cost</span><b>${money(cost)}</b>${vision ? `<small>Visionary −${money(vision * 100)}</small>` : ''}${merch ? `<small>Merchant −${money(merch)}</small>` : ''}</div>
				<div><span>Progress needed</span><b>${progress}</b></div>
				<div><span>With the inventor alone</span><b>${perDay}/day</b><small>≈ ${Math.ceil(progress / perDay)} day${Math.ceil(progress / perDay) > 1 ? 's' : ''}; every other character working adds 1, Tinkerers 2</small></div>
				${helperFee ? `<div><span>Helpers' pay</span><b>${money(helperFee)}</b><small>half the cost each, paid when hired</small></div>` : ''}
				${fd.potency !== 'minor' && !fd.special ? '<div class="warn">Medium potency and above needs a special material the GM describes.</div>' : ''}`;
		};
		const box = form.querySelector('.fupj-wiz');
		box.addEventListener('change', update);
		box.addEventListener('input', update);
		update();
		const drop = form.querySelector('.result');
		drop.addEventListener('dragover', (e) => e.preventDefault());
		drop.addEventListener('drop', async (e) => {
			e.preventDefault();
			const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
			const d = TE.getDragEventData(e);
			if (d?.type !== 'Item') return;
			const it = await fromUuid(d.uuid);
			if (!it) return;
			if (['weapon', 'armor', 'shield', 'accessory'].includes(it.type)) ui.notifications.warn('By the rules, projects cannot make weapons, armor, shields or accessories. The GM may allow it anyway.');
			this.result = { uuid: it.uuid, name: it.name, img: it.img };
			this.render();
		});
	}

	static #clearResult() {
		this.result = null;
		this.render();
	}

	static async #submit(event, form, formData) {
		const f = formData.object;
		const res = await run('create', {
			name: f.name,
			description: f.description ? `<p>${esc(f.description)}</p>${f.flaw ? `<p><b>Flaw:</b> ${esc(f.flaw)}</p>` : ''}` : f.flaw ? `<p><b>Flaw:</b> ${esc(f.flaw)}</p>` : '',
			inventor: f.inventor,
			owner: f.owner === 'party' ? 'party' : f.inventor,
			potency: f.potency,
			area: f.area,
			use: f.use,
			flawed: !!f.flawed,
			flaw: f.flaw,
			special: f.special,
			helpers: 0,
			result: this.result,
			resultTo: f.resultTo,
			deadline: num(f.deadline),
			img: this.result?.img,
		});
		if (!res?.ok) return;
		// helpers are hired (and paid) through the dashboard so their fee comes out of someone's purse
		if (num(f.helpers) > 0) await run('hireHelpers', { item: res.uuid, count: num(f.helpers), source: f.inventor });
		this.close();
		game.modules.get('fu-projects').api.open();
	}
}
