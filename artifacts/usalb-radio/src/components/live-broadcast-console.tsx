import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertTriangle,
  AudioWaveform,
  Check,
  FileAudio,
  Headphones,
  Mic2,
  MonitorUp,
  Music2,
  Pause,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  Video,
  Volume2,
  Waves,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type BroadcastSource, useLiveBroadcaster } from "@/lib/use-live-broadcaster";

type LiveBroadcastConsoleProps = {
  stationName: string;
  showName: string;
};

function LevelMeter({ level, label, color }: { level: number; label: string; color: "primary" | "accent" }) {
  return (
    <div className="min-w-0" data-testid={`meter-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="eyebrow text-muted-foreground">{label}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{Math.round(level * 100).toString().padStart(2, "0")}</span>
      </div>
      <div className="meter-scan flex h-20 items-end gap-1 overflow-hidden rounded-lg border border-border bg-background/80 px-2 py-2">
        {Array.from({ length: 14 }, (_, index) => {
          const threshold = (index + 1) / 14;
          const active = level >= threshold * 0.84;
          return (
            <span
              key={index}
              className={cn(
                "h-full flex-1 origin-bottom rounded-sm transition-opacity duration-150",
                active ? color === "primary" ? "bg-primary" : "bg-accent" : "bg-muted/70",
                active && index > 11 && "bg-destructive",
              )}
              style={{ opacity: active ? 0.92 : 0.42, transform: `scaleY(${active ? 1 : 0.22})` }}
            />
          );
        })}
      </div>
    </div>
  );
}

function SourceTile({
  value,
  selected,
  label,
  description,
  icon,
  onSelect,
  disabled,
}: {
  value: BroadcastSource;
  selected: boolean;
  label: string;
  description: string;
  icon: ReactNode;
  onSelect: (value: BroadcastSource) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      disabled={disabled}
      className={cn(
        "group flex min-h-[112px] flex-1 flex-col justify-between rounded-xl border p-4 text-left transition",
        selected ? "border-primary/70 bg-primary/10 shadow-[inset_0_0_0_1px_rgba(225,91,72,.12)]" : "border-border bg-background/35 hover:border-primary/40 hover:bg-primary/5",
        disabled && "cursor-not-allowed opacity-60",
      )}
      data-testid={`button-source-${value}`}
      aria-pressed={selected}
    >
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", selected ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground group-hover:text-foreground")}>{icon}</span>
      <span>
        <span className="mt-3 block text-sm font-bold">{label}</span>
        <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function LiveBroadcastConsole({ stationName, showName }: LiveBroadcastConsoleProps) {
  const musicInputRef = useRef<HTMLInputElement>(null);
  const padInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const displayPreviewRef = useRef<HTMLVideoElement>(null);
  const broadcast = useLiveBroadcaster();
  const isBusy = broadcast.state === "preparing" || broadcast.state === "connecting" || broadcast.state === "stopping";
  const isLive = broadcast.state === "live";
  const cannotStart = broadcast.source === "music" && !broadcast.musicFile;
  useEffect(() => {
    const preview = displayPreviewRef.current;
    if (!preview) return;
    preview.srcObject = broadcast.displayStream;
    if (broadcast.displayStream) void preview.play().catch(() => undefined);
    return () => {
      if (preview.srcObject === broadcast.displayStream) preview.srcObject = null;
    };
  }, [broadcast.displayStream]);
  const statusLabel = {
    idle: "Ready to broadcast",
    preparing: "Requesting devices",
    connecting: "Connecting to relay",
    live: "On air",
    stopping: "Closing signal",
    error: "Needs attention",
  }[broadcast.state];

  return (
    <section className="console-grid hardware-inset relative mb-6 overflow-hidden rounded-2xl border border-border bg-card/80" data-testid="live-broadcast-console">
      <div className="absolute right-[-5rem] top-[-7rem] h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative border-b border-border px-5 py-5 sm:px-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={cn("mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border", isLive ? "border-primary/50 bg-primary/15 text-primary" : "border-border bg-background text-muted-foreground")}>
              <Radio className={cn("h-5 w-5", isLive && "signal-blink")} />
            </div>
            <div>
              <p className="eyebrow text-primary">03 / Live desk</p>
              <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Broadcast console</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {stationName || "USALB RADIO"} <span className="mx-1 text-border">·</span> {showName || "Live from the studio"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn("flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[.16em]", isLive ? "border-primary/40 bg-primary/10 text-primary" : broadcast.state === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-background/50 text-muted-foreground")} data-testid="status-broadcast">
              <span className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-primary signal-blink" : broadcast.state === "error" ? "bg-destructive" : "bg-muted-foreground")} />
              {statusLabel}
            </div>
            <button
              type="button"
              onClick={isLive ? broadcast.stop : broadcast.start}
              disabled={isBusy || (!isLive && cannotStart)}
              className={cn("flex min-w-[132px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-extrabold uppercase tracking-[.13em] transition disabled:cursor-not-allowed disabled:opacity-45", isLive ? "border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20" : "bg-primary text-primary-foreground hover:bg-primary/90")}
              data-testid={isLive ? "button-stop-broadcast" : "button-start-broadcast"}
            >
              {isLive ? <Square className="h-4 w-4 fill-current" /> : <Radio className="h-4 w-4" />}
              {isLive ? "Stop air" : broadcast.state === "connecting" ? "Connecting" : "Go live"}
            </button>
          </div>
        </div>
        {broadcast.error && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="status-broadcast-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{broadcast.error}</span>
          </div>
        )}
      </div>

      <div className="relative grid gap-0 xl:grid-cols-[1.18fr_.82fr]">
        <div className="space-y-6 border-b border-border p-5 sm:p-7 xl:border-b-0 xl:border-r">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow text-muted-foreground">Input source</p>
                <p className="mt-1 text-sm font-bold">What should the relay hear?</p>
              </div>
              {broadcast.source === "pc" ? <MonitorUp className="h-5 w-5 text-primary" /> : broadcast.source === "music" ? <Music2 className="h-5 w-5 text-accent" /> : <Mic2 className="h-5 w-5 text-accent" />}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SourceTile value="pc" selected={broadcast.source === "pc"} onSelect={broadcast.setSource} disabled={isBusy || isLive} icon={<MonitorUp className="h-4 w-4" />} label="PC / system audio" description="Share a tab, window, or screen with its audio." />
              <SourceTile value="music" selected={broadcast.source === "music"} onSelect={broadcast.setSource} disabled={isBusy || isLive} icon={<Music2 className="h-4 w-4" />} label="Local music file" description="Loop a music file from this computer." />
              <SourceTile value="mic" selected={broadcast.source === "mic"} onSelect={broadcast.setSource} disabled={isBusy || isLive} icon={<Mic2 className="h-4 w-4" />} label="Microphone only" description="Go live with voice and no music source." />
            </div>
            {broadcast.source === "music" && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-background/45 p-3">
                <FileAudio className="h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{broadcast.musicFile?.name || "No music file loaded"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">MP3, WAV, OGG or another browser-readable file</p>
                </div>
                <input ref={musicInputRef} type="file" accept="audio/*" className="sr-only" onChange={(event) => broadcast.loadMusic(event.target.files?.[0] ?? null)} data-testid="input-music-file" />
                <button type="button" onClick={() => musicInputRef.current?.click()} disabled={isLive} className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[11px] font-bold transition hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50" data-testid="button-load-music">
                  <Upload className="h-3.5 w-3.5" /> Load file
                </button>
              </div>
            )}
            {broadcast.source === "pc" && (
              <div className="mt-3 overflow-hidden rounded-xl border border-border bg-background/45" data-testid="panel-display-share">
                <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-primary" />
                      <p className="text-sm font-bold">Screen-share preview</p>
                      {broadcast.displayStream && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary">Selected</span>
                      )}
                    </div>
                    <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">
                      The browser dialog controls whether you share a tab, window, or entire screen. Enable audio there if the relay should hear the share. The video preview stays in this control room; listeners receive audio only.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void (isLive ? broadcast.replaceDisplay() : broadcast.chooseDisplay())}
                    disabled={isBusy}
                    className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.13em] text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-45"
                    data-testid={isLive ? "button-replace-display" : "button-choose-display"}
                  >
                    {isLive ? <RefreshCw className="h-3.5 w-3.5" /> : <MonitorUp className="h-3.5 w-3.5" />}
                    {isLive ? "Replace share" : broadcast.displayStream ? "Choose another" : "Choose share"}
                  </button>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(180px,.8fr)] sm:items-center">
                  <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-background" data-testid="video-display-preview">
                    <video ref={displayPreviewRef} autoPlay muted playsInline className={cn("h-full w-full object-contain", !broadcast.displayStream && "hidden")} aria-label="Selected screen-share preview" />
                    {!broadcast.displayStream && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
                        <MonitorUp className="h-7 w-7 text-muted-foreground" />
                        <p className="mt-2 text-xs font-bold">No share selected</p>
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Choose a source to preview it before going live.</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 text-[11px]">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2.5">
                      <span className="text-muted-foreground">Surface</span>
                      <span className="font-bold capitalize">{broadcast.displayStream ? broadcast.displaySurface : "Not selected"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2.5">
                      <span className="flex items-center gap-2 text-muted-foreground"><Volume2 className="h-3.5 w-3.5" /> Shared audio</span>
                      <span className={cn("font-bold", broadcast.displayHasAudio ? "text-accent" : "text-destructive")}>{broadcast.displayStream && broadcast.displayHasAudio ? "Present" : "Not present"}</span>
                    </div>
                    <p className={cn("leading-5", broadcast.displayStream && !broadcast.displayHasAudio ? "text-destructive" : "text-muted-foreground")}>
                      {broadcast.displayStream && !broadcast.displayHasAudio
                         ? "Audio is off. Replace this share and enable the audio checkbox in the browser dialog."
                         : "A live preview confirms the browser capture is still active. Only its audio is sent to listeners."}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <button type="button" onClick={broadcast.toggleMicrophone} className={cn("flex items-center justify-between rounded-xl border p-4 text-left transition", broadcast.microphoneEnabled ? "border-accent/50 bg-accent/10" : "border-border bg-background/40 hover:border-primary/40")} data-testid="button-toggle-microphone" aria-pressed={broadcast.microphoneEnabled}>
              <span className="flex items-center gap-3"><span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", broadcast.microphoneEnabled ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground")}><Mic2 className="h-4 w-4" /></span><span><span className="block text-sm font-bold">Microphone</span><span className="mt-1 block text-[11px] text-muted-foreground">{broadcast.microphoneEnabled ? "Voice input enabled" : "Voice input muted"}</span></span></span>
              <span className={cn("h-5 w-9 rounded-full p-1 transition", broadcast.microphoneEnabled ? "bg-accent" : "bg-muted")}><span className={cn("block h-3 w-3 rounded-full bg-background transition-transform", broadcast.microphoneEnabled && "translate-x-4")} /></span>
            </button>
            <button type="button" onClick={() => broadcast.setDucking(!broadcast.ducking)} className={cn("flex items-center justify-between rounded-xl border p-4 text-left transition", broadcast.ducking ? "border-primary/40 bg-primary/10" : "border-border bg-background/40 hover:border-primary/40")} data-testid="button-toggle-ducking" aria-pressed={broadcast.ducking}>
              <span className="flex items-center gap-3"><span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", broadcast.ducking ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}><Waves className="h-4 w-4" /></span><span><span className="block text-sm font-bold">Auto ducking</span><span className="mt-1 block text-[11px] text-muted-foreground">{broadcast.ducking ? "Music lowers while speaking" : "Manual music level"}</span></span></span>
              <span className={cn("h-5 w-9 rounded-full p-1 transition", broadcast.ducking ? "bg-primary" : "bg-muted")}><span className={cn("block h-3 w-3 rounded-full bg-background transition-transform", broadcast.ducking && "translate-x-4")} /></span>
            </button>
          </div>

          <div className="rounded-xl border border-border bg-background/35 p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Desk levels</p></div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Limiter protected · live adjustable</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex justify-between text-xs"><span className="font-semibold">Music</span><span className="font-mono text-muted-foreground">{Math.round(broadcast.musicVolume * 100)}%</span></div>
                <input type="range" min="0" max="1" step=".01" value={broadcast.musicVolume} onChange={(event) => broadcast.setMusicVolume(Number(event.target.value))} className="h-1.5 w-full accent-[hsl(var(--primary))]" data-testid="input-music-volume" />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-xs"><span className="font-semibold">Voice</span><span className="font-mono text-muted-foreground">{Math.round(broadcast.voiceVolume * 100)}%</span></div>
                <input type="range" min="0" max="1" step=".01" value={broadcast.voiceVolume} onChange={(event) => broadcast.setVoiceVolume(Number(event.target.value))} className="h-1.5 w-full accent-[hsl(var(--accent))]" data-testid="input-voice-volume" />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-xs"><span className="font-semibold">Master</span><span className="font-mono text-muted-foreground">{Math.round(broadcast.masterVolume * 100)}%</span></div>
                <input type="range" min="0" max="1" step=".01" value={broadcast.masterVolume} onChange={(event) => broadcast.setMasterVolume(Number(event.target.value))} className="h-1.5 w-full accent-[hsl(var(--primary))]" data-testid="input-master-volume" />
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <LevelMeter label="Music level" level={broadcast.musicLevel} color="primary" />
              <LevelMeter label="Voice level" level={broadcast.voiceLevel} color="accent" />
            </div>
          </div>
        </div>

        <aside className="space-y-6 p-5 sm:p-7">
          <div>
            <div className="mb-3 flex items-center justify-between">
               <div><p className="eyebrow text-muted-foreground">Instant playback</p><p className="mt-1 text-sm font-bold">Sound-effect pads</p></div>
              <Sparkles className="h-5 w-5 text-accent" />
            </div>
            <p className="mb-4 text-xs leading-5 text-muted-foreground">Load short station elements, then trigger them over the live mix.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
              {broadcast.pads.map((pad) => (
                <div key={pad.id} className={cn("rounded-xl border p-3 transition", broadcast.activePad === pad.id ? "border-accent/60 bg-accent/10" : "border-border bg-background/35")} data-testid={`card-effect-pad-${pad.id}`}>
                  <button type="button" onClick={() => void broadcast.triggerEffect(pad.id)} disabled={!isLive || !pad.file} className="group flex w-full items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-45" data-testid={`button-trigger-${pad.id}`}>
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", broadcast.activePad === pad.id ? "border-accent/50 text-accent" : "border-border text-muted-foreground group-hover:border-primary/40 group-hover:text-primary")}><Pause className="h-3.5 w-3.5 fill-current" /></span>
                    <span className="min-w-0"><span className="block truncate text-xs font-bold">{pad.label}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{pad.file?.name || "Empty pad"}</span></span>
                  </button>
                  <input ref={(element) => { padInputRefs.current[pad.id] = element; }} type="file" accept="audio/*" className="sr-only" onChange={(event) => broadcast.loadEffect(pad.id, event.target.files?.[0] ?? null)} data-testid={`input-effect-${pad.id}`} />
                  <button type="button" onClick={() => padInputRefs.current[pad.id]?.click()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-[10px] font-bold text-muted-foreground transition hover:border-primary/50 hover:text-foreground" data-testid={`button-load-${pad.id}`}><Upload className="h-3 w-3" /> {pad.file ? "Replace" : "Load audio"}</button>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-background/45 p-4">
               <div className="flex items-start gap-3">
              <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
               <div><p className="text-xs font-bold">Broadcast checklist</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Listeners receive audio only; no screen video is broadcast. Allow microphone access, then preview a tab, window, or entire screen before going live. Enable the browser audio checkbox when the shared source should be heard.</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1"><Check className="h-3 w-3 text-accent" /> Web audio</span>
              <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1"><AudioWaveform className="h-3 w-3 text-accent" /> Opus relay</span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}