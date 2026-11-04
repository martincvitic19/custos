// SPDX-License-Identifier: GPL-2.0-only
// rpcd ubus object "custos" used by luci-app-custos.
'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';
import * as cu from 'custos';

const DOMAIN = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$/;

function svc_running(name) {
	let out = cu.run(`ubus call service list '{"name":"${name}"}'`);
	let s = out ? json(out) : null;
	for (let inst, v in (s?.[name]?.instances ?? {}))
		if (v.running)
			return true;
	return false;
}

function ping(ip) {
	if (!match(ip ?? '', /^[0-9.]+$/))
		return false;
	return system(`ping -c 1 -W 1 ${ip} >/dev/null 2>&1`) == 0;
}

function connection(c) {
	let st = json(cu.run('ubus call network.interface.lan status') || '{}') ?? {};
	let gw = c.get('custos', 'connection', 'gateway');
	return {
		ipaddr: c.get('custos', 'connection', 'ipaddr'),
		gateway: gw,
		addresses: map(st['ipv4-address'] ?? [], (a) => `${a.address}/${a.mask}`),
		up: !!st.up,
		router: ping(gw),
		internet: ping('9.9.9.9') || ping('194.242.2.2')
	};
}

// AdGuard Home filter id -> list name (for "blocked by ..." messages)
// Names of the AdGuard Home filter lists, and which ones are locked.
function list_info() {
	let names = { '0': 'Custos: own rules' };
	let fl = cu.agh('GET', '/filtering/status', null, 5);
	for (let f in (fl.body?.filters ?? []))
		names[`${f.id}`] = f.name;
	return { names, locked: cu.locked_filters(cu.catalog(), fl.body?.filters), seen: {} };
}

// "locked": blocked by an adult content list, or one of our own rules for
// a domain on it. Such a block can never be lifted from the web interface.
function is_locked(info, domain, r) {
	if (!r)
		return false;
	if (info.locked[`${r.filter_list_id}`] || match(r.text ?? '', /\$important$/))
		return true;
	if (r.filter_list_id != 0 || !domain)
		return false;
	info.seen[domain] ??= cu.locked_match(domain, info.locked);
	return info.seen[domain];
}

function explain(info, domain, reason, rules, service) {
	let r = rules?.[0];
	let blocked = match(reason ?? '', /^Filtered(BlackList|BlockedService|Invalid)/) != null;
	return {
		reason,
		blocked,
		safesearch: reason == 'FilteredSafeSearch',
		allowed_by_rule: reason == 'NotFilteredWhiteList',
		locked: blocked && is_locked(info, domain, r),
		list: r ? info.names[`${r.filter_list_id}`] : null,
		rule: r?.text,
		service
	};
}

const methods = {
	status: {
		call: function() {
			let c = cu.config();
			let res = {
				enabled: true,
				adguardhome: svc_running('adguardhome'),
				apply: cu.read_json(cu.RUNDIR + '/apply.json', {}),
				connection: connection(c)
			};
			let st = cu.agh('GET', '/stats', null, 5);
			if (cu.agh_ok(st)) {
				let s = st.body;
				res.agh = {
					queries: s.num_dns_queries,
					blocked: s.num_blocked_filtering,
					safesearch: s.num_replaced_safesearch,
					avg_ms: int((s.avg_processing_time ?? 0) * 1000 * 10) / 10,
					top_blocked: slice(s.top_blocked_domains ?? [], 0, 10),
					// the router's own lookups are not a "device using Custos"
					clients: length(filter(s.top_clients ?? [], (o) => !match(keys(o)[0], /^(127\.|::1$)/)))
				};
			}
			let fl = cu.agh('GET', '/filtering/status', null, 5);
			if (cu.agh_ok(fl)) {
				res.agh ??= {};
				res.agh.lists = map(fl.body.filters ?? [], (f) => ({
					name: f.name, url: f.url, enabled: f.enabled,
					rules: f.rules_count, updated: f.last_updated }));
			}
			return res;
		}
	},

	hosts: {
		call: function() {
			return { hosts: values(cu.hosts(cu.config())) };
		}
	},

	services: {
		call: function() {
			let r = cu.agh('GET', '/blocked_services/all', null, 10);
			return {
				groups: map(r.body?.groups ?? [], (g) => g.id),
				services: map(r.body?.blocked_services ?? [], (s) => ({
					id: s.id, name: s.name, group: s.group_id, icon: s.icon_svg }))
			};
		}
	},

	// What is on a block list: domains matching a search, from AdGuard
	// Home's copy of the list.
	list_domains: {
		args: { id: 'id', search: 'search', limit: 100 },
		call: function(req) {
			let cat = cu.catalog();
			let l = filter(cu.all_lists(cat), (x) => x.id == req.args.id)[0];
			if (!l)
				return { error: 'unknown list' };
			let url = cu.list_url(cat, l);
			let st = cu.agh('GET', '/filtering/status', null, 5);
			let f = filter(st.body?.filters ?? [], (x) => x.url == url)[0];
			if (!f)
				return { error: 'list not active' };
			let file = cu.shellquote(`${cu.FILTERDIR}/${f.id}.txt`);
			let q = lc(trim(req.args.search ?? ''));
			if (!match(q, /^[a-z0-9._-]*$/))
				return { error: 'invalid search' };
			let limit = +req.args.limit || 100;
			if (limit > 500)
				limit = 500;
			let pat = cu.shellquote(length(q) ? q : '||');
			let out = cu.run(`grep -F -e ${pat} ${file} | grep '^||' | head -n ${limit}`) ?? '';
			let total = +trim(cu.run(`grep -F -e ${pat} ${file} | grep -c '^||'`) ?? '0');
			return {
				name: f.name, total, updated: f.last_updated,
				domains: map(filter(split(out, '\n'), length), (x) => replace(x, /^\|\||\^.*$/g, ''))
			};
		}
	},

	lists: {
		call: function() {
			return cu.read_json('/usr/share/custos/blocklists.json', {});
		}
	},

	querylog: {
		args: { limit: 50, blocked: false, search: 'search' },
		call: function(req) {
			let limit = +req.args.limit || 50;
			if (limit > 500)
				limit = 500;
			let q = `/querylog?limit=${limit}`;
			if (req.args.blocked)
				q += '&response_status=blocked';
			if (match(req.args.search ?? '', /^[A-Za-z0-9.:_-]+$/))
				q += '&search=' + req.args.search;
			let r = cu.agh('GET', q, null, 10);
			let info = list_info();
			return { entries: map(r.body?.data ?? [], (e) => ({
				time: e.time, client: e.client, client_name: e.client_info?.name,
				domain: e.question?.name, type: e.question?.type, elapsed: e.elapsedMs,
				...explain(info, e.question?.name, e.reason, e.rules, e.service_name) })) };
		}
	},

	// "Why is this (not) blocked?" for one domain.
	check: {
		args: { domain: 'domain' },
		call: function(req) {
			let d = lc(trim(req.args.domain ?? ''));
			d = replace(d, /^[a-z]+:\/\//, '');
			d = split(split(d, '/')[0], ':')[0];
			if (!match(d, DOMAIN))
				return { error: 'invalid domain' };
			let r = cu.agh('GET', '/filtering/check_host?name=' + d, null, 10);
			if (!cu.agh_ok(r))
				return { error: cu.agh_err(r) };
			return { domain: d, ...explain(list_info(), d, r.body.reason, r.body.rules, r.body.service_name) };
		}
	},

	// One-click allow/block from the activity log.
	rule: {
		args: { domain: 'domain', action: 'action' },
		call: function(req) {
			let d = lc(trim(req.args.domain ?? ''));
			let a = req.args.action;
			if (!match(d, DOMAIN) || !(a in [ 'allow', 'block', 'remove' ]))
				return { error: 'invalid request' };
			if (a == 'allow' && cu.locked_match(d, list_info().locked))
				return { error: 'locked', domain: d };
			let c = cu.config();
			for (let opt in [ 'allow_domain', 'block_domain' ]) {
				let cur = c.get('custos', 'filtering', opt) ?? [];
				let next = filter(type(cur) == 'array' ? cur : [ cur ], (x) => lc(x) != d);
				if ((a == 'allow' && opt == 'allow_domain') || (a == 'block' && opt == 'block_domain'))
					push(next, d);
				length(next) ? c.set('custos', 'filtering', opt, next) : c.delete('custos', 'filtering', opt);
			}
			c.commit('custos');
			system('( /usr/libexec/custos/apply >/dev/null 2>&1 & )');
			return { ok: true, domain: d };
		}
	},

	// Moving to another address drops the connection of the browser that
	// asked for it, so this is applied with a delay instead of through
	// LuCI's Save & Apply (whose rollback would undo it).
	set_connection: {
		args: { ipaddr: 'ipaddr', gateway: 'gateway' },
		call: function(req) {
			let ip = req.args.ipaddr, gw = req.args.gateway;
			let m = match(ip ?? '', /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
			let g = match(gw ?? '', /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
			if (!m || !g || +m[5] < 8 || +m[5] > 30 ||
			    length(filter([ ...slice(m, 1, 5), ...slice(g, 1, 5) ], (x) => +x > 255)))
				return { error: 'invalid address' };
			let c = cu.config();
			c.set('custos', 'connection', 'ipaddr', ip);
			c.set('custos', 'connection', 'gateway', gw);
			c.commit('custos');
			system('( sleep 3; /usr/libexec/custos/apply >/dev/null 2>&1 & )');
			return { ok: true, ipaddr: ip, gateway: gw };
		}
	},

	refresh_lists: {
		call: function() {
			let r = cu.agh('POST', '/filtering/refresh', { whitelist: false }, 300);
			return { ok: cu.agh_ok(r), result: r.body };
		}
	},

	apply: {
		call: function() {
			system('( /usr/libexec/custos/apply >/dev/null 2>&1 & )');
			return { ok: true };
		}
	}
};

return { custos: methods };
