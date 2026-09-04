fn main() {
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(mobile)");

    // 纯领域单测不需要窗口资源，也不链接 WebView2；桌面构建和类型导出
    // 仍走标准 Tauri build script。
    if std::env::var_os("CARGO_FEATURE_DESKTOP_RUNTIME").is_some()
        || std::env::var_os("CARGO_FEATURE_TYPEGEN").is_some()
    {
        tauri_build::build();
    }
}
