# Custos

Family-safe DNS filtering for every device in your home, built on
**OpenWrt 25.12.5**. One small box next to your CPE (the router your ISP gave
you), one cable, and every phone, laptop, TV and console on the network gets:

- [HaGeZi](https://github.com/hagezi/dns-blocklists) block lists in AdGuard
  Home: ads, trackers, malware, adult content, social networks, telemetry
- SafeSearch enforced on Google, YouTube (Restricted Mode), Bing, DuckDuckGo
  and others
- blocked apps and services (TikTok, Roblox, Fortnite, …)
- bypass protection: DNS-over-HTTPS resolvers, VPN/proxy services, iCloud
  Private Relay
- adult content, SafeSearch and bypass protection are **always on** and cannot
  be overridden with *Allow*
- a LuCI web UI: *Home*, *Activity*, *Block lists*, *Devices*

This repository is an **OpenWrt feed**: it holds only the Custos packages and
the build script. The rest is vanilla OpenWrt.

```
build.sh            one command: device config + per-build settings + make
configs/            target and package set per device
custos/             backend package (apply engine, ubus API, AdGuard Home config)
luci-app-custos/    the web UI
```

## How it works

```text
                       internet
                           │
                  ┌────────┴────────┐
                  │       CPE       │ 192.168.0.1
                  │ gateway, NAT,   │ DHCP server: off
                  │ firewall, Wi-Fi │
                  └──┬─────┬─────┬──┘
                     │     │     │
           ┌─────────┴──┐ phone laptop ...
           │   Custos   │ 192.168.0.14
           │  (Brume 2) │ DHCP + DNS filter
           └────────────┘
```

The CPE stays the router. Custos hands out IP addresses (DHCP) and tells every
device "your gateway is the CPE, your DNS server is me". DNS queries go to
AdGuard Home on Custos; allowed ones are forwarded over DNS-over-HTTPS to
Quad9 and Mullvad DNS. The traffic itself never passes through Custos.

## What you need

- GL.iNet **GL-MT2500 / GL-MT2500A Brume 2**. Other devices supported by
  OpenWrt work too: Custos needs one Ethernet port, 512 MB RAM and 128 MB of
  storage. Closest to the Brume 2 (small, wired only, two or more Ethernet ports) are
  the FriendlyElec NanoPi R2S / R3S / R5S / R6S and the Radxa E20C. Common
  boards like the Raspberry Pi 4 / 5 or any x86-64 PC work as well. The
  GL.iNet Brume 3 (GL-MT5000) is not supported by OpenWrt 25.12 yet. A new
  device needs its own `configs/<device>.config` (copy an existing one and
  change the target lines).
- a PC with an Ethernet port and two Ethernet cables
- admin access to your CPE's web interface (to switch its DHCP off)
- for building: Linux (Debian 12 / Ubuntu 22.04 or newer), ~40 GB free disk,
  1–2 hours for the first build

## 1. Download

Install the
[OpenWrt build prerequisites](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem),
then get OpenWrt and add Custos as a feed:

```sh
git clone --depth 1 -b v25.12.5 https://github.com/openwrt/openwrt.git
cd openwrt
echo "src-git custos https://github.com/martincvitic19/custos.git;develop" >> feeds.conf.default
./scripts/feeds update -a
./scripts/feeds install -a
```

## 2. Build

```sh
export CUSTOS_IP=192.168.0.14/24     # a free address in the CPE's network
export CUSTOS_GATEWAY=192.168.0.1    # the CPE
export CUSTOS_TZ=Europe/Zagreb       # default: the build machine's time zone
export CUSTOS_SSH_PUBKEY=~/.ssh/id_ed25519.pub   # optional; disables SSH passwords

./feeds/custos/build.sh glinet_gl-mt2500    # ./feeds/custos/build.sh list shows all devices
```

**Pick the address first.** Open the CPE's web interface: the address in the
browser bar (often `192.168.0.1` or `192.168.1.1`) is `CUSTOS_GATEWAY`. For
`CUSTOS_IP` keep the first three numbers and pick a free last number below the
CPE's DHCP range, e.g. `.14`. Both can be changed later under
*System → Custos*.

**Root password.** The build creates a random root password for every build
and saves it on the build machine (git-ignored). Only its hash goes into the
image. You log in to the web UI (and SSH, unless you set `CUSTOS_SSH_PUBKEY`)
as user `root` with this password:

```sh
cat feeds/custos/.secrets/glinet_gl-mt2500-root-password    # in the openwrt directory
```

Set `CUSTOS_ROOT_PASSWORD` before building to choose your own instead.

The image you need is
`bin/targets/mediatek/filogic/openwrt-mediatek-filogic-glinet_gl-mt2500-airoha-squashfs-sysupgrade.bin`.
Older Brume 2 units without the Airoha PHY use the same file without
`-airoha`; the stock firmware refuses the wrong one.

## 3. First flash (LAN port)

The stock GL.iNet firmware only allows admin access from its **LAN** port, at
`192.168.8.1`. So the first flash is the only time you use the LAN port:

1. PC Ethernet → **Brume LAN port**, nothing in the WAN port. Power on and
   wait about a minute.
2. Open `http://192.168.8.1` and set an admin password if asked.
3. *System → Upgrade → Local Upgrade*, choose the sysupgrade image,
   **untick *Keep Settings***, *Install*.
4. Wait about 3 minutes and don't unplug it.

## 4. Connect

1. Power the Brume off.
2. Cable from a **LAN port of the CPE → Brume WAN port**. The Brume's LAN port
   stays empty.
3. Power the Brume on and give it 2–3 minutes to download the block lists.

Custos bridges both ports into one network, so from now on it is reachable
over that one cable, including for all future updates.

## 5. Configure the CPE

Custos only works if it is the **only** place where devices learn their DNS
server. Every CPE names its menus differently, but these are the settings to
look for in its web interface (log in with the address you used for
`CUSTOS_GATEWAY`; the admin password is often on a sticker on the CPE):

| Setting (typical menu) | Set to | Why |
|---|---|---|
| DHCP server, IPv4 (*LAN → DHCP*) | **off** | Custos hands out addresses, with itself as DNS. Two DHCP servers race, and devices take whichever answers first |
| DHCPv6 / stateful IPv6 (*LAN → IPv6*) | **off** | otherwise devices learn the ISP's DNS over IPv6 and skip Custos |
| DNS in IPv6 router advertisements (RDNSS) | **off**, if the CPE has the option | same reason. If you can't control it, switch IPv6 off on the LAN side |
| Custom DNS servers for the LAN | empty / default | the CPE must not hand out DNS servers through any other path |
| Parental control / DNS filter / "safe browsing" | off | two filters only confuse each other |
| Wi-Fi, NAT, firewall, port forwards | unchanged | the CPE stays the router and the gateway of every device |

Also check that:

- **Custos's address is outside the CPE's old DHCP range**, or reserved for
  the Brume's MAC address, so no other device can get it. Custos hands out
  `.100–.249` itself.
- The CPE stays in **router mode**. "Bridge" or "modem" mode would remove
  the gateway that Custos points devices to.
- Wi-Fi extenders and mesh nodes run as access points (no DHCP of their own).

Then reboot the CPE. If it cannot switch DHCP off at all, Custos still answers
DHCP requests, but devices may take the CPE's answer first. In that case, ask
your ISP for a CPE where DHCP can be switched off.

## 6. Check

Reconnect each device (Wi-Fi off and on) so it gets a new lease. Then:

| Test | Expected |
|---|---|
| IP settings | address `192.168.0.100–249`, gateway `192.168.0.1`, DNS `192.168.0.14` |
| `nslookup pornhub.com` | `0.0.0.0` / `::` |
| `nslookup www.google.com` | `forcesafesearch.google.com` (216.239.38.120) |
| `https://192.168.0.14` (log in as `root`) | *Home* says the network is protected |

Accept the self-signed certificate. SSH: `ssh root@192.168.0.14`.

## When Custos is unplugged or off

Custos is the only DHCP and DNS server of the network, so without it the
network does **not** fall back to unfiltered internet. It simply stops
working:

- **Names stop resolving.** Devices still use `192.168.0.14` as their DNS
  server, which no longer answers, so web pages and apps can't connect.
  Connections that are already open, and anything that uses a plain IP
  address, keep working for a while.
- **No new addresses.** The CPE's DHCP is off, so devices keep their address
  only until their lease runs out (12 hours). A device that joins or
  reconnects in the meantime gets no address (`169.254.x.x`) and no internet.
- **Plugging it back in fixes it by itself.** After about 2 minutes Custos
  answers again and the devices recover without any action. Devices that
  had lost their address get it back after reconnecting their Wi-Fi.

This is deliberate: pulling the cable does not get anyone around the filter,
it takes the whole house offline, and that gets noticed. Put the box where
children can't reach it. Flashing an update or rebooting behaves the same
for about 3 minutes.

If Custos is broken and you need internet without it, switch the CPE's DHCP
server back on and reconnect the devices. They then use the ISP's DNS, which
is **unfiltered**. Switch it off again once Custos is back.

## Updates

Build a new image, then flash it over the network:

```sh
scp -O bin/targets/mediatek/filogic/*gl-mt2500-airoha*sysupgrade.bin root@192.168.0.14:/tmp/fw.bin
ssh root@192.168.0.14 'sysupgrade /tmp/fw.bin'       # keeps settings; -n starts fresh
```

The block lists update themselves every 24 hours. Every build also writes
CycloneDX SBOM files next to the images (`*.bom.cdx.json`).

## Limits

- DNS filtering is not a firewall. A device with its own VPN, a phone on
  mobile data or an app with hard-coded DNS goes around it. The bypass
  protection closes the common paths, not all of them.
- Every device gets the same protection. Device names on the *Devices* page
  are tied to MAC addresses (phones keep their private Wi-Fi address per
  network unless the network is forgotten).
- Anyone with the root password can change anything.

## License

GPL-2.0-only, like OpenWrt. Custos is an independent project, not affiliated
with OpenWrt, GL.iNet, AdGuard, HaGeZi, Quad9 or Mullvad.
