import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Check, CircleAlert, Copy, Download, ExternalLink, KeyRound, RadioTower, Save, Trash2, Wifi, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetAdminDiagnosticsQueryKey,
  getGetBroadcasterConnectionQueryKey,
  getGetChatQueryKey,
  getGetListenersQueryKey,
  getGetNowPlayingQueryKey,
  getGetStationQueryKey,
  getGetStreamStatusQueryKey,
  useBroadcasterHeartbeat,
  useGetBroadcasterConnection,
  useDeleteAdminChatMessage,
  useGetAdminDiagnostics,
  useGetChat,
  useGetListeners,
  useGetNowPlaying,
  useGetStation,
  useGetStreamStatus,
  usePairBroadcaster,
  useClearAdminChat,
  useUpdateAdminNowPlaying,
  useUpdateAdminSettings,
} from '@workspace/api-client-react';
import type { BroadcasterConnection, BroadcasterHeartbeatStatus, BroadcasterPair, ChatMessage, Diagnostics, NowPlaying, Station, StreamStatus } from '@workspace/api-client-react';
import { ErrorPanel, SectionLabel, StationHeader, StatusBadge, TrackArtwork, formatAgo, formatDuration, formatTime } from '@/components/radio-ui';

const inputClass = 'mt-2 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-primary';

function Field({ label, value, onChange, placeholder, type = 'text', testId }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; testId: string }) {
  return <label className="block text-sm font-semibold">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={inputClass} data-testid={testId} /></label>;
}

function SignalCard({ status, listeners }: { status?: StreamStatus; listeners?: number }) {
  const state = status?.state ?? 'OFFLINE';
  const heartbeat = formatAgo(status?.lastHeartbeat);
  return <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" data-testid="card-signal-status"><SectionLabel right={heartbeat}>Signal telemetry</SectionLabel><div className="flex flex-wrap items-end justify-between gap-4"><div><StatusBadge status={status} /><p className="mt-4 text-3xl font-bold tracking-tight">{state === 'LIVE' ? 'Broadcasting' : state === 'CONNECTING' ? 'Waiting for source' : state === 'RECONNECTING' ? 'Finding source' : 'Off air'}</p><p className="mt-1 text-sm text-muted-foreground">{status?.broadcasterConnected ? 'Broadcaster connected' : 'No broadcaster connection'}</p></div><div className="grid grid-cols-2 gap-3 text-right"><div><p className="font-mono text-2xl text-primary">{listeners ?? status?.listenerCount ?? '—'}</p><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">listeners</p></div><div><p className="font-mono text-2xl text-secondary">{formatDuration(status?.uptimeSeconds)}</p><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">uptime</p></div></div></div><div className="mt-6 grid grid-cols-3 gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span>{status?.bitrateKbps ? `${status.bitrateKbps} kbps` : 'Bitrate —'}</span><span className="text-center">{status?.sampleRate ? `${status.sampleRate} Hz` : 'Sample —'}</span><span className="text-right">{status?.contentType || 'Format —'}</span></div></section>;
}

function CopyableValue({ label, value, copyValue = value, secret = false }: { label: string; value: string; copyValue?: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(copyValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <div className="rounded-2xl border border-border bg-background/60 p-3"><p className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">{label}</p><div className="mt-1 flex items-center gap-2"><code className={`min-w-0 flex-1 break-all text-sm font-semibold ${secret ? 'text-primary' : ''}`}>{value}</code><button type="button" onClick={() => void copy()} disabled={!copyValue} className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-30" aria-label={`Copy ${label}`}><Copy size={14} /></button>{copied && <Check size={14} className="shrink-0 text-primary" />}</div></div>;
}

function BroadcasterConnectionPanel() {
  const connection = useGetBroadcasterConnection({ query: { queryKey: getGetBroadcasterConnectionQueryKey(), refetchInterval: 30000 } });
  const pair = usePairBroadcaster();
  const [pairingCode, setPairingCode] = useState(() => {
    try { return window.localStorage.getItem('usalb-admin-pairing-code') || ''; } catch { return ''; }
  });
  const [deviceName, setDeviceName] = useState('USALB Windows Broadcaster');
  const [credentials, setCredentials] = useState<BroadcasterPair>();
  const details: BroadcasterConnection | BroadcasterPair | undefined = credentials || connection.data;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pairingCode.trim()) return;
    try { window.localStorage.setItem('usalb-admin-pairing-code', pairingCode.trim()); } catch { /* ignore storage errors */ }
    pair.mutate({ data: { code: pairingCode.trim(), deviceName } }, { onSuccess: (result) => setCredentials(result) });
  };
  const streamPassword = credentials?.streamPassword;
  return <section className="rounded-3xl border border-border bg-card p-5 shadow-[6px_6px_0_hsl(var(--secondary)/.12)] sm:p-6" data-testid="panel-broadcaster-connection"><div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between"><div><SectionLabel right="source setup">Broadcaster connection</SectionLabel><h2 className="mt-2 text-2xl font-bold tracking-tight">Connect the Windows broadcaster.</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Copy these values into the USALB Broadcaster station settings. The control room is open; pairing only issues the protected source token.</p></div><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><RadioTower size={20} /></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{details ? <><CopyableValue label="Station name" value={details.stationName} /><CopyableValue label="Hostname" value={details.hostname} /><CopyableValue label="Server address" value={details.serverAddress} /><CopyableValue label="Port" value={`${details.port}`} /><CopyableValue label="Stream password" value={streamPassword || 'Available after pairing'} copyValue={streamPassword || ''} secret /><CopyableValue label="Protocol" value={details.protocol} /><CopyableValue label="Connection type" value={details.connectionType} /><CopyableValue label="Codec" value={details.codec} /><CopyableValue label="Bitrate" value={`${details.bitrateKbps} kbps`} /><CopyableValue label="Sample rate" value={`${details.sampleRate} Hz`} /><CopyableValue label="Channels" value={details.channels} /><CopyableValue label="Publish endpoint" value={credentials?.publishEndpoint || details.publishEndpoint} /></> : <div className="sm:col-span-2 lg:col-span-4 rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">Loading the deployed server connection details…</div>}</div><div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[1fr_auto]"><div><p className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={15} className="text-primary" /> Get the private stream password</p><p className="mt-1 text-xs text-muted-foreground">Enter the server pairing code to issue or retrieve stable broadcaster credentials. This does not protect or block the control room.</p></div><form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end"><label className="text-xs font-semibold">Pairing code<input type="password" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} className={`${inputClass} min-w-[220px]`} placeholder="Server pairing code" autoComplete="off" data-testid="input-broadcaster-pairing-code" /></label><label className="text-xs font-semibold">Device name<input type="text" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} className={`${inputClass} min-w-[220px]`} data-testid="input-broadcaster-device-name" /></label><button type="submit" disabled={pair.isPending || !pairingCode.trim()} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-pair-broadcaster">{pair.isPending ? 'Pairing…' : 'Get stream password'}</button></form></div>{pair.isError && <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-broadcaster-pair-error">Pairing failed. Check the pairing code and try again.</p>}{credentials && <div className="mt-4 rounded-2xl bg-primary/10 px-4 py-3 text-sm text-primary" data-testid="text-broadcaster-pair-success">Broadcaster paired. Copy the stream password and publish endpoint into the Windows broadcaster.</div>}</section>;
}

function SettingsForm({ station }: { station?: Station }) {
  const queryClient = useQueryClient();
  const update = useUpdateAdminSettings();
  const [form, setForm] = useState({ name: '', slogan: '', genre: '', logoUrl: '', streamUrl: '', chatEnabled: true, instagram: '', website: '' });
  useEffect(() => { if (station) setForm({ name: station.name, slogan: station.slogan, genre: station.genre, logoUrl: station.logoUrl || '', streamUrl: station.streamUrl, chatEnabled: station.chatEnabled, instagram: station.socialLinks?.instagram || '', website: station.socialLinks?.website || '' }); }, [station]);
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => { event.preventDefault(); update.mutate({ data: { name: form.name, slogan: form.slogan, genre: form.genre, logoUrl: form.logoUrl || null, streamUrl: form.streamUrl, chatEnabled: form.chatEnabled, socialLinks: { instagram: form.instagram, website: form.website } } }, { onSuccess: (data) => { queryClient.setQueryData(getGetStationQueryKey(), data); } }); };
  return <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" data-testid="panel-settings"><SectionLabel right="station identity">Station settings</SectionLabel><form onSubmit={submit} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Station name" value={form.name} onChange={(value) => set('name', value)} testId="input-station-name" /><Field label="Genre" value={form.genre} onChange={(value) => set('genre', value)} testId="input-station-genre" /></div><Field label="Slogan" value={form.slogan} onChange={(value) => set('slogan', value)} testId="input-station-slogan" /><Field label="Live stream URL" value={form.streamUrl} onChange={(value) => set('streamUrl', value)} placeholder="https://…" testId="input-stream-url" /><div className="grid gap-4 sm:grid-cols-2"><Field label="Logo URL" value={form.logoUrl} onChange={(value) => set('logoUrl', value)} placeholder="Optional" testId="input-logo-url" /><Field label="Website" value={form.website} onChange={(value) => set('website', value)} placeholder="https://…" testId="input-website-url" /></div><div className="flex items-center justify-between rounded-2xl bg-muted/50 px-4 py-3"><div><p className="text-sm font-semibold">Public chat</p><p className="text-xs text-muted-foreground">Let listeners join the room</p></div><button type="button" role="switch" aria-checked={form.chatEnabled} onClick={() => set('chatEnabled', !form.chatEnabled)} className={`relative h-7 w-12 rounded-full transition-colors ${form.chatEnabled ? 'bg-primary' : 'bg-muted-foreground/35'}`} data-testid="toggle-chat-enabled"><span className={`absolute top-1 size-5 rounded-full bg-background transition-transform ${form.chatEnabled ? 'translate-x-6' : 'translate-x-1'}`} /></button></div><button type="submit" disabled={update.isPending} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-settings"><Save size={15} />{update.isPending ? 'Saving…' : update.isSuccess ? 'Saved to station' : 'Save station settings'}</button>{update.isError && <p className="text-xs text-destructive">Settings could not be saved. Try again.</p>}</form></section>;
}

function NowPlayingForm({ track }: { track?: NowPlaying | null }) {
  const queryClient = useQueryClient();
  const update = useUpdateAdminNowPlaying();
  const [form, setForm] = useState({ artist: '', title: '', genre: '', artworkUrl: '' });
  useEffect(() => { if (track) setForm({ artist: track.artist, title: track.title, genre: track.genre, artworkUrl: track.artworkUrl || '' }); }, [track]);
  const submit = (event: FormEvent) => { event.preventDefault(); update.mutate({ data: { artist: form.artist, title: form.title, genre: form.genre, artworkUrl: form.artworkUrl || null } }, { onSuccess: (data) => { queryClient.setQueryData(getGetNowPlayingQueryKey(), data); } }); };
  return <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" data-testid="panel-now-playing"><SectionLabel right="on air metadata">Now playing</SectionLabel><form onSubmit={submit} className="space-y-4"><div className="flex gap-4"><TrackArtwork track={track} size="small" /><div className="flex-1 space-y-3"><Field label="Artist" value={form.artist} onChange={(value) => setForm((f) => ({ ...f, artist: value }))} testId="input-track-artist" /><Field label="Title" value={form.title} onChange={(value) => setForm((f) => ({ ...f, title: value }))} testId="input-track-title" /></div></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Genre" value={form.genre} onChange={(value) => setForm((f) => ({ ...f, genre: value }))} testId="input-track-genre" /><Field label="Artwork URL" value={form.artworkUrl} onChange={(value) => setForm((f) => ({ ...f, artworkUrl: value }))} placeholder="Optional" testId="input-track-artwork" /></div><button type="submit" disabled={update.isPending} className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground disabled:opacity-50" data-testid="button-save-now-playing"><Save size={15} />{update.isPending ? 'Updating…' : 'Update metadata'}</button></form></section>;
}

function Moderation({ messages }: { messages: ChatMessage[] }) {
  const queryClient = useQueryClient();
  const remove = useDeleteAdminChatMessage();
  const clear = useClearAdminChat();
  const deleteMessage = (id: number) => { if (window.confirm('Remove this message from the room?')) remove.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetChatQueryKey() }) }); };
  const clearAll = () => { if (window.confirm('Clear every message from the public room?')) clear.mutate(undefined, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetChatQueryKey() }) }); };
  return <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" data-testid="panel-moderation"><div className="mb-4 flex items-start justify-between gap-3"><div><SectionLabel right={`${messages.length} visible`}>Room moderation</SectionLabel></div><button onClick={clearAll} disabled={!messages.length || clear.isPending} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-40" data-testid="button-clear-chat"><Trash2 size={13} /> Clear room</button></div><div className="max-h-[310px] space-y-2 overflow-y-auto">{!messages.length ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="state-admin-chat-empty">The room is clear.</p> : messages.map((item) => <div className="flex items-center gap-3 rounded-2xl bg-muted/45 px-3 py-3" key={item.id} data-testid={`moderation-message-${item.id}`}><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-background font-mono text-[10px] text-primary">{item.nickname.slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm"><strong>{item.nickname}</strong><span className="ml-2 text-muted-foreground">{item.message}</span></p><time className="font-mono text-[9px] text-muted-foreground">{formatTime(item.createdAt)}</time></div><button onClick={() => deleteMessage(item.id)} aria-label={`Delete message from ${item.nickname}`} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`button-delete-chat-${item.id}`}><X size={15} /></button></div>)}</div></section>;
}

function Diagnostics({ data }: { data?: Diagnostics }) {
  return <section className="rounded-3xl border border-border bg-card p-5 sm:p-6" data-testid="panel-diagnostics"><SectionLabel right="live checks">Diagnostics</SectionLabel><div className="space-y-3">{!data?.checks?.length ? <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Activity size={15} /> Waiting for diagnostic checks…</div> : data.checks.map((check) => <div key={check.name} className="flex items-start gap-3"><span className={`mt-0.5 grid size-5 place-items-center rounded-full ${check.status === 'pass' ? 'bg-primary/15 text-primary' : check.status === 'warn' ? 'bg-secondary/20 text-secondary' : 'bg-destructive/15 text-destructive'}`}>{check.status === 'pass' ? <Check size={12} /> : <CircleAlert size={12} />}</span><div className="min-w-0"><p className="text-sm font-semibold">{check.name}</p><p className="text-xs text-muted-foreground">{check.detail}</p></div></div>)}</div></section>;
}

function AdminConsole() {
  const queryClient = useQueryClient();
  const station = useGetStation();
  const status = useGetStreamStatus({ query: { queryKey: getGetStreamStatusQueryKey(), refetchInterval: 5000 } });
  const nowPlaying = useGetNowPlaying({ query: { queryKey: getGetNowPlayingQueryKey(), refetchInterval: 10000 } });
  const listeners = useGetListeners({ query: { queryKey: getGetListenersQueryKey(), refetchInterval: 10000 } });
  const chat = useGetChat({ query: { queryKey: getGetChatQueryKey(), refetchInterval: 12000 } });
  const diagnostics = useGetAdminDiagnostics({ query: { queryKey: getGetAdminDiagnosticsQueryKey(), refetchInterval: 15000 } });
  const heartbeat = useBroadcasterHeartbeat();
  const sendHeartbeat = (heartbeatStatus: BroadcasterHeartbeatStatus) => heartbeat.mutate({ data: { status: heartbeatStatus } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() }); } });
  return <main className="noise min-h-[100dvh] station-grid"><div className="mx-auto max-w-[1420px] px-5 pb-12 pt-5 sm:px-8 lg:px-12"><StationHeader admin /><div className="mt-10 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Open station operations</p><h1 className="mt-2 text-4xl font-bold tracking-[-.06em] sm:text-5xl">The control room.</h1><p className="mt-2 text-muted-foreground">Watch the signal. Keep the room moving.</p></div><div className="flex items-center gap-2"><button onClick={() => sendHeartbeat('STREAMING')} className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground" data-testid="button-heartbeat-streaming"><Wifi size={14} /> Send live heartbeat</button></div></div><div className="mt-7"><div className="mb-3 flex justify-end"><a href="/downloads/USALB-Broadcaster-Windows.zip" download className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs font-semibold text-primary hover:bg-primary/15" data-testid="link-download-broadcaster"><Download size={15} /> Download Windows broadcaster</a></div><BroadcasterConnectionPanel /></div>{(station.isError || status.isError) && <div className="mt-6"><ErrorPanel title="Control room signal issue" detail="Some station telemetry could not be loaded." onRetry={() => { void station.refetch(); void status.refetch(); }} /></div>}<div className="mt-7 grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><div className="space-y-6"><SignalCard status={status.data} listeners={listeners.data?.count} /><div className="grid gap-6 md:grid-cols-2"><NowPlayingForm track={nowPlaying.data} /><Diagnostics data={diagnostics.data} /></div></div><div className="space-y-6"><SettingsForm station={station.data} /><Moderation messages={chat.data || []} /></div></div><footer className="mt-10 flex items-center justify-between border-t border-border pt-6"><Link href="/" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary" data-testid="link-preview-station"><ExternalLink size={13} /> View public station</Link><span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">USALB / open control room</span></footer></div></main>;
}

export default function Admin() {
  return <AdminConsole />;
}