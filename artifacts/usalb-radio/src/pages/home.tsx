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
  genre: "Albanian hits · Talk · Kulturë",
  hostName: "USALB Studio",
  showName: "Drejtpërdrejt nga studio",
  sourceType: "browser",
  isLive: false
};

type SiteLanguage = "al" | "en";

type NewsItem = {
  id: number;
  date: string;
  link: string;
  title: string;
  excerpt: string;
  image?: string;
};

function NewsFeed({ language }: { language: SiteLanguage }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setNewsLoading(true);
      try {
        const response = await fetch("https://public-api.wordpress.com/rest/v1.1/sites/usalbtv.com/posts/?number=6&fields=ID,date,URL,title,excerpt,featured_image");
        if (!response.ok) throw new Error("News feed unavailable");
        const data = await response.json();
        const posts = Array.isArray(data?.posts) ? data.posts : [];
        if (!cancelled) {
          setItems(posts.map((post: any) => ({
            id: Number(post.ID),
            date: post.date,
            link: post.URL,
            title: String(post.title || "").replace(/<[^>]+>/g, ""),
            excerpt: String(post.excerpt || "").replace(/<[^>]+>/g, "").trim(),
            image: post.featured_image || undefined,
          })));
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setNewsLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return (
    <section id="news" className="relative overflow-hidden border-y border-white/10 bg-[#060b0d] px-5 py-28 sm:px-8 sm:py-40">
      <div className="absolute inset-0 usalb-map-grid opacity-20" />
      <div className="relative mx-auto max-w-[1500px]">
        <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
          <div>
            <div className="eyebrow flex items-center gap-3 text-[#ffcc33]"><span className="h-px w-10 bg-[#ffcc33]" /> {language === "al" ? "USALB NEWS" : "USALB NEWS"}</div>
            <h2 className="mt-5 max-w-3xl font-display text-[clamp(3rem,6vw,6.5rem)] font-semibold leading-[.88] tracking-[-.06em] text-white">
              {language === "al" ? "Lajmet e fundit." : "Latest news."}
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/55 sm:text-lg">
              {language === "al" ? "Të rejat më të fundit nga redaksia e USALB." : "The latest stories from the USALB newsroom."}
            </p>
          </div>
          <a href="https://usalbtv.com" target="_blank" rel="noreferrer" className="text-xs font-bold uppercase tracking-[.18em] text-[#ffcc33] transition hover:text-white">
            {language === "al" ? "Shiko të gjitha →" : "View all →"}
          </a>
        </div>

        {newsLoading && (
          <div className="mt-12 h-64 animate-pulse rounded-[2rem] border border-white/10 bg-white/[.03]" />
        )}

        {!newsLoading && items.length > 0 && (
          <div className="mt-12 grid gap-5 lg:grid-cols-12">
            {items.map((item, index) => (
              <a key={item.id} href={item.link} target="_blank" rel="noreferrer"
                className={cn("group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[.035] transition duration-500 hover:-translate-y-1 hover:border-[#ffcc33]/30", index === 0 ? "lg:col-span-7 lg:row-span-2" : "lg:col-span-5")}>
                {item.image && <img src={item.image} alt="" loading={index === 0 ? "eager" : "lazy"} className={cn("absolute inset-0 h-full w-full object-cover opacity-45 transition duration-700 group-hover:scale-105 group-hover:opacity-60", index === 0 ? "min-h-[430px]" : "min-h-[210px]")} />}
                <div className="relative flex min-h-[210px] flex-col justify-end bg-gradient-to-t from-[#030607] via-[#030607]/75 to-transparent p-6 sm:p-8">
                  <div className="font-mono text-[9px] uppercase tracking-[.18em] text-[#ffcc33]">{new Date(item.date).toLocaleDateString(language === "al" ? "sq-AL" : "en-US")}</div>
                  <h3 className="mt-2 font-display text-2xl font-semibold leading-tight text-white sm:text-3xl">{item.title}</h3>
                  {item.excerpt && <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-white/55">{item.excerpt}</p>}
                  <span className="mt-5 text-[10px] font-bold uppercase tracking-[.16em] text-white/45 group-hover:text-[#ffcc33]">{language === "al" ? "Lexo lajmin →" : "Read article →"}</span>
                </div>
              </a>
            ))}
          </div>
        )}

        {!newsLoading && items.length === 0 && (
          <div className="mt-12 rounded-3xl border border-white/10 bg-white/[.03] p-8 text-sm text-white/45">
            {language === "al" ? "Lajmet do të shfaqen këtu sapo burimi i USALB TV të jetë i disponueshëm." : "News will appear here when the USALB TV feed is available."}
          </div>
        )}
      </div>
    </section>
  );
}

function SignalBars({ active }: { active: boolean }) {
  return (
    <div className="flex h-7 items-end gap-1.5" aria-label={active ? "Audio is playing" : "Audio is paused"}>
      {[35, 58, 82, 48, 70, 42, 68].map((height, i) => (
        <span key={i} className={cn("w-1 rounded-full bg-primary transition-transform", active && "animate-[equalizer_1s_ease-in-out_infinite_alternate]")} style={{ height: `${active ? height : 18}%`, animationDelay: `${i * -120}ms` }} />
      ))}
    </div>
  );
}

function USAAlbaniaGlobe({ progress }: { progress: any }) {
  const rotate = useTransform(progress, [0, 1], [-8, 8]);
  const route = useTransform(progress, [0, .5, 1], [0, 1, 0]);
  const pulse = useTransform(progress, [0, .5, 1], [.65, 1, .65]);

  return (
    <div className="relative mx-auto aspect-square w-[min(82vw,760px)] [perspective:1200px]" aria-label="Animated USA to Albania connection">
      <motion.div style={{ rotateY: rotate }} className="relative h-full w-full [transform-style:preserve-3d]">
        <div className="absolute inset-[7%] rounded-full border border-white/15 bg-[radial-gradient(circle_at_35%_28%,rgba(255,255,255,.16),rgba(10,18,22,.82)_52%,#020405_100%)] shadow-[inset_-40px_-30px_90px_rgba(0,0,0,.8),0_0_100px_rgba(255,204,51,.08)]" />
        <div className="absolute inset-[11%] rounded-full opacity-35" style={{ background: "repeating-radial-gradient(circle at 48% 45%, transparent 0 34px, rgba(255,255,255,.06) 35px 36px)" }} />
        <div className="absolute inset-[19%] rounded-full border border-dashed border-white/10" />
        <svg viewBox="0 0 800 800" className="absolute inset-[8%] h-[84%] w-[84%] overflow-visible">
          <defs>
            <linearGradient id="usalbRoute" x1="0" x2="1">
              <stop offset="0" stopColor="#e11d48" />
              <stop offset=".5" stopColor="#ffcc33" />
              <stop offset="1" stopColor="#e11d48" />
            </linearGradient>
            <filter id="usalbGlow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <path d="M185 350 C300 250 405 280 515 365 C585 420 625 425 655 410" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="2" strokeDasharray="7 13" />
          <motion.path d="M185 350 C300 250 405 280 515 365 C585 420 625 425 655 410" fill="none" stroke="url(#usalbRoute)" strokeWidth="5" strokeLinecap="round" filter="url(#usalbGlow)" style={{ pathLength: route }} />
          <circle cx="185" cy="350" r="11" fill="#e11d48" filter="url(#usalbGlow)" />
          <circle cx="655" cy="410" r="11" fill="#e11d48" filter="url(#usalbGlow)" />
          <motion.circle cx="185" cy="350" r="24" fill="none" stroke="#ffcc33" strokeWidth="2" style={{ opacity: pulse }} />
          <motion.circle cx="655" cy="410" r="24" fill="none" stroke="#ffcc33" strokeWidth="2" style={{ opacity: pulse }} />
        </svg>
        <div className="absolute left-[17%] top-[43%] -translate-y-1/2">
          <span className="eyebrow rounded-full border border-white/15 bg-black/35 px-3 py-2 text-white/75 backdrop-blur-md">USA</span>
        </div>
        <div className="absolute right-[10%] top-[50%] -translate-y-1/2">
          <span className="eyebrow rounded-full border border-white/15 bg-black/35 px-3 py-2 text-white/75 backdrop-blur-md">ALBANIA</span>
        </div>
        <div className="absolute inset-[4%] rounded-full border border-[#ffcc33]/15 shadow-[0_0_70px_rgba(255,204,51,.08)]" />
      </motion.div>
    </div>
  );
}

function CinematicMediaJourney() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress: mediaProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  const scenes = [
    {
      src: "https://images.pexels.com/videos/5727833/city-city-at-night-city-lights-city-night-5727833.jpeg?auto=compress&dpr=1&h=750&w=1260",
      alt: "New York City skyline at night",
      kicker: "01 · USA",
      title: "Sinjali nis këtu.",
      copy: "Energjia e Nju Jorkut. Zëra shqiptarë. Një qytet plot njerëz që mbajnë shtëpinë me vete.",
      credit: "Visual: CityXcape / Pexels",
    },
    {
      src: "https://images.pexels.com/videos/29007631/4k-4k-background-4k-drone-4k-drone-footage-29007631.jpeg?auto=compress&dpr=1&h=750&w=1260",
      alt: "Albanian coastline and mountains",
      kicker: "02 · ATLANTIC → ADRIATIC",
      title: "Përtej distancës.",
      copy: "Oqeani bëhet ura — një sinjal i pandërprerë që lidh dy anët e diasporës.",
      credit: "Visual: Sergey Guk / Pexels",
    },
    {
      src: "https://images.pexels.com/videos/33119145/aerial-albania-architecture-building-33119145.jpeg?dpr=1&h=750&w=1260",
      alt: "Tirana aerial cityscape",
      kicker: "03 · ALBANIA",
      title: "Kthim te burimi.",
      copy: "Tirana, Shqipëri dhe tingulli i shtëpisë — drejtpërdrejt përmes USALB RADIO.",
      credit: "Visual: Albanian Filmmaker / Pexels",
    },
  ];

  const usaOpacity = useTransform(mediaProgress, [0, .2999, .3001, 1], [1, 1, 0, 0]);
  const bridgeOpacity = useTransform(mediaProgress, [0, .3000, .3001, .6999, .7000, 1], [0, 0, 1, 1, 0, 0]);
  const albaniaOpacity = useTransform(mediaProgress, [0, .6999, .7000, 1], [0, 0, 1, 1]);
  const opacities = [usaOpacity, bridgeOpacity, albaniaOpacity];
  const imageScale = useTransform(mediaProgress, [0, 1], [1.12, 1.02]);
  const imageX = useTransform(mediaProgress, [0, .5, 1], ["-1.5%", "0%", "1.5%"]);
  const imageY = useTransform(mediaProgress, [0, 1], ["-1%", "1%"]);
  const signalX = useTransform(mediaProgress, [0, 1], ["-8%", "108%"]);
  const titleY = useTransform(mediaProgress, [0, .18, .36, .58, .76, 1], [40, 0, -20, 30, 0, -20]);

  return (
    <section ref={sectionRef} className="relative h-[320vh] border-y border-white/10 bg-[#040708]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="absolute inset-0 bg-[#040708]" />
        {scenes.map((scene, index) => (
          <motion.img
            key={scene.src}
            src={scene.src}
            alt={scene.alt}
            loading={index === 0 ? "eager" : "lazy"}
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: opacities[index],
              scale: imageScale,
              x: imageX,
              y: imageY,
            }}
          />
        ))}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,9,.92)_0%,rgba(3,7,9,.60)_38%,rgba(3,7,9,.20)_72%,rgba(3,7,9,.55)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,7,9,.40)_0%,transparent_35%,rgba(3,7,9,.82)_100%)]" />
        <div className="absolute inset-0 usalb-hero-grid opacity-25" />

        <div className="relative z-10 mx-auto w-full max-w-[1500px] px-5 sm:px-8">
          <motion.div style={{ y: titleY }} className="max-w-2xl">
            <div className="eyebrow mb-5 flex items-center gap-3 text-[#ffcc33]">
              <span className="h-px w-10 bg-[#ffcc33]" />
              MEDIA REALE · UDHËTIM NË SCROLL
            </div>
            {scenes.map((scene, index) => (
              <motion.div
                key={scene.title}
                className="absolute max-w-2xl"
                style={{ opacity: opacities[index] }}
              >
                <p className="eyebrow text-white/60">{scene.kicker}</p>
                <h2 className="mt-4 font-display text-[clamp(3rem,7vw,7.5rem)] font-semibold leading-[.86] tracking-[-.065em] text-white">
                  {scene.title}
                </h2>
                <p className="mt-7 max-w-xl text-base leading-7 text-white/70 sm:text-xl sm:leading-8">
                  {scene.copy}
                </p>
                <p className="mt-7 text-[10px] font-mono uppercase tracking-[.16em] text-white/35">{scene.credit}</p>
              </motion.div>
            ))}
          </motion.div>

          <div className="absolute bottom-10 left-5 right-5 sm:left-8 sm:right-8">
            <div className="relative h-px overflow-hidden bg-white/20">
              <motion.div className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-[#ffcc33] to-transparent shadow-[0_0_25px_#ffcc33]" style={{ x: signalX }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-[9px] font-mono uppercase tracking-[.18em] text-white/45">
              <span>USA</span><span>SINJAL LIVE</span><span>ALBANIA</span>
            </div>
          </div>
        </div>

        <div className="absolute right-5 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-3 sm:flex">
          {scenes.map((scene, index) => (
            <motion.span
              key={scene.kicker}
              className="h-12 w-px origin-top bg-white/20"
              style={{ scaleY: opacities[index] }}
            />
          ))}
        </div>
      </div>
    </section>
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
  const [language, setLanguage] = useState<SiteLanguage>(() => {
    const saved = window.localStorage.getItem("usalb-language");
    return saved === "en" ? "en" : "al";
  });

  useEffect(() => {
    window.localStorage.setItem("usalb-language", language);
  }, [language]);

  const stationQuery = useGetStation({ query: { queryKey: getGetStationQueryKey(), refetchInterval: 10000 } });
  const statusQuery = useGetStreamStatus({ query: { queryKey: getGetStreamStatusQueryKey(), refetchInterval: 5000 } });
  const station = stationQuery.data;
  const status = statusQuery.data;
  const config = {
    stationName: station?.name || fallback.stationName,
    tagline: station?.slogan || fallback.tagline,
    genre: station?.genre || fallback.genre,
    hostName: "USALB Studio",
    showName: "Drejtpërdrejt nga studio",
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
  const cinematicY = useTransform(smoothProgress, [.28, .52, .76], [90, 0, -90]);
  const cinematicRotate = useTransform(smoothProgress, [.28, .52, .76], [-5, 0, 5]);
  const cinematicScale = useTransform(smoothProgress, [.28, .52, .76], [.86, 1, .88]);
  const journeyX = useTransform(smoothProgress, [.52, .82], ["0%", "-42%"]);

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
    setError(`Lidhje live interrupted. Reconnecting in ${delay} seconds…`);
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
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href="#news" className="hidden text-[10px] font-bold uppercase tracking-[.16em] text-white/55 transition hover:text-white sm:inline">{language === "al" ? "Lajme" : "News"}</a>
          <span className="hidden eyebrow text-white/45 md:inline">SHBA ↔ SHQIPËRI · LIVE</span>
          <div className="flex items-center rounded-full border border-white/10 bg-black/30 p-1 backdrop-blur-md" aria-label="Language">
            <button onClick={() => setLanguage("sq")} className={cn("rounded-full px-3 py-1.5 text-[10px] font-bold transition", language === "al" ? "bg-[#ffcc33] text-black" : "text-white/55 hover:text-white")}>AL</button>
            <button onClick={() => setLanguage("en")} className={cn("rounded-full px-3 py-1.5 text-[10px] font-bold transition", language === "en" ? "bg-[#c8102e] text-white" : "text-white/55 hover:text-white")}>EN</button>
          </div>
          {installPrompt && <button onClick={() => void installApp()} className="hidden items-center gap-2 rounded-full border border-[#ffcc33]/30 bg-[#ffcc33]/10 px-4 py-2 text-xs font-bold text-[#ffcc33] transition hover:bg-[#ffcc33]/20 sm:flex"><Download className="h-3.5 w-3.5" /> {language === "al" ? "Instalo" : "Install app"}</button>}
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
            <div className="eyebrow mb-6 flex items-center gap-3 text-[#ffcc33]"><span className="h-px w-8 bg-[#ffcc33]" /> {language === "al" ? "SHQIP · RADIO LIVE" : "SHBA ↔ SHQIPËRI · LIVE RADIO"}</div>
            <h1 className="font-display text-[clamp(4rem,10vw,9rem)] font-semibold leading-[.82] tracking-[-.075em] text-white">
              <span className="block">USALB</span>
              <span className="block bg-gradient-to-r from-white via-white to-white/45 bg-clip-text text-transparent">RADIO.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-base leading-7 text-white/60 sm:text-xl sm:leading-8">
              {language === "al" ? <>Nga energjia e <span className="text-white">SHBA-së</span> te zemra e <span className="text-[#ffcc33]">Shqipërisë</span>. Një sinjal live që lidh diasporën, kudo që ndodheni.</> : <>From the energy of the <span className="text-white">USA</span> to the heart of <span className="text-[#ffcc33]">Albania</span>. One live signal connecting the diaspora, wherever you are.</>}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <button onClick={() => void toggle()} disabled={loading} className={cn("group flex items-center gap-3 rounded-full px-7 py-4 text-sm font-extrabold shadow-2xl transition hover:-translate-y-1 disabled:cursor-wait disabled:opacity-60", playing ? "bg-[#ffcc33] text-black" : "bg-[#c8102e] text-white")} data-testid="button-toggle-player">
                {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                {loading ? (language === "al" ? "Duke u lidhur" : "Connecting") : playing ? (language === "al" ? "Ndalo transmetimin" : "Pause broadcast") : (language === "al" ? "Dëgjo live" : "Listen live")}
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
              <span className="flex items-center gap-2"><RadioTower className="h-4 w-4 text-[#c8102e]" /> {language === "al" ? "Live nga Shqipëria" : "Drejtpërdrejt nga Shqipëria"}</span>
              <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-[#ffcc33]" /> {language === "al" ? "Dëgjohet në SHBA" : "Heard in the USA"}</span>
            </div>
          </div>

          <motion.div className="relative mx-auto w-full max-w-xl" style={{ y: useTransform(smoothProgress, [0, .3], [0, -45]) }}>
            <div className="absolute -inset-10 rounded-full bg-[#c8102e]/10 blur-3xl" />
            <div className="glass hardware-inset relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#091216]/70 p-5 shadow-[0_40px_120px_rgba(0,0,0,.55)] backdrop-blur-2xl sm:p-7">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#ffcc33]/10 blur-3xl" />
              <div className="relative z-10 flex items-center justify-between">
                <span className="eyebrow text-white/45">Në transmetim tani</span>
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
                <span className="flex items-center gap-2"><Wifi className={cn("h-3.5 w-3.5", reconnecting ? "text-[#ffcc33] animate-pulse" : "text-[#ffcc33]")} /> {reconnecting ? "Po rilidhet…" : "Gati · Audio live"}</span>
                <span>Updated {lastUpdated}</span>
              </div>
            </div>
          </motion.div>
        </motion.div>

        <motion.div className="absolute bottom-7 left-1/2 z-20 -translate-x-1/2 text-white/35" animate={{ y: [0, 8, 0] }} transition={{ duration: 2.4, repeat: Infinity }}>
          <ArrowDown className="h-5 w-5" />
        </motion.div>
      </section>

      <NewsFeed language={language} />

      <section className="relative overflow-hidden border-y border-white/10 bg-[#070d10] px-5 py-28 sm:px-8 sm:py-40">
        <div className="mx-auto max-w-[1500px]">
          <div className="grid gap-16 lg:grid-cols-[.75fr_1.25fr] lg:items-center">
            <div>
              <p className="eyebrow text-[#ffcc33]">Lidhja</p>
              <h2 className="mt-5 font-display text-5xl font-semibold leading-[.92] tracking-[-.055em] text-white sm:text-7xl">Dy vende.<br /><span className="text-[#c8102e]">Një sinjal.</span></h2>
              <p className="mt-7 max-w-lg text-base leading-7 text-white/50">USALB Radio ekziston për hapësirën mes Shqipërisë dhe Amerikës — muzikën, gjuhën, kujtimet dhe bisedat e natës që udhëtojnë me ne.</p>
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
              <div className="absolute bottom-7 left-7 flex items-center gap-3 rounded-full border border-white/10 bg-black/30 px-4 py-2 backdrop-blur-md"><Waves className="h-4 w-4 text-[#ffcc33]" /><span className="text-[10px] font-bold uppercase tracking-[.2em] text-white/50">Lidhje live</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-5 py-28 sm:px-8 sm:py-40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(60,59,110,.16),transparent_28%),radial-gradient(circle_at_80%_60%,rgba(200,16,46,.13),transparent_30%)]" />
        <div className="relative mx-auto max-w-[1500px]">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="eyebrow text-[#c8102e]">Krijuar për diasporën</p>
              <h2 className="mt-4 max-w-4xl font-display text-5xl font-semibold leading-[.9] tracking-[-.06em] text-white sm:text-8xl">Kudo që Shqipëria është në zemrën tënde.</h2>
            </div>
            <Sparkles className="hidden h-12 w-12 text-[#ffcc33] md:block" />
          </div>
          <div className="mt-20 grid gap-5 md:grid-cols-3">
            {[
              { n: "01", title: "Muzikë", text: "Tinguj shqiptarë, energji moderne dhe këngët që mbajnë lidhjen gjallë." },
              { n: "02", title: "Kulturë", text: "Një shtëpi digjitale për histori, zëra dhe momente të ndara përtej Atlantikut." },
              { n: "03", title: "Komunitet", text: "Një stacion për dëgjuesit në Shqipëri, Amerikë dhe kudo mes tyre." },
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

      <section className="relative min-h-[125vh] overflow-hidden bg-[#040708] px-5 py-32 sm:px-8 sm:py-44">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(200,16,46,.16),transparent_24%),radial-gradient(circle_at_15%_70%,rgba(40,75,130,.14),transparent_30%)]" />
        <div className="absolute inset-0 usalb-hero-grid opacity-30" />
        <div className="relative mx-auto max-w-[1500px]">
          <div className="flex items-end justify-between gap-8">
            <div>
              <p className="eyebrow text-[#ffcc33]">Ndiq sinjalin</p>
              <h2 className="mt-5 max-w-4xl font-display text-5xl font-semibold leading-[.88] tracking-[-.06em] text-white sm:text-8xl">Amerika në njërën anë.<br /><span className="text-[#c8102e]">Shqipëria në anën tjetër.</span></h2>
            </div>
            <span className="hidden max-w-xs text-right text-xs uppercase tracking-[.16em] text-white/35 md:block">Një udhëtim kinematik radioje i ndërtuar rreth identitetit USALB.</span>
          </div>
          <div className="relative mt-20 flex min-h-[720px] items-center justify-center [perspective:1400px]">
            <motion.div style={{ y: cinematicY, rotateX: cinematicRotate, scale: cinematicScale }} className="relative h-[min(68vw,650px)] w-[min(88vw,1050px)] [transform-style:preserve-3d]">
              <div className="absolute inset-0 rounded-[2.5rem] border border-white/10 bg-[radial-gradient(circle_at_22%_35%,rgba(255,255,255,.14),transparent_16%),radial-gradient(circle_at_78%_55%,rgba(200,16,46,.22),transparent_25%),linear-gradient(120deg,#101b22,#06090b_55%,#180b10)] shadow-[0_50px_150px_rgba(0,0,0,.65)]" />
              <div className="absolute inset-[5%] overflow-hidden rounded-[2rem] border border-white/10 bg-black/25 backdrop-blur-sm">
                <div className="absolute -left-[10%] top-[18%] h-56 w-[65%] rounded-full border border-white/10 [transform:rotateY(28deg)]" />
                <div className="absolute -right-[8%] bottom-[12%] h-72 w-[58%] rounded-full border border-[#c8102e]/20 [transform:rotateY(-28deg)]" />
                <div className="absolute left-[8%] top-[12%] text-[clamp(2rem,5vw,5rem)] font-black tracking-[-.08em] text-white/10">USA</div>
                <div className="absolute right-[8%] bottom-[12%] text-[clamp(2rem,5vw,5rem)] font-black tracking-[-.08em] text-[#c8102e]/20">ALB</div>
                <motion.div className="absolute left-[13%] top-1/2 h-px w-[74%] bg-gradient-to-r from-white/10 via-[#ffcc33] to-[#c8102e]" animate={{ opacity:[.25,1,.25] }} transition={{ duration:2.6, repeat:Infinity }} />
                <motion.div className="absolute left-[18%] top-[calc(50%-4px)] h-2 w-2 rounded-full bg-[#ffcc33] shadow-[0_0_28px_#ffcc33]" animate={{ x:["0%","470%","0%"], y:["0%","-45%","0%"] }} transition={{ duration:5, repeat:Infinity, ease:"easeInOut" }} />
                <div className="absolute inset-x-8 bottom-8 flex items-center justify-between rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
                  <span className="eyebrow text-white/45">SHBA ↔ SHQIPËRI</span>
                  <span className="flex items-center gap-2 text-xs font-bold text-[#ffcc33]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#c8102e]" /> SINJALI PO LËVIZ</span>
                </div>
              </div>
              <div className="absolute -left-8 top-1/2 h-40 w-20 -translate-y-1/2 rounded-full border border-white/5 bg-white/[.02] blur-[1px] [transform:translateZ(-80px)_rotateY(45deg)]" />
              <div className="absolute -right-8 top-1/2 h-40 w-20 -translate-y-1/2 rounded-full border border-[#c8102e]/10 bg-[#c8102e]/5 [transform:translateZ(-80px)_rotateY(-45deg)]" />
            </motion.div>
          </div>
        </div>
      </section>

      <CinematicMediaJourney />

      <section className="relative -mt-[18vh] overflow-hidden bg-[#030607] px-5 pb-28 pt-[18vh] sm:px-8 sm:pb-40">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-transparent via-[#030607]/70 to-[#030607]" />
      </section>

      <section className="relative overflow-hidden border-y border-white/10 bg-[#071014] px-5 py-28 sm:px-8 sm:py-40">
        <div className="mx-auto max-w-[1500px]">
          <p className="eyebrow text-[#c8102e]">Udhëtimi USALB</p>
          <div className="mt-5 overflow-hidden">
            <motion.div style={{ x: journeyX }} className="flex w-max gap-5">
              {[
                ["01","NEW YORK","Energjia e qytetit amerikan."],
                ["02","ATLANTIC","Sinjali kalon distancën."],
                ["03","ALBANIA","Kultura, gjuha dhe shtëpia."],
                ["04","USALB RADIO","Një stacion i lidh të gjitha."],
              ].map(([n,title,text]) => (
                <article key={n} className="flex h-72 w-[78vw] max-w-[470px] flex-col justify-between rounded-[2rem] border border-white/10 bg-white/[.025] p-7 sm:w-[470px]">
                  <span className="font-mono text-xs text-[#ffcc33]">{n}</span>
                  <div><h3 className="font-display text-4xl font-semibold tracking-tight text-white">{title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-white/40">{text}</p></div>
                </article>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-[1.35rem] border border-white/10 bg-[#071014]/90 p-2 shadow-[0_20px_70px_rgba(0,0,0,.5)] backdrop-blur-2xl">
          <img src={logoSrc} alt="" className="h-12 w-12 rounded-xl object-contain bg-black/20 p-1" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8102e]" /><span className="eyebrow text-white/40">{isLive ? "LIVE TANI" : "USALB RADIO"}</span></div>
            <p className="truncate text-sm font-bold text-white">{config.showName}</p>
          </div>
          <div className="hidden items-center gap-2 sm:flex"><SignalBars active={playing} /></div>
          <button onClick={() => void toggle()} disabled={loading} className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition", playing ? "bg-[#ffcc33] text-black" : "bg-[#c8102e] text-white")} aria-label={playing ? "Pause radio" : "Play radio"}>
            {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>
          <input aria-label="Player volume" type="range" min="0" max="1" step=".01" value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} className="hidden w-24 accent-[#c8102e] md:block" />
        </div>
      </div>

      <footer className="border-t border-white/10 bg-[#040708] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
          <span>© USALB RADIO · USA ↔ Albania · Live broadcast.</span>
          <span className="flex items-center gap-2"><Headphones className="h-3.5 w-3.5" /> Radioja jote me një prekje</span>
        </div>
      </footer>

      <audio ref={audioRef} playsInline preload="none"
        onPause={() => { if (!shouldReconnectRef.current) setPlaying(false); }}
        onPlaying={() => { setPlaying(true); setLoading(false); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; }}
        onWaiting={() => { if (shouldReconnectRef.current) setReconnecting(true); }}
        onError={() => { if (shouldReconnectRef.current) scheduleReconnect(); else { setPlaying(false); setError("Burimi live nuk është i disponueshëm tani."); } }}
        onEnded={() => { if (shouldReconnectRef.current) scheduleReconnect(); }}
      />
    </main>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};