using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using NAudio.Wave;

const string DefaultServer = "https://usalb-radio--applauncher.replit.app";
var serverUrl = args.Length > 0 ? args[0] : "";
var pairingCode = args.Length > 1 ? args[1] : "";

if (string.IsNullOrWhiteSpace(serverUrl))
{
    Console.Write($"USALB server URL [{DefaultServer}]: ");
    serverUrl = Console.ReadLine();
}
serverUrl = string.IsNullOrWhiteSpace(serverUrl) ? DefaultServer : serverUrl.Trim().TrimEnd('/');
if (serverUrl.EndsWith("/admin", StringComparison.OrdinalIgnoreCase))
    serverUrl = serverUrl[..^6].TrimEnd('/');

var credentialsPath = Path.Combine(AppContext.BaseDirectory, "credentials.json");
Credential? credentials = null;

if (File.Exists(credentialsPath))
{
    try
    {
        credentials = JsonSerializer.Deserialize<Credential>(File.ReadAllText(credentialsPath, Encoding.UTF8), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Console.WriteLine($"Using saved broadcaster credentials for {credentials?.DeviceId}.");
    }
    catch { credentials = null; }
}

using var http = new HttpClient();

if (credentials is null)
{
    if (string.IsNullOrWhiteSpace(pairingCode))
    {
        Console.Write("Enter the USALB broadcaster pairing code: ");
        pairingCode = Console.ReadLine() ?? "";
    }

    var pairJson = JsonSerializer.Serialize(new { code = pairingCode, deviceName = "USALB Windows Broadcaster" });
    using var pairResponse = await http.PostAsync(
        serverUrl + "/api/broadcaster/pair",
        new StringContent(pairJson, Encoding.UTF8, "application/json"));

    pairResponse.EnsureSuccessStatusCode();
    var body = await pairResponse.Content.ReadAsStringAsync();
    credentials = JsonSerializer.Deserialize<Credential>(body, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
        ?? throw new Exception("The server returned invalid broadcaster credentials.");

    if (string.IsNullOrWhiteSpace(credentials.PublishEndpoint) || string.IsNullOrWhiteSpace(credentials.PublishToken))
        throw new Exception("The server returned incomplete broadcaster credentials.");

    File.WriteAllText(credentialsPath, JsonSerializer.Serialize(credentials, new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine("Paired successfully.");
}

Console.WriteLine("USALB Broadcaster");
Console.WriteLine("System-audio loopback capture: READY");
Console.WriteLine("Press Ctrl+C to stop.");
Console.WriteLine();

var heartbeatCts = new CancellationTokenSource();
var heartbeatTask = HeartbeatLoop(credentials!, heartbeatCts.Token);

using var loopback = new WasapiLoopbackCapture();
Console.WriteLine($"System-audio format: {loopback.WaveFormat.SampleRate} Hz, {loopback.WaveFormat.Channels} channels, {loopback.WaveFormat.Encoding}");
var ffmpeg = StartFfmpeg(credentials!, loopback.WaveFormat);
using var stdin = ffmpeg.StandardInput.BaseStream;
using var uploadCts = new CancellationTokenSource();
var uploadTask = UploadAudioAsync(credentials!, ffmpeg, uploadCts.Token);

loopback.DataAvailable += (_, e) =>
{
    try
    {
        stdin.Write(e.Buffer, 0, e.BytesRecorded);
        stdin.Flush();
    }
    catch { }
};

loopback.RecordingStopped += (_, e) =>
{
    try { stdin.Close(); } catch { }
};

Console.WriteLine("Streaming Windows system audio to USALB...");
loopback.StartRecording();

try
{
    await Task.Delay(Timeout.InfiniteTimeSpan);
}
catch (TaskCanceledException) { }
finally
{
    try { loopback.StopRecording(); } catch { }
    try { stdin.Close(); } catch { }
    uploadCts.Cancel();
    try { if (!ffmpeg.HasExited) ffmpeg.Kill(true); } catch { }
    heartbeatCts.Cancel();
    try { await heartbeatTask; } catch { }
    try { await uploadTask; } catch (Exception ex) { Console.WriteLine($"Audio upload stopped: {ex.Message}"); }
}

static Process StartFfmpeg(Credential c, WaveFormat inputFormat)
{
    var psi = new ProcessStartInfo("ffmpeg.exe")
    {
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true
    };

    psi.ArgumentList.Add("-hide_banner");
    psi.ArgumentList.Add("-loglevel");
    psi.ArgumentList.Add("warning");
    psi.ArgumentList.Add("-f");
    psi.ArgumentList.Add("f32le");
    psi.ArgumentList.Add("-ar");
    psi.ArgumentList.Add(inputFormat.SampleRate.ToString());
    psi.ArgumentList.Add("-ac");
    psi.ArgumentList.Add(inputFormat.Channels.ToString());
    psi.ArgumentList.Add("-i");
    psi.ArgumentList.Add("pipe:0");
    psi.ArgumentList.Add("-c:a");
    psi.ArgumentList.Add("libmp3lame");
    psi.ArgumentList.Add("-ar");
    psi.ArgumentList.Add("44100");
    psi.ArgumentList.Add("-ac");
    psi.ArgumentList.Add("2");
    psi.ArgumentList.Add("-b:a");
    psi.ArgumentList.Add("128k");
    psi.ArgumentList.Add("-f");
    psi.ArgumentList.Add("mp3");
    psi.ArgumentList.Add("-flush_packets");
    psi.ArgumentList.Add("1");
    psi.ArgumentList.Add("pipe:1");

    var p = Process.Start(psi) ?? throw new Exception("Could not start FFmpeg.");
    _ = Task.Run(async () =>
    {
        while (!p.StandardError.EndOfStream)
        {
            var line = await p.StandardError.ReadLineAsync();
            if (!string.IsNullOrWhiteSpace(line)) Console.WriteLine(line);
        }
    });
    return p;
}

static async Task UploadAudioAsync(Credential c, Process ffmpeg, CancellationToken token)
{
    using var client = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };

    while (!token.IsCancellationRequested)
    {
        try
        {
            Console.WriteLine("Connecting audio ingest...");

            using var request = new HttpRequestMessage(HttpMethod.Post, c.PublishEndpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", c.PublishToken);
            request.Headers.TransferEncodingChunked = true;

            var content = new FfmpegStreamContent(ffmpeg.StandardOutput.BaseStream, token);
            content.Headers.ContentType = new MediaTypeHeaderValue("audio/mpeg");
            request.Content = content;

            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            response.EnsureSuccessStatusCode();

            Console.WriteLine("Audio ingest connected.");

            await content.StreamingTask;

            if (!token.IsCancellationRequested)
                throw new IOException("Audio ingest connection ended.");
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            break;
        }
        catch (Exception ex)
        {
            if (token.IsCancellationRequested) break;

            Console.WriteLine($"Audio ingest disconnected: {ex.Message}");
            Console.WriteLine("Reconnecting audio ingest in 3 seconds...");

            try { await Task.Delay(TimeSpan.FromSeconds(3), token); }
            catch (OperationCanceledException) { break; }
        }
    }

    Console.WriteLine("Audio ingest stopped.");
}

sealed class FfmpegStreamContent : HttpContent
{
    private readonly Stream _source;
    private readonly CancellationToken _token;
    private readonly TaskCompletionSource<bool> _streaming =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private long _bytesSent;
    private DateTime _lastReport = DateTime.UtcNow;

    public Task StreamingTask => _streaming.Task;

    public FfmpegStreamContent(Stream source, CancellationToken token)
    {
        _source = source;
        _token = token;
    }

    protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
    {
        var buffer = new byte[32 * 1024];

        try
        {
            while (!_token.IsCancellationRequested)
            {
                var read = await _source.ReadAsync(buffer.AsMemory(0, buffer.Length), _token);
                if (read == 0) break;

                await stream.WriteAsync(buffer.AsMemory(0, read), _token);
                await stream.FlushAsync(_token);

                _bytesSent += read;
                if ((DateTime.UtcNow - _lastReport).TotalSeconds >= 5)
                {
                    Console.WriteLine($"Audio bytes sent: {_bytesSent:N0}");
                    _lastReport = DateTime.UtcNow;
                }
            }

            if (_token.IsCancellationRequested)
                _streaming.TrySetCanceled(_token);
            else
                _streaming.TrySetResult(true);
        }
        catch (OperationCanceledException) when (_token.IsCancellationRequested)
        {
            _streaming.TrySetCanceled(_token);
        }
        catch (Exception ex)
        {
            _streaming.TrySetException(ex);
            throw;
        }
    }

    protected override bool TryComputeLength(out long length)
    {
        length = 0;
        return false;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
    }
}

static async Task HeartbeatLoop(Credential c, CancellationToken token)
{
    using var client = new HttpClient();
    while (!token.IsCancellationRequested)
    {
        try
        {
            var payload = JsonSerializer.Serialize(new
            {
                status = "STREAMING",
                contentType = "audio/mpeg",
                sampleRate = 44100,
                bitrateKbps = 128
            });
            using var req = new HttpRequestMessage(HttpMethod.Post, c.HeartbeatEndpoint);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", c.PublishToken);
            req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
            await client.SendAsync(req, token);
        }
        catch { }

        try { await Task.Delay(TimeSpan.FromSeconds(10), token); }
        catch { break; }
    }
}

sealed class Credential
{
    public string DeviceId { get; set; } = "";
    public string PublishEndpoint { get; set; } = "";
    public string PublishToken { get; set; } = "";
    public string HeartbeatEndpoint { get; set; } = "";
}
