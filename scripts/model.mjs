import { MODULE_ID, activeParty, classLevel, esc, money, num, partyCharacters, postChat, setting, skillLevel, sync, zenitOf } from './util.mjs';

/**
 * Projects are Project FU's own "project" items (cost, progress clock, potency, area, uses, flaw).
 * This module adds what the rules ask for around them, kept in the item's flags:
 * payment, the special material, helpers, who works each day, a log, complications and the finished item.
 */

export const POTENCY = { minor: 100, medium: 200, major: 400, extreme: 800 };
export const AREA = { individual: 1, small: 2, large: 3, huge: 4 };
export const USES = { consumable: 1, permanent: 5 };
export const POTENCY_HINT = {
	minor: 'Light, transport on land or water, limited protection.',
	medium: 'Travel underwater, suppress a magical effect, relay sound, do a task for the inventor, short-term energy.',
	major: 'Fly, alter an area for a short time, erase memories, long-term energy.',
	extreme: 'Teleport, travel through time or into other worlds, control the weather.',
};
export const AREA_HINT = { individual: 'One creature or object', small: 'A room or small group', large: 'A building or a crowd', huge: 'A village, a district or more' };

export const ACTIVITIES = { project: 'Working on a project', rest: 'Resting', train: 'Training', shop: 'Shopping', research: 'Researching', carouse: 'Carousing', work: 'Odd jobs', travel: 'Travelling', other: 'Something else' };

export const COMPLICATIONS = [
	{ id: 'setback', name: 'Setback', text: 'Something breaks: lose 2 progress.', progress: -2 },
	{ id: 'price', name: 'Price hike', text: 'A part costs more than expected: 10% of the cost is owed again.', extra: 0.1 },
	{ id: 'lostday', name: 'Lost day', text: 'Nothing gets done tomorrow.', skip: 1 },
	{ id: 'part', name: 'Missing part', text: 'A rare part is missing. Work stops until the GM says it has been found.', block: true },
	{ id: 'attention', name: 'Unwanted attention', text: 'Someone has noticed the invention and wants it, or wants it stopped.' },
	{ id: 'breakthrough', name: 'Happy accident', text: 'A mistake turns into an insight: gain 2 progress.', progress: 2 },
];

export const isProject = (item) => item?.type === 'project';
export const data = (item) => foundry.utils.mergeObject(blank(), item?.getFlag(MODULE_ID, 'data') ?? {}, { inplace: false });

function blank() {
	return { inventor: null, paid: 0, materials: [], special: { needed: '', have: false }, helpers: 0, helpersPaid: 0, workers: [], log: [], complications: [], result: null, resultTo: 'inventor', deadline: 0, skip: 0, blocked: false, clockScene: null, done: false };
}

/** Every project the party can see: on party characters and on the party actor */
export function allProjects() {
	const owners = [...partyCharacters()];
	const party = activeParty();
	if (party) owners.push(party);
	const seen = new Set();
	const out = [];
	for (const a of owners) {
		if (!a || seen.has(a.uuid)) continue;
		seen.add(a.uuid);
		for (const i of a.items.filter(isProject)) out.push(i);
	}
	return out;
}

export const costOf = (item) => num(item.system?.cost?.value);

/** A Merchant in the party knows where to buy parts cheaply (homebrew, world setting) */
export function merchantDiscount() {
	const pct = num(setting('merchantDiscount'), 0);
	if (!pct) return 0;
	return partyCharacters().some((a) => classLevel(a, 'merchant') > 0) ? pct / 100 : 0;
}

/** Visionary's discount (Project FU computes it) plus the Merchant's */
export const discountOf = (item) => num(item.system?.discount?.value) + Math.round(Math.max(0, costOf(item) - num(item.system?.discount?.value)) * merchantDiscount());

/** What is still owed: total cost, minus Visionary's discount, minus zenit and materials put in */
export function owed(item) {
	const d = data(item);
	const materials = d.materials.reduce((s, m) => s + num(m.value), 0);
	const extra = d.complications.reduce((s, c) => s + num(c.owed), 0);
	return Math.max(0, costOf(item) - discountOf(item) + extra - num(d.paid) - materials);
}

export const progressOf = (item) => ({ current: num(item.system?.progress?.current), max: Math.max(1, num(item.system?.progress?.max, 1)) });

/**
 * The core rule: +1 per character working today, +1 more for each Tinkerer among them, +1 per helper,
 * plus Visionary: (SL) more for every character with the Skill who works that day (cumulative).
 */
export function dailyProgress(item, workers = data(item).workers) {
	const d = data(item);
	const actors = workers.map(sync).filter(Boolean);
	const tinkerers = actors.filter((a) => classLevel(a, 'tinkerer') > 0).length;
	const inventor = sync(d.inventor) ?? item.parent;
	const vision = actors.reduce((s, a) => s + (a === inventor ? Math.max(num(item.system?.lvlVision?.value), skillLevel(a, 'visionary')) : skillLevel(a, 'visionary')), 0);
	return { total: actors.length + tinkerers + num(d.helpers) + vision, workers: actors.length, tinkerers, helpers: num(d.helpers), vision };
}

export function status(item) {
	const d = data(item);
	const p = progressOf(item);
	if (d.done || p.current >= p.max) return { id: 'done', label: 'Complete' };
	if (owed(item) > 0 && setting('mustPay') !== false) return { id: 'unpaid', label: 'Waiting for payment' };
	if (d.special.needed && !d.special.have) return { id: 'material', label: `Needs ${d.special.needed}` };
	if (d.blocked) return { id: 'blocked', label: 'Missing part' };
	if (d.skip > 0) return { id: 'skip', label: 'Lost day' };
	return { id: 'ready', label: 'In progress' };
}

/* ---------------------------------------------------------------- */
/* GM operations (players reach them through rpc.request)           */
/* ---------------------------------------------------------------- */

const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
const fail = (message) => ({ ok: false, message });
const setData = (item, d) => item.setFlag(MODULE_ID, 'data', d);

async function payer(source, item) {
	if (source === 'party') return activeParty();
	return sync(source) ?? sync(data(item).inventor) ?? item.parent;
}

export const OPS = {
	async create(p) {
		const owner = p.owner === 'party' ? activeParty() : sync(p.owner);
		if (!owner) return fail('Pick who owns the project.');
		const [item] = await owner.createEmbeddedDocuments('Item', [
			{
				name: p.name || 'New invention',
				type: 'project',
				img: p.img || 'icons/tools/smithing/anvil.webp',
				system: {
					description: p.description ?? '',
					potency: { value: p.potency },
					area: { value: p.area },
					use: { value: p.use },
					isFlawed: { value: !!p.flawed },
					numTinker: { value: 1 },
					numHelper: { value: num(p.helpers) },
					lvlVision: { value: skillLevel(sync(p.inventor), 'visionary') },
				},
				flags: { [MODULE_ID]: { data: { ...blank(), inventor: p.inventor, special: { needed: p.special ?? '', have: false }, helpers: num(p.helpers), flaw: p.flaw ?? '', result: p.result ?? null, resultTo: p.resultTo ?? 'inventor', deadline: num(p.deadline) } } },
			},
		]);
		postChat(`<h3>New project: ${esc(item.name)}</h3><p>${esc(owner.name)} · ${money(costOf(item) - discountOf(item))} · ${progressOf(item).max} progress</p>`);
		return ok(`${item.name} created.`, { uuid: item.uuid });
	},

	async pay(p, item) {
		const who = await payer(p.source, item);
		const due = owed(item);
		const amount = Math.min(due, Math.max(0, Math.floor(num(p.amount, due))));
		if (!who || amount <= 0) return fail('Nothing to pay.');
		if (zenitOf(who) < amount) return fail(`${who.name} has only ${money(zenitOf(who))}.`);
		await who.update({ 'system.resources.zenit.value': zenitOf(who) - amount });
		const d = data(item);
		d.paid = num(d.paid) + amount;
		d.log.unshift({ t: Date.now(), text: `${who.name} paid ${money(amount)}` });
		await setData(item, d);
		return ok(`${money(amount)} paid.`);
	},

	async hireHelpers(p, item, user) {
		const d = data(item);
		const n = Math.max(0, num(p.count));
		const extra = Math.max(0, n - num(d.helpers));
		// only the GM decides that someone helps for free
		const free = !!p.free && !!user?.isGM;
		if (extra && !free) {
			const who = await payer(p.source, item);
			const fee = Math.ceil(costOf(item) / 2) * extra;
			if (!who || zenitOf(who) < fee) return fail(`Helpers ask for half the project's cost each: ${money(fee)}.`);
			await who.update({ 'system.resources.zenit.value': zenitOf(who) - fee });
			d.log.unshift({ t: Date.now(), text: `${who.name} hired ${extra} helper${extra > 1 ? 's' : ''} for ${money(fee)}` });
		} else if (extra) d.log.unshift({ t: Date.now(), text: `${extra} helper${extra > 1 ? 's' : ''} joined for free` });
		d.helpers = n;
		await setData(item, d);
		await item.update({ 'system.numHelper.value': n });
		return ok('Helpers updated.');
	},

	async material(p, item, user) {
		const d = data(item);
		const src = p.uuid ? await fromUuid(p.uuid) : null;
		// players spend items they carry; sidebar and compendium items (never used up) are for the GM
		if (!user?.isGM && src && !src.parent) return fail('Drop an item from your character\'s inventory.');
		if (!user?.isGM && p.special && p.have && !src) return fail('Drop the special material from your inventory, or ask the GM.');
		if (p.special) {
			d.special.have = !!p.have;
			if (src) d.special.item = src.name;
			if (src && p.consume && src.parent) await src.delete();
			d.log.unshift({ t: Date.now(), text: p.have ? `Special material found: ${d.special.item ?? d.special.needed}` : 'Special material removed' });
		} else if (src) {
			const value = num(src.system?.cost?.value);
			if (!value) return fail(`${src.name} has no value to put towards the cost.`);
			d.materials.push({ name: src.name, img: src.img, value });
			if (src.parent) {
				const q = num(src.system?.quantity?.value, 1);
				if (q > 1) await src.update({ 'system.quantity.value': q - 1 });
				else await src.delete();
			}
			d.log.unshift({ t: Date.now(), text: `${src.name} used as material (${money(value)})` });
		}
		await setData(item, d);
		return ok('Materials updated.');
	},

	async work(p, item) {
		const d = data(item);
		const actor = sync(p.actor);
		if (!actor) return fail('Unknown character.');
		const on = p.on ?? !d.workers.includes(p.actor);
		d.workers = d.workers.filter((u) => u !== p.actor);
		if (on) {
			// one project per character per day
			for (const other of allProjects()) {
				if (other === item) continue;
				const od = data(other);
				if (od.workers.includes(p.actor)) {
					od.workers = od.workers.filter((u) => u !== p.actor);
					await setData(other, od);
				}
			}
			d.workers.push(p.actor);
			await setActivity(p.actor, 'project', item.name);
		}
		await setData(item, d);
		return ok(on ? `${actor.name} works on ${item.name} today.` : `${actor.name} takes the day off.`);
	},

	async update(p, item, user) {
		const d = data(item);
		// players choose what they are building and who gets it; deadlines, blocks and materials are the GM's call
		const gm = !!user?.isGM;
		if (!gm && !item.parent?.testUserPermission(user, 'OWNER') && !sync(d.inventor)?.testUserPermission(user, 'OWNER')) return fail('Only the inventor can change this project.');
		if ('resultTo' in p) d.resultTo = p.resultTo;
		if ('result' in p) d.result = p.result;
		if (gm) {
			for (const k of ['deadline', 'blocked']) if (k in p) d[k] = p[k];
			if ('special' in p) d.special.needed = p.special;
		}
		await setData(item, d);
		return ok('Saved.');
	},

	async complication(p, item) {
		return ok('', { c: await complicate(item, p.id) });
	},

	async resolve(p, item) {
		const d = data(item);
		d.complications = d.complications.map((c, i) => (i === p.index ? { ...c, resolved: true } : c));
		if (d.complications.every((c) => c.resolved || c.id !== 'part')) d.blocked = false;
		await setData(item, d);
		return ok('Resolved.');
	},

	async clock(p, item) {
		const d = data(item);
		d.clockScene = p.on ? (p.scene ?? canvas.scene?.id ?? null) : null;
		await setData(item, d);
		await syncClock(item, !p.on);
		return ok(p.on ? 'Clock shown on the scene.' : 'Clock removed.');
	},

	async activity(p) {
		await setActivity(p.actor, p.activity, p.note);
		return ok('');
	},

	async endDay() {
		return endDay();
	},

	async complete(p, item) {
		return complete(item);
	},
};

/* ---------------------------------------------------------------- */

export function downtime() {
	return foundry.utils.mergeObject({ day: 1, activities: {}, log: [] }, game.settings.get(MODULE_ID, 'downtime') ?? {}, { inplace: false });
}

async function setActivity(actorUuid, activity, note = '') {
	const dt = downtime();
	dt.activities[actorUuid] = { activity, note: String(note ?? '').slice(0, 120) };
	await game.settings.set(MODULE_ID, 'downtime', dt);
}

async function complicate(item, id) {
	const d = data(item);
	let c = COMPLICATIONS.find((x) => x.id === id);
	if (!c) c = COMPLICATIONS[Math.floor(Math.random() * COMPLICATIONS.length)];
	const entry = { id: c.id, name: c.name, text: c.text, t: Date.now() };
	if (c.extra) entry.owed = Math.ceil(costOf(item) * c.extra);
	if (c.skip) d.skip = num(d.skip) + c.skip;
	if (c.block) d.blocked = true;
	d.complications.push(entry);
	d.log.unshift({ t: Date.now(), text: `Complication: ${c.name}` });
	await setData(item, d);
	if (c.progress) {
		const pr = progressOf(item);
		await item.update({ 'system.progress.current': Math.max(0, Math.min(pr.max, pr.current + c.progress)) });
	}
	postChat(`<h3>${esc(item.name)}: ${esc(c.name)}</h3><p>${esc(c.text)}</p>`);
	return entry;
}

/** Optional work check (homebrew): each worker rolls INS + DEX against the difficulty */
async function workCheck(actor) {
	const a = actor.system?.attributes ?? {};
	const d1 = num(a.ins?.current, 8);
	const d2 = num(a.dex?.current, 8);
	const roll = await new Roll(`1d${d1} + 1d${d2}`).evaluate();
	const [r1, r2] = roll.dice.map((x) => x.total);
	const crit = r1 === r2 && r1 >= 6;
	const fumble = r1 === 1 && r2 === 1;
	const dl = num(setting('workDL'), 10);
	return { total: roll.total, crit, fumble, success: crit || (!fumble && roll.total >= dl), dl };
}

async function endDay() {
	const dt = downtime();
	const lines = [];
	for (const item of allProjects()) {
		const d = data(item);
		const st = status(item);
		if (st.id === 'done') continue;
		const working = d.workers.map(sync).filter(Boolean);
		// the day passes for every project, worked on or not
		const hadDeadline = d.deadline > 0;
		if (hadDeadline) d.deadline = Math.max(0, d.deadline - 1);
		const lateNote = hadDeadline && d.deadline === 0 ? ' · <b>deadline reached</b>' : '';
		if (!working.length && !num(d.helpers)) {
			if (st.id === 'skip') d.skip = Math.max(0, d.skip - 1);
			if (hadDeadline) {
				await setData(item, d);
				lines.push(`<li><b>${esc(item.name)}</b>: nobody worked on it${d.deadline ? ` · ${d.deadline} day${d.deadline > 1 ? 's' : ''} left` : lateNote}</li>`);
			} else if (st.id === 'skip') await setData(item, d);
			continue;
		}
		if (st.id !== 'ready') {
			if (st.id === 'skip') d.skip = Math.max(0, d.skip - 1);
			d.workers = [];
			await setData(item, d);
			lines.push(`<li><b>${esc(item.name)}</b>: no progress (${esc(st.label)})${lateNote}</li>`);
			continue;
		}
		const dp = dailyProgress(item);
		let gain = dp.total;
		const notes = [];
		if (setting('workChecks')) {
			for (const w of working) {
				const r = await workCheck(w);
				if (r.crit) {
					gain += 1;
					notes.push(`${w.name} critical (+1)`);
				} else if (r.fumble) {
					gain -= 1;
					notes.push(`${w.name} fumbled`);
					await complicate(item);
				} else if (!r.success) {
					gain -= 1;
					notes.push(`${w.name} ${r.total} vs ${r.dl} (−1)`);
				}
			}
		}
		gain = Math.max(0, gain);
		const pr = progressOf(item);
		const now = Math.min(pr.max, pr.current + gain);
		await item.update({ 'system.progress.current': now, 'system.numHelper.value': num(d.helpers) });
		const fresh = data(item);
		fresh.workers = [];
		fresh.deadline = d.deadline;
		fresh.log.unshift({ t: Date.now(), text: `Day ${dt.day}: +${gain} progress (${working.map((w) => w.name).join(', ') || 'helpers'})${notes.length ? ` · ${notes.join(', ')}` : ''}` });
		fresh.log = fresh.log.slice(0, 40);
		await setData(item, fresh);
		await syncClock(item);
		lines.push(`<li><b>${esc(item.name)}</b>: +${gain} → ${now}/${pr.max}${notes.length ? ` <small>(${esc(notes.join(', '))})</small>` : ''}${d.deadline ? ` · ${d.deadline} day${d.deadline > 1 ? 's' : ''} left` : now >= pr.max ? '' : lateNote}</li>`);
		if (now >= pr.max) await complete(item);
	}
	const acts = Object.entries(dt.activities)
		.map(([u, a]) => {
			const actor = sync(u);
			return actor && a.activity !== 'project' ? `<li>${esc(actor.name)}: ${esc(ACTIVITIES[a.activity] ?? a.activity)}${a.note ? ` (${esc(a.note)})` : ''}</li>` : '';
		})
		.join('');
	postChat(`<h3>Downtime: end of day ${dt.day}</h3>${lines.length ? `<ul>${lines.join('')}</ul>` : '<p>No project moved forward.</p>'}${acts ? `<ul>${acts}</ul>` : ''}`);
	dt.day += 1;
	dt.activities = {};
	await game.settings.set(MODULE_ID, 'downtime', dt);
	return ok(`Day ${dt.day - 1} is over.`);
}

/** Progress is full: make the invention and hand it over */
async function complete(item) {
	const d = data(item);
	if (d.done) return fail('Already complete.');
	const inventor = sync(d.inventor) ?? item.parent;
	const to = d.resultTo === 'party' ? activeParty() ?? inventor : inventor;
	let made = null;
	if (setting('createItem') !== false && to) {
		let itemData;
		const tpl = d.result?.uuid ? await fromUuid(d.result.uuid) : null;
		if (tpl) {
			itemData = tpl.toObject();
			delete itemData._id;
		} else {
			const consumable = item.system?.use?.value === 'consumable';
			itemData = {
				name: item.name,
				type: consumable ? 'consumable' : 'treasure',
				img: item.img,
				system: { description: item.system?.description ?? '', ...(consumable ? { ipCost: { value: 0 } } : { cost: { value: costOf(item) } }) },
			};
		}
		foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.fromProject`, item.uuid);
		[made] = await to.createEmbeddedDocuments('Item', [itemData]);
	}
	d.done = true;
	d.workers = [];
	d.log.unshift({ t: Date.now(), text: made ? `Complete: ${made.name} given to ${to.name}` : 'Complete' });
	await setData(item, d);
	await syncClock(item);
	postChat(`<h3><i class="fa-solid fa-screwdriver-wrench"></i> ${esc(item.name)} is complete!</h3>${made ? `<p>${esc(made.name)} is now with ${esc(to.name)}.</p>` : ''}`);
	return ok('Complete.');
}

/** Show the project as a Battle UI scene clock and keep it in step */
export async function syncClock(item, remove = false) {
	if (!game.modules.get('fu-battle-ui')?.active) return;
	const d = data(item);
	const sceneId = d.clockScene;
	const scenes = sceneId ? [game.scenes.get(sceneId)] : game.scenes.filter((s) => (s.getFlag('fu-battle-ui', 'clocks') ?? []).some((c) => c.id === `fupj-${item.id}`));
	const pr = progressOf(item);
	for (const scene of scenes.filter(Boolean)) {
		let list = (scene.getFlag('fu-battle-ui', 'clocks') ?? []).filter((c) => c.id !== `fupj-${item.id}`);
		if (!remove && d.clockScene) list = [...list, { id: `fupj-${item.id}`, name: item.name, max: Math.min(pr.max, 24), current: Math.round((pr.current / pr.max) * Math.min(pr.max, 24)), kind: 'goal', tick: false, hidden: false }];
		await scene.setFlag('fu-battle-ui', 'clocks', list);
	}
}
