[Variables]
; ---- Visual Actor widget variables ----
; Swap widget size in ONE line: change Width (Height follows your portrait
; aspect; both are forwarded to the WebView2 host and the server canvas).
ServerURL=http://127.0.0.1:8765/rainmeter
ServerHealthURL=http://127.0.0.1:8765/health

; Geometry
Width=480
Height=640

; Appearance (0-255). Opacity drives both the skin and WebView2 host alpha.
Opacity=255
Transparent=1

; Interaction toggles (0/1)
ClickThrough=0
AlwaysOnTop=1
Draggable=1

; Refresh cadence for status polling (ms)
RefreshMs=16
StatusPollMs=2000

; Path to the bundled PowerShell helpers (resolved at runtime by Rainmeter)
ServerStart=#@#launch_server.ps1
ServerStop=#@#stop_server.ps1
ServerCheck=#@#check_server.ps1
