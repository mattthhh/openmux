Name:           openmux
Version:        %{_openmux_version}
Release:        1%{?dist}
Summary:        Terminal multiplexer with master-stack tiling layout
License:        MIT
URL:            https://github.com/monotykamary/openmux
BuildArch:      x86_64
Requires:       bash
Requires:       glibc >= 2.28

%description
openmux is a terminal multiplexer with a master-stack tiling layout.

%install
rm -rf %{buildroot}
install -d %{buildroot}%{_libdir}/openmux
install -d %{buildroot}%{_bindir}
cp -a %{_sourcedir}/dist/. %{buildroot}%{_libdir}/openmux/
chmod 0755 %{buildroot}%{_libdir}/openmux/openmux
chmod 0755 %{buildroot}%{_libdir}/openmux/openmux-bin
ln -s %{_libdir}/openmux/openmux %{buildroot}%{_bindir}/openmux

%files
%license %{_sourcedir}/LICENSE
%doc %{_sourcedir}/README.md
%{_bindir}/openmux
%dir %{_libdir}/openmux
%{_libdir}/openmux/*

%changelog
* Sun Jun 21 2026 openmux maintainers <maintainers@openmux.local> - %{_openmux_version}-1
- Package openmux release artifact for RPM-based distributions.
