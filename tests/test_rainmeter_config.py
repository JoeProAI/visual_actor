"""Rainmeter config + skin packaging file sanity tests."""

from __future__ import annotations

from pathlib import Path

from app.config import load_config

ROOT = Path(__file__).resolve().parent.parent
SKIN = ROOT / "rainmeter" / "VisualActor"


def test_rainmeter_config_defaults():
    cfg = load_config().rainmeter
    assert cfg.server_url.endswith("/rainmeter")
    assert cfg.width > 0 and cfg.height > 0
    assert 0 <= cfg.opacity <= 255
    assert cfg.transparent in (0, 1)


def test_required_ini_files_exist():
    for name in ("VisualActor.ini", "Settings.ini", "ClickThrough.ini",
                 "AlwaysOnTop.ini", "WebViewHost.ini", "RMSKIN.ini"):
        assert (SKIN / name).exists(), f"missing {name}"


def test_resources_exist():
    res = SKIN / "Resources"
    for name in ("variables.inc", "styles.inc", "actions.inc",
                 "launch_server.ps1", "stop_server.ps1", "check_server.ps1", "icon.ico"):
        assert (res / name).exists(), f"missing Resources/{name}"


def test_webview_host_loads_server_url():
    txt = (SKIN / "WebViewHost.ini").read_text(encoding="utf-8")
    assert "Measure=Plugin" in txt
    assert "Plugin=WebView2" in txt
    assert "#ServerURL#" in txt


def test_variables_default_url():
    txt = (SKIN / "Resources" / "variables.inc").read_text(encoding="utf-8")
    assert "http://127.0.0.1:8765/rainmeter" in txt


def test_rmskin_metadata_has_load_target():
    txt = (SKIN / "RMSKIN.ini").read_text(encoding="utf-8")
    assert "Load=VisualActor\\VisualActor.ini" in txt
    assert "MinimumRainmeter=4.5" in txt


def test_main_skin_supports_toggles():
    txt = (SKIN / "VisualActor.ini").read_text(encoding="utf-8")
    for token in ("ClickThrough=", "AlwaysOnTop=", "Draggable=", "@IncludeWebView"):
        assert token in txt


def test_packaging_scripts_exist():
    assert (ROOT / "build_rainmeter_skin.ps1").exists()
    assert (ROOT / "scripts" / "package_rmskin.ps1").exists()
    assert (ROOT / "scripts" / "install_webview2.ps1").exists()
