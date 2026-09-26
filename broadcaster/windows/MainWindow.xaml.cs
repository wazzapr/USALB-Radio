using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Authentication;
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

    ChunkedAudioConnection? audioConnection;
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
    Uri? liveIngestUri;
    string liveKey = "";

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

    static string QuoteArg(string value) => "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    async void UpdateButton_Click(object sender, RoutedEventArgs e)
    {
        if (running)
        {
            MessageBox.Show("Stop the live broadcast before updating.", "USALB Broadcaster", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        try
        {
            UpdateButton.IsEnabled = false;
            UpdateButton.Content = "CHECKING…";

            using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/repos/wazzapr/USALB-Radio/releases/tags/broadcaster-latest");
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("USALB-Broadcaster", GetType().Assembly.GetName().Version?.ToString() ?? "1.0"));
            using var response = await http.SendAsync(request);
            response.EnsureSuccessStatusCode();

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var tag = doc.RootElement.GetProperty("tag_name").GetString() ?? "";
            var remoteVersionText = tag.StartsWith("broadcaster-v", StringComparison.OrdinalIgnoreCase)
                ? tag["broadcaster-v".Length..]
                : (doc.RootElement.TryGetProperty("name", out var name)
                    ? name.GetString()?.Replace("USALB Broadcaster ", "", StringComparison.OrdinalIgnoreCase) ?? ""
                    : "");

            if (!Version.TryParse(remoteVersionText, out var remoteVersion))
                throw new InvalidOperationException("The update server returned an invalid broadcaster version.");

            var localVersion = GetType().Assembly.GetName().Version ?? new Version(1, 0, 0);
            if (remoteVersion <= localVersion)
            {
                UpdateButton.Content = "UP TO DATE";
                StatusText.Text = $"Broadcaster v{localVersion} is up to date.";
                await Task.Delay(1500);
                UpdateButton.Content = "CHECK FOR UPDATES";
                UpdateButton.IsEnabled = true;
                return;
            }

            if (!doc.RootElement.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException("The latest broadcaster package is not available yet.");

            string? downloadUrl = null;
            foreach (var asset in assets.EnumerateArray())
            {
                var assetName = asset.GetProperty("name").GetString() ?? "";
                if (assetName.Equals("USALB-Broadcaster-Portable.zip", StringComparison.OrdinalIgnoreCase))
                {
                    downloadUrl = asset.GetProperty("browser_download_url").GetString();
                    break;
                }
            }

            if (string.IsNullOrWhiteSpace(downloadUrl))
                throw new InvalidOperationException("The latest broadcaster package is not available yet.");

            UpdateButton.Content = "DOWNLOADING…";
            StatusText.Text = $"Downloading broadcaster v{remoteVersion}…";

            var tempZip = Path.Combine(Path.GetTempPath(), $"USALB-Broadcaster-{remoteVersion}.zip");
            using (var download = await http.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                download.EnsureSuccessStatusCode();
                await using var source = await download.Content.ReadAsStreamAsync();
                await using var target = File.Create(tempZip);
                await source.CopyToAsync(target);
            }

            var exePath = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(exePath) || !File.Exists(exePath))
                throw new InvalidOperationException("Could not locate the installed broadcaster executable.");

            var installDir = Path.GetDirectoryName(exePath);
            if (string.IsNullOrWhiteSpace(installDir))
                throw new InvalidOperationException("Could not locate the broadcaster installation folder.");

            var updaterPath = Path.Combine(installDir, "USALB.Broadcaster.Updater.exe");
            if (!File.Exists(updaterPath))
                throw new InvalidOperationException("This broadcaster build does not contain the automatic updater. Install the latest broadcaster once.");

            UpdateButton.Content = "INSTALLING…";
            StatusText.Text = $"Installing broadcaster v{remoteVersion} and restarting…";

            var psi = new ProcessStartInfo
            {
                FileName = updaterPath,
                UseShellExecute = true,
                Verb = "runas",
                WorkingDirectory = installDir,
                Arguments = string.Join(" ",
                    "--pid", QuoteArg(Environment.ProcessId.ToString()),
                    "--zip", QuoteArg(tempZip),
                    "--target", QuoteArg(installDir),
                    "--exe", QuoteArg(exePath))
            };

            Process.Start(psi);
            IsClosing = true;
            Close();
        }
        catch (Exception ex)
        {
            UpdateButton.IsEnabled = true;
            UpdateButton.Content = "CHECK FOR UPDATES";
            StatusText.Text = "Update failed: " + ex.GetBaseException().Message;
            MessageBox.Show(ex.GetBaseException().Message, "USALB Broadcaster Update", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    async void LiveButton_Click(object sender, RoutedEventArgs e)
    {
        if (Interlocked.CompareExchange(ref stopping, 0, 0) != 0) return;
        if (running) { await StopAsync(); return; }
        try { await StartAsync(); }
        catch (OperationCanceledException) { if (!IsLoaded) return; await StopAsync(); }
        catch (Exception ex) { StatusText.Text = "CONNECTION ERROR: " + ex.GetBaseException().Message; LiveStateText.Text = "ERROR"; await StopAsync(); }
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
        var port = baseUri.IsDefaultPort ? "" : ":" + baseUri.Port;
        liveIngestUri = new Uri($"{baseUri.Scheme}://{baseUri.Host}{port}/api/live/ingest");
        liveKey = KeyBox.Password.Trim();

        StatusText.Text = "Connecting to USALB…";
        try
        {
            token.ThrowIfCancellationRequested();

            if (useSystemAudio)
            {
                loopback = new WasapiLoopbackCapture();
                musicBuffer = new BufferedWaveProvider(loopback.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(4), DiscardOnBufferOverflow = false, ReadFully = true };
                musicResampler = new MediaFoundationResampler(musicBuffer, new WaveFormat(SampleRate, 16, Channels)) { ResamplerQuality = 60 };
                musicSamples = musicResampler.ToSampleProvider();
                loopback.DataAvailable += (_, a) => { if (running) musicBuffer?.AddSamples(a.Buffer, 0, a.BytesRecorded); };
                loopback.StartRecording();
            }

            if (useMicrophone)
            {
                microphone = new WaveInEvent { WaveFormat = new WaveFormat(SampleRate, 16, Channels) };
                micBuffer = new BufferedWaveProvider(microphone.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(4), DiscardOnBufferOverflow = false, ReadFully = true };
                micResampler = new MediaFoundationResampler(micBuffer, new WaveFormat(SampleRate, 16, Channels)) { ResamplerQuality = 60 };
                micSamples = micResampler.ToSampleProvider();
                microphone.DataAvailable += (_, a) => { if (running) micBuffer?.AddSamples(a.Buffer, 0, a.BytesRecorded); };
                microphone.StartRecording();
            }

            audioConnection = await ConnectAudioAsync(liveIngestUri, liveKey, token);
            running = true;
            LiveButton.Content = "STOP LIVE";
            LiveStateText.Text = "LIVE";
            StatusText.Text = "LIVE · persistent source → USALB stream";
            monitorTimer.Start();
            sendTask = Task.Run(() => SendMixedAudioAsync(token), token);
        }
        catch (Exception ex)
        {
            try { if (audioConnection is not null) await audioConnection.DisposeAsync(); } catch { }
            audioConnection = null;
            throw new InvalidOperationException($"USALB connection failed: {ex.GetBaseException().Message}", ex);
        }
    }

    async Task<ChunkedAudioConnection> ConnectAudioAsync(Uri uri, string key, CancellationToken token)
    {
        var connection = await ChunkedAudioConnection.ConnectAsync(uri, key, SampleRate, Channels, token);
        return connection;
    }

    async Task<bool> ReconnectAsync(CancellationToken token)
    {
        var uri = liveIngestUri;
        if (uri is null) return false;

        while (running && !token.IsCancellationRequested)
        {
            try
            {
                await Dispatcher.InvokeAsync(() => StatusText.Text = "Reconnecting to USALB…");
                var connection = await ConnectAudioAsync(uri, liveKey, token);
                var old = audioConnection;
                audioConnection = connection;
                if (old is not null) { try { await old.DisposeAsync(); } catch { } }
                await Dispatcher.InvokeAsync(() => {
                    LiveStateText.Text = "LIVE";
                    StatusText.Text = "LIVE · reconnected automatically";
                });
                return true;
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { return false; }
            catch
            {
                try { await Task.Delay(3000, token); } catch { return false; }
            }
        }
        return false;
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
            var nextFrameAt = Stopwatch.GetTimestamp() + (long)(Stopwatch.Frequency * (FrameMs / 1000.0));
            while (running && !token.IsCancellationRequested)
            {
                if (audioConnection is null)
                {
                    if (!await ReconnectAsync(token)) break;
                }
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
                    musicEqL = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7f, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8f, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7f, treble)];
                    musicEqR = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7f, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8f, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7f, treble)];
                    micEqL = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7f, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8f, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7f, treble)];
                    micEqR = [BiQuadFilter.PeakingEQ(SampleRate, 100, 0.7f, bass), BiQuadFilter.PeakingEQ(SampleRate, 1000, 0.8f, mid), BiQuadFilter.PeakingEQ(SampleRate, 8000, 0.7f, treble)];
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
                var activeConnection = audioConnection;
                if (activeConnection is null) continue;
                try
                {
                    await activeConnection.SendAudioAsync(output, token);
                }
                catch (Exception) when (!token.IsCancellationRequested)
                {
                    if (ReferenceEquals(audioConnection, activeConnection))
                    {
                        try { await activeConnection.DisposeAsync(); } catch { }
                        audioConnection = null;
                    }
                    continue;
                }
                var now = Stopwatch.GetTimestamp();
                var remaining = nextFrameAt - now;
                if (remaining > 0)
                {
                    var delayMs = (int)(remaining * 1000 / Stopwatch.Frequency);
                    if (delayMs > 0) await Task.Delay(delayMs, token);
                    while (Stopwatch.GetTimestamp() < nextFrameAt && !token.IsCancellationRequested) Thread.SpinWait(100);
                }
                else if (remaining < -(long)(Stopwatch.Frequency * 0.5))
                {
                    nextFrameAt = Stopwatch.GetTimestamp();
                }
                nextFrameAt += (long)(Stopwatch.Frequency * (FrameMs / 1000.0));
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

    async Task StopAsync()
    {
        if (Interlocked.Exchange(ref stopping, 1) != 0) return;
        try
        {
            running = false;
            monitorTimer.Stop();
            var cts = sessionCts;
            cts?.Cancel();
            var connection = audioConnection; audioConnection = null;
            liveIngestUri = null; liveKey = "";
            if (connection is not null) { try { await connection.DisposeAsync(); } catch { } }
            try { loopback?.StopRecording(); } catch { }
            try { microphone?.StopRecording(); } catch { }
            var task = sendTask; sendTask = null;
            if (task is not null) { try { await Task.WhenAny(task, Task.Delay(1500)); } catch { } }
            try { loopback?.Dispose(); microphone?.Dispose(); musicResampler?.Dispose(); micResampler?.Dispose(); } catch { }
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
        try { audioConnection?.Abort(); } catch { }
        base.OnClosing(e);
    }

    protected override async void OnClosed(EventArgs e)
    {
        IsClosing = true; await StopAsync(); base.OnClosed(e);
    }
}


internal sealed class ChunkedAudioConnection : IAsyncDisposable
{
    readonly TcpClient client;
    readonly Stream stream;
    bool disposed;

    ChunkedAudioConnection(TcpClient client, Stream stream) { this.client = client; this.stream = stream; }

    public static async Task<ChunkedAudioConnection> ConnectAsync(Uri uri, string key, int sampleRate, int channels, CancellationToken token)
    {
        var client = new TcpClient { NoDelay = true };
        await client.ConnectAsync(uri.Host, uri.Port > 0 ? uri.Port : (uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? 443 : 80), token);
        Stream stream = client.GetStream();

        if (uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase))
        {
            var ssl = new SslStream(stream, false, (_, _, _, errors) => errors == SslPolicyErrors.None);
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
            {
                TargetHost = uri.Host,
                EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13
            }, token);
            stream = ssl;
        }

        var path = string.IsNullOrEmpty(uri.PathAndQuery) ? "/" : uri.PathAndQuery;
        var headers = new StringBuilder();
        headers.Append($"POST {path} HTTP/1.1\\r\\n");
        headers.Append($"Host: {uri.Host}{(uri.IsDefaultPort ? "" : ":" + uri.Port)}\\r\\n");
        headers.Append("Connection: keep-alive\\r\\n");
        headers.Append("Content-Type: application/octet-stream\\r\\n");
        headers.Append("Transfer-Encoding: chunked\\r\\n");
        headers.Append($"X-USALB-Sample-Rate: {sampleRate}\\r\\n");
        headers.Append($"X-USALB-Channels: {channels}\\r\\n");
        if (!string.IsNullOrWhiteSpace(key)) headers.Append($"X-Broadcaster-Token: {key}\\r\\n");
        headers.Append("\\r\\n");

        var headerBytes = Encoding.ASCII.GetBytes(headers.ToString());
        await stream.WriteAsync(headerBytes, token);
        await stream.FlushAsync(token);

        var response = await ReadHeadersAsync(stream, token);
        if (!response.StartsWith("HTTP/1.1 200", StringComparison.OrdinalIgnoreCase) &&
            !response.StartsWith("HTTP/1.0 200", StringComparison.OrdinalIgnoreCase))
        {
            await stream.DisposeAsync();
            client.Dispose();
            throw new InvalidOperationException($"USALB ingest rejected the connection: {response.Split('\\n')[0].Trim()}");
        }

        return new ChunkedAudioConnection(client, stream);
    }

    public async Task SendAudioAsync(byte[] pcm, CancellationToken token)
    {
        if (disposed) throw new ObjectDisposedException(nameof(ChunkedAudioConnection));
        const int magicLength = 4;
        var chunkLength = magicLength + pcm.Length;
        var prefix = Encoding.ASCII.GetBytes($"{chunkLength:X}\\r\\n");
        await stream.WriteAsync(prefix, token);
        await stream.WriteAsync(new byte[] { 0x50, 0x43, 0x4d, 0x31 }, token);
        await stream.WriteAsync(pcm, token);
        await stream.WriteAsync(new byte[] { 13, 10 }, token);
        await stream.FlushAsync(token);
    }

    public void Abort()
    {
        try { client.Client.Shutdown(SocketShutdown.Both); } catch { }
        try { client.Close(); } catch { }
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        try { await stream.WriteAsync(Encoding.ASCII.GetBytes("0\\r\\n\\r\\n")); } catch { }
        try { await stream.FlushAsync(); } catch { }
        try { await stream.DisposeAsync(); } catch { }
        try { client.Dispose(); } catch { }
    }

    static async Task<string> ReadHeadersAsync(Stream stream, CancellationToken token)
    {
        var buffer = new byte[1];
        using var data = new MemoryStream();
        var state = 0;
        while (data.Length < 16384)
        {
            var count = await stream.ReadAsync(buffer, token);
            if (count == 0) throw new IOException("USALB ingest server closed the connection during handshake.");
            data.WriteByte(buffer[0]);
            state = state switch
            {
                0 when buffer[0] == 13 => 1,
                1 when buffer[0] == 10 => 2,
                2 when buffer[0] == 13 => 3,
                3 when buffer[0] == 10 => 4,
                _ => 0
            };
            if (state == 4) return Encoding.ASCII.GetString(data.ToArray());
        }
        throw new IOException("USALB ingest response headers are too large.");
    }
}
