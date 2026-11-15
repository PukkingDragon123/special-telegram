# Voice acting (round 6)

All spoken Thai lines are synthesised offline — no real person's voice is recorded or cloned.

- **Model:** Meta AI, *Massively Multilingual Speech* — Thai TTS checkpoint `facebook/mms-tts-tha`
  (VITS), via Hugging Face `transformers`. Licence: **CC-BY-NC 4.0** — usable here because เฮียผัด! is a free,
  non-commercial fan project. Attribution: "Voice synthesis: Meta AI MMS-TTS (facebook/mms-tts-tha), CC-BY-NC 4.0".
  Paper: Pratap et al., *Scaling Speech Technology to 1,000+ Languages* (2023).
- **Pipeline:** `scripts/voice/extract_lines.py` collects every Thai line from the cutscene / tutorial / stand /
  backrooms / ritual / dialogue / bark sources and keys it by an FNV-1a hash of the text;
  `scripts/voice/gen_voice.py` renders one neutral take per line (16 kHz mono, 32 kbps MP3) into
  `public/assets/audio/voice/<hash>.mp3` + `manifest.json`.
- **Characters:** one take per line; each character's voice is made at runtime in `src/core/voice.ts`
  (playback rate = pitch + pace, EQ, FX send: casino hall reverb, stand metallic echo, ghost echo).
- If the game is ever sold, these clips must be replaced (the licence is non-commercial).
