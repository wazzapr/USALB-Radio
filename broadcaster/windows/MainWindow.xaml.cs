using System.Net.WebSockets;
using System.Text;
using System.Windows;
using NAudio.Wave;

namespace USALB.Broadcaster;

public partial class MainWindow : Window
{
    const int SampleRate = 44100, Channels = 2, FrameMs = 20;

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
    int stopping;

    public MainWindow()
    {
        InitializeComponent();
    }

    async void LiveButton_Click(object sender, RoutedEventArgs e)
    {
        if (Interlocked.CompareExchange(ref stopping, 0, 0) != 0)
            return;

        if (running)
        {
            await StopAsync();
            return;
        }

        try
        {
            await StartAsync();
        }
        catch (OperationCanceledException)
        {
            if (!IsLoaded)
                return;

            await StopAsync();
        }
        catch (Exception ex)
        {
            StatusText.Text = "Error: " + ex.Message;
            await StopAsync();
        }
    }

    async Task StartAsync()
    {
        var useSystemAudio = SystemAudioBox.IsChecked == true;
        var useMicrophone = MicBox.IsChecked == true;

        if (!useSystemAudio && !useMicrophone)
            throw new InvalidOperationException("Select at least one audio input.");

        var server = ServerBox.Text.Trim().TrimEnd('/');
        if (!Uri.TryCreate(server, UriKind.Absolute, out var baseUri) ||
            (baseUri.Scheme != Uri.UriSchemeHttps && baseUri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException("Enter a valid HTTP or HTTPS USALB server URL.");

        await StopAsync();

        // The cancellation source belongs to this LIVE session only.
        // Opening the broadcaster never creates a socket or starts capture.
        var cts = new CancellationTokenSource();
        sessionCts = cts;
        var token = cts.Token;

        var scheme = baseUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        var port = baseUri.IsDefaultPort ? "" : ":" + baseUri.Port;
        var wsUri = new Uri(
            $"{scheme}://{baseUri.Host}{port}/api/live/ws?role=broadcaster");

        var ws = new ClientWebSocket();
        var key = KeyBox.Password.Trim();
        if (!string.IsNullOrWhiteSpace(key))
            ws.Options.SetRequestHeader("x-broadcaster-token", key);

        StatusText.Text = "Connecting to USALB…";

        try
        {
            // Connect is owned by this LIVE session and is cancellable.
            await ws.ConnectAsync(wsUri, token);
            token.ThrowIfCancellationRequested();
            socket = ws;

            if (useSystemAudio)
            {
                loopback = new WasapiLoopbackCapture();
                musicBuffer = new BufferedWaveProvider(loopback.WaveFormat)
                {
                    DiscardOnBufferOverflow = true,
                    ReadFully = true
                };
                musicResampler = new MediaFoundationResampler(
                    musicBuffer,
                    new WaveFormat(SampleRate, 16, Channels))
                {
                    ResamplerQuality = 60
                };
                musicSamples = musicResampler.ToSampleProvider();
                loopback.DataAvailable += (_, a) =>
                {
                    if (running)
                        musicBuffer?.AddSamples(a.Buffer, 0, a.BytesRecorded);
                };
                loopback.StartRecording();
            }

            if (useMicrophone)
            {
                microphone = new WaveInEvent
                {
                    WaveFormat = new WaveFormat(SampleRate, 16, Channels)
                };
                micBuffer = new BufferedWaveProvider(microphone.WaveFormat)
                {
                    DiscardOnBufferOverflow = true,
                    ReadFully = true
                };
                micResampler = new MediaFoundationResampler(
                    micBuffer,
                    new WaveFormat(SampleRate, 16, Channels))
                {
                    ResamplerQuality = 60
                };
                micSamples = micResampler.ToSampleProvider();
                microphone.DataAvailable += (_, a) =>
                {
                    if (running)
                        micBuffer?.AddSamples(a.Buffer, 0, a.BytesRecorded);
                };
                microphone.StartRecording();
            }

            await SendJsonAsync(
                "{\"type\":\"start\",\"mimeType\":\"audio/pcm;rate=44100;channels=2\",\"codec\":\"pcm\",\"pcmSampleRate\":44100,\"pcmChannels\":2}",
                token);

            running = true;
            LiveButton.Content = "STOP LIVE";
            StatusText.Text = "LIVE · clean WASAPI capture → USALB server → adaptive MP3";

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

        try
        {
            while (running &&
                   socket?.State == WebSocketState.Open &&
                   !token.IsCancellationRequested)
            {
                Array.Clear(music);
                Array.Clear(mic);

                musicSamples?.Read(music, 0, music.Length);
                micSamples?.Read(mic, 0, mic.Length);

                for (var i = 0; i < frameSamples; i++)
                {
                    var sample = Math.Clamp(music[i] + mic[i], -0.98f, 0.98f);
                    var s = (short)Math.Round(sample * short.MaxValue);
                    output[i * 2] = (byte)(s & 255);
                    output[i * 2 + 1] = (byte)(s >> 8);
                }

                var packet = new byte[4 + output.Length];
                packet[0] = 0x50;
                packet[1] = 0x43;
                packet[2] = 0x4d;
                packet[3] = 0x31;
                Buffer.BlockCopy(output, 0, packet, 4, output.Length);

                await socket.SendAsync(
                    packet,
                    WebSocketMessageType.Binary,
                    true,
                    token);

                await Task.Delay(FrameMs, token);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (ObjectDisposedException)
        {
        }
        catch (Exception ex)
        {
            await Dispatcher.InvokeAsync(() =>
            {
                if (running && !IsClosing)
                    StatusText.Text = "Broadcast error: " + ex.Message;
            });
        }
    }

    async Task SendJsonAsync(string json, CancellationToken token)
    {
        var ws = socket;
        if (ws?.State != WebSocketState.Open)
            return;

        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, token);
    }

    async Task StopAsync()
    {
        if (Interlocked.Exchange(ref stopping, 1) != 0)
            return;

        try
        {
            // Stop producing data immediately.
            running = false;

            var cts = sessionCts;
            cts?.Cancel();

            // Abort the socket BEFORE waiting for the send task. This is
            // critical: a blocked network write must never keep the app alive.
            var ws = socket;
            socket = null;
            try { ws?.Abort(); } catch { }

            try { loopback?.StopRecording(); } catch { }
            try { microphone?.StopRecording(); } catch { }

            var task = sendTask;
            sendTask = null;

            if (task is not null)
            {
                try
                {
                    await Task.WhenAny(task, Task.Delay(1500));
                }
                catch
                {
                }
            }

            try
            {
                loopback?.Dispose();
                microphone?.Dispose();
                musicResampler?.Dispose();
                micResampler?.Dispose();
            }
            catch
            {
            }

            try { ws?.Dispose(); } catch { }
            try { cts?.Dispose(); } catch { }

            loopback = null;
            microphone = null;
            musicResampler = null;
            micResampler = null;
            musicBuffer = null;
            micBuffer = null;
            musicSamples = null;
            micSamples = null;
            sessionCts = null;

            if (IsLoaded && !IsClosing)
            {
                LiveButton.Content = "GO LIVE";
                StatusText.Text = "Ready";
            }
        }
        finally
        {
            Interlocked.Exchange(ref stopping, 0);
        }
    }

    bool IsClosing { get; set; }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        IsClosing = true;

        // Synchronously cancel/abort the network side first. The async
        // cleanup below is bounded and can no longer hold the socket open.
        running = false;
        try { sessionCts?.Cancel(); } catch { }
        try { socket?.Abort(); } catch { }

        base.OnClosing(e);
    }

    protected override async void OnClosed(EventArgs e)
    {
        IsClosing = true;
        await StopAsync();
        base.OnClosed(e);
    }
}
