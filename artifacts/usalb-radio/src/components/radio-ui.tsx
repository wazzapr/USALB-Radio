import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play, Radio, RotateCcw, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import type { NowPlaying, Station, StreamStatus } from '@workspace/api-client-react';

export function StationMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'group'}`} data-testid="brand-station-mark">
      <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[4px_4px_0_hsl(var(--accent))]">
        <Radio size={22} strokeWidth={2.5} />
        <span className="absolute -right-1 -top-1 size-2 rounded-full bg-secondary" />
      </span>
      <span className="leading-none">
        <span className="block font-mono text-[10px] font-medium uppercase tracking-[.22em] text-muted-foreground">broadcast / 01</span>
        <span className="mt-1 block font-bold tracking-[-.04em] text-foreground">USALB <span className="text-primary">RADIO</span></span>
      </span>
    </div>
  );
}

export function StatusBadge({ status, small = false }: { status?: StreamStatus; small?: boolean }) {
  const state = status?.state ?? 'CONNECTING';
  const live = state === 'LIVE';
  const label = state === 'LIVE' ? 'On air now' : state === 'CONNECTING' ? 'Connecting' : state === 'RECONNECTING' ? 'Reconnecting' : state === 'ERROR' ? 'Stream error' : 'Off air';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[.14em] ${small ? 'px-2.5 py-1' : ''} ${live ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`} data-testid="status-stream">
      <span className={`size-1.5 rounded-full ${live ? 'live-pulse bg-primary' : 'bg-muted-foreground/50'}`} />
      {label}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} aria-label="Loading" />;
}

export function ErrorPanel({ title = 'Signal interrupted', detail = 'We could not reach the station right now.', onRetry }: { title?: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-3xl border border-destructive/25 bg-destructive/5 p-5" role="alert" data-testid="state-error">
      <div className="flex items-start gap-3">
        <WifiOff size={18} className="mt-0.5 text-destructive" />
        <div className="flex-1">
          <p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p>
          {onRetry && <button onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background" data-testid="button-retry"><RotateCcw size={14} /> Try again</button>}
        </div>
      </div>
    </div>
  );
}

function artworkGradient(title = '') {
  const colors = ['linear-gradient(135deg,#df854d,#103c47)', 'linear-gradient(135deg,#d84d85,#202452)', 'linear-gradient(135deg,#e3b64f,#174f55)'];
  return colors[title.length % colors.length];
}

export function TrackArtwork({ track, size = 'large' }: { track?: NowPlaying | null; size?: 'large' | 'small' }) {
  const [failed, setFailed] = useState(false);
  const isLarge = size === 'large';
  if (track?.artworkUrl && !failed) return <img src={track.artworkUrl} alt={`${track.title} artwork`} onError={() => setFailed(true)} className={`aspect-square rounded-[1.75rem] object-cover shadow-xl shadow-primary/10 ${isLarge ? 'w-full' : 'size-16 rounded-2xl'}`} data-testid="img-track-artwork" />;
  return (
    <div className={`relative aspect-square overflow-hidden rounded-[1.75rem] ${isLarge ? 'w-full' : 'size-16 rounded-2xl'} bg-[var(--artwork)] shadow-xl shadow-primary/10`} style={{ '--artwork': artworkGradient(track?.title) } as CSSProperties} data-testid="img-track-artwork">
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 25% 25%, white 0 2px, transparent 3px), radial-gradient(circle at 72% 65%, white 0 1px, transparent 2px)', backgroundSize: '24px 24px, 17px 17px' }} />
      <div className="absolute bottom-4 left-4 font-mono text-[9px] uppercase tracking-[.25em] text-white/75">{track?.genre || 'USALB / LIVE'}</div>
      <div className={`absolute right-4 top-4 rounded-full border border-white/20 bg-black/15 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-white/80 ${isLarge ? '' : 'hidden'}`}>side A</div>
    </div>
  );
}

export function LivePlayer({ station, status }: { station?: Station; status?: StreamStatus }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [volume, setVolume] = useState(0.78);
  const [audioError, setAudioError] = useState(false);
  const streamUrl = status?.streamUrl || station?.streamUrl;
  const state = status?.state ?? 'OFFLINE';
  const unavailable = !streamUrl || state === 'OFFLINE';

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.volume = volume;
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  const toggle = async () => {
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    if (!streamUrl || unavailable) return;
    setAudioError(false); setConnecting(true);
    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    audio.src = streamUrl; audio.preload = 'none'; audio.volume = volume;
    audio.onplaying = () => { setConnecting(false); setPlaying(true); };
    audio.onpause = () => setPlaying(false);
    audio.onerror = () => { setConnecting(false); setPlaying(false); setAudioError(true); };
    try { await audio.play(); } catch { setConnecting(false); setAudioError(true); }
  };
  const retry = () => { setAudioError(false); void toggle(); };
  const label = audioError || state === 'ERROR' ? 'Retry live stream' : connecting ? 'Connecting to live stream' : playing ? 'Pause live stream' : unavailable ? 'Live stream unavailable' : 'Listen live';

  return (
    <div className="flex flex-col gap-3" data-testid="live-player">
      <div className="flex items-center gap-3">
        <button onClick={audioError ? retry : toggle} disabled={unavailable && !audioError} aria-label={label} className={`grid size-16 shrink-0 place-items-center rounded-full border-4 border-background text-background shadow-[0_0_0_1px_hsl(var(--primary)/.3)] transition-transform active:scale-95 ${unavailable && !audioError ? 'cursor-not-allowed bg-muted-foreground/40' : 'bg-secondary hover:scale-105'}`} data-testid="button-live-player">
          {audioError || state === 'ERROR' ? <RotateCcw size={24} /> : connecting ? <Wifi size={24} className="animate-pulse" /> : playing ? <Pause size={25} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">{connecting ? 'Finding the signal' : playing ? 'You are listening' : audioError ? 'Playback could not start' : 'Ready when you are'}</span>{playing && <div className="equalizer flex h-6 items-end gap-1 text-secondary" aria-hidden="true"><span /><span /><span /><span /></div>}</div>
          <p className="mt-1 truncate text-lg font-semibold">{label}</p>
        </div>
        <label className="hidden items-center gap-2 sm:flex">
          <span className="sr-only">Volume</span>{volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} className="text-muted-foreground" />}
          <input type="range" min="0" max="1" step=".01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-20 accent-primary" aria-label="Volume" data-testid="input-volume" />
        </label>
      </div>
      {audioError && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-player-error">The audio connection failed. Check your connection and try once more.</p>}
      {!status?.isLive && <p className="text-xs text-muted-foreground">The station will appear here when the broadcaster connects. We never fake a live signal.</p>}
    </div>
  );
}

export function StationHeader({ station, admin = false }: { station?: Station; admin?: boolean }) {
  return (
    <header className="flex items-center justify-between gap-4">
      <StationMark compact />
      {admin ? <span className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">control room</span> : <div className="hidden items-center gap-2 sm:flex"><span className="size-2 rounded-full bg-primary live-pulse" /><span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Real signal. Real people.</span></div>}
    </header>
  );
}

export function SectionLabel({ children, right }: { children: string; right?: string }) {
  return <div className="mb-4 flex items-center justify-between border-b border-border pb-3"><span className="font-mono text-[10px] font-medium uppercase tracking-[.2em] text-muted-foreground">{children}</span>{right && <span className="font-mono text-[10px] uppercase tracking-widest text-primary">{right}</span>}</div>;
}

export function formatDuration(seconds?: number) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

export function formatTime(date?: string | null) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}

export function formatAgo(date?: string | null) {
  if (!date) return 'No heartbeat yet';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return mins < 1 ? 'just now' : `${mins}m ago`;
}