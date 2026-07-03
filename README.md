# Visual Actor

A **local, real-time talking avatar** for your desktop. Type or talk to her —
an LLM thinks up the reply, streaming TTS speaks it, and a 3D face lip-syncs
live in the browser or as an always-on-top **Rainmeter widget** on Windows.

## What it does (the goal)

- **Back-and-forth conversation** — a chat panel wired to OpenRouter
  (`gpt-4o-mini` by default, persona "Aria"), with chat history, streamed
  sentence-by-sentence replies, and barge-in (interrupt her mid-sentence).
- **Voice input** — hold the 🎤 button and speak; audio is transcribed locally
  with Whisper (`faster-whisper`), no cloud STT.
- **Speaks with lip-sync** — replies stream through a TTS chain
  (ElevenLabs → local Piper → formant fallback) and drive the avatar's mouth
  in sync with the audio.
- **Two visual modes** — a realistic 3D head (generated once with the Tripo3D
  API, with a procedural `jawOpen` morph so the lips move) and an
  audio-reactive aurora **Arc Reactor** visualizer.
- **Desktop widget** — the same views packaged as a Rainmeter skin
  (WebView2) so the actor lives on your Windows desktop, not in a browser tab.

Everything runs from one local FastAPI server; the only network calls are the
LLM (OpenRouter) and optional ElevenLabs/Tripo3D APIs.

## Easy install

### Windows (PowerShell)

```powershell
git clone https://github.com/JoeProAI/visual_actor
cd visual_actor
.\install.ps1        # venv + deps + .env + Piper voice + 3D head + launch
```

`install.ps1` prompts for missing API keys, generates the 3D head if
`TRIPO3D_API_KEY` is set, then starts the server and opens
http://127.0.0.1:8765/. Next time, just run `.\run.bat`.

### macOS / Linux

```bash
git clone https://github.com/JoeProAI/visual_actor
cd visual_actor
./install.sh         # one-command setup
./run.sh             # start the server → http://127.0.0.1:8765/
```

### API keys

Copy `.env.example` to `.env` (the installers do this) and fill in:

| Key | Needed for | Where to get it |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | the conversation brain | https://openrouter.ai/settings/keys |
| `TRIPO3D_API_KEY` | one-time 3D head generation | https://platform.tripo3d.ai/api-keys |
| `ELEVENLABS_API_KEY` | best voice quality (optional) | https://elevenlabs.io — falls back to local Piper without it |

### Generate the 3D head (one time)

The realistic head is generated, not committed:

```bash
python scripts/generate_avatar_tripo.py   # Tripo3D text-to-model → avatar_head.glb
python scripts/add_jaw_morph.py           # bake the jawOpen morph so her lips move
```

Without the model file, Face mode falls back to the built-in 2D portrait.

## Using it

Open http://127.0.0.1:8765/ after launch:

- **Conversation panel** — type a message and Send, or hold 🎤 and talk.
  Replies stream in, are spoken aloud, and lip-sync the avatar. Send a new
  message while she's speaking to interrupt her.
- **Face / Arc Reactor toggle** — switch between the 3D head and the
  audio-reactive visualizer.
- **"Say an exact line"** — direct TTS without the LLM, with a latency report.

## Rainmeter desktop widget (Windows)

```powershell
pwsh .\build_rainmeter_skin.ps1    # builds VisualActor.rmskin
```

Double-click the `.rmskin` to install, then enable the **VisualActor** skin in
Rainmeter. It hosts the same views via WebView2 and talks to the local server
(start it with `.\run.bat` or let the skin's start action launch it).
Widget size/opacity/click-through are configured in `.env`
(`RAINMETER_*` variables).

## Development

```bash
python -m pytest tests/    # unit tests
./benchmark.sh             # latency benchmark against config/latency.yaml
```

Key layout: `app/` (FastAPI server, TTS router, LLM conversation, STT, web
frontend), `rainmeter/` (skin sources), `scripts/` (model generation +
packaging), `config/` (YAML tunables).
