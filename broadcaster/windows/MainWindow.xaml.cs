using System.Net.WebSockets;
using System.Text;
using System.Windows;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace USALB.Broadcaster;

public partial class MainWindow : Window
{
    const int SampleRate=44100, Channels=2, FrameMs=20;
    readonly CancellationTokenSource stop=new();
    ClientWebSocket? socket; WasapiLoopbackCapture? loopback; WasapiCapture? microphone;
    BufferedWaveProvider? musicBuffer; BufferedWaveProvider? micBuffer;
    MediaFoundationResampler? musicResampler; MediaFoundationResampler? micResampler;
    ISampleProvider? musicSamples; ISampleProvider? micSamples;
    volatile bool running;

    public MainWindow(){InitializeComponent();}
    async void LiveButton_Click(object sender,RoutedEventArgs e){if(running){await StopAsync();return;}try{await StartAsync();}catch(Exception ex){StatusText.Text="Error: "+ex.Message;await StopAsync();}}

    async Task StartAsync(){
        var server=ServerBox.Text.Trim().TrimEnd('/');
        if(!Uri.TryCreate(server,UriKind.Absolute,out var baseUri))throw new InvalidOperationException("Enter a valid USALB server URL.");
        var scheme=baseUri.Scheme=="https"?"wss":"ws";
        var wsUri=new Uri($"{scheme}://{baseUri.Host}{(baseUri.IsDefaultPort?"":":"+baseUri.Port)}/api/live/ws?role=broadcaster");
        socket=new ClientWebSocket(); var key=KeyBox.Password.Trim();
        if(!string.IsNullOrWhiteSpace(key))socket.Options.SetRequestHeader("x-broadcaster-token",key);
        StatusText.Text="Connecting to USALB…"; await socket.ConnectAsync(wsUri,CancellationToken.None);
        await SendJsonAsync("{\"type\":\"start\",\"mimeType\":\"audio/pcm;rate=44100;channels=2\",\"codec\":\"pcm\",\"pcmSampleRate\":44100,\"pcmChannels\":2}");
        if(SystemAudioBox.IsChecked==true){
            loopback=new WasapiLoopbackCapture(); musicBuffer=new BufferedWaveProvider(loopback.WaveFormat){DiscardOnBufferOverflow=false,ReadFully=true};
            musicResampler=new MediaFoundationResampler(musicBuffer,new WaveFormat(SampleRate,16,Channels)){ResamplerQuality=60}; musicSamples=musicResampler.ToSampleProvider();
            loopback.DataAvailable+=(_,a)=>musicBuffer.AddSamples(a.Buffer,0,a.BytesRecorded); loopback.StartRecording();
        }
        if(MicBox.IsChecked==true){
            microphone=new WasapiCapture(); micBuffer=new BufferedWaveProvider(microphone.WaveFormat){DiscardOnBufferOverflow=false,ReadFully=true};
            micResampler=new MediaFoundationResampler(micBuffer,new WaveFormat(SampleRate,16,Channels)){ResamplerQuality=60}; micSamples=micResampler.ToSampleProvider();
            microphone.DataAvailable+=(_,a)=>micBuffer.AddSamples(a.Buffer,0,a.BytesRecorded); microphone.StartRecording();
        }
        if(musicSamples is null && micSamples is null)throw new InvalidOperationException("Select at least one audio input.");
        running=true; LiveButton.Content="STOP LIVE"; StatusText.Text="LIVE · clean WASAPI capture → USALB server → adaptive MP3";
        _=Task.Run(()=>SendMixedAudioAsync(stop.Token));
    }

    async Task SendMixedAudioAsync(CancellationToken token){
        var frameSamples=SampleRate*Channels*FrameMs/1000; var output=new byte[frameSamples*2];
        var music=new float[frameSamples]; var mic=new float[frameSamples];
        while(running&&socket?.State==WebSocketState.Open&&!token.IsCancellationRequested){
            Array.Clear(music);Array.Clear(mic); musicSamples?.Read(music,0,music.Length); micSamples?.Read(mic,0,mic.Length);
            for(int i=0;i<frameSamples;i++){var sample=Math.Clamp(music[i]+mic[i],-.98f,.98f);short s=(short)Math.Round(sample*short.MaxValue);output[i*2]=(byte)(s&255);output[i*2+1]=(byte)(s>>8);}
            var packet=new byte[4+output.Length];packet[0]=0x50;packet[1]=0x43;packet[2]=0x4d;packet[3]=0x31;Buffer.BlockCopy(output,0,packet,4,output.Length);
            await socket.SendAsync(packet,WebSocketMessageType.Binary,true,token); await Task.Delay(FrameMs,token);
        }
    }

    async Task SendJsonAsync(string json){if(socket?.State!=WebSocketState.Open)return;var bytes=Encoding.UTF8.GetBytes(json);await socket.SendAsync(bytes,WebSocketMessageType.Text,true,CancellationToken.None);}
    async Task StopAsync(){
        running=false;try{if(socket?.State==WebSocketState.Open)await SendJsonAsync("{\"type\":\"stop\"}");}catch{}
        try{loopback?.StopRecording();}catch{} try{microphone?.StopRecording();}catch{}
        loopback?.Dispose();microphone?.Dispose();musicResampler?.Dispose();micResampler?.Dispose();
        loopback=null;microphone=null;musicResampler=null;micResampler=null;musicBuffer=null;micBuffer=null;musicSamples=null;micSamples=null;
        if(socket is not null){try{socket.Abort();socket.Dispose();}catch{}socket=null;} LiveButton.Content="GO LIVE";StatusText.Text="Ready";
    }
    protected override async void OnClosed(EventArgs e){await StopAsync();stop.Cancel();base.OnClosed(e);}
}
