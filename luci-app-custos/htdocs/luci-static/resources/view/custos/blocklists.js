'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require dom';
'require custos.common as cu';

const GROUP_NAMES = {
	ai: _('AI assistants'),
	cdn: _('CDN'),
	dating: _('Dating'),
	gambling: _('Gambling'),
	gaming: _('Games'),
	hosting: _('Hosting'),
	messenger: _('Messengers'),
	privacy: _('VPN & privacy'),
	shopping: _('Shopping'),
	social_network: _('Social networks'),
	software: _('Software'),
	streaming: _('Video & streaming')
};

/* Several widgets share the single 'blocklist' list option: each one only
 * owns its own id(s). Only touch uci when the list really changes. */
function setLists(sid, ids, on) {
	const cur = L.toArray(uci.get('custos', sid, 'blocklist'));
	const next = cur.filter((x) => !ids.includes(x)).concat(on);
	if (next.join(' ') != cur.join(' '))
		uci.set('custos', sid, 'blocklist', next.length ? next : null);
}

/* Blocked services as a grid of icons with check boxes (like AdGuard Home). */
const ServiceGrid = form.Value.extend({
	__name__: 'CBI.CustosServiceGrid',

	renderWidget(section_id, option_index, cfgvalue) {
		const on = L.toArray(cfgvalue);
		const groups = {};
		(this.services || []).forEach((s) => (groups[s.group] = groups[s.group] || []).push(s));

		const grid = E('div', { 'class': 'cu-svc', 'id': this.cbid(section_id) });
		Object.keys(groups).sort((a, b) => (GROUP_NAMES[a] || a).localeCompare(GROUP_NAMES[b] || b)).forEach((g) => {
			grid.appendChild(E('h4', { 'data-group': g }, GROUP_NAMES[g] || g));
			groups[g].sort((a, b) => a.name.localeCompare(b.name)).forEach((s) => {
				const box = E('input', { 'type': 'checkbox', 'value': s.id, 'checked': on.includes(s.id) ? '' : null });
				const lbl = E('label', { 'class': on.includes(s.id) ? 'on' : '', 'data-name': s.name.toLowerCase(), 'data-group': g }, [
					box,
					s.icon ? E('img', { 'src': 'data:image/svg+xml;base64,' + s.icon, 'alt': '' }) : '',
					cu.esc(s.name)
				]);
				box.addEventListener('change', () => lbl.classList.toggle('on', box.checked));
				grid.appendChild(lbl);
			});
		});

		const search = E('input', { 'type': 'search', 'class': 'cbi-input-text', 'placeholder': _('Search services…'),
			'input': (ev) => {
				const q = ev.target.value.trim().toLowerCase();
				grid.querySelectorAll('label').forEach((l) => l.style.display = !q || l.dataset.name.includes(q) ? '' : 'none');
				grid.querySelectorAll('h4').forEach((h) => h.style.display = q ? 'none' : '');
			} });
		const count = () => grid.querySelectorAll('input:checked').length;
		const info = E('span', { 'class': 'cu-small' }, _('%d blocked').format(count()));
		grid.addEventListener('change', () => info.textContent = _('%d blocked').format(count()));

		if (!(this.services || []).length)
			return E('p', { 'class': 'cu-small' }, _('Service catalog unavailable: AdGuard Home is not running.'));
		return E('div', {}, [ E('div', { 'class': 'cu-svc-tools' }, [ search, info ]), grid ]);
	},

	formvalue(section_id) {
		const grid = document.getElementById(this.cbid(section_id));
		return grid ? Array.from(grid.querySelectorAll('input:checked')).map((i) => i.value) : this.cfgvalue(section_id);
	},

	write(section_id, value) {
		uci.set('custos', section_id, this.option, L.toArray(value).length ? L.toArray(value) : null);
	}
});

return view.extend({
	load() {
		return Promise.all([
			cu.lists(),
			cu.services().catch(() => ({})),
			cu.status().catch(() => ({})),
			uci.load('custos')
		]);
	},

	handleRefresh() {
		ui.showModal(_('Updating block lists…'), [ E('p', { 'class': 'spinning' }, _('Downloading the latest lists, this can take a minute.')) ]);
		return cu.refreshLists().then((r) => {
			ui.hideModal();
			ui.addNotification(null, E('p', r?.ok ? _('Block lists updated.') : _('Update failed – check the internet connection.')), r?.ok ? 'info' : 'warning');
		});
	},

	render([ lists, services, st ]) {
		const counts = {};
		(st?.agh?.lists || []).forEach((l) => counts[l.url] = l.rules);
		const url = (l) => l.url || (lists.base + l.id + '.txt');
		const size = (l) => counts[url(l)] != null ? ' · ' + _('%s domains').format(cu.num(counts[url(l)])) : '';
		const groups = lists.groups || [];

		const m = new form.Map('custos', _('Block lists'),
			_('Choose what is blocked. Everything is done by DNS: when a device asks for a blocked name, it gets no address. Changes take effect a few seconds after <em>Save & Apply</em>. Adult content, SafeSearch and the bypass protection are always on and cannot be switched off.'));

		/* --- Block lists and own rules */
		let s = m.section(form.NamedSection, 'filtering', 'filtering', _('Lists'),
			_('Lists by <a href="https://github.com/hagezi/dns-blocklists" target="_blank" rel="noreferrer">HaGeZi</a>, updated automatically every 24 hours. They apply to every device.'));
		s.addremove = false;
		s.tab('level', _('Protection level'));
		groups.filter((g) => !g.exclusive).forEach((g) => s.tab(g.id, g.title.replace(/ \(.*\)$/, '')));
		s.tab('services', _('Apps & services'));
		s.tab('own', _('Your own rules'));

		groups.forEach((g) => {
			const ids = g.lists.map((l) => l.id);
			if (g.exclusive) {
				const o = s.taboption('level', form.ListValue, 'bl_' + g.id, _('Ads, trackers, malware'),
					_('One general list. Higher levels block more but break more sites. <strong>Pro</strong> is a good start for a family.'));
				o.widget = 'radio';
				o.orientation = 'vertical';
				g.lists.forEach((l) => o.value(l.id, '%s – %s%s'.format(l.name, l.descr, size(l))));
				o.value('', _('None'));
				o.cfgvalue = (sid) => L.toArray(uci.get('custos', sid, 'blocklist')).filter((x) => ids.includes(x))[0] || '';
				o.write = (sid, v) => setLists(sid, ids, v ? [ v ] : []);
				o.remove = (sid) => setLists(sid, ids, []);
				return;
			}
			g.lists.forEach((l) => {
				const o = s.taboption(g.id, form.Flag, 'bl_' + l.id.replace(/[^a-z0-9]/g, '_'), l.name, cu.esc(l.descr) + size(l)
					+ (l.locked ? ' · <strong>' + _('Always on') + '</strong>' : ''));
				if (l.locked) {
					/* Adult content: enforced by the router, cannot be switched off. */
					o.readonly = true;
					o.cfgvalue = () => '1';
					o.write = o.remove = () => {};
					return;
				}
				o.default = '0';
				o.cfgvalue = (sid) => L.toArray(uci.get('custos', sid, 'blocklist')).includes(l.id) ? '1' : '0';
				o.write = (sid, v) => setLists(sid, [ l.id ], v == '1' ? [ l.id ] : []);
				o.remove = (sid) => setLists(sid, [ l.id ], []);
			});
		});

		let o = s.taboption('services', ServiceGrid, 'blocked_service', _('Blocked apps & services'),
			_('Blocks a whole service (app, web site and its servers) on every device. Lists cover categories; this covers single services such as TikTok, Roblox or Fortnite.'));
		o.services = services.services || [];

		o = s.taboption('own', form.DynamicList, 'block_domain', _('Always block'),
			_('Domain names; subdomains are included (example.com also blocks www.example.com). Applies to every filtered device.'));
		o.datatype = 'hostname';
		o = s.taboption('own', form.DynamicList, 'allow_domain', _('Always allow'),
			_('Overrides the block lists, e.g. a school site that is blocked by mistake. Never works for adult content or bypass services. Tip: <em>Activity</em> has an Allow button next to every blocked name.'));
		o.datatype = 'hostname';

		return m.render().then((node) => E([], [
			cu.style(),
			E('div', { 'class': 'cu-side' }, [
				E('div', {}, [
					node,
					this.renderAlwaysOn(),
					E('div', { 'class': 'cbi-section' }, [
						E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, 'handleRefresh') }, _('Update block lists now'))
					])
				]),
				this.renderViewer(lists, counts, url)
			])
		]));
	},

	/* Locked protections: shown, never configurable. */
	renderAlwaysOn() {
		const li = (t, d) => E('li', {}, [ cu.mark(true, t), d ? E('span', { 'class': 'cu-small' }, ' – ' + d) : '' ]);
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Always on')),
			E('p', { 'class': 'cbi-section-descr' }, _('These protections apply to every device and cannot be switched off.')),
			E('div', { 'class': 'cu-cols' }, [
				cu.card(_('SafeSearch'), E('ul', { 'class': 'cu-lock' }, [
					li('Google Search & Images'),
					li(_('YouTube Restricted Mode'), _('hides mature videos and comments, also in the app')),
					li('Bing / Microsoft Edge / Copilot'),
					li('DuckDuckGo'), li('Ecosia'), li('Yandex'), li('Pixabay'),
					li(_('Search engines without SafeSearch are blocked'))
				])),
				cu.card(_('Bypass protection'), E('ul', { 'class': 'cu-lock' }, [
					li(_('Adult content list (NSFW)')),
					li(_('Encrypted DNS, VPN and proxy services'), _('HaGeZi bypass list')),
					li(_('Firefox stays on Custos'), _('canary domain')),
					li(_('iCloud Private Relay blocked')),
					li(_('No Allow for anything on these lists'))
				]))
			])
		]);
	},

	/* "What is on this list?": search inside any active list. */
	renderViewer(lists, counts, url) {
		const active = (lists.groups || []).flatMap((g) => g.lists).concat(lists.bypass ? [ lists.bypass ] : [])
			.filter((l) => counts[url(l)] != null);
		const sel = E('select', { 'class': 'cbi-input-select' }, active.map((l) =>
			E('option', { 'value': l.id }, '%s (%s)'.format(l.name.replace(/^HaGeZi /, ''), cu.num(counts[url(l)])))));
		const q = E('input', { 'type': 'search', 'class': 'cbi-input-text', 'placeholder': _('Search, e.g. tiktok') });
		const out = E('div', {});
		const show = () => cu.listDomains(sel.value, q.value.trim().toLowerCase() || undefined, 200).then((r) => {
			if (r?.error)
				return dom.content(out, E('p', { 'class': 'cu-small cu-bad' }, cu.esc(r.error)));
			dom.content(out, [
				E('p', { 'class': 'cu-small' }, r.total > r.domains.length
					? _('%s matches, first %d shown.').format(cu.num(r.total), r.domains.length)
					: _('%s matches.').format(cu.num(r.total))),
				E('div', { 'class': 'cu-domains' }, r.domains.map((d) => E('div', {}, cu.esc(d))))
			]);
		});
		sel.addEventListener('change', show);
		q.addEventListener('keydown', (ev) => { if (ev.key == 'Enter') { ev.preventDefault(); show(); } });
		if (active.length)
			window.setTimeout(show, 0);
		return cu.card(_('What is on a list'), active.length ? [
			E('p', { 'class': 'cu-small' }, _('Every domain on a list is blocked, including its subdomains.')),
			E('div', { 'class': 'cu-svc-tools' }, [ sel, q,
				E('button', { 'class': 'btn', 'click': (ev) => { ev.preventDefault(); show(); } }, _('Search')) ]),
			out
		] : E('p', { 'class': 'cu-small' }, _('No lists downloaded yet.')));
	}
});
