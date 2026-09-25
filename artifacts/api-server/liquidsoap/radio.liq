# USALB Radio Liquidsoap engine
settings.harbor.bind_addrs := ["127.0.0.1"]
settings.harbor.timeout := 120.0
settings.harbor.reverse_dns := false

source_password = environment.get(default="usalb-internal-source", "USALB_LIQUIDSOAP_SOURCE_PASSWORD")

live = input.harbor(
  "live",
  port=8005,
  password=source_password,
  buffer=4.0,
  timeout=120.0
)

silence_fallback = blank(duration=2.0)
radio = fallback(track_sensitive=false, [live, silence_fallback])

output.harbor(
  mount="/stream",
  port=8006,
  format="audio/mpeg",
  buffer=262140,
  burst=16384,
  %mp3(bitrate=320, samplerate=44100, stereo=true, internal_quality=2),
  radio
)
