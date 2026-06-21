%global debug_package %{nil}

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
install -d %{buildroot}%{_licensedir}/%{name}
install -d %{buildroot}%{_docdir}/%{name}

cp -a %{_sourcedir}/dist/. %{buildroot}%{_libdir}/openmux/
chmod 0755 %{buildroot}%{_libdir}/openmux/openmux
chmod 0755 %{buildroot}%{_libdir}/openmux/openmux-bin

# Create a real wrapper in %{_bindir} pointing at the runtime dir (don't symlink the dist wrapper).
cat > %{buildroot}%{_bindir}/openmux <<'WRAPPER'
#!/usr/bin/env bash
RUNTIME_DIR="%{_libdir}/openmux"
export ZIG_PTY_LIB="${ZIG_PTY_LIB:-$RUNTIME_DIR/libzig_pty.so}"
export ZIG_GIT_LIB="${ZIG_GIT_LIB:-$RUNTIME_DIR/libzig_git.so}"
export GHOSTTY_VT_LIB="${GHOSTTY_VT_LIB:-$RUNTIME_DIR/libghostty-vt.so}"
export OPENMUX_VERSION="${OPENMUX_VERSION:-%{version}}"
export OPENMUX_ORIGINAL_CWD="${OPENMUX_ORIGINAL_CWD:-$(pwd)}"
cd "$RUNTIME_DIR"
if [[ -f "$RUNTIME_DIR/libstdout-rewrite.so" ]] && [[ -z "$OPENMUX_NO_REWRITE" ]]; then
  export LD_PRELOAD="${LD_PRELOAD:+$LD_PRELOAD:}$RUNTIME_DIR/libstdout-rewrite.so"
fi
exec "$RUNTIME_DIR/openmux-bin" "$@"
WRAPPER
chmod 0755 %{buildroot}%{_bindir}/openmux

install -m 0644 %{_sourcedir}/LICENSE %{buildroot}%{_licensedir}/%{name}/LICENSE
install -m 0644 %{_sourcedir}/README.md %{buildroot}%{_docdir}/%{name}/README.md

%files
%license %{_licensedir}/%{name}/LICENSE
%doc %{_docdir}/%{name}/README.md
%{_bindir}/openmux
%dir %{_libdir}/openmux
%{_libdir}/openmux/*
%changelog
* Sun Jun 21 2026 openmux maintainers <maintainers@openmux.local> - %{_openmux_version}-1
- Package openmux release artifact for RPM-based distributions.
