#!/usr/bin/ucode -S
// SPDX-License-Identifier: GPL-2.0-only
//
// Reconcile /etc/config/custos with the network/DHCP config and with
// AdGuard Home (REST API on loopback). Idempotent: only touches and reloads
// what actually changed. Progress/result: /var/run/custos/apply.json
//
//   apply          everything
//   apply boot     network/DHCP config only, no reloads (from uci-defaults)
//   apply retry    everything, but only if the last run failed (cron)
'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';
import * as cu from 'custos';

const STATUS = cu.RUNDIR + '/apply.json';
const LISTS = cu.read_json('/usr/share/custos/blocklists.json', { base: '', groups: [] });
// The router's own lookups (NTP, list downloads): AdGuard Home first, a
// public resolver while AdGuard Home is not up yet.
const SELF_DNS = [ '127.0.0.1', '9.9.9.9' ];
const UPSTREAMS = [ 'https://dns.quad9.net/dns-query', 'https://dns.mullvad.net/dns-query', '[/lan/]127.0.0.1:54' ];

let errors = [], changes = [];

function status(state) {
	cu.mkdirs(cu.RUNDIR);
	cu.write_json(STATUS, { state, time: time(), changes, errors });
}

function as_list(v) {
	return v == null ? [] : (type(v) == 'array' ? v : [ v ]);
}

function bool(v, dflt) {
	return v == null ? dflt : (v == '1' || v == 'true' || v == 'on' || v == 'yes');
}

function same(a, b) {
	return sprintf('%J', a) == sprintf('%J', b);
}

// uci helper: set option only if different, remember that the package changed.
function uset(c, dirty, pkg, sec, opt, val) {
	let cur = c.get(pkg, sec, opt);
	if (val == null) {
		if (cur != null) {
			c.delete(pkg, sec, opt);
			dirty[pkg] = true;
		}
		return;
	}
	if (!same(cur, val)) {
		c.set(pkg, sec, opt, val);
		dirty[pkg] = true;
	}
}

// A catalog entry may carry its own url (lists outside the adblock/ folder).
function list_url(id) {
	for (let g in LISTS.groups)
		for (let l in g.lists)
			if (l.id == id && l.url)
				return l.url;
	return LISTS.base + id + '.txt';
}

function list_owned(url) {
	if (index(url, LISTS.base) == 0)
		return true;
	for (let g in LISTS.groups)
		for (let l in g.lists)
			if (l.url == url)
				return true;
	return false;
}

function list_name(id) {
	for (let g in LISTS.groups)
		for (let l in g.lists)
			if (l.id == id)
				return 'HaGeZi ' + replace(l.name, /^HaGeZi /, '');
	if (id == LISTS.bypass?.id)
		return LISTS.bypass.name;
	return 'HaGeZi ' + id;
}

// --- Network: one network with the ISP router ------------------------------
//
// Both ports join br-lan, so it does not matter which one the ISP router's
// cable is in. The ISP router stays the gateway; this router only answers
// DHCP (gateway = ISP router, DNS = this router) and DNS.
function sync_network(c, boot) {
	let s = cursor();
	let dirty = {};
	s.load('network');
	s.load('dhcp');

	let conn = c.get_all('custos', 'connection') ?? {};
	let ip = conn.ipaddr ?? '192.168.0.14/24';
	if (index(ip, '/') < 0)
		ip += '/24';
	let gw = conn.gateway ?? '192.168.0.1';

	let br = s.get('network', 'lan', 'device') ?? 'br-lan';
	let wan = s.get('network', 'wan', 'device');
	s.foreach('network', 'device', (d) => {
		if (d.name != br || d.type != 'bridge' || !wan)
			return;
		let ports = as_list(d.ports);
		if (!(wan in ports))
			uset(s, dirty, 'network', d['.name'], 'ports', [ ...ports, wan ]);
	});

	uset(s, dirty, 'network', 'lan', 'proto', 'static');
	uset(s, dirty, 'network', 'lan', 'netmask', null);
	uset(s, dirty, 'network', 'lan', 'ipaddr', [ ip ]);
	uset(s, dirty, 'network', 'lan', 'gateway', gw);
	uset(s, dirty, 'network', 'lan', 'dns', SELF_DNS);
	for (let i in [ 'wan', 'wan6' ])
		if (s.get('network', i) == 'interface')
			uset(s, dirty, 'network', i, 'disabled', '1');

	// DHCP: gateway = ISP router; no IPv6 RA/DHCPv6 from here (the ISP
	// router routes IPv6, so it is the one to announce it).
	let opts = filter(as_list(s.get('dhcp', 'lan', 'dhcp_option')), (o) => !match(o, /^3,/));
	uset(s, dirty, 'dhcp', 'lan', 'dhcp_option', [ ...opts, '3,' + gw ]);
	uset(s, dirty, 'dhcp', 'lan', 'ra', 'disabled');
	uset(s, dirty, 'dhcp', 'lan', 'dhcpv6', 'disabled');

	for (let p in keys(dirty)) {
		s.commit(p);
		push(changes, `uci: ${p}`);
	}
	if (boot)
		return;
	if (dirty.network)
		system('/etc/init.d/network reload');
	if (dirty.dhcp)
		system('/etc/init.d/dnsmasq restart; /etc/init.d/odhcpd restart');
}

// --- AdGuard Home ---------------------------------------------------------

function agh_wait() {
	for (let i = 0; i < 60; i++) {
		let r = cu.agh('GET', '/status', null, 3);
		if (cu.agh_ok(r))
			return true;
		system('sleep 1');
	}
	return false;
}

const SAFE = { enabled: true, bing: true, duckduckgo: true, ecosia: true, google: true,
	pixabay: true, yandex: true, youtube: true };

// Every device gets the same protection (the global settings); the client
// entry only gives it a name in the query log. A 'role' option left over
// from older configs is ignored.
function client_data(d, mac) {
	let base = {
		name: d.name,
		ids: [ mac ],
		tags: [],
		upstreams: [],
		use_global_settings: true,
		use_global_blocked_services: true,
		filtering_enabled: true,
		parental_enabled: false,
		safebrowsing_enabled: false,
		safe_search: { enabled: false },
		blocked_services: { ids: [], schedule: { time_zone: 'Local' } },
		ignore_querylog: false,
		ignore_statistics: false
	};
	return base;
}

function sync_agh(c) {
	if (!agh_wait()) {
		push(errors, 'AdGuard Home API not reachable');
		return;
	}

	// Protection cannot be switched off: adult content, SafeSearch and the
	// bypass protection are always enforced.
	cu.agh('POST', '/protection', { enabled: true });

	let dns = cu.agh('GET', '/dns_info');
	if (cu.agh_ok(dns) && !same(dns.body.upstream_dns, UPSTREAMS)) {
		let r = cu.agh('POST', '/dns_config', { upstream_dns: UPSTREAMS });
		cu.agh_ok(r) ? push(changes, 'agh: upstreams') : push(errors, `agh upstreams: ${cu.agh_err(r)}`);
	}

	// Filter lists (we own every list under the HaGeZi base URL)
	let want = {};
	for (let id in as_list(c.get('custos', 'filtering', 'blocklist')))
		want[list_url(id)] = id;
	// Locked lists (adult content, bypass) cannot be switched off.
	for (let id in cu.locked_ids(LISTS))
		want[list_url(id)] = id;

	let st = cu.agh('GET', '/filtering/status');
	let have = {};
	for (let f in (st.body?.filters ?? []))
		have[f.url] = f;

	for (let url, f in have) {
		if (list_owned(url) && !want[url]) {
			let r = cu.agh('POST', '/filtering/remove_url', { url, whitelist: false });
			cu.agh_ok(r) ? push(changes, `agh: removed ${f.name}`) : push(errors, `remove ${f.name}: ${cu.agh_err(r)}`);
		}
	}
	for (let url, id in want) {
		if (!have[url]) {
			// AdGuard Home downloads the list synchronously; allow slow links.
			status('adding list ' + id);
			let r = cu.agh('POST', '/filtering/add_url', { name: list_name(id), url, whitelist: false }, 600);
			cu.agh_ok(r) ? push(changes, `agh: added ${id}`) : push(errors, `add ${id}: ${cu.agh_err(r)}`);
		}
		else if (!have[url].enabled) {
			cu.agh('POST', '/filtering/set_url', { url, whitelist: false,
				data: { name: have[url].name, url, enabled: true } });
		}
	}

	// Lists that are configured but empty: AdGuard Home started without
	// internet (boot without cable, or a flash that dropped its work dir)
	// and would only retry after filters_update_interval.
	let empty = filter(keys(have), (url) => want[url] && !have[url].rules_count);
	if (length(empty)) {
		status('downloading lists');
		cu.agh('POST', '/filtering/refresh', { whitelist: false }, 600);
		st = cu.agh('GET', '/filtering/status');
		for (let f in (st.body?.filters ?? []))
			if (want[f.url] && !f.rules_count)
				push(errors, `list ${want[f.url]} not downloaded`);
			else if (want[f.url] && index(empty, f.url) >= 0)
				push(changes, `agh: downloaded ${want[f.url]}`);
	}

	// Custom rules
	let rules = [ '! Managed by Custos - edit in LuCI -> Custos -> Filtering' ];
	// Bypass protection, always on: Firefox canary domain, iCloud Private Relay
	push(rules, '||use-application-dns.net^', '||mask.icloud.com^', '||mask-h2.icloud.com^');
	for (let d in as_list(c.get('custos', 'filtering', 'block_domain')))
		if (match(d, /^[A-Za-z0-9._-]+$/))
			push(rules, `||${lc(d)}^`);
	// Allow rules never reach a locked (adult content) list: a domain on it
	// is not allowed at all, and the locked domains below an allowed one
	// stay blocked ($important beats a plain @@ rule).
	st = cu.agh('GET', '/filtering/status');
	let locked = cu.locked_filters(LISTS, st.body?.filters);
	for (let d in as_list(c.get('custos', 'filtering', 'allow_domain'))) {
		d = lc(d);
		if (!match(d, /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/))
			continue;
		let below = cu.locked_match(d, locked) ? null : cu.locked_below(d, locked);
		if (below == null || length(below) > 2000) {
			push(changes, `allow ${d} refused: adult content`);
			continue;
		}
		push(rules, `@@||${d}^`);
		for (let b in below)
			push(rules, `||${b}^$important`);
	}
	if (!same(st.body?.user_rules, rules)) {
		let r = cu.agh('POST', '/filtering/set_rules', { rules });
		cu.agh_ok(r) ? push(changes, 'agh: custom rules') : push(errors, `rules: ${cu.agh_err(r)}`);
	}

	// SafeSearch: always on, for every engine and every device
	let safe = SAFE;
	let cur = cu.agh('GET', '/safesearch/status').body ?? {};
	if (length(filter(keys(safe), (k) => cur[k] !== safe[k]))) {
		let r = cu.agh('PUT', '/safesearch/settings', safe);
		cu.agh_ok(r) ? push(changes, 'agh: safesearch') : push(errors, `safesearch: ${cu.agh_err(r)}`);
	}

	// Blocked services (for every device)
	let svc = { ids: sort(as_list(c.get('custos', 'filtering', 'blocked_service'))),
		schedule: { time_zone: 'Local' } };
	let bs = cu.agh('GET', '/blocked_services/get');
	if (!same(sort(bs.body?.ids ?? []), svc.ids)) {
		let r = cu.agh('PUT', '/blocked_services/update', svc);
		cu.agh_ok(r) ? push(changes, 'agh: blocked services') : push(errors, `services: ${cu.agh_err(r)}`);
	}

	// Persistent clients: every configured device, so the query log shows its name.
	let cl = cu.agh('GET', '/clients');
	let existing = {};
	for (let x in (cl.body?.clients ?? []))
		existing[x.name] = x;
	let wanted = {};
	for (let d in cu.devices(c)) {
		let data = client_data(d, d.mac);
		wanted[d.name] = true;
		if (!existing[d.name]) {
			let r = cu.agh('POST', '/clients/add', data);
			cu.agh_ok(r) ? push(changes, `agh: client ${d.name}`) : push(errors, `client ${d.name}: ${cu.agh_err(r)}`);
		}
		else {
			let e = existing[d.name];
			if (!same(e.ids, data.ids) || e.use_global_settings != data.use_global_settings ||
			    e.filtering_enabled != data.filtering_enabled || e.use_global_blocked_services != data.use_global_blocked_services ||
			    length(filter(keys(data.safe_search), (k) => e.safe_search?.[k] !== data.safe_search[k])))
				cu.agh('POST', '/clients/update', { name: d.name, data });
		}
	}
	for (let name in keys(existing))
		if (!wanted[name])
			cu.agh('POST', '/clients/delete', { name });
}

let c = cu.config();

if (ARGV[0] == 'boot') {
	sync_network(c, true);
	exit(0);
}
// LuCI loads its scripts with ?v=<mtime of the package database>. A new
// image carries the build time, which is also the clock of a router without
// RTC until NTP has synced, so browsers would keep the previous Custos pages
// from their cache. Once per boot, with a synced clock, give it a new mtime.
const DB = fs.stat('/lib/apk/db/installed') ? '/lib/apk/db/installed' : '/usr/lib/opkg/status';
const BUSTED = cu.RUNDIR + '/cache-bust';
if (!fs.stat(BUSTED) && fs.stat(DB) && time() - fs.stat(DB).mtime > 3600) {
	cu.mkdirs(cu.RUNDIR);
	system(`touch ${DB}`);
	fs.writefile(BUSTED, '');
}

if (ARGV[0] == 'retry' && cu.read_json(STATUS, { state: 'error' }).state != 'error')
	exit(0);

// mkdir is atomic: use it as a lock, break locks older than 15 minutes.
const LOCK = cu.RUNDIR + '/apply.lock';
cu.mkdirs(cu.RUNDIR);
let st = fs.stat(LOCK);
if (st && time() - st.mtime > 900)
	fs.rmdir(LOCK);
if (!fs.mkdir(LOCK)) {
	warn('apply already running\n');
	exit(0);
}

status('running');
sync_network(c, false);
sync_agh(c);
status(length(errors) ? 'error' : 'ok');
if (length(changes) || length(errors))
	system(`logger -t custos ${cu.shellquote('apply: ' + (join('; ', changes) || 'no changes') + (length(errors) ? ' ERRORS: ' + join('; ', errors) : ''))}`);
fs.rmdir(LOCK);
exit(length(errors) ? 1 : 0);
