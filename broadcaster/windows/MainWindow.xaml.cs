using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using NAudio.Wave;
using NAudio.Dsp;

namespace USALB.Broadcaster;

public partial class MainWindow : Window
{
    const int SampleRate = 44100, Channels = 2, FrameMs = 20;
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(5) };
    readonly DispatcherTimer monitorTimer = new() { Interval = TimeSpan.FromSeconds(3) };

    ClientWebSocket? socket;
    WasapiLoopbackCapture? loopback;
    WaveInEvent? microphone;
    BufferedWaveProvider? musicBuffer;
    BufferedWaveProvider? micBuffer;
    MediaFoundationResampler? musicResampler;
    MediaFoundationResampler? micResampler;
    ISampleProvider? musicSamples;
    ISampleProvider? micSamples;
    CancellationTokenSource? sessionCts;
    Task? sendTask;
    volatile bool running;
    volatile int musicGainPercent = 100;
    volatile int micGainPercent = 100;
    volatile int masterGainPercent = 100;
    volatile float bassGainDb;
    volatile float midGainDb;
    volatile float trebleGainDb;
    volatile bool limiterEnabled = true;
    int stopping;
    bool IsClosing { get; set; }

    public MainWindow()
    {
        InitializeComponent();
        monitorTimer.Tick += async (_, _) => await RefreshMonitorAsync();
        Loaded += async (_, _) => await RefreshMonitorAsync();
        MusicVolume.ValueChanged += (_, _) => musicGainPercent = (int)Math.Round(MusicVolume.Value);
        MicVolume.ValueChanged += (_, _) => micGainPercent = (int)Math.Round(MicVolume.Value);
        MasterVolume.ValueChanged += (_, _) => masterGainPercent = (int)Math.Round(MasterVolume.Value);
        BassGain.ValueChanged += (_, _) => bassGainDb = (float)BassGain.Value;
        MidGain.ValueChanged += (_, _) => midGainDb = (float)MidGain.Value;
        TrebleGain.ValueChanged += (_, _) => trebleGainDb = (float)TrebleGain.Value;
        LimiterBox.Checked += (_, _) => limiterEnabled = true;
        LimiterBox.Unchecked += (_, _) => limiterEnabled = false;
        Closed += (_, _) => http.Dispose();
    }

    async void LiveButton_Click(object sender, RoutedEventArgs e)
    {
        if (Interlocked.CompareExchange(ref stopping, 0, 0) != 0) return;
        if (running) { await StopAsync(); return; }
        try { await StartAsync(); }
        catch (OperationCanceledException) { if (!IsLoaded) return; await StopAsync(); }
        catch (Exception ex) { StatusText.Text = "Error: " + ex.Message; await StopAsync(); }
    }

    async Task StartAsync()
    {
        var useSystemAudio = SystemAudioBox.IsChecked == true;
        var useMicrophone = MicBox.IsChecked == true;
        if (!useSystemAudio && !useMicrophone) throw new InvalidOperationException("Select at least one audio input.");

        var server = ServerBox.Text.Trim().TrimEnd('/');
        if (!Uri.TryCreate(server, UriKind.Absolute, out var baseUri) ||
            (baseUri.Scheme != Uri.UriSchemeHttps && baseUri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException("Enter a valid HTTP or HTTPS USALB server URL.");

        await StopAsync();

        var cts = new CancellationTokenSource();
        sessionCts = cts;
        var token = cts.Token;
        var scheme = baseUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        var port = baseUri.IsDefaultPort ? "" : ":" + baseUri.Port;
        var wsUri = new Uri($"{scheme}://{baseUri.Host}{port}/api/live/ws?role=broadcaster");
        var ws = new ClientWebSocket();
        var key = KeyBox.Password.Trim();
        if (!string.IsNullOrWhiteSpace(key)) ws.Options.SetRequestHeader("x-broadcaster-token", key);

        StatusText.Text = "Connecting to USALB…";
        try
        {
            await ws.ConnectAsync(wsUri, token);
            token.ThrowIfCancellationRequested();
            socket = ws;

            if (useSystemAudio)
            {
                loopback = new WasapiLoopbackCapture();
                musicBuffer = new BufferedWaveProvider(loopback.WaveFormat) { DiscardOnBufferOverflow = true, ReadFully = true };
                musicResampler = new MediaFoundationResampler(musicBuffer, new WaveFormat(SampleRate, 16, Channels)) { ResamplerQuality = 60 };
                musicSamples = musicResampler.ToSampleProvider();
                loopback.DataAvailable += (_, a) => { if (running) musicBuffer?.AddSamples(a.Buffer, 0, a.BytesRecorded); };
                loopback.StartRecording();
            }

            if (useMicrophone)
            {
                microphone = new WaveInEvent { WaveFormat = new WaveFormat(SampleRate, 16, Channels) };
                micBuffer = new BufferedWaveProvider(microphone.WaveFormat) { DiscardOnBufferOverflow = true, ReadFully = true };
                micResampler = new MediaFoundationResampler(micBuffer, new WaveFormat(SampleRate, 16, Channels)) { ResamplerQuality = 60 };
                micSamples = micResampler.ToSampleProvider();
                microphone.DataAvailable += (_, a) => { if (running) micBuffer?.AddSamples(a.Buffer, 0, a.BytesRecorded); };
                microphone.StartRecording();
            }

            await SendJsonAsync("{\"type\":\"start\",\"mimeType\":\"audio/pcm;rate=44100;channels=2\",\"codec\":\"pcm\",\"pcmSampleRate\":44100,\"pcmChannels\":2}", token);
            running = true;
            LiveButton.Content = "STOP LIVE";
            LiveStateText.Text = "LIVE";
            StatusText.Text = "LIVE · system audio → USALB server";
            monitorTimer.Start();
            sendTask = Task.Run(() => SendMixedAudioAsync(token), token);
        }
        catch
        {
            try { ws.Abort(); } catch { }
            ws.Dispose();
            throw;
        }
    }

    async Task SendMixedAudioAsync(CancellationToken token)
    {
        var frameSamples = SampleRate * Channels * FrameMs / 1000;
        var output = new byte[frameSamples * 2];
        var music = new float[frameSamples];
        var mic = new float[frameSamples];
        BiQuadFilter[]? musicEqL = null, musicEqR = null, micEqL = null, micEqR = null;
        float lastBass = float.NaN, lastMid = float.NaN, lastTreble = float.NaN;
        try
        {
            while (running && socket?.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                Array.Clear(music); Array.Clear(mic);
                musicSamples?.Read(music, 0, music.Length);
                micSamples?.Read(mic, 0, mic.Length);
                var currentMusicGain = musicGainPercent / 100.0;
                var currentMicGain = micGainPercent / 100.0;
                var currentMasterGain = masterGainPercent / 100.0;
                var bass = bassGainDb;
                var mid = midGainDb;
                var treble = trebleGainDb;

                if (musicEqL is null || bass != lastBass || mid != lastMid || treble != lastTreble)
                {
                    musicEqL = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7, treble)];
                    musicEqR = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7, treble)];
                    micEqL = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7, treble)];
                    micEqR = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7, treble)];
                    lastBass = bass;
                    lastMid = mid;
                    lastTreble = treble;
                }

                for (var i = 0; i < frameSamples; i += 2)
                {
                    var ml = ApplyEq(musicEqL, music[i]);
                    var mr = ApplyEq(musicEqR, music[i + 1]);
                    var il = ApplyEq(micEqL, mic[i]);
                    var ir = ApplyEq(micEqR, mic[i + 1]);

                    var left = (float)((ml * currentMusicGain) + (il * currentMicGain)) * (float)currentMasterGain;
                    var right = (float)((mr * currentMusicGain) + (ir * currentMicGain)) * (float)currentMasterGain;

                    if (limiterEnabled)
                    {
                        left = Math.Clamp(left, -0.98f, 0.98f);
                        right = Math.Clamp(right, -0.98f, 0.98f);
                    }
                    else
                    {
                        left = Math.Clamp(left, -1f, 1f);
                        right = Math.Clamp(right, -1f, 1f);
                    }

                    var sl = (short)Math.Round(left * short.MaxValue);
                    var sr = (short)Math.Round(right * short.MaxValue);
                    output[i * 2] = (byte)(sl & 255); output[i * 2 + 1] = (byte)(sl >> 8);
                    output[(i + 1) * 2] = (byte)(sr & 255); output[(i + 1) * 2 + 1] = (byte)(sr >> 8);
                }
                var packet = new byte[4 + output.Length];
                packet[0] = 0x50; packet[1] = 0x43; packet[2] = 0x4d; packet[3] = 0x31;
                Buffer.BlockCopy(output, 0, packet, 4, output.Length);
                await socket.SendAsync(packet, WebSocketMessageType.Binary, true, token);
                await Task.Delay(FrameMs, token);
            }
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (Exception ex)
        {
            if (!IsClosing) await Dispatcher.InvokeAsync(() => { if (running) StatusText.Text = "Broadcast error: " + ex.Message; });
        }
    }

    static float ApplyEq(BiQuadFilter[]? filters, float sample)
    {
        if (filters is null) return sample;
        var value = sample;
        foreach (var filter in filters) value = filter.Transform(value);
        return value;
    }

    async Task SendJsonAsync(string json, CancellationToken token)
    {
        var ws = socket;
        if (ws?.State != WebSocketState.Open) return;
        await ws.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, token);
    }

    async Task StopAsync()
    {
        if (Interlocked.Exchange(ref stopping, 1) != 0) return;
        try
        {
            running = false;
            monitorTimer.Stop();
            var cts = sessionCts;
            cts?.Cancel();
            var ws = socket; socket = null;
            try { ws?.Abort(); } catch { }
            try { loopback?.StopRecording(); } catch { }
            try { microphone?.StopRecording(); } catch { }
            var task = sendTask; sendTask = null;
            if (task is not null) { try { await Task.WhenAny(task, Task.Delay(1500)); } catch { } }
            try { loopback?.Dispose(); microphone?.Dispose(); musicResampler?.Dispose(); micResampler?.Dispose(); } catch { }
            try { ws?.Dispose(); } catch { }
            try { cts?.Dispose(); } catch { }
            loopback = null; microphone = null; musicResampler = null; micResampler = null;
            musicBuffer = null; micBuffer = null; musicSamples = null; micSamples = null; sessionCts = null;
            if (IsLoaded && !IsClosing) { LiveButton.Content = "GO LIVE"; LiveStateText.Text = "OFFLINE"; StatusText.Text = "Ready — opening this app does not stream."; }
        }
        finally { Interlocked.Exchange(ref stopping, 0); }
    }

    async Task RefreshMonitorAsync()
    {
        if (IsClosing) return;
        var server = ServerBox.Text.Trim().TrimEnd('/');
        if (!Uri.TryCreate(server, UriKind.Absolute, out var baseUri)) return;
        try
        {
            using var response = await http.GetAsync(new Uri(baseUri, "/api/stream-status"));
            if (!response.IsSuccessStatusCode) { FooterText.Text = "Server monitor unavailable"; return; }
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = doc.RootElement;
            var state = root.GetProperty("state").GetString() ?? "OFFLINE";
            var listeners = root.GetProperty("listenerCount").GetInt32();
            ListenerCountText.Text = listeners.ToString();
            ConnectionText.Text = state;
            LiveStateText.Text = root.GetProperty("isLive").GetBoolean() ? "LIVE" : state;
            BitrateText.Text = root.TryGetProperty("bitrateKbps", out var br) && br.ValueKind != JsonValueKind.Null ? br.ToString() + " kbps" : "—";
            SampleRateText.Text = root.TryGetProperty("sampleRate", out var sr) && sr.ValueKind != JsonValueKind.Null ? sr.ToString() + " Hz" : "—";
            if (root.TryGetProperty("currentTrack", out var track) && track.ValueKind == JsonValueKind.Object)
            {
                ArtistText.Text = track.GetProperty("artist").GetString() ?? "—";
                TitleText.Text = track.GetProperty("title").GetString() ?? "—";
            }
            FooterText.Text = "Control Room · monitoring every 3 seconds";
        }
        catch
        {
            ConnectionText.Text = "SERVER UNREACHABLE";
            FooterText.Text = "Could not reach USALB server";
        }
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        IsClosing = true; running = false; monitorTimer.Stop();
        try { sessionCts?.Cancel(); } catch { }
        try { socket?.Abort(); } catch { }
        base.OnClosing(e);
    }

    protected override async void OnClosed(EventArgs e)
    {
        IsClosing = true; await StopAsync(); base.OnClosed(e);
    }
}
