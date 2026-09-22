import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { getGetStationQueryKey, getGetStreamStatusQueryKey, useGetStation, useGetStreamStatus } from "@workspace/api-client-react";
import { Copy, Download, ExternalLink, Globe2, Headphones, Info, Link2, LoaderCircle, MessageCircle, MoreHorizontal, Pause, Play, Share2, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

const logoSrc = "/usalb-logo-transparent.png";
const fallback = { stationName: "USALB RADIO", tagline: "Zëri që të mban afër.", genre: "Albanian hits · Talk · Culture", hostName: "USALB Studio", showName: "Live from the studio", sourceType: "browser", isLive: false };

function SignalBars({ active }: { active: boolean }) {
  return <div className="flex h-6 items-end gap-1" aria-label={active ? "Audio is playing" : "Audio is paused"}>{[35, 58, 82, 48, 70].map((height, i) => <span key={i} className={cn("w-1 rounded-t-sm bg-primary transition-transform", active && "animate-[equalizer_1s_ease-in-out_infinite_alternate]")} style={{ height: `${active ? height : 18}%`, animationDelay: `${i * -120}ms` }} />)}</div>;
}

export default function Home() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [volume, setVolume] = useState(.82);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [broadcastLive, setBroadcastLive] = useState<boolean | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const stationQuery = useGetStation({ query: { queryKey: getGetStationQueryKey(), refetchInterval: 10000 } });
  const statusQuery = useGetStreamStatus({ query: { queryKey: getGetStreamStatusQueryKey(), refetchInterval: 5000 } });
  const station = stationQuery.data;
  const status = statusQuery.data;
  const config = {
    stationName: station?.name || fallback.stationName,
    tagline: station?.slogan || fallback.tagline,
    genre: station?.genre || fallback.genre,
    hostName: "USALB Studio",
    showName: "Live from the studio",
    sourceType: "browser",
    isLive: status?.isLive ?? false,
  };
  const isLive = broadcastLive ?? status?.isLive ?? config.isLive;
  const updated = status?.lastHeartbeat;
  const shouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/live/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { live?: boolean };
        if (!cancelled) setBroadcastLive(data.live === true);
      } catch {
        // The player can continue using the native audio connection even if status polling fails.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const navigatorWithAudioSession = navigator as Navigator & { audioSession?: { type: string } };
    if (navigatorWithAudioSession.audioSession) navigatorWithAudioSession.audioSession.type = "playback";

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: config.showName || "USALB RADIO",
        artist: config.hostName || "USALB Studio",
        album: config.stationName || "USALB RADIO",
        artwork: [{ src: `${window.location.origin}${logoSrc}`, sizes: "512x512", type: "image/png" }],
      });
      try { navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play()); } catch {}
      try { navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause()); } catch {}
      try { navigator.mediaSession.setActionHandler("stop", () => { audioRef.current?.pause(); shouldReconnectRef.current = false; }); } catch {}
    }
  }, [config.hostName, config.showName, config.stationName]);

  const lastUpdated = useMemo(() => updated ? new Date(updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—", [updated]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const stopNativeStream = () => {
    clearReconnectTimer();
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };

  const startNativeStream = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setLoading(true);
    setError("");
    audio.volume = muted ? 0 : volume;
    audio.src = `/api/radio-stream?client=web&ts=${Date.now()}`;
    audio.load();
    void audio.play().then(() => {
      setLoading(false);
      setReconnecting(false);
      reconnectAttemptRef.current = 0;
      setPlaying(true);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    }).catch(() => {
      setLoading(false);
      setPlaying(false);
      if (shouldReconnectRef.current) scheduleReconnect();
      else setError("Tap the play button again to connect to the live source.");
    });
  };

  const scheduleReconnect = () => {
    if (!shouldReconnectRef.current || reconnectTimerRef.current !== null) return;
    const delay = Math.min(10, Math.max(1, 2 ** reconnectAttemptRef.current));
    reconnectAttemptRef.current += 1;
    setReconnecting(true);
    setPlaying(false);
    setLoading(true);
    setError(`Live connection interrupted. Reconnecting in ${delay} seconds…`);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      startNativeStream();
    }, delay * 1000);
  };

  const toggle = async () => {
    if (playing) {
      shouldReconnectRef.current = false;
      stopNativeStream();
      setPlaying(false);
      setLoading(false);
      setReconnecting(false);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      return;
    }

    shouldReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    setLoading(true);
    setError("");
    setReconnecting(false);
    startNativeStream();
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasNativeShare = typeof (navigator as Navigator & { share?: unknown }).share === "function";
  const shareText = `${config.stationName || "USALB RADIO"} — ${config.tagline || "Listen live"}`;
  const shareTargets = [
    { label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" />, url: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${window.location.href}`)}` },
    { label: "Facebook", icon: <Globe2 className="h-4 w-4" />, url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}` },
    { label: "X / Twitter", icon: <ExternalLink className="h-4 w-4" />, url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(window.location.href)}` },
  ];
  const share = () => setShareOpen((open) => !open);
  const shareNative = async () => {
    if (hasNativeShare) await navigator.share({ title: config.stationName, text: shareText, url: window.location.href }).catch(() => undefined);
    setShareOpen(false);
  };
  const copyShareLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    setShareOpen(false);
  };
  const shareMessenger = () => {
    const messengerUrl = `fb-messenger://share/?link=${encodeURIComponent(window.location.href)}`;
    window.location.href = messengerUrl;
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        if (hasNativeShare) void shareNative();
        else void copyShareLink();
      }
    }, 800);
    setShareOpen(false);
  };

  return (
    <main className="min-h-[100dvh] overflow-hidden">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
           <img src={logoSrc} alt="USALB RADIO" className="h-14 w-16 object-contain sm:h-16 sm:w-[4.5rem]" data-testid="img-station-logo" />
           <span className="font-display text-lg font-bold tracking-tight">USALB <span className="text-primary">RADIO</span></span>
        </Link>
        <nav className="flex items-center gap-3">
           <span className="hidden eyebrow text-muted-foreground sm:inline">Tirana · Prishtina · diaspora</span>
           {installPrompt && <button onClick={() => void installApp()} className="hidden items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-bold text-accent transition hover:bg-accent/20 sm:flex" data-testid="button-install-app"><Download className="h-3.5 w-3.5" /> Install app</button>}
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl gap-10 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:gap-20 lg:pb-28 lg:pt-20">
        <div className="pointer-events-none absolute -left-40 top-12 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
          <div className="eyebrow mb-6 flex items-center gap-3 text-accent"><span className="h-px w-8 bg-accent" /> live radio / 24—7</div>
          <h1 className="font-display max-w-3xl text-5xl font-semibold leading-[.98] tracking-[-.055em] text-foreground sm:text-7xl lg:text-[6.3rem]">Stay close to<br /><em className="text-primary not-italic">the signal.</em></h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">{config.tagline || "The Albanian sound, wherever you are."} Tune in for a steady stream of music, voices and stories from the region.</p>
           <div className="mt-9 flex flex-wrap items-center gap-4">
            <button onClick={toggle} disabled={loading} className={cn("group flex items-center gap-3 rounded-full px-6 py-3.5 text-sm font-extrabold transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60", playing ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground")} data-testid="button-toggle-player">
              {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
              {loading ? "Connecting" : playing ? "Pause broadcast" : "Listen live"}
            </button>
             <div className="relative">
              <button onClick={share} className="flex items-center gap-2 rounded-full border border-border px-5 py-3.5 text-sm font-bold text-foreground transition hover:border-primary/60 hover:bg-card" aria-expanded={shareOpen} data-testid="button-share-station"><Share2 className="h-4 w-4" /> Share station</button>
              {shareOpen && (
                <div className="absolute left-0 top-[calc(100%+0.6rem)] z-20 w-64 rounded-2xl border border-border bg-card p-2 shadow-2xl" role="menu" aria-label="Share station">
                  <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Share on</p>
                  {shareTargets.map((target) => (
                    <a
                      key={target.label}
                      href={target.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setShareOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted"
                      role="menuitem"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{target.icon}</span>
                      {target.label}
                    </a>
                  ))}
                  <button onClick={shareMessenger} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-foreground transition hover:bg-muted" role="menuitem">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><MessageCircle className="h-4 w-4" /></span>
                    Messenger
                  </button>
                  <button onClick={copyShareLink} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-foreground transition hover:bg-muted" role="menuitem">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{copied ? <Link2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</span>
                    {copied ? "Link copied" : "Copy link"}
                  </button>
                  {hasNativeShare && (
                    <button onClick={shareNative} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-foreground transition hover:bg-muted" role="menuitem">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><MoreHorizontal className="h-4 w-4" /></span>
                      More apps
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
           {error && <p className="mt-4 flex items-center gap-2 text-sm text-accent" data-testid="status-stream-error"><WifiOff className="h-4 w-4" />{error}</p>}
           {reconnecting && <p className="mt-3 text-sm font-semibold text-muted-foreground">You can leave this page open. The player will reconnect automatically.</p>}
          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><Headphones className="h-4 w-4 text-primary" /> Broadcast from Albania</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-3 rounded-[2rem] border border-primary/10" />
           <div className="glass relative overflow-hidden rounded-[1.7rem] border border-border p-5 shadow-2xl sm:p-7">
             <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center" aria-hidden="true">
              <img src={logoSrc} alt="" className="h-[78%] w-[78%] object-contain opacity-20 mix-blend-screen" />
            </div>
            <div className="absolute right-0 top-0 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
             <div className="relative z-10 flex items-center justify-between">
              <span className="eyebrow text-muted-foreground">On air now</span>
              <span className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest", isLive ? "border-accent/30 bg-accent/10 text-accent" : "border-border text-muted-foreground")} data-testid="status-live"><i className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-accent animate-pulse" : "bg-muted-foreground")} />{isLive ? "Live" : "Standby"}</span>
            </div>
             <div className="relative z-10 mt-12 flex items-center justify-center">
              <div className={cn("pointer-events-none absolute h-56 w-56 rounded-full border border-primary/20", playing && "animate-[ping_3s_ease-out_infinite]")} />
              <button
                type="button"
                onClick={toggle}
                disabled={loading}
                className="group relative z-10 flex h-48 w-48 items-center justify-center rounded-full border border-primary/30 bg-background shadow-[inset_0_0_45px_rgba(224,89,71,.12)] transition hover:scale-[1.02] hover:border-primary/60 disabled:cursor-wait disabled:opacity-75"
                aria-label={playing ? "Pause live broadcast" : "Play live broadcast"}
                data-testid="button-center-player"
              >
                <span className="flex h-36 w-36 items-center justify-center rounded-full border border-accent/20 bg-card text-primary transition group-hover:bg-primary/10">
                  {loading ? <LoaderCircle className="h-10 w-10 animate-spin" /> : playing ? <Pause className="h-12 w-12 fill-current" /> : <Play className="ml-1 h-12 w-12 fill-current" />}
                </span>
              </button>
            </div>
             <div className="relative z-10 mt-12 text-center">
              <div className="flex justify-center"><SignalBars active={playing} /></div>
              <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight" data-testid="text-show-name">{config.showName || "USALB RADIO"}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{config.hostName || "USALB Studio"} · {config.genre || "Albanian radio"}</p>
            </div>
              <div className="relative z-10 mt-8 flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
              <button onClick={() => { setMuted(!muted); if (audioRef.current) audioRef.current.volume = muted ? volume : 0; }} className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-toggle-mute">{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
              <input aria-label="Volume" type="range" min="0" max="1" step=".01" value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} className="h-1 w-full accent-[hsl(var(--primary))]" data-testid="input-volume" />
              <span className="font-mono text-[10px] text-muted-foreground">{Math.round((muted ? 0 : volume) * 100)}%</span>
            </div>
              <div className="relative z-10 mt-4 flex items-center justify-between text-[11px] text-muted-foreground"><span className="flex items-center gap-2"><Wifi className={cn("h-3.5 w-3.5", reconnecting ? "text-accent animate-pulse" : "text-accent")} /> {reconnecting ? "Reconnecting…" : "Ready to play"}</span><span>Updated {lastUpdated}</span></div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/40">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto] md:items-center">
          <div><p className="eyebrow text-primary">The frequency</p><h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">A familiar voice in a noisy world.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">USALB RADIO is made for the commute, the kitchen, the late shift and the long way home. No feed to scroll. Just press play.</p></div>
          <div className="flex gap-8 text-right"><div><p className="font-display text-3xl text-accent">01</p><p className="eyebrow mt-1 text-muted-foreground">station</p></div><div><p className="font-display text-3xl text-accent">AL</p><p className="eyebrow mt-1 text-muted-foreground">everywhere</p></div></div>
        </div>
      </section>
      <footer className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>© USALB RADIO · Albanian broadcast, wherever you are.</span><span className="flex items-center gap-2"><Info className="h-3.5 w-3.5" /> Your one-tap radio home</span></footer>
      <audio ref={audioRef} playsInline preload="none" onPause={() => { if (!shouldReconnectRef.current) setPlaying(false); }} onPlaying={() => { setPlaying(true); setLoading(false); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; }} onWaiting={() => { if (shouldReconnectRef.current) setReconnecting(true); }} onError={() => { if (shouldReconnectRef.current) scheduleReconnect(); else { setPlaying(false); setError("The live source is unavailable right now."); } }} onEnded={() => { if (shouldReconnectRef.current) scheduleReconnect(); }} />
    </main>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};