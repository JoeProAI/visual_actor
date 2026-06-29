; Reusable action bangs for the Visual Actor skin.
; Referenced by meters via e.g. LeftMouseUpAction=[!Execute "#ToggleClickThrough#"]

[Variables]
; ---- Server control (PowerShell helpers shipped in the skin) ----
LaunchServer=["#@#launch_server.ps1"]
StopServer=["#@#stop_server.ps1"]
CheckServer=["#@#check_server.ps1"]

; ---- Settings / config skin ----
OpenSettings=[!ActivateConfig "VisualActor" "Settings.ini"]
CloseSettings=[!DeactivateConfig "VisualActor\Settings.ini"]

; ---- Click-through toggle (preserves a settings skin to disable it) ----
ToggleClickThrough=[!ToggleConfig "VisualActor" "ClickThrough.ini"][!Refresh]
EnableClickThrough=[!ClickThrough 1]
DisableClickThrough=[!ClickThrough 0]

; ---- Always-on-top toggle (Rainmeter: 1=topmost, 0=normal, -2=on desktop) ----
EnableAlwaysOnTop=[!ZPos 1]
DisableAlwaysOnTop=[!ZPos 0]
ToggleAlwaysOnTop=[!ToggleConfig "VisualActor" "AlwaysOnTop.ini"]

; ---- Resize: bump width/height then reload the WebView2 host ----
GrowWidth=[!SetVariable Width "(#Width#+40)"][!WriteKeyValue Variables Width "(#Width#+40)" "#@#variables.inc"][!Refresh]
ShrinkWidth=[!SetVariable Width "(Max(160,#Width#-40))"][!WriteKeyValue Variables Width "(Max(160,#Width#-40))" "#@#variables.inc"][!Refresh]

; ---- Opacity / transparency ----
MoreOpaque=[!SetVariable Opacity "(Min(255,#Opacity#+25))"][!UpdateMeter *][!Redraw]
LessOpaque=[!SetVariable Opacity "(Max(0,#Opacity#-25))"][!UpdateMeter *][!Redraw]
