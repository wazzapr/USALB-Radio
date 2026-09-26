import { useCallback, useEffect, useRef, useState } from "react";
import * as lamejs from "@breezystack/lamejs";

export type BroadcastSource = "pc" | "music" | "mic";
export type BroadcastState = "idle" | "preparing" | "connecting" | "live" | "stopping" | "error";
export type DisplaySurface = "tab" | "window" | "screen" | "unknown";

export type EffectPad = {
  id: string;
  label: string;
  file: File | null;
  duration: number | null;
};

type AudioGraph = {
  context: AudioContext;
  mixBus: GainNode;
  masterGain: GainNode;
  limiter: DynamicsCompressorNode;
  musicGain: GainNode;
  voiceGain: GainNode;
  musicAnalyser: AnalyserNode;
  voiceAnalyser: AnalyserNode;
  mp3Processor: ScriptProcessorNode | null;
  mp3Encoder: lamejs.Mp3Encoder | null;
  mp3Silence: GainNode | null;
  mp3LeftPending: Int16Array;
  mp3RightPending: Int16Array;
  musicElement: HTMLAudioElement | null;
  displayStream: MediaStream | null;
  displaySource: MediaStreamAudioSourceNode | null;
  microphoneStream: MediaStream | null;
};

type PreviewGraph = {
  context: AudioContext;
  musicGain: GainNode;
  voiceGain: GainNode;
  musicAnalyser: AnalyserNode;
  voiceAnalyser: AnalyserNode;
  musicElement: HTMLAudioElement | null;
  displayStream: MediaStream | null;
  displaySource: MediaStreamAudioSourceNode | null;
  microphoneStream: MediaStream | null;
};

const defaultPads: EffectPad[] = [
  { id: "pad-1", label: "Stinger", file: null, duration: null },
  { id: "pad-2", label: "Jingle", file: null, duration: null },
  { id: "pad-3", label: "Sweep", file: null, duration: null },
  { id: "pad-4", label: "Drop", file: null, duration: null },
  { id: "pad-5", label: "Bed", file: null, duration: null },
  { id: "pad-6", label: "Tag", file: null, duration: null },
];
function wsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/live/ws?role=broadcaster`;
}

export function useLiveBroadcaster() {
  const [state, setState] = useState<BroadcastState>("idle");
  const [error, setError] = useState("");
  const [source, setSource] = useState<BroadcastSource>("pc");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [ducking, setDucking] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.72);
  const [voiceVolume, setVoiceVolume] = useState(0.88);
  const [masterVolume, setMasterVolume] = useState(0.88);
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [pads, setPads] = useState<EffectPad[]>(defaultPads);
  const [musicLevel, setMusicLevel] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [activePad, setActivePad] = useState<string | null>(null);
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [displaySurface, setDisplaySurface] = useState<DisplaySurface>("unknown");
  const [displayHasAudio, setDisplayHasAudio] = useState(false);

  const graphRef = useRef<AudioGraph | null>(null);
  const previewGraphRef = useRef<PreviewGraph | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const musicUrlRef = useRef<string | null>(null);
  const effectBuffersRef = useRef(new Map<string, AudioBuffer>());
  const duckFrameRef = useRef<number | null>(null);
  const shuttingDownRef = useRef(false);
  const sourceRef = useRef(source);
  const microphoneEnabledRef = useRef(microphoneEnabled);
  const duckingRef = useRef(ducking);
  const musicVolumeRef = useRef(musicVolume);
  const voiceVolumeRef = useRef(voiceVolume);
  const masterVolumeRef = useRef(masterVolume);

  sourceRef.current = source;
  microphoneEnabledRef.current = microphoneEnabled;
  duckingRef.current = ducking;
  musicVolumeRef.current = musicVolume;
  voiceVolumeRef.current = voiceVolume;
  masterVolumeRef.current = masterVolume;

  const updateDisplayDetails = useCallback((stream: MediaStream | null) => {
    if (!stream) {
      setDisplayStream(null);
      setDisplaySurface("unknown");
      setDisplayHasAudio(false);
      return;
    }
    const videoTrack = stream.getVideoTracks()[0];
    const surface = videoTrack?.getSettings().displaySurface;
    setDisplayStream(stream);
    setDisplaySurface(surface === "tab" || surface === "window" || surface === "screen" ? surface : "unknown");
    setDisplayHasAudio(stream.getAudioTracks().length > 0);
  }, []);

  const registerDisplayEnded = useCallback((stream: MediaStream) => {
    const handleEnded = () => {
      if (displayStreamRef.current !== stream) return;
      if (stream.getAudioTracks().some((track) => track.readyState !== "ended")) return;
      displayStreamRef.current = null;
      const graph = graphRef.current;
      if (graph?.displayStream === stream) {
        graph.displayStream = null;
        graph.displaySource?.disconnect();
        graph.displaySource = null;
      }
      updateDisplayDetails(null);
      setError("Shared audio ended. Choose a new tab, window, or screen before continuing.");
    };
    const handleAudioEnded = () => {
      if (displayStreamRef.current !== stream) return;
      const audioStillPresent = stream.getAudioTracks().some((track) => track.readyState !== "ended");
      setDisplayHasAudio(audioStillPresent);
      if (!audioStillPresent) setError("Shared audio ended. Replace the share and enable audio in the browser dialog.");
    };
    stream.getVideoTracks().forEach((track) => track.addEventListener("ended", handleEnded, { once: true }));
    stream.getAudioTracks().forEach((track) => track.addEventListener("ended", handleAudioEnded, { once: true }));
  }, [updateDisplayDetails]);

  const stopMeter = useCallback(() => {
    if (duckFrameRef.current !== null) {
      cancelAnimationFrame(duckFrameRef.current);
      duckFrameRef.current = null;
    }
    setMusicLevel(0);
    setVoiceLevel(0);
  }, []);

  const cleanupPreviewGraph = useCallback(async () => {
    const preview = previewGraphRef.current;
    previewGraphRef.current = null;
    if (!preview) return;
    preview.musicElement?.pause();
    if (preview.musicElement) preview.musicElement.src = "";
    preview.displaySource?.disconnect();
    if (preview.displayStream && displayStreamRef.current !== preview.displayStream) {
      preview.displayStream.getTracks().forEach((track) => track.stop());
    }
    preview.microphoneStream?.getTracks().forEach((track) => track.stop());
    preview.musicGain.disconnect();
    preview.voiceGain.disconnect();
    preview.musicAnalyser.disconnect();
    preview.voiceAnalyser.disconnect();
    if (preview.context.state !== "closed") await preview.context.close();
  }, []);

  const ensurePreviewGraph = useCallback(async () => {
    if (graphRef.current) return graphRef.current;
    if (previewGraphRef.current) {
      if (previewGraphRef.current.context.state === "suspended") await previewGraphRef.current.context.resume();
      return previewGraphRef.current;
    }
    const context = new AudioContext({ latencyHint: "balanced", sampleRate: 44100 });
    await context.resume();
    const musicGain = context.createGain();
    const voiceGain = context.createGain();
    const musicAnalyser = context.createAnalyser();
    const voiceAnalyser = context.createAnalyser();
    musicAnalyser.fftSize = 256;
    voiceAnalyser.fftSize = 256;
    musicGain.gain.value = musicVolumeRef.current;
    voiceGain.gain.value = microphoneEnabledRef.current ? voiceVolumeRef.current : 0;
    musicGain.connect(musicAnalyser);
    voiceGain.connect(voiceAnalyser);
    const preview: PreviewGraph = {
      context,
      musicGain,
      voiceGain,
      musicAnalyser,
      voiceAnalyser,
      musicElement: null,
      displayStream: null,
      displaySource: null,
      microphoneStream: null,
    };
    previewGraphRef.current = preview;
    return preview;
  }, []);

  const cleanupGraph = useCallback(async () => {
    stopMeter();
    const graph = graphRef.current;
    graphRef.current = null;
    if (!graph) return;
    graph.musicElement?.pause();
    if (graph.musicElement) graph.musicElement.src = "";
    if (graph.displayStream && displayStreamRef.current === graph.displayStream) {
      displayStreamRef.current = null;
      updateDisplayDetails(null);
    }
    if (graph.mp3Processor) graph.mp3Processor.onaudioprocess = null;
    graph.mp3Processor?.disconnect();
    graph.mp3Silence?.disconnect();
    graph.mixBus.disconnect();
    graph.masterGain.disconnect();
    graph.limiter.disconnect();
    graph.displaySource?.disconnect();
    graph.displayStream?.getTracks().forEach((track) => track.stop());
    graph.microphoneStream?.getTracks().forEach((track) => track.stop());
    if (graph.context.state !== "closed") await graph.context.close();
  }, [stopMeter, updateDisplayDetails]);

  const fail = useCallback(
    async (message: string) => {
      setError(message);
      setState("error");
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState === WebSocket.OPEN) socket.close();
      await cleanupGraph();
    },
    [cleanupGraph],
  );

  const readEffect = useCallback(async (pad: EffectPad, context: AudioContext) => {
    if (!pad.file) return null;
    const cached = effectBuffersRef.current.get(pad.id);
    if (cached) return cached;
    const buffer = await context.decodeAudioData(await pad.file.arrayBuffer());
    effectBuffersRef.current.set(pad.id, buffer);
    return buffer;
  }, []);

  const runMeter = useCallback(() => {
    const graph = graphRef.current;
    const preview = previewGraphRef.current;
    const analyserGraph = graph ?? preview;
    if (!analyserGraph) return;
    const voiceData = new Uint8Array(analyserGraph.voiceAnalyser.fftSize);
    const musicData = new Uint8Array(analyserGraph.musicAnalyser.fftSize);
    const frame = () => {
      const currentGraph = graphRef.current;
      const currentPreview = previewGraphRef.current;
      const analyserGraph = currentGraph ?? currentPreview;
      if (!analyserGraph) return;
      analyserGraph.musicAnalyser.getByteTimeDomainData(musicData);
      analyserGraph.voiceAnalyser.getByteTimeDomainData(voiceData);
      let musicSum = 0;
      let voiceSum = 0;
      for (let index = 0; index < musicData.length; index += 1) {
        const musicSample = (musicData[index] - 128) / 128;
        const voiceSample = (voiceData[index] - 128) / 128;
        musicSum += musicSample * musicSample;
        voiceSum += voiceSample * voiceSample;
      }
      const nextMusic = Math.min(1, Math.sqrt(musicSum / musicData.length) * 3.2);
      const nextVoice = Math.min(1, Math.sqrt(voiceSum / voiceData.length) * 3.2);
      setMusicLevel(nextMusic);
      setVoiceLevel(nextVoice);
      if (currentGraph && duckingRef.current) {
        const duckTarget = nextVoice > 0.045 ? Math.max(0.22, 1 - nextVoice * 1.9) : 1;
        currentGraph.musicGain.gain.setTargetAtTime(musicVolumeRef.current * duckTarget, currentGraph.context.currentTime, 0.045);
      }
      duckFrameRef.current = requestAnimationFrame(frame);
    };
    duckFrameRef.current = requestAnimationFrame(frame);
  }, []);

  const setMusic = useCallback((value: number) => {
    setMusicVolume(value);
    const graph = graphRef.current;
    const preview = previewGraphRef.current;
    const target = graph ?? preview;
    if (target) target.musicGain.gain.setTargetAtTime(value, target.context.currentTime, 0.02);
  }, []);

  const setVoice = useCallback((value: number) => {
    setVoiceVolume(value);
    const graph = graphRef.current;
    const preview = previewGraphRef.current;
    const target = graph ?? preview;
    if (target) target.voiceGain.gain.setTargetAtTime(value, target.context.currentTime, 0.02);
  }, []);

  const setMaster = useCallback((value: number) => {
    setMasterVolume(value);
    const graph = graphRef.current;
    if (graph) graph.masterGain.gain.setTargetAtTime(value, graph.context.currentTime, 0.02);
  }, []);

  const setDuck = useCallback((value: boolean) => {
    setDucking(value);
    const graph = graphRef.current;
    if (!graph || value) return;
    graph.musicGain.gain.setTargetAtTime(musicVolumeRef.current, graph.context.currentTime, 0.04);
  }, []);

  const toggleMicrophone = useCallback(async () => {
    const next = !microphoneEnabledRef.current;
    setMicrophoneEnabled(next);
    const graph = graphRef.current;
    const preview = previewGraphRef.current;
    if (!graph && !preview && !next) return;
    if (!graph && next) {
      try {
        const target = await ensurePreviewGraph();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        target.microphoneStream = stream;
        const microphoneSource = target.context.createMediaStreamSource(stream);
        microphoneSource.connect(target.voiceGain);
        target.voiceGain.gain.setTargetAtTime(voiceVolumeRef.current, target.context.currentTime, 0.02);
        runMeter();
        return;
      } catch {
        setMicrophoneEnabled(false);
        setError("Microphone access was not granted. Check the browser permission and try again.");
        return;
      }
    }
    if (!graph) {
      if (preview?.microphoneStream) preview.microphoneStream.getAudioTracks().forEach((track) => { track.enabled = false; });
      preview?.voiceGain.gain.setTargetAtTime(0, preview.context.currentTime, 0.02);
      return;
    }
    if (next && !graph.microphoneStream) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        graph.microphoneStream = stream;
        const microphoneSource = graph.context.createMediaStreamSource(stream);
        microphoneSource.connect(graph.voiceGain);
      } catch {
        setMicrophoneEnabled(false);
        setError("Microphone access was not granted. Check the browser permission and try again.");
        graph.voiceGain.gain.setTargetAtTime(0, graph.context.currentTime, 0.02);
        return;
      }
    }
    graph.microphoneStream?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    graph.voiceGain.gain.setTargetAtTime(next ? voiceVolumeRef.current : 0, graph.context.currentTime, 0.02);
  }, []);

  const loadMusic = useCallback((file: File | null) => {
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    musicUrlRef.current = file ? URL.createObjectURL(file) : null;
    setMusicFile(file);
    if (!file) return;
    void (async () => {
      if (graphRef.current) return;
      const preview = await ensurePreviewGraph();
      preview.musicElement?.pause();
      if (preview.musicElement) preview.musicElement.src = "";
      const musicElement = new Audio(musicUrlRef.current ?? undefined);
      musicElement.loop = true;
      musicElement.preload = "auto";
      const musicSource = preview.context.createMediaElementSource(musicElement);
      musicSource.connect(preview.musicGain);
      preview.musicElement = musicElement;
      try {
        await musicElement.play();
        runMeter();
      } catch {
        setError("Music is loaded. Press play/preview in the browser if autoplay is blocked.");
      }
    })();
  }, [ensurePreviewGraph, runMeter]);

  const loadEffect = useCallback((id: string, file: File | null) => {
    effectBuffersRef.current.delete(id);
    setPads((current) =>
      current.map((pad) => (pad.id === id ? { ...pad, file, duration: null } : pad)),
    );
  }, []);

  const chooseDisplay = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("This browser cannot share a tab, window, or screen.");
      return;
    }
    try {
      setError("");
      const nextStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { suppressLocalAudioPlayback: true } });
      const previousStream = displayStreamRef.current;
      displayStreamRef.current = nextStream;
      updateDisplayDetails(nextStream);
      registerDisplayEnded(nextStream);
      nextStream.getVideoTracks().forEach((track) => track.stop());
      if (!graphRef.current) {
        const preview = await ensurePreviewGraph();
        preview.displaySource?.disconnect();
        preview.displayStream?.getTracks().forEach((track) => track.stop());
        preview.displayStream = nextStream;
        if (nextStream.getAudioTracks().length) {
          const displaySource = preview.context.createMediaStreamSource(nextStream);
          displaySource.connect(preview.musicGain);
          preview.displaySource = displaySource;
        }
        runMeter();
      }
      if (previousStream && previousStream !== nextStream) previousStream.getTracks().forEach((track) => track.stop());
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        setError("Screen sharing was cancelled. Choose a tab, window, or screen when you are ready.");
      } else {
        setError("The browser could not start screen sharing. Check permission and try again.");
      }
    }
  }, [registerDisplayEnded, updateDisplayDetails]);

  const replaceDisplay = useCallback(async () => {
    if (state !== "live" || !navigator.mediaDevices?.getDisplayMedia) return;
    try {
      setError("");
      const nextStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { suppressLocalAudioPlayback: true } });
      if (!nextStream.getAudioTracks().length) {
        nextStream.getTracks().forEach((track) => track.stop());
        setError("The new share has no audio. Enable audio in the browser dialog, then replace the share again.");
        return;
      }
      const graph = graphRef.current;
      if (!graph) {
        nextStream.getTracks().forEach((track) => track.stop());
        setError("The live audio path is not ready for a replacement share.");
        return;
      }
      const nextSource = graph.context.createMediaStreamSource(nextStream);
      nextSource.connect(graph.musicGain);
      const previousStream = displayStreamRef.current;
      graph.displaySource?.disconnect();
      graph.displaySource = nextSource;
      graph.displayStream = nextStream;
      displayStreamRef.current = nextStream;
      updateDisplayDetails(nextStream);
      registerDisplayEnded(nextStream);
      if (previousStream && previousStream !== nextStream) previousStream.getTracks().forEach((track) => track.stop());
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        setError("Share replacement was cancelled. The current live share is still selected.");
      } else {
        setError("The live share could not be replaced. The current share is still selected.");
      }
    }
  }, [registerDisplayEnded, state, updateDisplayDetails]);

  const start = useCallback(async () => {
    if (state === "preparing" || state === "connecting" || state === "live") return;
    setError("");
    setState("preparing");
    shuttingDownRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support the audio capture tools needed for live broadcast.");
      }
      if (sourceRef.current === "pc" && !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("This browser cannot capture PC/system audio.");
      }
      const context = new AudioContext({ latencyHint: "balanced", sampleRate: 44100 });
      await context.resume();
      if (context.sampleRate !== 44100) {
        throw new Error(`This browser opened the live audio context at ${context.sampleRate} Hz instead of 44.1 kHz. Reload the Control Room and try again.`);
      }
      const mixBus = context.createGain();
      const limiter = context.createDynamicsCompressor();
      const masterGain = context.createGain();
      const musicGain = context.createGain();
      const voiceGain = context.createGain();
      const musicAnalyser = context.createAnalyser();
      const voiceAnalyser = context.createAnalyser();
      const mp3Processor = typeof context.createScriptProcessor === "function" ? context.createScriptProcessor(4096, 2, 2) : null;
      const mp3Encoder = new lamejs.Mp3Encoder(2, 44100, 320);
      const mp3Silence = mp3Processor ? context.createGain() : null;
      musicAnalyser.fftSize = 256;
      voiceAnalyser.fftSize = 256;
      musicGain.gain.value = musicVolumeRef.current;
      voiceGain.gain.value = microphoneEnabledRef.current ? voiceVolumeRef.current : 0;
      masterGain.gain.value = masterVolumeRef.current;
      limiter.threshold.value = -8;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.005;
      limiter.release.value = 0.18;
      musicGain.connect(musicAnalyser);
      voiceGain.connect(voiceAnalyser);
      musicAnalyser.connect(mixBus);
      voiceAnalyser.connect(mixBus);
      mixBus.connect(limiter);
      limiter.connect(masterGain);
      if (mp3Processor && mp3Silence) {
        masterGain.connect(mp3Processor);
        mp3Processor.connect(mp3Silence);
        mp3Silence.gain.value = 0.00001;
        mp3Silence.connect(context.destination);
        mp3Processor.onaudioprocess = (event) => {
          const socket = socketRef.current;
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          // Keep every encoded MP3 frame. Dropping frames here creates audible
          // multi-second holes when the WebSocket briefly reports queued bytes.
          const input = event.inputBuffer;
          const left = new Int16Array(graph.mp3LeftPending.length + input.length);
          const right = new Int16Array(graph.mp3RightPending.length + input.length);
          left.set(graph.mp3LeftPending);
          right.set(graph.mp3RightPending);
          const pendingOffset = graph.mp3LeftPending.length;
          const leftData = input.getChannelData(0);
          const rightData = input.numberOfChannels > 1 ? input.getChannelData(1) : leftData;
          for (let frame = 0; frame < input.length; frame += 1) {
            left[pendingOffset + frame] = Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, leftData[frame])) * 32767)));
            right[pendingOffset + frame] = Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, rightData[frame])) * 32767)));
          }
          const frameSize = 1152;
          const completeLength = left.length - (left.length % frameSize);
          for (let offset = 0; offset < completeLength; offset += frameSize) {
            const mp3 = mp3Encoder.encodeBuffer(left.subarray(offset, offset + frameSize), right.subarray(offset, offset + frameSize));
            if (mp3.length) socket.send(new Uint8Array(mp3));
          }
          graph.mp3LeftPending = left.slice(completeLength);
          graph.mp3RightPending = right.slice(completeLength);
        };
      }

      let displayStream = sourceRef.current === "pc" ? displayStreamRef.current : null;
      if (sourceRef.current === "pc" && !displayStream) {
        const nextStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const previousStream = displayStreamRef.current;
        displayStreamRef.current = nextStream;
        updateDisplayDetails(nextStream);
        registerDisplayEnded(nextStream);
        nextStream.getVideoTracks().forEach((track) => track.stop());
        if (previousStream && previousStream !== nextStream) previousStream.getTracks().forEach((track) => track.stop());
        displayStream = nextStream;
      }

      const graph: AudioGraph = {
        context,
        mixBus,
        masterGain,
        limiter,
        musicGain,
        voiceGain,
        musicAnalyser,
        voiceAnalyser,
        mp3Processor,
        mp3Encoder,
        mp3Silence,
        mp3LeftPending: new Int16Array(0),
        mp3RightPending: new Int16Array(0),
        musicElement: null,
        displayStream: null,
        displaySource: null,
        microphoneStream: null,
      };
      await cleanupPreviewGraph();
      graphRef.current = graph;
      if (sourceRef.current === "pc" && !displayStream && !microphoneEnabledRef.current) {
        throw new Error("Choose a tab, window, or screen with audio, or enable the microphone.");
      }
      graph.displayStream = displayStream;
      const microphoneStream = microphoneEnabledRef.current
        ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        : null;
      graph.microphoneStream = microphoneStream;

      if (displayStream?.getAudioTracks().length) {
        const displaySource = context.createMediaStreamSource(displayStream);
        displaySource.connect(musicGain);
        graph.displaySource = displaySource;
      } else if (sourceRef.current === "pc" && !microphoneStream) {
        throw new Error("Screen sharing has no shared audio. Enable audio in the browser dialog, or turn on the microphone.");
      }

      let musicElement: HTMLAudioElement | null = null;
      if (sourceRef.current === "music") {
        if (!musicUrlRef.current) throw new Error("Choose a local music file before starting the broadcast.");
        musicElement = new Audio(musicUrlRef.current);
        musicElement.loop = true;
        musicElement.preload = "auto";
        const musicSource = context.createMediaElementSource(musicElement);
        musicSource.connect(musicGain);
      }

      if (microphoneStream) {
        const microphoneSource = context.createMediaStreamSource(microphoneStream);
        microphoneSource.connect(voiceGain);
      }

      if (sourceRef.current === "mic" && !microphoneStream) {
        throw new Error("Enable the microphone before starting a microphone-only broadcast.");
      }

      graph.musicElement = musicElement;
      if (musicElement) await musicElement.play();
      runMeter();

      const socket = new WebSocket(wsUrl());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      setState("connecting");
      socket.onclose = () => {
        if (!shuttingDownRef.current && socketRef.current === socket) {
          void fail("The live relay disconnected. The broadcast has been stopped.");
        }
      };
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("The live relay did not respond in time.")), 9000);
        socket.onopen = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        socket.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("Could not connect to the live relay. Check the station server and try again."));
        };
      });
      socket.send(JSON.stringify({ type: "start", mimeType: "audio/mpeg", codec: "mp3" }));
      setState("live");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The broadcast could not be started.";
      await fail(message);
    }
  }, [cleanupGraph, cleanupPreviewGraph, fail, registerDisplayEnded, runMeter, state, updateDisplayDetails]);

  const stop = useCallback(() => {
    if (state !== "live" && state !== "connecting" && state !== "preparing") return;
    shuttingDownRef.current = true;
    setState("stopping");
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    socket?.close();
    socketRef.current = null;
    void cleanupGraph();
    setState("idle");
  }, [cleanupGraph, state]);

  const triggerEffect = useCallback(async (id: string) => {
    const graph = graphRef.current;
    const pad = pads.find((item) => item.id === id);
    if (!graph || !pad?.file || state !== "live") {
      if (!pad?.file) setError("Load an audio file into this pad before triggering it.");
      return;
    }
    try {
      const buffer = await readEffect(pad, graph.context);
      if (!buffer) return;
      const sourceNode = graph.context.createBufferSource();
      const gain = graph.context.createGain();
      sourceNode.buffer = buffer;
      gain.gain.value = 0.9;
      sourceNode.connect(gain);
      gain.connect(graph.mixBus);
      sourceNode.start();
      setActivePad(id);
      window.setTimeout(() => setActivePad((current) => (current === id ? null : current)), Math.max(250, buffer.duration * 1000));
    } catch {
      setError(`Could not decode ${pad.file.name}. Choose a WAV, MP3, or OGG file.`);
    }
  }, [pads, readEffect, state]);

  useEffect(() => () => {
    socketRef.current?.close();
    void cleanupGraph();
    void cleanupPreviewGraph();
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
  }, [cleanupGraph, cleanupPreviewGraph]);

  useEffect(() => {
    if (state === "error" && shuttingDownRef.current) setState("idle");
  }, [state]);

  return {
    state,
    error,
    source,
    setSource,
    microphoneEnabled,
    toggleMicrophone,
    ducking,
    setDucking: setDuck,
    musicVolume,
    setMusicVolume: setMusic,
    voiceVolume,
    setVoiceVolume: setVoice,
    masterVolume,
    setMasterVolume: setMaster,
    musicFile,
    loadMusic,
    pads,
    loadEffect,
    triggerEffect,
    activePad,
    musicLevel,
    voiceLevel,
    displayStream,
    displaySurface,
    displayHasAudio,
    chooseDisplay,
    replaceDisplay,
    start,
    stop,
  };
}