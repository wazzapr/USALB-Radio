import { useMemo, useState, type FormEvent } from 'react';
import { MessageCircle, Send, Users, Instagram, Globe2, Headphones } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatQueryKey,
  getGetListenersQueryKey,
  getGetNowPlayingQueryKey,
  getGetStationQueryKey,
  getGetStreamStatusQueryKey,
  useCreateChatMessage,
  useGetChat,
  useGetListeners,
  useGetNowPlaying,
  useGetStation,
  useGetStreamStatus,
} from '@workspace/api-client-react';
import type { ChatMessage, NowPlaying } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ErrorPanel, LivePlayer, SectionLabel, Skeleton, StationHeader, StatusBadge, TrackArtwork, formatTime } from '@/components/radio-ui';

function TrackInfo({ track, loading }: { track?: NowPlaying | null; loading?: boolean }) {
  if (loading) return <div className="flex gap-4"><Skeleton className="size-16 rounded-2xl" /><div className="flex-1 space-y-2 pt-1"><Skeleton className="h-3 w-24" /><Skeleton className="h-6 w-48" /></div></div>;
  if (!track?.title && !track?.artist) return <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="state-now-playing-empty">No track metadata yet. The next voice or record will show up here.</div>;
  return <div className="flex items-center gap-4" data-testid="now-playing"><TrackArtwork track={track} size="small" /><div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Now playing</p><p className="mt-1 truncate text-lg font-semibold">{track.title}</p><p className="truncate text-sm text-muted-foreground">{track.artist}</p><p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{track.genre || 'USALB'} · started {formatTime(track.startedAt)}</p></div></div>;
}

function ChatPanel({ enabled = true, messages = [] }: { enabled?: boolean; messages?: ChatMessage[] }) {
  const queryClient = useQueryClient();
  const create = useCreateChatMessage();
  const [nickname, setNickname] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const sorted = useMemo(() => [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [messages]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (nickname.trim().length < 2 || !message.trim() || create.isPending) return;
    create.mutate({ data: { nickname: nickname.trim(), message: message.trim() } }, { onSuccess: () => { setMessage(''); setSent(true); queryClient.invalidateQueries({ queryKey: getGetChatQueryKey() }); setTimeout(() => setSent(false), 2500); } });
  };
  if (!enabled) return <div className="rounded-3xl border border-border bg-card p-6 text-center" data-testid="state-chat-disabled"><MessageCircle className="mx-auto text-muted-foreground" size={24} /><p className="mt-3 font-semibold">Chat is taking a quiet moment</p><p className="mt-1 text-sm text-muted-foreground">The public room is currently closed by the station.</p></div>;
  return <div className="overflow-hidden rounded-3xl border border-border bg-card" data-testid="chat-panel">
    <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent"><MessageCircle size={17} /></span><div><h2 className="font-semibold">The public room</h2><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Say hello to the room</p></div></div><Users size={17} className="text-muted-foreground" /></div>
    <div className="max-h-[315px] min-h-[180px] space-y-4 overflow-y-auto p-5">
      {!sorted.length ? <div className="flex min-h-[150px] flex-col items-center justify-center text-center"><span className="font-mono text-3xl text-secondary">“</span><p className="text-sm text-muted-foreground" data-testid="state-chat-empty">Be the first voice in the room.</p></div> : sorted.map((item) => <div className="flex gap-3" key={item.id} data-testid={`chat-message-${item.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted font-mono text-[11px] font-medium text-primary">{item.nickname.slice(0, 2).toUpperCase()}</span><div className="min-w-0"><div className="flex items-baseline gap-2"><span className="text-sm font-semibold">{item.nickname}</span><time className="font-mono text-[9px] text-muted-foreground">{formatTime(item.createdAt)}</time></div><p className="break-words text-sm leading-relaxed text-muted-foreground">{item.message}</p></div></div>)}
    </div>
    <form onSubmit={submit} className="border-t border-border bg-muted/35 p-4">
      <div className="mb-2 flex gap-2"><input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={32} placeholder="Your name" className="w-28 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary" aria-label="Your name" data-testid="input-chat-nickname" /><input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="Leave a note for the room" className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary" aria-label="Chat message" data-testid="input-chat-message" /><button type="submit" disabled={create.isPending || nickname.trim().length < 2 || !message.trim()} className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-send-chat"><Send size={16} /></button></div>
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{sent ? 'Message sent to the room' : create.isError ? 'Could not send. Try again.' : 'Keep it kind · 500 characters max'}</p>
    </form>
  </div>;
}

export default function Home() {
  const stationQuery = useGetStation();
  const statusQuery = useGetStreamStatus({ query: { queryKey: getGetStreamStatusQueryKey(), refetchInterval: 10000 } });
  const nowQuery = useGetNowPlaying({ query: { queryKey: getGetNowPlayingQueryKey(), refetchInterval: 15000 } });
  const listenerQuery = useGetListeners({ query: { queryKey: getGetListenersQueryKey(), refetchInterval: 15000 } });
  const chatQuery = useGetChat({ query: { queryKey: getGetChatQueryKey(), refetchInterval: 20000 } });
  const station = stationQuery.data;
  const status = statusQuery.data;
  const track = nowQuery.data || status?.currentTrack;
  const loadError = stationQuery.isError || statusQuery.isError;

  return <main className="noise min-h-[100dvh] overflow-hidden station-grid">
    <div className="mx-auto max-w-[1320px] px-5 pb-12 pt-5 sm:px-8 lg:px-12">
      <StationHeader />
      {loadError && <div className="mt-6"><ErrorPanel detail="The station details are taking a moment to come through." onRetry={() => { void stationQuery.refetch(); void statusQuery.refetch(); }} /></div>}
      <section className="relative mt-10 grid gap-10 lg:mt-16 lg:grid-cols-[1.05fr_.95fr] lg:items-end lg:gap-20">
        <div className="relative z-10">
          <div className="mb-6 flex flex-wrap items-center gap-3"><StatusBadge status={status} /><span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">{status?.listenerCount ?? listenerQuery.data?.count ?? 0} listeners in the room</span></div>
          <h1 className="max-w-3xl text-[clamp(3.5rem,11vw,8rem)] font-extrabold leading-[.86] tracking-[-.075em] text-foreground">A signal<br /><span className="text-primary">with a pulse.</span></h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground">{station?.slogan || 'Live sound from the USALB community, wherever you are.'}</p>
          <div className="mt-9 max-w-xl rounded-[2rem] border border-border bg-card/75 p-5 shadow-[8px_8px_0_hsl(var(--secondary)/.22)] backdrop-blur-sm sm:p-6"><LivePlayer station={station} status={status} /></div>
        </div>
        <div className="relative mx-auto w-full max-w-[430px] lg:mb-2">
          <div className="absolute -inset-10 rounded-full bg-secondary/10 blur-3xl" />
          <div className="relative"><TrackArtwork track={track} /><div className="absolute -bottom-5 left-5 right-5 rounded-2xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur-sm"><TrackInfo track={track} loading={nowQuery.isLoading} /></div></div>
        </div>
      </section>
      <div className="mt-24 grid gap-8 border-t border-border pt-8 md:grid-cols-[1.1fr_.9fr] lg:mt-32">
        <div><SectionLabel right={station?.genre || 'community frequency'}>About the frequency</SectionLabel><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-3xl bg-primary p-6 text-primary-foreground"><span className="font-mono text-4xl">01</span><h2 className="mt-10 text-2xl font-semibold">No algorithm between us.</h2><p className="mt-3 text-sm leading-relaxed text-primary-foreground/75">A human-run signal with room for the unexpected. Press play when you want to feel connected.</p></div><div className="rounded-3xl border border-border bg-card p-6"><span className="font-mono text-4xl text-secondary">02</span><h2 className="mt-10 text-2xl font-semibold">Made for the in-between.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Headphones on the train, speakers in the kitchen, one good track changing the shape of the day.</p></div></div></div>
        <ChatPanel enabled={station?.chatEnabled ?? true} messages={chatQuery.data || []} />
      </div>
      <footer className="mt-16 flex flex-col gap-5 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><Headphones size={15} /><span>Stay close to the frequency.</span></div><div className="flex items-center gap-4"><span className="font-mono text-[10px] uppercase tracking-widest">USALB · {station?.genre || 'independent radio'}</span>{station?.socialLinks?.instagram && <a href={station.socialLinks.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" data-testid="link-social-instagram"><Instagram size={16} /></a>}{station?.socialLinks?.website && <a href={station.socialLinks.website} target="_blank" rel="noreferrer" aria-label="Website" data-testid="link-social-website"><Globe2 size={16} /></a>}<Link href="/admin" className="font-mono text-[10px] uppercase tracking-widest hover:text-primary" data-testid="link-admin">Control room</Link></div></footer>
    </div>
  </main>;
}