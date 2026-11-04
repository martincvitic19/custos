'use strict';
'require view';
'require form';
'require uci';
'require custos.common as cu';

return view.extend({
	load() {
		return Promise.all([ cu.hosts(), uci.load('custos') ]);
	},

	render([ res ]) {
		const hosts = res?.hosts || [];
		const m = new form.Map('custos', _('Devices'),
			_('Give family devices a name, so <em>Home</em> and <em>Activity</em> show who looked something up. Every device on the network is filtered the same way, listed here or not, so new phones and guests are filtered from the first minute.') + '<br>' +
			_('Devices are recognised by their MAC address. Phones use a random ("private") Wi-Fi address per network by default; it stays the same for your home network unless you forget the network on the phone.'));

		const s = m.section(form.GridSection, 'device', _('Your devices'));
		s.addremove = true;
		s.anonymous = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add device');

		let o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.placeholder = _('e.g. Kid tablet');
		o.validate = (sid, v) => /^[A-Za-z0-9 ._\x27-]{1,32}$/.test(v) || _('1–32 letters, digits, spaces');

		o = s.option(form.Value, 'mac', _('Device'), _('Pick a device that is online, or type its MAC address.'));
		o.datatype = 'macaddr';
		o.rmempty = false;
		hosts.sort((a, b) => (a.hostname || a.mac).localeCompare(b.hostname || b.mac)).forEach((h) =>
			o.value(h.mac, '%h (%h%h)'.format(h.hostname || h.name || _('unknown'), h.ip ? h.ip + ', ' : '', h.mac)));

		const known = new Set(L.toArray(uci.sections('custos', 'device')).map((d) => (d.mac || '').toLowerCase()));
		const unknown = hosts.filter((h) => h.ip && !known.has(h.mac));

		return m.render().then((node) => E([], [
			cu.style(),
			node,
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Other devices on the network')),
				unknown.length ? E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, _('Name')), E('th', { 'class': 'th' }, _('IP address')), E('th', { 'class': 'th' }, _('MAC address'))
					])
				].concat(unknown.map((h) => E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, cu.esc(h.hostname || '–')),
					E('td', { 'class': 'td' }, cu.esc(h.ip)),
					E('td', { 'class': 'td' }, cu.esc(h.mac))
				])))) : E('p', { 'class': 'cu-small' }, _('None – every device seen is listed above.'))
			])
		]));
	}
});
