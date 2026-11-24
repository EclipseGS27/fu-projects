import { MODULE_ID, SOCKET } from './util.mjs';
import { OPS, isProject } from './model.mjs';

/** Every change runs on the active GM, so players can work on projects their characters don't own */
const pending = new Map();
let seq = 0;

export async function request(op, payload = {}) {
	if (game.users.activeGM?.isSelf || (game.user.isGM && !game.users.activeGM)) return execute(op, payload, game.user.id);
	if (!game.users.activeGM) return { ok: false, message: 'A GM needs to be online.' };
	const reqId = `${game.user.id}.${++seq}`;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(reqId);
			resolve({ ok: false, message: 'The GM did not answer. Try again.' });
		}, 15000);
		pending.set(reqId, (res) => {
			clearTimeout(timer);
			resolve(res);
		});
		game.socket.emit(SOCKET, { type: 'rpc', op, payload, reqId, userId: game.user.id });
	});
}

export function onSocket(msg) {
	if (msg?.type === 'rpc' && game.users.activeGM?.isSelf) {
		execute(msg.op, msg.payload, msg.userId).then((res) => game.socket.emit(SOCKET, { type: 'rpcResult', reqId: msg.reqId, userId: msg.userId, res }));
	} else if (msg?.type === 'rpcResult' && msg.userId === game.user.id) {
		pending.get(msg.reqId)?.(msg.res);
		pending.delete(msg.reqId);
	}
}

const GM_ONLY = new Set(['endDay', 'complication', 'resolve', 'clock', 'complete']);

async function execute(op, p, userId) {
	try {
		const user = game.users.get(userId);
		const fn = OPS[op];
		if (!fn) return { ok: false, message: `Unknown action "${op}".` };
		if (GM_ONLY.has(op) && !user?.isGM) return { ok: false, message: 'Only the GM can do that.' };
		// players act for their own characters
		for (const key of ['actor', 'source', 'owner']) {
			const uuid = p[key];
			if (!uuid || uuid === 'party' || user?.isGM) continue;
			const a = fromUuidSync(uuid);
			if (!a?.testUserPermission(user, 'OWNER')) return { ok: false, message: 'That is not your character.' };
		}
		if (p.uuid && !user?.isGM) {
			const src = fromUuidSync(p.uuid);
			if (src?.parent && !src.parent.testUserPermission(user, 'OWNER')) return { ok: false, message: 'That item is not yours.' };
		}
		const item = p.item ? await fromUuid(p.item) : null;
		if (p.item && !isProject(item)) return { ok: false, message: 'That project is gone.' };
		return await fn(p, item, user);
	} catch (err) {
		console.error(`${MODULE_ID} | ${op}`, err);
		return { ok: false, message: err.message ?? String(err) };
	}
}

/** Run an action and show what happened */
export async function run(op, payload) {
	const res = await request(op, payload);
	if (res?.message) ui.notifications[res.ok ? 'info' : 'warn'](res.message);
	return res;
}
