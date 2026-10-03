import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { getGetStationQueryKey, getGetStreamStatusQueryKey, useGetStation, useGetStreamStatus } from "@workspace/api-client-react";
import {
  ArrowDown, Copy, Download, ExternalLink, Globe2, Headphones, Info, Link2,
  LoaderCircle, MapPin, MessageCircle, MoreHorizontal, Pause, Play, RadioTower,
  Share2, Sparkles, Volume2, VolumeX, Wifi, WifiOff, Waves
} from "lucide-react";
import { cn } from "@/lib/utils";

const logoSrc = "/usalb-logo-transparent.png";
const fallback = {
  stationName: "USALB RADIO",
  tagline: "Zëri që të mban afër.",
  genre: "Albanian hits · Talk · Culture",
  hostName: "USALB Studio",
  showName: "Live from the studio",
  sourceType: "browser",
  isLive: false
};

function SignalBars({ active }: { active: boolean }) {
  return (
    <div className="flex h-7 items-end gap-1.5" aria-label={active ? "Audio is playing" : "Audio is paused"}>
      {[35, 58, 82, 48, 70, 42, 68].map((height, i) => (
        <span key={i} className={cn("w-1 rounded-full bg-primary transition-transform", active && "animate-[equalizer_1s_ease-in-out_infinite_alternate]")} style={{ height: `${active ? height : 18}%`, animationDelay: `${i * -120}ms` }} />
      ))}
    </div>
  );
}

export default function Home() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [volume, setVolume] = useState(.82);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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
  const isLive = status?.isLive ?? config.isLive;
  const updated = status?.lastHeartbeat;
  const shouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 70, damping: 24, mass: .2 });
  const heroScale = useTransform(smoothProgress, [0, .28], [1, .86]);
  const heroY = useTransform(smoothProgress, [0, .28], [0, -100]);
  const globeRotate = useTransform(smoothProgress, [0, 1], [0, 210]);
  const bridgeX = useTransform(smoothProgress, [0, .45], ["-4%", "12%"]);

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
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  };

  const scheduleReconnect = () => {
    if (!shouldReconnectRef.current || reconnectTimerRef.current !== null) return;
    const delay = 1;
    reconnectAttemptRef.current += 1;
    setReconnecting(true);
    setPlaying(false);
    setLoading(true);
    setError(`Live connection interrupted. Reconnecting in ${delay} seconds…`);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      void startNativeStream();
    }, delay * 1000);
  };

  const startNativeStream = async () => {
    setLoading(true);
    setError("");
    try {
      const audio = audioRef.current;
      if (!audio) throw new Error("The radio player is not ready yet.");

      const streamUrl = status?.streamUrl || station?.streamUrl || "/api/radio-stream";
      const separator = streamUrl.includes("?") ? "&" : "?";
      audio.src = `${streamUrl}${separator}app-live=${Date.now()}`;
      audio.preload = "none";
      audio.volume = muted ? 0 : volume;

      audio.onplaying = () => {
        setPlaying(true);
        setLoading(false);
        setReconnecting(false);
        setError("");
        reconnectAttemptRef.current = 0;
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
      };
      audio.onwaiting = () => { if (shouldReconnectRef.current) setReconnecting(true); };
      audio.onstalled = () => {
        if (shouldReconnectRef.current) {
          setReconnecting(true);
          window.setTimeout(() => {
            if (shouldReconnectRef.current && audio.readyState < 3) scheduleReconnect();
          }, 1000);
        }
      };
      audio.onended = () => { if (shouldReconnectRef.current) scheduleReconnect(); };
      audio.onerror = () => { if (shouldReconnectRef.current) scheduleReconnect(); };

      await audio.play();
      setPlaying(true);
      setLoading(false);
      setReconnecting(false);
      reconnectAttemptRef.current = 0;
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    } catch {
      setLoading(false);
      setPlaying(false);
      if (shouldReconnectRef.current) scheduleReconnect();
      else setError("Tap the play button again to connect to the live source.");
    }
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
    await startNativeStream();
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const hasNativeShare = typeof (navigator as Navigator & { share?: unknown }).share === "function";
  const shareText = `${config.stationName || "USALB RADIO"} — ${config.tagline || "Listen live"}`;
  const shareTargets = [
    { label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" />, url: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${window.location.href}`)}` },
    { label: "Facebook", icon: <Globe2 className="h-4 w-4" />, url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}` },
    { label: "X / Twitter", icon: <ExternalLink className="h-4 w-4" />, url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(window.location.href)}` },
  ];
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
    window.location.href = `fb-messenger://share/?link=${encodeURIComponent(window.location.href)}`;
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        if (hasNativeShare) void shareNative();
        else void copyShareLink();
      }
    }, 800);
    setShareOpen(false);
  };

  return (
    <main className="min-h-[100dvh] overflow-x-clip bg-[#05090b] text-foreground">
      <div className="fixed inset-x-0 top-0 z-50 h-px bg-white/5">
        <motion.div className="h-full origin-left bg-gradient-to-r from-[#c8102e] via-primary to-[#ffcc33]" style={{ scaleX: scrollYProgress }} />
      </div>

      <header className="absolute inset-x-0 top-0 z-40 mx-auto flex w-full max-w-[1500px] items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
        <Link href="/" className="group flex items-center gap-3" data-testid="link-home">
          <motion.img whileHover={{ rotate: -5, scale: 1.05 }} src={logoSrc} alt="USALB RADIO" className="h-12 w-12 object-contain drop-shadow-[0_0_28px_rgba(224,89,71,.25)] sm:h-14 sm:w-14" data-testid="img-station-logo" />
          <span className="font-display text-lg font-bold tracking-tight text-white">USALB <span className="text-primary">RADIO</span></span>
        </Link>
        <nav className="flex items-center gap-3">
          <span className="hidden eyebrow text-white/45 sm:inline">USA ↔ ALBANIA · LIVE</span>
          {installPrompt && <button onClick={() => void installApp()} className="hidden items-center gap-2 rounded-full border border-[#ffcc33]/30 bg-[#ffcc33]/10 px-4 py-2 text-xs font-bold text-[#ffcc33] transition hover:bg-[#ffcc33]/20 sm:flex"><Download className="h-3.5 w-3.5" /> Install app</button>}
        </nav>
      </header>

      <section ref={heroRef} className="relative flex min-h-[100svh] items-center overflow-hidden px-5 pt-24 sm:px-8">
        <div className="absolute inset-0 usalb-hero-grid opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_42%,rgba(197,22,47,.20),transparent_30%),radial-gradient(circle_at_22%_72%,rgba(30,95,160,.22),transparent_32%),linear-gradient(180deg,#05090b_0%,#071216_65%,#05090b_100%)]" />

        <motion.div className="absolute left-[4%] top-[34%] hidden lg:block" style={{ x: bridgeX }}>
          <div className="relative flex items-center gap-3 rounded-full border border-white/10 bg-black/20 px-4 py-2 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-[#3c3b6e] shadow-[0_0_14px_#3c3b6e]" />
            <span className="text-[10px] font-bold uppercase tracking-[.28em] text-white/50">New York</span>
          </div>
        </motion.div>
        <motion.div className="absolute right-[4%] top-[34%] hidden lg:block" style={{ x: bridgeX }}>
          <div className="relative flex items-center gap-3 rounded-full border border-white/10 bg-black/20 px-4 py-2 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-[#c8102e] shadow-[0_0_14px_#c8102e]" />
            <span className="text-[10px] font-bold uppercase tracking-[.28em] text-white/50">Albania</span>
          </div>
        </motion.div>

        <motion.div className="absolute left-1/2 top-[48%] h-px w-[72%] -translate-x-1/2 origin-left bg-gradient-to-r from-transparent via-[#ffcc33]/70 to-transparent" style={{ scaleX: useTransform(smoothProgress, [0, .35], [0.25, 1]) }} />
        <div className="usalb-orbit absolute left-1/2 top-[45%] h-[min(76vw,720px)] w-[min(76vw,720px)] -translate-x-1/2 -translate-y-1/2">
          <motion.div className="usalb-globe absolute inset-[12%] rounded-full" style={{ rotate: globeRotate }}>
            <div className="absolute inset-[8%] rounded-full border border-white/10" />
            <div className="absolute inset-[18%] rounded-full border border-[#c8102e]/20" />
            <div className="absolute inset-[31%] rounded-full border border-[#ffcc33]/15" />
            <div className="absolute left-[15%] top-[48%] h-2 w-2 rounded-full bg-white shadow-[0_0_18px_white]" />
            <div className="absolute right-[20%] top-[52%] h-2.5 w-2.5 rounded-full bg-[#c8102e] shadow-[0_0_22px_#c8102e]" />
            <div className="absolute left-[17%] top-[49%] h-px w-[66%] rotate-[8deg] bg-gradient-to-r from-white/30 via-[#ffcc33] to-[#c8102e]" />
          </motion.div>
          {[0, 60, 120].map((angle) => (
            <motion.div key={angle} className="absolute inset-[2%] rounded-full border border-white/5" style={{ rotate: angle }} />
          ))}
        </div>

        <motion.div className="relative z-10 mx-auto grid w-full max-w-[1500px] gap-12 lg:grid-cols-[1.05fr_.95fr] lg:items-center" style={{ scale: heroScale, y: heroY }}>
          <div className="max-w-4xl">
            <div className="eyebrow mb-6 flex items-center gap-3 text-[#ffcc33]"><span className="h-px w-8 bg-[#ffcc33]" /> USA ↔ ALBANIA · LIVE RADIO</div>
            <h1 className="font-display text-[clamp(4rem,10vw,9rem)] font-semibold leading-[.82] tracking-[-.075em] text-white">
              <span className="block">USALB</span>
              <span className="block bg-gradient-to-r from-white via-white to-white/45 bg-clip-text text-transparent">RADIO.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-base leading-7 text-white/60 sm:text-xl sm:leading-8">
              From the energy of the <span className="text-white">USA</span> to the heart of <span className="text-[#ffcc33]">Albania</span>. One live signal connecting the diaspora, wherever you are.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <button onClick={() => void toggle()} disabled={loading} className={cn("group flex items-center gap-3 rounded-full px-7 py-4 text-sm font-extrabold shadow-2xl transition hover:-translate-y-1 disabled:cursor-wait disabled:opacity-60", playing ? "bg-[#ffcc33] text-black" : "bg-[#c8102e] text-white")} data-testid="button-toggle-player">
                {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                {loading ? "Connecting" : playing ? "Pause broadcast" : "Listen live"}
              </button>
              <div className="relative">
                <button onClick={() => setShareOpen((open) => !open)} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-4 text-sm font-bold text-white backdrop-blur-md transition hover:border-white/30 hover:bg-white/10"><Share2 className="h-4 w-4" /> Share</button>
                {shareOpen && (
                  <div className="absolute left-0 top-[calc(100%+0.6rem)] z-30 w-64 rounded-2xl border border-white/10 bg-[#0a1215]/95 p-2 shadow-2xl backdrop-blur-xl">
                    <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-[.16em] text-white/40">Share USALB</p>
                    {shareTargets.map((target) => <a key={target.label} href={target.url} target="_blank" rel="noreferrer" onClick={() => setShareOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#c8102e]/15 text-[#ffcc33]">{target.icon}</span>{target.label}</a>)}
                    <button onClick={shareMessenger} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white transition hover:bg-white/10"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#c8102e]/15 text-[#ffcc33]"><MessageCircle className="h-4 w-4" /></span>Messenger</button>
                    <button onClick={copyShareLink} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white transition hover:bg-white/10"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#c8102e]/15 text-[#ffcc33]">{copied ? <Link2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</span>{copied ? "Link copied" : "Copy link"}</button>
                    {hasNativeShare && <button onClick={shareNative} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white transition hover:bg-white/10"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#c8102e]/15 text-[#ffcc33]"><MoreHorizontal className="h-4 w-4" /></span>More apps</button>}
                  </div>
                )}
              </div>
            </div>
            {error && <p className="mt-4 flex items-center gap-2 text-sm text-[#ffcc33]"><WifiOff className="h-4 w-4" />{error}</p>}
            <div className="mt-12 flex flex-wrap gap-8 text-[10px] font-bold uppercase tracking-[.22em] text-white/40">
              <span className="flex items-center gap-2"><RadioTower className="h-4 w-4 text-[#c8102e]" /> Live from Albania</span>
              <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-[#ffcc33]" /> Heard in the USA</span>
            </div>
          </div>

          <motion.div className="relative mx-auto w-full max-w-xl" style={{ y: useTransform(smoothProgress, [0, .3], [0, -45]) }}>
            <div className="absolute -inset-10 rounded-full bg-[#c8102e]/10 blur-3xl" />
            <div className="glass hardware-inset relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#091216]/70 p-5 shadow-[0_40px_120px_rgba(0,0,0,.55)] backdrop-blur-2xl sm:p-7">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#ffcc33]/10 blur-3xl" />
              <div className="relative z-10 flex items-center justify-between">
                <span className="eyebrow text-white/45">On air now</span>
                <span className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest", isLive ? "border-[#ffcc33]/30 bg-[#ffcc33]/10 text-[#ffcc33]" : "border-white/10 text-white/40")}><i className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-[#ffcc33] animate-pulse" : "bg-white/30")} />{isLive ? "Live" : "Standby"}</span>
              </div>

              <div className="relative z-10 mt-8 flex items-center justify-center">
                <motion.div animate={playing ? { rotate: 360 } : { rotate: 0 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }} className="absolute h-64 w-64 rounded-full border border-[#c8102e]/20 border-dashed" />
                <motion.div animate={playing ? { scale: [1, 1.04, 1] } : { scale: 1 }} transition={{ duration: 2, repeat: Infinity }} className="absolute h-52 w-52 rounded-full border border-[#ffcc33]/20 shadow-[0_0_80px_rgba(200,16,46,.12)]" />
                <button type="button" onClick={() => void toggle()} disabled={loading} className="group relative z-10 flex h-48 w-48 items-center justify-center rounded-full border border-[#c8102e]/40 bg-[#060b0d] shadow-[inset_0_0_55px_rgba(200,16,46,.14),0_0_80px_rgba(0,0,0,.35)] transition hover:scale-[1.03] hover:border-[#ffcc33]/50 disabled:cursor-wait disabled:opacity-75">
                  <span className="flex h-36 w-36 items-center justify-center rounded-full border border-[#ffcc33]/20 bg-white/[.035] text-[#ffcc33] transition group-hover:bg-[#c8102e]/10">
                    {loading ? <LoaderCircle className="h-10 w-10 animate-spin" /> : playing ? <Pause className="h-12 w-12 fill-current" /> : <Play className="ml-1 h-12 w-12 fill-current" />}
                  </span>
                </button>
              </div>

              <div className="relative z-10 mt-8 text-center">
                <div className="flex justify-center"><SignalBars active={playing} /></div>
                <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">{config.showName || "USALB RADIO"}</h2>
                <p className="mt-2 text-sm text-white/45">{config.hostName || "USALB Studio"} · {config.genre || "Albanian radio"}</p>
              </div>

              <div className="relative z-10 mt-7 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                <button onClick={() => { setMuted(!muted); if (audioRef.current) audioRef.current.volume = muted ? volume : 0; }} className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white">{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
                <input aria-label="Volume" type="range" min="0" max="1" step=".01" value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} className="h-1 w-full accent-[#c8102e]" />
                <span className="font-mono text-[10px] text-white/40">{Math.round((muted ? 0 : volume) * 100)}%</span>
              </div>

              <div className="relative z-10 mt-3 flex items-center justify-between text-[11px] text-white/40">
                <span className="flex items-center gap-2"><Wifi className={cn("h-3.5 w-3.5", reconnecting ? "text-[#ffcc33] animate-pulse" : "text-[#ffcc33]")} /> {reconnecting ? "Reconnecting…" : "Ready · Live audio"}</span>
                <span>Updated {lastUpdated}</span>
              </div>
            </div>
          </motion.div>
        </motion.div>

        <motion.div className="absolute bottom-7 left-1/2 z-20 -translate-x-1/2 text-white/35" animate={{ y: [0, 8, 0] }} transition={{ duration: 2.4, repeat: Infinity }}>
          <ArrowDown className="h-5 w-5" />
        </motion.div>
      </section>

      <section className="relative overflow-hidden border-y border-white/10 bg-[#070d10] px-5 py-28 sm:px-8 sm:py-40">
        <div className="mx-auto max-w-[1500px]">
          <div className="grid gap-16 lg:grid-cols-[.75fr_1.25fr] lg:items-center">
            <div>
              <p className="eyebrow text-[#ffcc33]">The connection</p>
              <h2 className="mt-5 font-display text-5xl font-semibold leading-[.92] tracking-[-.055em] text-white sm:text-7xl">Two places.<br /><span className="text-[#c8102e]">One signal.</span></h2>
              <p className="mt-7 max-w-lg text-base leading-7 text-white/50">USALB Radio exists for the space between Albania and America — the music, language, memories and late-night conversations that travel with us.</p>
            </div>

            <div className="relative min-h-[420px] overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_50%_50%,rgba(200,16,46,.12),transparent_38%),#05090b]">
              <div className="absolute inset-0 usalb-map-grid opacity-40" />
              <div className="absolute left-[14%] top-[58%]">
                <div className="h-3 w-3 rounded-full bg-white shadow-[0_0_24px_white]" />
                <span className="absolute left-6 top-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-[.22em] text-white/50">USA · NYC</span>
              </div>
              <div className="absolute right-[15%] top-[42%]">
                <div className="h-3 w-3 rounded-full bg-[#c8102e] shadow-[0_0_24px_#c8102e]" />
                <span className="absolute right-6 top-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-[.22em] text-[#ffcc33]">ALBANIA</span>
              </div>
              <motion.div className="absolute left-[17%] top-[57%] h-px w-[66%] origin-left bg-gradient-to-r from-white/60 via-[#ffcc33] to-[#c8102e]" style={{ rotate: -13 }} animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 2.2, repeat: Infinity }} />
              <motion.div className="absolute left-[17%] top-[57%] h-3 w-3 rounded-full bg-[#ffcc33] shadow-[0_0_25px_#ffcc33]" animate={{ x: ["0%", "620%", "0%"], y: ["0%", "-115%", "0%"] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }} />
              <div className="absolute bottom-7 left-7 flex items-center gap-3 rounded-full border border-white/10 bg-black/30 px-4 py-2 backdrop-blur-md"><Waves className="h-4 w-4 text-[#ffcc33]" /><span className="text-[10px] font-bold uppercase tracking-[.2em] text-white/50">Live connection</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-5 py-28 sm:px-8 sm:py-40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(60,59,110,.16),transparent_28%),radial-gradient(circle_at_80%_60%,rgba(200,16,46,.13),transparent_30%)]" />
        <div className="relative mx-auto max-w-[1500px]">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow text-[#c8102e]">Made for the diaspora</p>
              <h2 className="mt-4 max-w-4xl font-display text-5xl font-semibold leading-[.9] tracking-[-.06em] text-white sm:text-8xl">Wherever Albania is in your heart.</h2>
            </div>
            <Sparkles className="hidden h-12 w-12 text-[#ffcc33] md:block" />
          </div>
          <div className="mt-20 grid gap-5 md:grid-cols-3">
            {[
              { n: "01", title: "Music", text: "Albanian sounds, modern energy and the tracks that keep the connection alive." },
              { n: "02", title: "Culture", text: "A digital home for stories, voices and moments shared across the Atlantic." },
              { n: "03", title: "Community", text: "One station for listeners in Albania, America and everywhere between." },
            ].map((item) => (
              <motion.article key={item.n} whileHover={{ y: -8 }} className="group min-h-64 rounded-[1.6rem] border border-white/10 bg-white/[.025] p-7 transition-colors hover:border-[#c8102e]/40 hover:bg-white/[.045]">
                <span className="font-mono text-xs text-[#ffcc33]">{item.n}</span>
                <h3 className="mt-16 font-display text-3xl font-semibold text-white">{item.title}</h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-white/45">{item.text}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#040708] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
          <span>© USALB RADIO · USA ↔ Albania · Live broadcast.</span>
          <span className="flex items-center gap-2"><Headphones className="h-3.5 w-3.5" /> Your one-tap radio home</span>
        </div>
      </footer>

      <audio ref={audioRef} playsInline preload="none"
        onPause={() => { if (!shouldReconnectRef.current) setPlaying(false); }}
        onPlaying={() => { setPlaying(true); setLoading(false); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; }}
        onWaiting={() => { if (shouldReconnectRef.current) setReconnecting(true); }}
        onError={() => { if (shouldReconnectRef.current) scheduleReconnect(); else { setPlaying(false); setError("The live source is unavailable right now."); } }}
        onEnded={() => { if (shouldReconnectRef.current) scheduleReconnect(); }}
      />
    </main>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
