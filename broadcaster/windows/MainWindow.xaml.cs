using System.Diagnostics;
using System.IO;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Authentication;
using System.Reflection;
using System.Windows;
using System.Windows.Threading;
using NAudio.Wave;
using NAudio.Dsp;

namespace USALB.Broadcaster;

public partial class MainWindow : Window
{
    const int SampleRate = 44100, Channels = 2, FrameMs = 20;
    const double ForwardAudioCushionSeconds = 1.5;
    const double WebSocketRotationSeconds = 270;
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(5) };
    readonly DispatcherTimer monitorTimer = new() { Interval = TimeSpan.FromSeconds(3) };

    PcmWebSocketConnection? audioConnection;
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
    readonly ConcurrentQueue<string> diagnosticEvents = new();
    long framesSent;
    long bytesSent;
    int reconnectCount;
    DateTime liveStartedAt;
    DateTime audioConnectionConnectedAt;
    DateTime lastAudioAt;
    string lastConnectionState = "OFFLINE";
    string lastAudioState = "IDLE";
    string lastError = "None";
    Uri? liveIngestUri;
    string liveKey = "";
    const string PairingFileName = "broadcaster-credentials.json";
    string pairedDeviceId = "";
    string CredentialsPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "USALB", PairingFileName);


    public MainWindow()
    {
        InitializeComponent();
        VersionText.Text = $"v{GetType().Assembly.GetName().Version ?? new Version(0, 0, 0)}";
        monitorTimer.Tick += async (_, _) => await RefreshMonitorAsync();
        Loaded += async (_, _) => { await EnsureCredentialsAsync(); await RefreshMonitorAsync(); };
        AddDiagnostic("Broadcaster UI started.");
        AddDiagnostic($"Version: {GetType().Assembly.GetName().Version}");
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

    void AddDiagnostic(string message)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}";
        diagnosticEvents.Enqueue(line);
        while (diagnosticEvents.Count > 500) diagnosticEvents.TryDequeue(out _);
        lastError = message.Contains("error", StringComparison.OrdinalIgnoreCase) ||
                    message.Contains("failed", StringComparison.OrdinalIgnoreCase) ||
                    message.Contains("closed", StringComparison.OrdinalIgnoreCase) ||
                    message.Contains("disconnect", StringComparison.OrdinalIgnoreCase)
                    ? message : lastError;
    }

    string GetDiagnosticLog() => string.Join(Environment.NewLine, diagnosticEvents);

    DiagnosticsSnapshot GetDiagnosticsSnapshot()
    {
        var uptime = liveStartedAt == default || !running
            ? "—"
            : (DateTime.Now - liveStartedAt).ToString(@"hh\:mm\:ss");
        var connection = running
            ? (audioConnection is null ? "RECONNECTING" : lastConnectionState)
            : "OFFLINE";
        var audioFlow = running
            ? ((DateTime.Now - lastAudioAt).TotalSeconds < 2 ? "HEALTHY" : "NO RECENT AUDIO")
            : "IDLE";
        return new DiagnosticsSnapshot(connection, audioFlow, reconnectCount, uptime, Interlocked.Read(ref framesSent), Interlocked.Read(ref bytesSent));
    }

    void DiagnosticsButton_Click(object sender, RoutedEventArgs e)
    {
        var window = new DiagnosticsWindow(GetDiagnosticLog, GetDiagnosticsSnapshot) { Owner = this };
        window.Show();
    }

    static string QuoteArg(string value) => "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    sealed class SavedCredentials
    {
        public string DeviceId { get; set; } = "";
        public string PublishToken { get; set; } = "";
    }

    async Task EnsureCredentialsAsync()
    {
        try
        {
            if (File.Exists(CredentialsPath))
            {
                var saved = JsonSerializer.Deserialize<SavedCredentials>(await File.ReadAllTextAsync(CredentialsPath));
                if (saved is not null && !string.IsNullOrWhiteSpace(saved.PublishToken))
                {
                    pairedDeviceId = saved.DeviceId ?? "";
                    KeyBox.Password = saved.PublishToken;
                    KeyBox.IsEnabled = false;
                    PairingText.Text = "CONNECTED · broadcaster credentials saved on this PC.";
                    return;
                }
            }

            var server = ServerBox.Text.Trim().TrimEnd('/');
            if (!Uri.TryCreate(server, UriKind.Absolute, out var baseUri) ||
                (baseUri.Scheme != Uri.UriSchemeHttps && baseUri.Scheme != Uri.UriSchemeHttp))
                throw new InvalidOperationException("Enter a valid HTTP or HTTPS USALB server URL.");

            pairedDeviceId = string.IsNullOrWhiteSpace(pairedDeviceId) ? Guid.NewGuid().ToString() : pairedDeviceId;
            using var response = await http.PostAsJsonAsync(
                $"{baseUri}/api/broadcaster/enroll",
                new { deviceId = pairedDeviceId, deviceName = $"USALB Broadcaster · {Environment.MachineName}" });
            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Automatic broadcaster enrollment failed ({(int)response.StatusCode}): {body}");

            using var doc = JsonDocument.Parse(body);
            var token = doc.RootElement.GetProperty("publishToken").GetString();
            var deviceId = doc.RootElement.GetProperty("deviceId").GetString();
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(deviceId))
                throw new InvalidOperationException("USALB server did not return broadcaster credentials.");

            Directory.CreateDirectory(Path.GetDirectoryName(CredentialsPath)!);
            await File.WriteAllTextAsync(CredentialsPath, JsonSerializer.Serialize(new SavedCredentials
            {
                DeviceId = deviceId,
                PublishToken = token
            }));

            pairedDeviceId = deviceId;
            KeyBox.Password = token;
            KeyBox.IsEnabled = false;
            PairingText.Text = "CONNECTED · broadcaster credentials created automatically.";
            StatusText.Text = "Broadcaster connected to USALB. Press GO LIVE.";
        }
        catch (Exception ex)
        {
            PairingText.Text = "SERVER CONNECTION · " + ex.GetBaseException().Message;
            StatusText.Text = "USALB server is not ready yet. GO LIVE will retry automatically.";
        }
    }

    void ClearPairingButton_Click(object sender, RoutedEventArgs e)
    {
        if (running)
        {
            MessageBox.Show("Stop the live broadcast before clearing credentials.", "USALB Broadcaster", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        try { if (File.Exists(CredentialsPath)) File.Delete(CredentialsPath); } catch { }
        pairedDeviceId = "";
        liveKey = "";
        KeyBox.Clear();
        PairingText.Text = "Credentials cleared. They will be created automatically when needed.";
        StatusText.Text = "Ready — GO LIVE will automatically connect to USALB.";
    }

    static string ParseReleaseVersion(string tag, string releaseName)
    {
        var tagMatch = System.Text.RegularExpressions.Regex.Match(tag ?? "", @"\d+\.\d+\.\d+(?:\.\d+)?");
        if (tagMatch.Success) return tagMatch.Value;

        var nameMatch = System.Text.RegularExpressions.Regex.Match(releaseName ?? "", @"\d+\.\d+\.\d+(?:\.\d+)?");
        if (nameMatch.Success) return nameMatch.Value;

        return "";
    }

    static string GetLocalBuildId() {
        return Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(x => string.Equals(x.Key, "BroadcasterBuild", StringComparison.OrdinalIgnoreCase))?.Value?.Trim() ?? "";
    }

    static string GetRemoteBuildId(JsonElement release) {
        var body = release.TryGetProperty("body", out var bodyElement) ? bodyElement.GetString() ?? "" : "";
        foreach (var line in body.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)) {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("Build:", StringComparison.OrdinalIgnoreCase)) return trimmed.Substring("Build:".Length).Trim();
        }
        return "";
    }

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
            var releaseName = doc.RootElement.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "";
            var remoteVersionText = ParseReleaseVersion(tag, releaseName);

            if (!Version.TryParse(remoteVersionText, out var remoteVersion))
                throw new InvalidOperationException("The update server returned an invalid broadcaster version.");

            var localVersion = GetType().Assembly.GetName().Version ?? new Version(1, 0, 0);
            var localBuild = GetLocalBuildId();
            var remoteBuild = GetRemoteBuildId(doc.RootElement);
            var updateAvailable = remoteVersion > localVersion ||
                                  (remoteVersion == localVersion &&
                                   !string.IsNullOrWhiteSpace(remoteBuild) &&
                                   !string.Equals(localBuild, remoteBuild, StringComparison.OrdinalIgnoreCase));

            if (!updateAvailable)
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
            StatusText.Text = string.IsNullOrWhiteSpace(remoteBuild) ? $"Downloading broadcaster v{remoteVersion}…" : $"Downloading broadcaster v{remoteVersion} · build {remoteBuild[..Math.Min(7, remoteBuild.Length)]}…";

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

    async void WhatsNewButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            WhatsNewButton.IsEnabled = false;
            WhatsNewButton.Content = "LOADING…";

            using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/repos/wazzapr/USALB-Radio/releases/tags/broadcaster-latest");
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("USALB-Broadcaster", GetType().Assembly.GetName().Version?.ToString() ?? "1.0"));
            using var response = await http.SendAsync(request);
            response.EnsureSuccessStatusCode();

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var tag = doc.RootElement.GetProperty("tag_name").GetString() ?? "";
            var releaseName = doc.RootElement.TryGetProperty("name", out var name) ? name.GetString() ?? "USALB Broadcaster" : "USALB Broadcaster";
            var body = doc.RootElement.TryGetProperty("body", out var bodyElement) ? bodyElement.GetString() ?? "" : "";
            var remoteVersionText = ParseReleaseVersion(tag, releaseName);
            var localVersion = GetType().Assembly.GetName().Version ?? new Version(0, 0, 0);

            if (string.IsNullOrWhiteSpace(body))
                body = "No release notes were published for this build.";

            var state = Version.TryParse(remoteVersionText, out var remoteVersion) && remoteVersion > localVersion
                ? $"UPDATE AVAILABLE · v{remoteVersion}"
                : $"YOU ARE CURRENT · v{localVersion}";

            MessageBox.Show(
                $"Current version: v{localVersion}\nLatest version: v{remoteVersionText}\n\n{state}\n\n{body}",
                "USALB Broadcaster · What's New",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Could not load the latest release notes.\n\n" + ex.GetBaseException().Message,
                "USALB Broadcaster · What's New",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
        finally
        {
            WhatsNewButton.Content = "WHAT'S NEW";
            WhatsNewButton.IsEnabled = true;
        }
    }

    async void LiveButton_Click(object sender, RoutedEventArgs e)
    {
        if (Interlocked.CompareExchange(ref stopping, 0, 0) != 0) return;
        if (running) { await StopAsync(); return; }
        try { await StartAsync(); }
        catch (OperationCanceledException) { if (!IsLoaded) return; await StopAsync(); }
        catch (Exception ex) { var message = "CONNECTION ERROR: " + ex.GetBaseException().Message; try { await StopAsync(); } catch { } StatusText.Text = message; LiveStateText.Text = "ERROR"; }
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
        if (string.IsNullOrWhiteSpace(KeyBox.Password))
            await EnsureCredentialsAsync();
        liveKey = KeyBox.Password.Trim();
        var wsScheme = baseUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        liveIngestUri = new Uri($"{wsScheme}://{baseUri.Host}{port}/api/live/ws?role=broadcaster&key={Uri.EscapeDataString(liveKey)}");
        if (string.IsNullOrWhiteSpace(liveKey))
            throw new InvalidOperationException("USALB could not create broadcaster credentials. Check the server connection.");

        AddDiagnostic($"GO LIVE requested. Inputs: systemAudio={useSystemAudio}, microphone={useMicrophone}.");
        StatusText.Text = "Connecting to USALB…";
        lastConnectionState = "CONNECTING";
        try
        {
            token.ThrowIfCancellationRequested();

            if (useSystemAudio)
            {
                loopback = new WasapiLoopbackCapture();
                musicBuffer = new BufferedWaveProvider(loopback.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(15), DiscardOnBufferOverflow = false, ReadFully = true };
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

            AddDiagnostic($"Opening broadcaster WebSocket: {liveIngestUri}");
            audioConnection = await ConnectAudioAsync(liveIngestUri, liveKey, token);
            running = true;
            liveStartedAt = DateTime.Now;
            audioConnectionConnectedAt = DateTime.Now;
            framesSent = 0;
            bytesSent = 0;
            lastAudioAt = DateTime.Now;
            lastConnectionState = "CONNECTED";
            lastAudioState = "FLOWING";
            AddDiagnostic($"Broadcaster WebSocket connected and server returned READY. Forward audio cushion target: {ForwardAudioCushionSeconds:0.0}s.");
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
            AddDiagnostic("GO LIVE failed: " + ex.GetBaseException().Message);
            lastConnectionState = "ERROR";
            throw new InvalidOperationException($"USALB connection failed: {ex.GetBaseException().Message}", ex);
        }
    }

    async Task<PcmWebSocketConnection> ConnectAudioAsync(Uri uri, string key, CancellationToken token)
    {
        return await PcmWebSocketConnection.ConnectAsync(uri, key, SampleRate, Channels, token,
            message => AddDiagnostic(message));
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
                AddDiagnostic($"Reconnect attempt started. Buffered audio: music={GetBufferedAudioSeconds(musicBuffer):0.00}s, mic={GetBufferedAudioSeconds(micBuffer):0.00}s.");
                var connection = await ConnectAudioAsync(uri, liveKey, token);
                var old = audioConnection;
                audioConnection = connection;
                audioConnectionConnectedAt = DateTime.Now;
                if (old is not null) { try { await old.DisposeAsync(); } catch { } }
                reconnectCount++;
                lastConnectionState = "CONNECTED";
                lastAudioAt = DateTime.Now;
                AddDiagnostic($"Reconnect successful. Reconnect count: {reconnectCount}. Waiting for forward audio cushion before resuming PCM.");
                await WaitForForwardAudioCushionAsync(token);
                await Dispatcher.InvokeAsync(() => {
                    LiveStateText.Text = "LIVE";
                    StatusText.Text = "LIVE · reconnected automatically";
                });
                return true;
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { return false; }
            catch (Exception ex)
            {
                var message = ex.GetBaseException().Message;
                lastConnectionState = "RECONNECTING";
                AddDiagnostic("Reconnect failed: " + message);
                try { await Dispatcher.InvokeAsync(() => { if (running) StatusText.Text = "Connection lost · " + message; }); } catch { }
                try { await Task.Delay(1000, token); } catch { return false; }
            }
        }
        return false;
    }

    static double GetBufferedAudioSeconds(BufferedWaveProvider? buffer)
    {
        if (buffer is null || buffer.WaveFormat.AverageBytesPerSecond <= 0) return 0;
        return buffer.BufferedBytes / (double)buffer.WaveFormat.AverageBytesPerSecond;
    }

    async Task WaitForForwardAudioCushionAsync(CancellationToken token)
    {
        if (musicBuffer is null && micBuffer is null) return;

        var logged = false;
        while (running && !token.IsCancellationRequested)
        {
            var musicSeconds = GetBufferedAudioSeconds(musicBuffer);
            var micSeconds = GetBufferedAudioSeconds(micBuffer);
            var availableSeconds = Math.Max(musicSeconds, micSeconds);

            if (availableSeconds >= ForwardAudioCushionSeconds)
            {
                if (logged)
                    AddDiagnostic($"Forward audio cushion ready: music={musicSeconds:0.00}s, mic={micSeconds:0.00}s.");
                return;
            }

            if (!logged)
            {
                AddDiagnostic($"Building forward audio cushion: music={musicSeconds:0.00}s, mic={micSeconds:0.00}s, target={ForwardAudioCushionSeconds:0.0}s.");
                logged = true;
            }

            await Task.Delay(50, token);
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
        Task<PcmWebSocketConnection>? rotationTask = null;
        PcmWebSocketConnection? rotationCandidate = null;
        DateTime nextRotationAttemptAt = DateTime.MinValue;
        try
        {
            var nextFrameAt = Stopwatch.GetTimestamp() + (long)(Stopwatch.Frequency * (FrameMs / 1000.0));
            await WaitForForwardAudioCushionAsync(token);
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
                // Start the replacement connection in the background. The current
                // connection keeps carrying PCM while the new WebSocket performs its
                // handshake, so connection setup itself cannot create a listener gap.
                if (audioConnection is not null &&
                    rotationTask is null &&
                    rotationCandidate is null &&
                    (DateTime.Now - audioConnectionConnectedAt).TotalSeconds >= WebSocketRotationSeconds &&
                    DateTime.Now >= nextRotationAttemptAt)
                {
                    AddDiagnostic("Planned WebSocket rotation started in background before the 5-minute connection limit.");
                    rotationTask = ConnectAudioAsync(liveIngestUri!, liveKey, token);
                }

                if (rotationTask is not null && rotationTask.IsCompleted)
                {
                    try
                    {
                        rotationCandidate = await rotationTask;
                        rotationTask = null;
                        AddDiagnostic("Planned WebSocket replacement is READY; next PCM frame will switch the live source.");
                    }
                    catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
                    catch (Exception ex)
                    {
                        rotationTask = null;
                        nextRotationAttemptAt = DateTime.Now.AddSeconds(30);
                        AddDiagnostic("Planned WebSocket rotation failed; keeping current connection: " + ex.GetBaseException().Message);
                    }
                }

                var primaryConnection = audioConnection;
                if (primaryConnection is null) continue;
                var candidateConnection = rotationCandidate;

                try
                {
                    // Once the replacement is READY, mirror each live PCM frame to
                    // both sockets. The old source remains authoritative until the
                    // replacement has received the same live frame, so the server
                    // never has to wait for the replacement to start producing audio.
                    await primaryConnection.SendAudioAsync(output, token);

                    if (candidateConnection is not null && ReferenceEquals(candidateConnection, rotationCandidate))
                    {
                        try
                        {
                            await candidateConnection.SendAudioAsync(output, token);
                            // The server commits the replacement on this mirrored PCM
                            // frame and sends the acknowledgement independently. Do not
                            // wait for that control message inside the 20 ms audio loop:
                            // waiting here pauses the old socket too and creates an audible
                            // gap. Both sockets keep receiving live PCM while the server
                            // owns the exact handoff boundary.
                        }
                        catch (Exception ex) when (!token.IsCancellationRequested)
                        {
                            try { await candidateConnection.DisposeAsync(); } catch { }
                            if (ReferenceEquals(rotationCandidate, candidateConnection))
                                rotationCandidate = null;
                            nextRotationAttemptAt = DateTime.Now.AddSeconds(30);
                            AddDiagnostic("Planned replacement could not accept mirrored PCM; continuing on the existing WebSocket: " + ex.GetBaseException().Message);
                            candidateConnection = null;
                        }
                    }

                    if (candidateConnection is not null && ReferenceEquals(candidateConnection, rotationCandidate))
                    {
                        var previous = audioConnection;
                        audioConnection = candidateConnection;
                        rotationCandidate = null;
                        audioConnectionConnectedAt = DateTime.Now;
                        reconnectCount++;
                        lastConnectionState = "CONNECTED";
                        AddDiagnostic("Planned WebSocket handoff committed after mirrored live PCM; old and new sources overlapped for the handoff.");

                        // The server now owns the old-socket close. Do not abort the
                        // previous transport locally: it must remain open after the
                        // server has promoted the replacement so the handoff cannot
                        // be disturbed by a client-side close race.
                        if (previous is not null && !ReferenceEquals(previous, candidateConnection))
                        {
                            AddDiagnostic("Replacement is live; leaving old WebSocket open for server-side handoff close.");
                        }
                    }

                    Interlocked.Increment(ref framesSent);
                    Interlocked.Add(ref bytesSent, output.Length);
                    lastAudioAt = DateTime.Now;
                    lastAudioState = "FLOWING";
                }
                catch (Exception ex) when (!token.IsCancellationRequested)
                {
                    if (ReferenceEquals(audioConnection, primaryConnection))
                    {
                        try { await primaryConnection.DisposeAsync(); } catch { }
                        audioConnection = null;
                        lastConnectionState = "RECONNECTING";
                        lastAudioState = "WAITING";

                        if (rotationCandidate is not null)
                        {
                            try { await rotationCandidate.DisposeAsync(); } catch { }
                            rotationCandidate = null;
                        }

                        nextRotationAttemptAt = DateTime.Now.AddSeconds(30);
                        AddDiagnostic("Broadcaster WebSocket disconnected while sending audio: " + ex.GetBaseException().Message);
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
            AddDiagnostic("Broadcast loop error: " + ex.GetBaseException().Message);
            lastConnectionState = "ERROR";
            lastAudioState = "ERROR";
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
            if (running) AddDiagnostic("Broadcast stopping.");
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
            lastConnectionState = "OFFLINE";
            lastAudioState = "IDLE";
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
            lastConnectionState = state;
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
            if (running && state != "OFFLINE") AddDiagnostic($"Server health: {state}, listeners={listeners}, bitrate={BitrateText.Text}, sampleRate={SampleRateText.Text}");
        }
        catch (Exception ex)
        {
            ConnectionText.Text = "SERVER UNREACHABLE";
            FooterText.Text = "Could not reach USALB server";
            if (running) AddDiagnostic("Server monitor error: " + ex.GetBaseException().Message);
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


internal sealed class PcmWebSocketConnection : IAsyncDisposable
{
    readonly ClientWebSocket socket;
    readonly TaskCompletionSource<Exception?> disconnectSignal =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly TaskCompletionSource<bool> handoffCommittedSignal =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    bool disposed;

    readonly Action<string> diagnostic;
    PcmWebSocketConnection(ClientWebSocket socket, Action<string> diagnostic)
    {
        this.socket = socket;
        this.diagnostic = diagnostic;
    }

    public static async Task<PcmWebSocketConnection> ConnectAsync(Uri uri, string key, int sampleRate, int channels, CancellationToken token, Action<string> diagnostic)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(12));
        var ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);

        try
        {
            diagnostic($"WebSocket TCP/HTTP upgrade connecting to {uri.Host}{uri.AbsolutePath}.");
            await ws.ConnectAsync(uri, timeoutCts.Token);
            diagnostic("WebSocket transport connected.");

            var start = JsonSerializer.Serialize(new
            {
                type = "start",
                mimeType = "audio/pcm",
                codec = "pcm",
                pcmSampleRate = sampleRate,
                pcmChannels = channels
            });
            await ws.SendAsync(Encoding.UTF8.GetBytes(start), WebSocketMessageType.Text, true, timeoutCts.Token);

            var buffer = new byte[8192];
            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), timeoutCts.Token);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                var reason = result.CloseStatusDescription ?? "No close reason supplied.";
                diagnostic($"Server closed broadcaster during handshake. code={result.CloseStatus}, reason={reason}");
                throw new IOException($"USALB live relay closed the broadcaster ({result.CloseStatus}): {reason}");
            }

            var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
            if (!message.Contains("\"type\":\"ready\"", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"USALB live relay rejected the broadcaster: {message}");

            diagnostic("Server READY received; PCM audio can start.");
            var connection = new PcmWebSocketConnection(ws, diagnostic);
            connection.StartReceiveMonitor();
            return connection;
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        {
            diagnostic("WebSocket connect timeout after 12 seconds.");
            ws.Dispose();
            throw new TimeoutException("USALB broadcaster WebSocket connection timed out after 12 seconds.");
        }
        catch (Exception ex)
        {
            diagnostic("WebSocket connect error: " + ex.GetBaseException().Message);
            ws.Dispose();
            throw;
        }
    }

    void StartReceiveMonitor()
    {
        _ = Task.Run(async () =>
        {
            var buffer = new byte[8192];
            try
            {
                while (!disposed && socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        var reason = result.CloseStatusDescription ?? "No close reason supplied.";
                        diagnostic($"SERVER CLOSED WEBSOCKET. code={result.CloseStatus}, reason={reason}");
                        disconnectSignal.TrySetResult(new IOException($"USALB live relay closed the connection ({result.CloseStatus}): {reason}"));
                        try { socket.Abort(); } catch { }
                        return;
                    }

                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                        if (message.Contains("\"type\":\"error\"", StringComparison.OrdinalIgnoreCase))
                        {
                            diagnostic("SERVER ERROR MESSAGE: " + message);
                            disconnectSignal.TrySetResult(new IOException("USALB live relay reported an error: " + message));
                        }
                        else if (message.Contains("\"type\":\"heartbeat\"", StringComparison.OrdinalIgnoreCase))
                        {
                            diagnostic("Server heartbeat received.");
                        }
                        else if (message.Contains("\"type\":\"handoff-committed\"", StringComparison.OrdinalIgnoreCase))
                        {
                            handoffCommittedSignal.TrySetResult(true);
                            diagnostic("Server confirmed replacement PCM is now the live source.");
                        }
                    }

                    while (!result.EndOfMessage)
                        result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                }
            }
            catch (Exception ex)
            {
                if (!disposed)
                {
                    diagnostic("WEBSOCKET RECEIVE ERROR: " + ex.GetBaseException().Message);
                    disconnectSignal.TrySetResult(ex);
                }
            }
        });
    }

    public async Task SendAudioAsync(byte[] pcm, CancellationToken token)
    {
        if (disposed) throw new ObjectDisposedException(nameof(PcmWebSocketConnection));
        if (disconnectSignal.Task.IsCompleted && disconnectSignal.Task.Result is Exception error)
            throw new IOException("USALB live relay connection was lost.", error);

        var packet = new byte[4 + pcm.Length];
        packet[0] = 0x50; packet[1] = 0x43; packet[2] = 0x4d; packet[3] = 0x31;
        Buffer.BlockCopy(pcm, 0, packet, 4, pcm.Length);
        await socket.SendAsync(packet.AsMemory(), WebSocketMessageType.Binary, true, token);
    }

    public async Task WaitForHandoffCommittedAsync(CancellationToken token)
    {
        await handoffCommittedSignal.Task.WaitAsync(TimeSpan.FromSeconds(2), token);
    }

    public void Abort()
    {
        try { socket.Abort(); } catch { }
        try { socket.Dispose(); } catch { }
        diagnostic("Broadcaster socket aborted locally.");
        disconnectSignal.TrySetResult(new IOException("Broadcaster socket aborted."));
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        try
        {
            if (socket.State == WebSocketState.Open)
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Broadcast stopped", CancellationToken.None);
        }
        catch { }
        socket.Dispose();
        disconnectSignal.TrySetResult(null);
    }
}
