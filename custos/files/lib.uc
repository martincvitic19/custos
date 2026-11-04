// SPDX-License-Identifier: GPL-2.0-only
// Shared helpers for the Custos scripts and rpcd plugin.
'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

export const RUNDIR = '/var/run/custos';
export const AGH = 'http://127.0.0.1:3000/control';

export function mkdirs(path) {
	let p = '';
	for (let part in split(path, '/')) {
		if (part == '')
			continue;
		p += '/' + part;
		if (!fs.stat(p))
			fs.mkdir(p, 0o755);
	}
};

export function shellquote(s) {
	return "'" + replace(`${s}`, "'", "'\\''") + "'";
};

export function run(cmd) {
	let p = fs.popen(cmd, 'r');
	if (!p)
		return null;
	let out = p.read('all');
	p.close();
	return out;
};

export function read_json(path, dflt) {
	let s = fs.readfile(path);
	let v = s ? json(s) : null;
	return v ?? dflt;
};

export function write_json(path, data) {
	let tmp = path + '.tmp';
	fs.writefile(tmp, sprintf('%J', data));
	fs.rename(tmp, path);
};

// Call the AdGuard Home REST API on loopback. Returns { code, body }.
export function agh(method, path, body, timeout) {
	mkdirs(RUNDIR);
	let cmd = sprintf("curl -s -m %d -X %s -w '\\n%%{http_code}'", timeout ?? 20, method);
	if (body != null) {
		let req = RUNDIR + '/agh-req.json';
		fs.writefile(req, sprintf('%J', body));
		cmd += ` -H 'Content-Type: application/json' --data-binary @${req}`;
	}
	let out = run(cmd + ' ' + shellquote(AGH + path)) ?? '';
	let nl = rindex(out, '\n');
	let code = +substr(out, nl + 1);
	let text = substr(out, 0, nl);
	let parsed = null;
	try { parsed = length(text) ? json(text) : null; } catch (e) { parsed = text; }
	return { code, body: parsed };
};

export function agh_ok(r) {
	return r.code >= 200 && r.code < 300;
};

// Short, readable reason for a failed AdGuard Home call.
export function agh_err(r) {
	let msg = type(r.body) == 'object' ? (r.body.message ?? sprintf('%J', r.body)) : `${r.body ?? ''}`;
	if (match(msg, /network is unreachable|all upstreams failed|no such host/))
		return `${r.code} no internet connection (retried when WAN comes up)`;
	msg = trim(split(msg, '\n')[0]);
	return `${r.code}${length(msg) ? ' ' + substr(msg, 0, 160) : ''}`;
};

export function config() {
	let c = cursor();
	c.load('custos');
	return c;
};

export function normmac(mac) {
	return lc(trim(mac ?? ''));
};

// Devices configured in /etc/config/custos.
export function devices(c) {
	let list = [];
	c.foreach('custos', 'device', (s) => {
		if (!s.mac)
			return;
		push(list, {
			section: s['.name'],
			name: s.name ?? s.mac,
			mac: normmac(s.mac)
		});
	});
	return list;
};

// Known hosts on the LAN: DHCP leases + neighbour table + configured devices.
export function hosts(c) {
	let res = {};
	for (let d in devices(c))
		res[d.mac] = { mac: d.mac, name: d.name, configured: true };

	let leases = fs.readfile('/tmp/dhcp.leases') ?? '';
	for (let line in split(leases, '\n')) {
		let f = split(line, ' ');
		if (length(f) < 4)
			continue;
		let mac = normmac(f[1]);
		res[mac] ??= { mac };
		res[mac].ip = f[2];
		if (f[3] != '*')
			res[mac].hostname = f[3];
	}

	for (let line in split(run('ip -4 neigh show') ?? '', '\n')) {
		let m = match(line, /^([0-9.]+) dev \S+ lladdr ([0-9a-f:]+)/);
		if (!m)
			continue;
		let mac = normmac(m[2]);
		res[mac] ??= { mac };
		res[mac].ip ??= m[1];
	}

	return res;
};

// --- Locked lists ------------------------------------------------------------
//
// Lists marked "locked" in the catalog (adult content, search engines
// without SafeSearch, DoH/VPN/proxy bypass) are always on and can never be
// overridden by an allow rule. AdGuard Home keeps every list
// as an adblock file ("||domain^" per line) under its work dir.
export const CATALOG = '/usr/share/custos/blocklists.json';
export const FILTERDIR = '/etc/adguardhome/work/data/filters';

export function catalog() {
	return read_json(CATALOG, { base: '', groups: [] });
};

export function list_url(cat, l) {
	return l.url ?? (cat.base + l.id + '.txt');
};

// Every list of the catalog, the bypass list included.
export function all_lists(cat) {
	let res = [];
	for (let g in cat.groups)
		for (let l in g.lists)
			push(res, l);
	if (cat.bypass)
		push(res, cat.bypass);
	return res;
};

export function locked_ids(cat) {
	return map(filter(all_lists(cat), (l) => l.locked), (l) => l.id);
};

// AdGuard Home filter ids of the locked lists, from /filtering/status.
export function locked_filters(cat, filters) {
	let urls = {};
	for (let l in all_lists(cat))
		if (l.locked)
			urls[list_url(cat, l)] = true;
	let ids = {};
	for (let f in (filters ?? []))
		if (urls[f.url])
			ids[`${f.id}`] = true;
	return ids;
};

function locked_files(ids) {
	return join(' ', map(keys(ids), (id) => shellquote(`${FILTERDIR}/${id}.txt`)));
}

// Is the domain, or a domain above it, on a locked list?
export function locked_match(domain, ids) {
	let files = locked_files(ids);
	if (!length(files))
		return false;
	let parts = split(lc(domain), '.'), args = '';
	for (let i = 0; i < length(parts); i++)
		args += ' -e ' + shellquote('||' + join('.', slice(parts, i)) + '^');
	return system(`grep -qsFx${args} ${files}`) == 0;
};

// Domains below the given one that are on a locked list.
export function locked_below(domain, ids) {
	let files = locked_files(ids);
	if (!length(files))
		return [];
	let out = run(`grep -hsF -e ${shellquote('.' + lc(domain) + '^')} ${files}`) ?? '';
	let res = [];
	for (let line in split(out, '\n')) {
		let m = match(line, /^\|\|([a-z0-9._-]+)\^$/);
		if (m)
			push(res, m[1]);
	}
	return uniq(res);
};
