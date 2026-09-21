using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using NAudio.Wave;

const string DefaultServer = "https://usalb-radio--applauncher.replit.app";
var serverUrl = args.Length > 0 ? args[0] : "";
var pairingCode = args.Length > 1 ? args[1] : "";

if (string.IsNullOrWhiteSpace(serverUrl)) {
    Console.Write($"USALB server URL [{DefaultServer}]: ");
    serverUrl = Console.ReadLine();
}
serverUrl = string.IsNullOrWhiteSpace(serverUrl) ? DefaultServer : serverUrl.Trim().TrimEnd('/');
if (serverUrl.EndsWith("/admin", StringComparison.OrdinalIgnoreCase))
    serverUrl = serverUrl[..^6].TrimEnd('/');

var credentialsPath = Path.Combine(AppContext.BaseDirectory, "credentials.json");
Credential? credentials = null;
if (File.Exists(credentialsPath)) {
    try { credentials = JsonSerializer.Deserialize<Credential>(File.ReadAllText(credentialsPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); } catch { credentials = null; }
}

using var http = new HttpClient();
if (credentials is null) {
    if (string.IsNullOrWhiteSpace(pairingCode)) {
        Console.Write("Enter the USALB broadcaster pairing code: ");
        pairingCode = Console.ReadLine() ?? "";
    }
    var pairJson = JsonSerializer.Serialize(new { code = pairingCode, deviceName = "USALB Windows Broadcaster" });
    using var response = await http.PostAsync(serverUrl + "/api/broadcaster/pair", new StringContent(pairJson, Encoding.UTF8, "application/json"));
    response.EnsureSuccessStatusCode();
    credentials = JsonSerializer.Deserialize<Credential>(await response.Content.ReadAsStringAsync(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
        ?? throw new Exception("Invalid broadcaster credentials returned by USALB.");
    if (string.IsNullOrWhiteSpace(credentials.PublishToken)) throw new Exception("USALB did not return a publish token.");
    File.WriteAllText(credentialsPath, JsonSerializer.Serialize(credentials, new JsonSerializerOptions { WriteIndented = true }));
}

Console.WriteLine("USALB Broadcaster");
Console.WriteLine("System-audio loopback capture: READY");
Console.WriteLine("USALB live relay: WebSocket MP3 / 48 kHz stereo / 192 kbps CBR");
Console.WriteLine("Press Ctrl+C to stop.");
Console.WriteLine();

using var loopback = new WasapiLoopbackCapture();
Console.WriteLine($"System-audio format: {loopback.WaveFormat.SampleRate} Hz, {loopback.WaveFormat.Channels} channels");
using var ffmpeg = StartFfmpeg(loopback.WaveFormat);
using var ffmpegInput = ffmpeg.StandardInput.BaseStream;
using var ffmpegOutput = ffmpeg.StandardOutput.BaseStream;
using var stopCts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stopCts.Cancel(); };

loopback.DataAvailable += (_, e) => {
    try { ffmpegInput.Write(e.Buffer, 0, e.BytesRecorded); ffmpegInput.Flush(); } catch { }
};
loopback.RecordingStopped += (_, _) => { try { ffmpegInput.Close(); } catch { } };
loopback.StartRecording();

var wsScheme = serverUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";
var host = serverUrl[(serverUrl.IndexOf("://", StringComparison.Ordinal) + 3)..];
var wsUrl = $"{wsScheme}://{host}/api/live/ws?role=broadcaster&key={Uri.EscapeDataString(credentials.PublishToken)}";

while (!stopCts.IsCancellationRequested && !ffmpeg.HasExited) {
    using var socket = new ClientWebSocket();
    socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    try {
        Console.WriteLine("Connecting to USALB live relay...");
        await socket.ConnectAsync(new Uri(wsUrl), stopCts.Token);
        Console.WriteLine("Connected. Going live.");
        var start = JsonSerializer.Serialize(new { type = "start", mimeType = "audio/mpeg", codec = "mp3" });
        await socket.SendAsync(Encoding.UTF8.GetBytes(start), WebSocketMessageType.Text, true, stopCts.Token);

        var buffer = new byte[32 * 1024];
        while (!stopCts.IsCancellationRequested && !ffmpeg.HasExited && socket.State == WebSocketState.Open) {
            var read = await ffmpegOutput.ReadAsync(buffer.AsMemory(0, buffer.Length), stopCts.Token);
            if (read == 0) break;
            await socket.SendAsync(buffer.AsMemory(0, read), WebSocketMessageType.Binary, true, stopCts.Token);
        }
    } catch (OperationCanceledException) when (stopCts.IsCancellationRequested) { break; }
      catch (Exception ex) { Console.WriteLine($"USALB relay disconnected: {ex.Message}"); }
    if (!stopCts.IsCancellationRequested) {
        Console.WriteLine("Reconnecting to USALB in 3 seconds...");
        try { await Task.Delay(3000, stopCts.Token); } catch { }
    }
}

try { loopback.StopRecording(); } catch { }
try { ffmpegInput.Close(); } catch { }
try { if (!ffmpeg.HasExited) ffmpeg.Kill(true); } catch { }

static Process StartFfmpeg(WaveFormat inputFormat) {
    var psi = new ProcessStartInfo("ffmpeg.exe") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
    psi.ArgumentList.Add("-hide_banner"); psi.ArgumentList.Add("-loglevel"); psi.ArgumentList.Add("warning");
    psi.ArgumentList.Add("-f"); psi.ArgumentList.Add("f32le"); psi.ArgumentList.Add("-ar"); psi.ArgumentList.Add(inputFormat.SampleRate.ToString()); psi.ArgumentList.Add("-ac"); psi.ArgumentList.Add(inputFormat.Channels.ToString()); psi.ArgumentList.Add("-i"); psi.ArgumentList.Add("pipe:0");
    psi.ArgumentList.Add("-c:a"); psi.ArgumentList.Add("libmp3lame"); psi.ArgumentList.Add("-ar"); psi.ArgumentList.Add("48000"); psi.ArgumentList.Add("-ac"); psi.ArgumentList.Add("2"); psi.ArgumentList.Add("-b:a"); psi.ArgumentList.Add("192k"); psi.ArgumentList.Add("-f"); psi.ArgumentList.Add("mp3"); psi.ArgumentList.Add("-flush_packets"); psi.ArgumentList.Add("1"); psi.ArgumentList.Add("pipe:1");
    var p = Process.Start(psi) ?? throw new Exception("Could not start FFmpeg.");
    _ = Task.Run(async () => { while (!p.StandardError.EndOfStream) { var line = await p.StandardError.ReadLineAsync(); if (!string.IsNullOrWhiteSpace(line)) Console.WriteLine(line); } });
    return p;
}
sealed class Credential { public string DeviceId { get; set; } = ""; public string PublishToken { get; set; } = ""; }
