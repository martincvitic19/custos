'use strict';
'require view';
'require poll';
'require dom';
'require custos.common as cu';

/* Hero line: one sentence that tells a parent whether the family is protected. */
function hero(st) {
	const c = st.connection || {};
	const lists = st.agh?.lists || [];
	const rules = lists.reduce((n, l) => n + (l.enabled ? (l.rules || 0) : 0), 0);
	let cls = 'cu-ok', big = _('Your network is protected'), sub = _('%s domains blocked by %d lists.').format(cu.num(rules), lists.length);

	if (!st.adguardhome) {
		cls = 'cu-bad'; big = _('Filtering is not running'); sub = _('AdGuard Home has stopped; reboot the router.');
	}
	else if (!c.router) {
		cls = 'cu-bad'; big = _('The ISP router does not answer'); sub = _('Is the cable from the ISP router plugged in? Is the ISP router at %s?').format(cu.esc(c.gateway));
	}
	else if (!c.internet) {
		cls = 'cu-bad'; big = _('No internet'); sub = _('The ISP router answers but the internet does not.');
	}
	else if (!rules) {
		cls = 'cu-warn'; big = _('Downloading block lists…'); sub = _('This takes a minute or two after a flash.');
	}
	else if (!st.agh?.clients) {
		cls = 'cu-warn'; big = _('Ready – no device uses Custos yet');
		sub = _('Switch off the DHCP server of the ISP router and reconnect your devices (Wi-Fi off and on).');
	}
	return E('div', { 'class': 'cu-hero ' + cls }, [
		E('div', { 'class': 'big' }, cls == 'cu-ok' ? '🛡' : (cls == 'cu-warn' ? '⏳' : '⚠')),
		E('div', {}, [ E('div', { 'class': 'big' }, big), E('div', { 'class': 'sub' }, sub) ])
	]);
}

/* One row per device and domain (A and AAAA lookups come in pairs). */
function dedup(entries) {
	const seen = new Set();
	return entries.filter((e) => {
		const k = (e.client_name || e.client) + ' ' + e.domain;
		return !seen.has(k) && seen.add(k);
	});
}

return view.extend({
	load() {
		return Promise.all([ cu.status(), this.loadLogs() ]);
	},

	loadLogs() {
		return Promise.all([ cu.querylog(50, true), cu.querylog(40, false) ]);
	},

	/* Status every 15 s (it pings the ISP router), the logs every 5 s. */
	refreshStatus() {
		return cu.status().then((st) => this.showStatus(st || {}));
	},

	refreshLogs() {
		return this.loadLogs().then((logs) => this.showLogs(logs));
	},

	showStatus(st) {
		const agh = st.agh || {};
		const c = st.connection || {};
		const pct = agh.queries ? (100 * agh.blocked / agh.queries).toFixed(1) + ' %' : '–';
		const ap = st.apply || {};

		dom.content(this.el.status, [
			hero(st),
			E('div', { 'class': 'cu-checks' }, [
				cu.mark(c.router, _('ISP router %s').format(cu.esc(c.gateway || '?'))),
				cu.mark(c.internet, _('Internet')),
				cu.mark(st.adguardhome, _('DNS filter')),
				cu.mark(ap.state == 'ok', _('Settings: %s').format(cu.esc(ap.state || _('not applied yet'))), ap.state != 'error'),
				E('span', { 'class': 'cu-small' }, _('Custos at %s').format(cu.esc((c.addresses || []).join(', ') || c.ipaddr)))
			]),
			ap.errors?.length ? E('p', { 'class': 'cu-small cu-bad' }, cu.esc(ap.errors.join('; '))) : '',
			E('div', { 'class': 'cu-grid' }, [
				cu.tile(cu.num(agh.queries), _('DNS queries')),
				cu.tile(cu.num(agh.blocked), _('Blocked (%s)').format(pct)),
				cu.tile(cu.num(agh.safesearch), _('SafeSearch enforced')),
				cu.tile(cu.num(agh.clients), _('Devices using Custos'))
			]),
			E('p', { 'class': 'cu-small' }, _('Numbers cover the last 7 days.'))
		]);

		const top = (agh.top_blocked || []).map((o) => {
			const k = Object.keys(o)[0];
			return E('tr', {}, [ E('td', {}, cu.esc(k)), E('td', { 'style': 'text-align:right' }, cu.num(o[k])) ]);
		});
		dom.content(this.el.top, cu.card(_('Top blocked domains'),
			top.length ? E('table', { 'class': 'cu-tbl' }, top) : E('p', { 'class': 'cu-small' }, '–')));
	},

	showLogs([ blocked, all ]) {
		const recent = dedup(blocked?.entries || []).slice(0, 10).map((e) => E('tr', {}, [
			E('td', { 'class': 'cu-small' }, new Date(e.time).toLocaleTimeString()),
			E('td', {}, cu.esc(e.client_name || e.client)),
			E('td', {}, [ cu.esc(e.domain), E('br'), E('span', { 'class': 'cu-small' }, cu.verdict(e)) ])
		]));
		dom.content(this.el.recent, cu.card(_('Recently blocked'),
			recent.length ? E('table', { 'class': 'cu-tbl' }, recent) : E('p', { 'class': 'cu-small' }, _('Nothing blocked yet.'))));

		const live = (all?.entries || []).map((e) => E('tr', { 'class': e.blocked ? 'cu-row-bad' : '' }, [
			E('td', { 'class': 'cu-small' }, new Date(e.time).toLocaleTimeString()),
			E('td', {}, cu.esc(e.client_name || e.client)),
			E('td', {}, [ cu.esc(e.domain), ' ', E('span', { 'class': 'cu-small' }, cu.esc(e.type)) ]),
			E('td', {}, cu.verdict(e))
		]));
		dom.content(this.el.live, cu.card(_('Live: what your devices look up'), [
			E('p', { 'class': 'cu-small' }, [ _('Updates every 5 seconds; blocked lookups are red. To check a site or change a rule, open '),
				E('a', { 'href': L.url('admin/activity') }, _('Activity')), '.' ]),
			live.length ? E('table', { 'class': 'cu-tbl' }, live) : E('p', { 'class': 'cu-small' }, _('No lookups yet.'))
		]));
	},

	render([ st, logs ]) {
		this.el = {
			status: E('div'),
			recent: E('div'),
			top: E('div'),
			live: E('div')
		};
		this.showStatus(st || {});
		this.showLogs(logs);
		poll.add(() => this.refreshStatus(), 15);
		poll.add(() => this.refreshLogs(), 5);
		return E([], [
			cu.style(),
			E('h2', {}, _('Custos – Home')),
			E('div', { 'class': 'cbi-map-descr' }, _('DNS filtering for every device in your home: HaGeZi block lists and enforced SafeSearch, served by AdGuard Home on this router.')),
			this.el.status,
			E('div', { 'class': 'cu-cols' }, [ this.el.recent, this.el.top ]),
			this.el.live
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
