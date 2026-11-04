# SPDX-License-Identifier: GPL-2.0-only
#
# Custos: family-safe DNS filtering for the whole home network, with
# AdGuard Home, HaGeZi block lists and enforced SafeSearch.

include $(TOPDIR)/rules.mk

PKG_NAME:=custos
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/custos
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Custos family-safe DNS filter
  PKGARCH:=all
  DEPENDS:=+adguardhome +curl +ca-bundle \
	+ucode +ucode-mod-fs +ucode-mod-uci +rpcd-mod-ucode
endef

define Package/custos/description
  Turns OpenWrt into the DNS server and DHCP server of an existing home
  network: AdGuard Home with HaGeZi block lists, enforced SafeSearch,
  blocked apps and services and DNS bypass protection. The ISP router stays the
  router; one cable from it to this device is all it needs.
endef

define Package/custos/conffiles
/etc/config/custos
endef

define Build/Compile
endef

define Package/custos/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/etc/uci-defaults
	$(INSTALL_CONF) ./files/custos.config $(1)/etc/config/custos
	$(INSTALL_BIN) ./files/custos.init $(1)/etc/init.d/custos
	$(INSTALL_BIN) ./files/custos.uci-defaults $(1)/etc/uci-defaults/90-custos
	$(INSTALL_DIR) $(1)/usr/libexec/custos
	$(INSTALL_BIN) ./files/apply.uc $(1)/usr/libexec/custos/apply
	$(INSTALL_DIR) $(1)/usr/share/ucode
	$(INSTALL_DATA) ./files/lib.uc $(1)/usr/share/ucode/custos.uc
	$(INSTALL_DIR) $(1)/usr/share/custos
	$(INSTALL_DATA) ./files/adguardhome.yaml $(1)/usr/share/custos/adguardhome.yaml
	$(INSTALL_DATA) ./files/blocklists.json $(1)/usr/share/custos/blocklists.json
	$(INSTALL_DATA) ./files/banner $(1)/usr/share/custos/banner
	echo '$(PKG_VERSION)' > $(1)/usr/share/custos/version
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./files/rpcd.uc $(1)/usr/share/rpcd/ucode/custos
endef

$(eval $(call BuildPackage,custos))
