'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require custos.common as cu';

const IP4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

return view.extend({
	load() {
		return Promise.all([ cu.status().catch(() => ({})), uci.load('custos') ]);
	},

	handleMove() {
		const ip = document.getElementById('cu-ip').value.trim();
		const gw = document.getElementById('cu-gw').value.trim();
		const [ addr, prefix ] = ip.split('/');
		if (!IP4.test(addr) || !IP4.test(gw) || !(+prefix >= 8 && +prefix <= 30)) {
			ui.addNotification(null, E('p', _('Enter the address with prefix (e.g. 192.168.0.14/24) and the ISP router (e.g. 192.168.0.1).')), 'warning');
			return;
		}
		return cu.setConnection(ip, gw).then((r) => {
			if (!r?.ok) {
				ui.addNotification(null, E('p', _('Could not save: %s').format(cu.esc(r?.error))), 'warning');
				return;
			}
			const url = '%s//%s/cgi-bin/luci/admin/system/custos'.format(location.protocol, addr);
			ui.showModal(_('Moving to %s…').format(addr), [
				E('p', {}, _('Custos changes its address now. Devices get the new settings when they renew their address (or switch Wi-Fi off and on).')),
				E('p', {}, [ _('Continue at '), E('a', { 'href': url }, url) ])
			]);
			if (addr != location.hostname)
				window.setTimeout(() => location.href = url, 8000);
		});
	},

	render([ st ]) {
		const c = st?.connection || {};
		const m = new form.Map('custos', _('Custos settings'),
			_('Filtering cannot be switched off: adult content, SafeSearch and the bypass protection are always on.'));

		const conn = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Connection to the ISP router')),
			E('p', { 'class': 'cbi-section-descr' }, _('Custos sits next to your ISP router, on the same network, with one cable. The ISP router keeps routing the internet; Custos hands out addresses (DHCP) with the ISP router as gateway and itself as DNS server. The DHCP server of the ISP router must be switched off.')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'cu-ip' }, _('Custos address')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'id': 'cu-ip', 'class': 'cbi-input-text', 'value': c.ipaddr || '' }),
					E('div', { 'class': 'cbi-value-description' }, _('With prefix, e.g. 192.168.0.14/24. A free address in the ISP router\'s network.'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'cu-gw' }, _('ISP router')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'id': 'cu-gw', 'class': 'cbi-input-text', 'value': c.gateway || '' }),
					E('div', { 'class': 'cbi-value-description' }, [ _('Its address, e.g. 192.168.0.1. Now: '),
						cu.mark(c.router, c.router ? _('answers') : _('does not answer')) ])
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, ''),
				E('div', { 'class': 'cbi-value-field' }, E('button', { 'class': 'btn cbi-button-apply', 'click': ui.createHandlerFn(this, 'handleMove') }, _('Save address')))
			])
		]);

		const maint = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Maintenance')),
			E('p', {}, [
				E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, () => {
					ui.showModal(_('Updating block lists…'), [ E('p', { 'class': 'spinning' }, _('Downloading the latest lists, this can take a minute.')) ]);
					return cu.refreshLists().then((r) => {
						ui.hideModal();
						ui.addNotification(null, E('p', r?.ok ? _('Block lists updated.') : _('Update failed – check the internet connection.')), r?.ok ? 'info' : 'warning');
					});
				}) }, _('Update block lists now')), ' ',
				E('button', { 'class': 'btn', 'click': ui.createHandlerFn(this, () => cu.apply().then(() =>
					ui.addNotification(null, E('p', _('Settings are being applied again.')), 'info'))) }, _('Apply settings again'))
			]),
			E('p', { 'class': 'cu-small' }, _('Last apply: %s %s').format(cu.esc(st?.apply?.state || '–'),
				st?.apply?.time ? new Date(st.apply.time * 1000).toLocaleString() : '')),
			E('p', { 'class': 'cu-small' }, _('Advanced: the full AdGuard Home interface listens on this router only. Open it with <code>ssh -L 3000:127.0.0.1:3000 root@%s</code> and then http://localhost:3000. Changes made there may be overwritten by Custos.').format(cu.esc((c.ipaddr || '').split('/')[0])))
		]);

		return m.render().then((node) => E([], [ cu.style(), node, conn, maint ]));
	}
});
