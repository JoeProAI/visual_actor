# Local model assets

This directory holds **optional** local models. The system runs fully without
them (deterministic CPU paths), but dropping models here unlocks higher-quality
voices and rendering. Nothing here is required to pass the benchmark.

## Piper voice (recommended local backup)

Download a Piper voice (ONNX + JSON) and point `PIPER_MODEL_PATH` at the `.onnx`:

```
mkdir -p app/assets/models/piper
# Example: en_US-amy-low
curl -L -o app/assets/models/piper/en_US-amy-low.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx
curl -L -o app/assets/models/piper/en_US-amy-low.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx.json
```

`install.sh` attempts this automatically when network access is available.

## Fish Speech S2 (second local backup)

Fish Speech is distributed as a source checkout. Clone it and set
`FISH_SPEECH_MODEL_PATH` to the downloaded checkpoint directory:

```
git clone https://github.com/fishaudio/fish-speech app/assets/models/fish-speech-src
# follow upstream instructions to fetch the S2 checkpoint, then:
export FISH_SPEECH_MODEL_PATH=app/assets/models/fish-speech-s2
```

## audio→blendshape ONNX regressor (optional)

If you have a trained audio→blendshape model, place it here and reference it
from the renderer; `app/avatar/blendshapes.py::regress_from_audio` will load it
for a single-pass (non-diffusion) regression. Absent a model, the deterministic
viseme→blendshape table is used.

## LivePortrait / 3DMM assets (optional)

For `renderer: liveportrait` or `renderer: mesh`, install the respective runtime
and weights per their upstream docs. Both adapters degrade to the built-in
direct 2D renderer when weights are absent.
