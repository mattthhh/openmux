const std = @import("std");

const TerminalArtifact = enum {
    ghostty,
    lib,
};

const TerminalOptions = struct {
    artifact: TerminalArtifact,
    oniguruma: bool,
    simd: bool,
    c_abi: bool,
    slow_runtime_safety: bool,
    kitty_graphics_passthrough: bool,
    version: std.SemanticVersion,
};

const UucodeCompat = struct {
    module: *std.Build.Module,
    tables_path: std.Build.LazyPath,
};

const UnicodeTables = struct {
    props_output: std.Build.LazyPath,
    symbols_output: std.Build.LazyPath,

    pub fn init(
        b: *std.Build,
        _: std.Build.LazyPath,
        uucode_module: *std.Build.Module,
    ) !UnicodeTables {
        const props_exe = b.addExecutable(.{
            .name = "props-unigen",
            .root_module = b.createModule(.{
                .root_source_file = b.path("compat/ghostty-unicode/props_uucode.zig"),
                .target = b.graph.host,
                .optimize = .Debug,
                .link_libc = true,
                .strip = false,
                .omit_frame_pointer = false,
                .unwind_tables = .sync,
            }),
            .use_llvm = true,
        });
        props_exe.root_module.addImport("uucode", uucode_module);

        const symbols_exe = b.addExecutable(.{
            .name = "symbols-unigen",
            .root_module = b.createModule(.{
                .root_source_file = b.path("compat/ghostty-unicode/symbols_uucode.zig"),
                .target = b.graph.host,
                .optimize = .Debug,
                .link_libc = true,
                .strip = false,
                .omit_frame_pointer = false,
                .unwind_tables = .sync,
            }),
            .use_llvm = true,
        });
        symbols_exe.root_module.addImport("uucode", uucode_module);

        const props_run = b.addRunArtifact(props_exe);
        const symbols_run = b.addRunArtifact(symbols_exe);

        const wf = b.addWriteFiles();
        const props_output = wf.addCopyFile(props_run.captureStdOut(.{}), "props.zig");
        const symbols_output = wf.addCopyFile(symbols_run.captureStdOut(.{}), "symbols.zig");

        return .{
            .props_output = props_output,
            .symbols_output = symbols_output,
        };
    }

    pub fn addModuleImport(self: *const UnicodeTables, module: *std.Build.Module) void {
        module.addAnonymousImport("unicode_tables", .{
            .root_source_file = self.props_output,
        });
        module.addAnonymousImport("symbols_tables", .{
            .root_source_file = self.symbols_output,
        });
    }
};

fn addBuildOptions(
    b: *std.Build,
    module: *std.Build.Module,
    simd_enabled: bool,
) void {
    const build_opts = b.addOptions();
    build_opts.addOption(bool, "simd", simd_enabled);
    module.addOptions("build_options", build_opts);
}

fn addTerminalOptions(
    b: *std.Build,
    module: *std.Build.Module,
    options: TerminalOptions,
) void {
    const terminal_options = b.addOptions();
    terminal_options.addOption(TerminalArtifact, "artifact", options.artifact);
    terminal_options.addOption(bool, "c_abi", options.c_abi);
    terminal_options.addOption(bool, "oniguruma", options.oniguruma);
    terminal_options.addOption(bool, "simd", options.simd);
    terminal_options.addOption(bool, "slow_runtime_safety", options.slow_runtime_safety);
    terminal_options.addOption(bool, "kitty_graphics_passthrough", options.kitty_graphics_passthrough);
    terminal_options.addOption(bool, "kitty_graphics", true);
    terminal_options.addOption(bool, "tmux_control_mode", false);
    terminal_options.addOption([]const u8, "version_string", b.fmt("{f}", .{options.version}));
    terminal_options.addOption(usize, "version_major", options.version.major);
    terminal_options.addOption(usize, "version_minor", options.version.minor);
    terminal_options.addOption(usize, "version_patch", options.version.patch);
    terminal_options.addOption(?[]const u8, "version_pre", options.version.pre);
    terminal_options.addOption(?[]const u8, "version_build", options.version.build);
    module.addOptions("terminal_options", terminal_options);
}

fn buildOnigurumaModule(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    enabled: bool,
) *std.Build.Module {
    if (!enabled) {
        return b.createModule(.{
            .root_source_file = b.path("compat/oniguruma_stub.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
    }

    const include_dir = b.option([]const u8, "onig_include_dir", "Path to oniguruma headers") orelse "/opt/homebrew/include";
    const lib_dir = b.option([]const u8, "onig_lib_dir", "Path to oniguruma libraries") orelse "/opt/homebrew/lib";
    const lib_name = b.option([]const u8, "onig_lib_name", "System library name for oniguruma") orelse "onig";

    const module = b.createModule(.{
        .root_source_file = b.path("../../vendor/ghostty/pkg/oniguruma/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    module.addSystemIncludePath(.{ .cwd_relative = include_dir });
    module.addLibraryPath(.{ .cwd_relative = lib_dir });
    module.linkSystemLibrary(lib_name, .{});
    return module;
}

fn buildWuffsStubModule(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) *std.Build.Module {
    return b.createModule(.{
        .root_source_file = b.path("compat/wuffs_stub.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
}

fn buildUucodeTables(
    b: *std.Build,
    build_config_path: std.Build.LazyPath,
) std.Build.LazyPath {
    const target = b.graph.host;
    const optimize: std.builtin.OptimizeMode = .Debug;

    const config_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/config.zig"),
        .target = target,
        .optimize = optimize,
    });

    const types_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/types.zig"),
        .target = target,
        .optimize = optimize,
    });
    types_mod.addImport("config.zig", config_mod);
    config_mod.addImport("types.zig", types_mod);

    const config_x_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/x/config.x.zig"),
        .target = target,
        .optimize = optimize,
    });

    const types_x_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/x/types.x.zig"),
        .target = target,
        .optimize = optimize,
    });
    types_x_mod.addImport("config.x.zig", config_x_mod);
    config_x_mod.addImport("types.x.zig", types_x_mod);
    config_x_mod.addImport("types.zig", types_mod);
    config_x_mod.addImport("config.zig", config_mod);

    const build_config_mod = b.createModule(.{
        .root_source_file = build_config_path,
        .target = target,
        .optimize = optimize,
    });
    build_config_mod.addImport("types.zig", types_mod);
    build_config_mod.addImport("config.zig", config_mod);
    build_config_mod.addImport("types.x.zig", types_x_mod);
    build_config_mod.addImport("config.x.zig", config_x_mod);

    const build_tables_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/build/tables.zig"),
        .target = target,
        .optimize = optimize,
    });
    build_tables_mod.addImport("config.zig", config_mod);
    build_tables_mod.addImport("build_config", build_config_mod);
    build_tables_mod.addImport("types.zig", types_mod);

    const build_tables_exe = b.addExecutable(.{
        .name = "uucode-build-tables",
        .root_module = build_tables_mod,
        .use_llvm = true,
    });

    const run_build_tables = b.addRunArtifact(build_tables_exe);
    run_build_tables.setCwd(b.path("compat/uucode"));

    const wf = b.addWriteFiles();
    return wf.addCopyFile(run_build_tables.captureStdOut(.{}), "tables.zig");
}

fn buildUucodeCompat(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    build_config_path: std.Build.LazyPath,
) UucodeCompat {
    const config_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/config.zig"),
        .target = target,
        .optimize = optimize,
    });

    const types_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/types.zig"),
        .target = target,
        .optimize = optimize,
    });
    types_mod.addImport("config.zig", config_mod);
    config_mod.addImport("types.zig", types_mod);

    const config_x_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/x/config.x.zig"),
        .target = target,
        .optimize = optimize,
    });

    const types_x_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/x/types.x.zig"),
        .target = target,
        .optimize = optimize,
    });
    types_x_mod.addImport("config.x.zig", config_x_mod);
    config_x_mod.addImport("types.x.zig", types_x_mod);
    config_x_mod.addImport("types.zig", types_mod);
    config_x_mod.addImport("config.zig", config_mod);

    const build_config_mod = b.createModule(.{
        .root_source_file = build_config_path,
        .target = target,
    });
    build_config_mod.addImport("types.zig", types_mod);
    build_config_mod.addImport("config.zig", config_mod);
    build_config_mod.addImport("types.x.zig", types_x_mod);
    build_config_mod.addImport("config.x.zig", config_x_mod);

    const tables_path = buildUucodeTables(b, build_config_path);

    const tables_mod = b.createModule(.{
        .root_source_file = tables_path,
        .target = target,
        .optimize = optimize,
    });
    tables_mod.addImport("types.zig", types_mod);
    tables_mod.addImport("types.x.zig", types_x_mod);
    tables_mod.addImport("config.zig", config_mod);
    tables_mod.addImport("build_config", build_config_mod);

    const get_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/get.zig"),
        .target = target,
        .optimize = optimize,
    });
    get_mod.addImport("types.zig", types_mod);
    get_mod.addImport("tables", tables_mod);
    types_mod.addImport("get.zig", get_mod);

    const lib_mod = b.createModule(.{
        .root_source_file = b.path("compat/uucode/src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    lib_mod.addImport("types.zig", types_mod);
    lib_mod.addImport("config.zig", config_mod);
    lib_mod.addImport("types.x.zig", types_x_mod);
    lib_mod.addImport("tables", tables_mod);
    lib_mod.addImport("get.zig", get_mod);

    return .{
        .module = lib_mod,
        .tables_path = tables_path,
    };
}

fn configureGhosttyVendorModule(
    b: *std.Build,
    module: *std.Build.Module,
    terminal_options: TerminalOptions,
    simd_enabled: bool,
    uucode_module: *std.Build.Module,
    oniguruma_module: *std.Build.Module,
    wuffs_module: *std.Build.Module,
    dcimgui_module: *std.Build.Module,
    unicode_tables: *const UnicodeTables,
) void {
    addTerminalOptions(b, module, terminal_options);
    addBuildOptions(b, module, simd_enabled);
    module.addImport("uucode", uucode_module);
    module.addImport("oniguruma", oniguruma_module);
    module.addImport("wuffs", wuffs_module);
    module.addImport("dcimgui", dcimgui_module);
    unicode_tables.addModuleImport(module);
}

fn prepareGhosttyOverlay(b: *std.Build) std.Build.LazyPath {
    const run = b.addSystemCommand(&.{ "python3" });
    run.addFileArg(b.path("compat/prepare_ghostty_overlay.py"));
    run.addDirectoryArg(b.path("../../vendor/ghostty/src"));
    run.addDirectoryArg(b.path("compat/ghostty-overlay"));
    return run.addOutputDirectoryArg("ghostty-overlay");
}

pub fn build(b: *std.Build) !void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const simd_enabled = b.option(bool, "simd", "Enable SIMD fast paths") orelse false;

    if (simd_enabled) {
        @panic("zig-ghostty-wrapper Zig 0.16 local wrapper path does not support SIMD yet; build with -Dsimd=false");
    }

    const vendor_root = b.path("../../vendor/ghostty");
    const ghostty_overlay = prepareGhosttyOverlay(b);
    const uucode = buildUucodeCompat(
        b,
        target,
        optimize,
        vendor_root.path(b, "src/build/uucode_config.zig"),
    );
    const unicode_tables = try UnicodeTables.init(b, vendor_root, uucode.module);
    const oniguruma_enabled = false;
    const oniguruma_module = buildOnigurumaModule(b, target, optimize, oniguruma_enabled);
    const wuffs_module = buildWuffsStubModule(b, target, optimize);
    const dcimgui_module = b.createModule(.{
        .root_source_file = b.path("compat/dcimgui_stub.zig"),
        .target = target,
        .optimize = optimize,
    });

    const terminal_options: TerminalOptions = .{
        .artifact = .lib,
        .oniguruma = oniguruma_enabled,
        .simd = simd_enabled,
        .c_abi = false,
        .slow_runtime_safety = optimize == .Debug,
        .kitty_graphics_passthrough = true,
        .version = .{ .major = 0, .minor = 0, .patch = 0 },
    };

    const ghostty_module = b.createModule(.{
        .root_source_file = ghostty_overlay.path(b, "ghostty_min.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = false,
    });
    configureGhosttyVendorModule(
        b,
        ghostty_module,
        terminal_options,
        simd_enabled,
        uucode.module,
        oniguruma_module,
        wuffs_module,
        dcimgui_module,
        &unicode_tables,
    );

    const lib = b.addLibrary(.{
        .name = "ghostty-vt",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
        .linkage = .dynamic,
    });

    lib.root_module.addImport("ghostty", ghostty_module);
    lib.installHeadersDirectory(
        b.path("include/zig-ghostty-wrapper"),
        "zig-ghostty-wrapper",
        .{ .include_extensions = &.{ ".h" } },
    );
    b.installArtifact(lib);

    const main_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });
    main_tests.root_module.addImport("ghostty", ghostty_module);

    const run_tests = b.addRunArtifact(main_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);
}
