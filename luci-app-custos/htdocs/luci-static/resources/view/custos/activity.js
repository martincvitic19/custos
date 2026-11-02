'use strict';
'require view';
'require dom';
'require ui';
'require custos.common as cu';

return view.extend({
	blockedOnly: false,
	search: '',

	load() {
		return cu.querylog(100, this.blockedOnly, this.search || undefined);
	},

	refresh() {
		return this.load().then((q) => dom.content(document.getElementById('cu-log'), this.renderLog(q)));
	},

	handleCheck() {
		const input = document.getElementById('cu-check-domain');
		const out = document.getElementById('cu-check-result');
		const name = input.value.trim();
		if (!name)
			return;
		return cu.check(name).then((r) => {
			if (r?.error) {
				dom.content(out, E('div', { 'class': 'cu-result cu-bad' }, cu.esc(r.error)));
				return;
			}
			const blocked = r.blocked;
			dom.content(out, E('div', { 'class': 'cu-result ' + (blocked ? 'cu-bad' : (r.safesearch ? 'cu-warn' : 'cu-ok')) }, [
				E('strong', {}, cu.esc(r.domain)), ': ',
				blocked ? (r.locked ? _('adult content, always blocked') : _('blocked for children')) : (r.safesearch ? _('SafeSearch address for children') : _('allowed')),
				r.list ? E('div', { 'class': 'cu-small' }, _('List: %s').format(cu.esc(r.list))) : '',
				r.rule ? E('div', { 'class': 'cu-small' }, _('Rule: %s').format(cu.esc(r.rule))) : '',
				r.service ? E('div', { 'class': 'cu-small' }, _('Service: %s').format(cu.esc(r.service))) : '',
				E('div', { 'style': 'margin-top:6px' }, cu.ruleButton(r.domain, blocked, () => this.handleCheck(), r.locked))
			]));
		});
	},

	renderLog(q) {
		const rows = (q?.entries || []).map((e) => E('tr', {}, [
			E('td', { 'class': 'cu-small' }, new Date(e.time).toLocaleString()),
			E('td', {}, cu.esc(e.client_name || e.client)),
			E('td', {}, [ cu.esc(e.domain), ' ', E('span', { 'class': 'cu-small' }, cu.esc(e.type)) ]),
			E('td', {}, cu.verdict(e)),
			E('td', { 'style': 'text-align:right' }, e.safesearch ? '' : cu.ruleButton(e.domain, e.blocked, () => this.refresh(), e.locked))
		]));
		return rows.length ? E('table', { 'class': 'cu-tbl' }, rows) : E('p', { 'class': 'cu-small' }, _('No queries found.'));
	},

	render(q) {
		const search = E('input', { 'type': 'search', 'class': 'cbi-input-text', 'placeholder': _('Filter by domain or device…'),
			'keydown': (ev) => { if (ev.key == 'Enter') { this.search = ev.target.value.trim(); this.refresh(); } } });
		const onlyBlocked = E('label', {}, [
			E('input', { 'type': 'checkbox', 'change': (ev) => { this.blockedOnly = ev.target.checked; this.refresh(); } }),
			' ', _('only blocked')
		]);

		return E([], [
			cu.style(),
			E('h2', {}, _('Activity')),
			E('div', { 'class': 'cbi-map-descr' }, _('Which names your devices looked up, and what Custos did with them. The log is kept on this router for 7 days and never leaves it.')),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Check a site')),
				E('p', { 'class': 'cu-small' }, _('Is a site blocked, and by which list? Type its name, e.g. www.example.com.')),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, [
					E('input', { 'id': 'cu-check-domain', 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'www.example.com',
						'keydown': (ev) => { if (ev.key == 'Enter') this.handleCheck(); } }),
					E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, 'handleCheck') }, _('Check'))
				]),
				E('div', { 'id': 'cu-check-result' })
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Recent lookups')),
				E('div', { 'class': 'cu-svc-tools' }, [
					search, onlyBlocked,
					E('button', { 'class': 'btn', 'click': ui.createHandlerFn(this, () => { this.search = search.value.trim(); return this.refresh(); }) }, _('Refresh'))
				]),
				E('div', { 'id': 'cu-log' }, this.renderLog(q))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
