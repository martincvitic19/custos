'use strict';
'require baseclass';
'require rpc';
'require ui';

/* Shared by the Custos views: rpc calls, styles and small widgets. */

const CSS = `
.cu-hero{display:flex;align-items:center;gap:14px;border-radius:8px;padding:14px 18px;margin:0 0 16px;border:1px solid currentColor}
.cu-hero .big{font-size:1.5em;font-weight:600}
.cu-hero .sub{opacity:.85}
.cu-checks{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 16px}
.cu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:0 0 16px}
.cu-tile{border:1px solid var(--border-color-medium,#ccc);border-radius:6px;padding:12px}
.cu-tile .v{font-size:1.8em;font-weight:600;line-height:1.2}
.cu-tile .l{opacity:.75;font-size:.9em}
.cu-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.cu-card{border:1px solid var(--border-color-medium,#ccc);border-radius:6px;padding:12px 14px;margin-bottom:16px;overflow:hidden}
.cu-card h3{margin:0 0 10px;font-size:1.1em}
.cu-ok{color:var(--success-color-high,#2e7d32)} .cu-bad{color:var(--error-color-high,#c62828)} .cu-warn{color:var(--warn-color-high,#b26a00)}
.cu-small{font-size:.85em;opacity:.8}
.cu-tbl{width:100%;font-size:.9em;border-collapse:collapse} .cu-tbl td{padding:3px 4px;word-break:break-all;vertical-align:middle}
.cu-tbl tr+tr td{border-top:1px solid var(--border-color-low,#eee)}
.cu-tbl .btn{padding:0 8px;font-size:.85em;line-height:1.8em;height:auto}
.cu-svc-tools{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.cu-svc{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
.cu-svc label{display:flex;align-items:center;gap:6px;border:1px solid var(--border-color-medium,#ccc);border-radius:6px;padding:5px 8px;cursor:pointer;font-size:.9em}
.cu-svc label.on{border-color:var(--error-color-high,#c62828);background:rgba(198,40,40,.08)}
.cu-svc img{width:18px;height:18px;flex:0 0 18px}
.cu-svc h4{grid-column:1/-1;margin:8px 0 0;font-size:.95em;opacity:.8}
.cu-result{margin-top:10px;padding:8px 12px;border-radius:6px;border:1px solid currentColor}
.cu-row-bad td{background:rgba(198,40,40,.12)}
.cu-side{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start}
@media (max-width:1000px){.cu-side{grid-template-columns:minmax(0,1fr)}}
.cu-lock{list-style:none;margin:0;padding:0} .cu-lock li{padding:3px 0}
.cu-domains{max-height:420px;overflow:auto;font-family:monospace;font-size:.85em}
`;

/* Hostnames and domains come from the network: always escape. */
const esc = (v) => '%h'.format(v ?? '');

return baseclass.extend({
	CSS,
	esc,

	status: rpc.declare({ object: 'custos', method: 'status' }),
	hosts: rpc.declare({ object: 'custos', method: 'hosts' }),
	services: rpc.declare({ object: 'custos', method: 'services' }),
	lists: rpc.declare({ object: 'custos', method: 'lists' }),
	listDomains: rpc.declare({ object: 'custos', method: 'list_domains', params: [ 'id', 'search', 'limit' ] }),
	querylog: rpc.declare({ object: 'custos', method: 'querylog', params: [ 'limit', 'blocked', 'search' ] }),
	check: rpc.declare({ object: 'custos', method: 'check', params: [ 'domain' ] }),
	rule: rpc.declare({ object: 'custos', method: 'rule', params: [ 'domain', 'action' ] }),
	setConnection: rpc.declare({ object: 'custos', method: 'set_connection', params: [ 'ipaddr', 'gateway' ] }),
	refreshLists: rpc.declare({ object: 'custos', method: 'refresh_lists' }),
	apply: rpc.declare({ object: 'custos', method: 'apply' }),

	style() {
		return E('style', {}, CSS);
	},

	mark(ok, label, warn) {
		return E('span', { 'class': ok ? 'cu-ok' : (warn ? 'cu-warn' : 'cu-bad') },
			(ok ? '✔ ' : (warn ? '● ' : '✖ ')) + label);
	},

	tile(value, label) {
		return E('div', { 'class': 'cu-tile' }, [ E('div', { 'class': 'v' }, value), E('div', { 'class': 'l' }, label) ]);
	},

	card(title, body) {
		return E('div', { 'class': 'cu-card' }, [ E('h3', {}, title) ].concat(body));
	},

	num(n) {
		return n == null ? '–' : Number(n).toLocaleString();
	},

	/* What a query-log entry or a domain check means, in words. */
	verdict(e) {
		if (e.blocked)
			return E('span', { 'class': 'cu-bad' }, e.service
				? _('Blocked service: %s').format(esc(e.service))
				: _('Blocked by %s').format(esc(e.list || _('a block list'))));
		if (e.safesearch)
			return E('span', { 'class': 'cu-warn' }, _('SafeSearch enforced'));
		if (e.allowed_by_rule)
			return E('span', { 'class': 'cu-ok' }, _('Allowed by your rule'));
		return E('span', { 'class': 'cu-small' }, _('Allowed'));
	},

	/* Allow / block button for a domain; calls done() after the change.
	 * Adult content (locked lists) can never be allowed: no button. */
	ruleButton(domain, blocked, done, locked) {
		if (blocked && locked)
			return E('span', { 'class': 'cu-small cu-bad', 'title': _('Adult content is always blocked and cannot be allowed.') }, _('Always blocked'));
		const action = blocked ? 'allow' : 'block';
		return E('button', {
			'class': 'btn ' + (blocked ? 'cbi-button-positive' : 'cbi-button-negative'),
			'title': blocked ? _('Always allow %s (and its subdomains)').format(domain) : _('Always block %s (and its subdomains)').format(domain),
			'click': ui.createHandlerFn(this, () => this.rule(domain, action).then((r) => {
				ui.addNotification(null, E('p', r?.ok
					? (blocked ? _('%s is now always allowed.') : _('%s is now always blocked.')).format(esc(domain))
					: (r?.error == 'locked'
						? _('%s is adult content and cannot be allowed.').format(esc(domain))
						: _('Could not change the rule for %s.').format(esc(domain)))), r?.ok ? 'info' : 'warning');
				return done?.();
			}))
		}, blocked ? _('Allow') : _('Block'));
	}
});
