import { MODULE_ID, SOCKET } from './util.mjs';
import { isProject, allProjects, data } from './model.mjs';
import { onSocket, request } from './rpc.mjs';
import { Dashboard } from './dashboard.mjs';
import { ProjectWizard } from './wizard.mjs';

let dash = null;
const open = () => {
	dash ??= new Dashboard();
	dash.render({ force: true });
	return dash;
};
const rerender = () => {
	if (dash?.rendered) dash.render();
};

Hooks.once('init', () => {
	const reg = (key, d) => game.settings.register(MODULE_ID, key, { config: true, ...d });
	reg('mustPay', { name: 'Pay before work starts', hint: 'The rules have the cost paid at once. On: a project makes no progress while money is owed.', scope: 'world', type: Boolean, default: true });
	reg('workChecks', { name: 'Work checks (homebrew)', hint: 'Each character working rolls INS + DEX at the end of the day: a failure gives 1 less progress, a critical 1 more, a fumble causes a complication.', scope: 'world', type: Boolean, default: false });
	reg('workDL', { name: 'Work check difficulty', scope: 'world', type: Number, range: { min: 6, max: 16, step: 1 }, default: 10 });
	reg('merchantDiscount', { name: 'Merchant in the party: material discount (%)', hint: 'Homebrew. When anyone in the party has the Merchant class, project materials cost this much less. 0 turns it off.', scope: 'world', type: Number, range: { min: 0, max: 50, step: 5 }, default: 10 });
	reg('createItem', { name: 'Create the finished item', hint: 'When a project completes, put the result on the inventor or in the party stash.', scope: 'world', type: Boolean, default: true });
	game.settings.register(MODULE_ID, 'downtime', { scope: 'world', config: false, type: Object, default: { day: 1, activities: {}, log: [] }, onChange: rerender });
	game.modules.get(MODULE_ID).api = { open, wizard: () => new ProjectWizard().render({ force: true }), request, projects: allProjects, data };
});

Hooks.once('ready', () => {
	game.socket.on(SOCKET, onSocket);
});

for (const h of ['createItem', 'updateItem', 'deleteItem']) Hooks.on(h, (item) => isProject(item) && rerender());
Hooks.on('updateActor', (actor, changed) => {
	if (changed.system?.resources?.zenit) rerender();
});

Hooks.on('getSceneControlButtons', (controls) => {
	try {
		const tokens = controls.tokens ?? controls.token;
		if (tokens?.tools && !Array.isArray(tokens.tools)) tokens.tools.fupjDowntime = { name: 'fupjDowntime', title: 'Projects & Downtime', icon: 'fa-solid fa-screwdriver-wrench', button: true, order: 62, visible: true, onChange: () => open() };
	} catch (err) {
		console.warn(`${MODULE_ID} | scene control`, err);
	}
});

/* "Downtime" on character and party sheets */
Hooks.on('getHeaderControlsApplicationV2', (app, controls) => {
	const actor = app.document;
	if (!(actor instanceof Actor) || !['character', 'party'].includes(actor.type)) return;
	controls.push({ icon: 'fa-solid fa-screwdriver-wrench', label: 'Projects & Downtime', action: 'fupjOpen', onClick: () => open() });
});
