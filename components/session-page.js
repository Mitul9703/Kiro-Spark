"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import { createClient, AnamEvent } from "@anam-ai/js-sdk";
import { Loader2, Mic, MicOff, PhoneOff, Sparkles } from "lucide-react";
import { AGENT_LOOKUP } from "../lib/agents";
import { getApiUrl, getBackendWsUrl } from "../lib/client-config";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

function floatTo16BitPCM(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index]));
    int16Array[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return int16Array;
}

function downsampleFloat32(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) return buffer;

  const ratio = inputSampleRate / outputSampleRate;
  const nextLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(nextLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < buffer.length; index += 1) {
      sum += buffer[index];
      count += 1;
    }

    result[offsetResult] = count > 0 ? sum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function int16ToBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary);
}

function base64ToUint8Array(base64) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

function pcmBytesToInt16Array(pcmBytes) {
  return new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, Math.floor(pcmBytes.byteLength / 2));
}

function downsampleInt16(input, inputRate = 24000, outputRate = 16000) {
  if (outputRate === inputRate) return input;

  const ratio = inputRate / outputRate;
  const nextLength = Math.floor(input.length / ratio);
  const result = new Int16Array(nextLength);
  let offsetResult = 0;
  let offsetInput = 0;

  while (offsetResult < result.length) {
    const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let index = offsetInput; index < nextOffsetInput && index < input.length; index += 1) {
      sum += input[index];
      count += 1;
    }

    result[offsetResult] = count > 0 ? Math.round(sum / count) : 0;
    offsetResult += 1;
    offsetInput = nextOffsetInput;
  }

  return result;
}

function formatDuration(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getCodingLanguageExtensions(language) {
  const normalized = (language || "").toLowerCase();
  const extensions = [EditorView.lineWrapping];

  if (normalized.includes("javascript")) return [...extensions, javascript({ jsx: true })];
  if (normalized.includes("python")) return [...extensions, python()];
  if (normalized.includes("java")) return [...extensions, java()];
  if (normalized.includes("c++") || normalized.includes("cpp")) return [...extensions, cpp()];
  if (normalized.includes("sql")) return [...extensions, sql()];

  return extensions;
}

export function SessionPage({ slug }) {
  const router = useRouter();
  const { state, patchAgent, createSessionRecord } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const agentState = state.agents[slug];
  const upload = agentState?.upload;
  const isCodingAgent = slug === "coding";
  const canScreenShare = slug !== "coding";
  const isPanelMode = Boolean(agent?.panelMode && agent?.panelPersonas?.length);
  const panelPersonas = agent?.panelPersonas || [];
  const codingLanguages = agent?.codingLanguages || ["JavaScript", "Pseudocode"];
  const customContextText = agentState?.customContextText || "";
  const companyUrl = agentState?.companyUrl || "";
  const preparedExternalResearch = agentState?.researchPrep?.result || null;
  const sessionName = agentState?.sessionName || "";
  const thread =
    (state.threads?.[slug] || []).find((item) => item.id === agentState.selectedThreadId) || null;

  const [permissionState, setPermissionState] = useState("pending");
  const [sessionPhase, setSessionPhase] = useState("preflight");
  const [statusText, setStatusText] = useState("Preparing rehearsal room...");
  const [modelBuffer, setModelBuffer] = useState("");
  const [userBuffer, setUserBuffer] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [startAttempt, setStartAttempt] = useState(0);
  const [codeLanguage, setCodeLanguage] = useState(codingLanguages[0] || "JavaScript");
  const [codeDraft, setCodeDraft] = useState("");
  const [codeSyncState, setCodeSyncState] = useState("idle");
  const [screenShareState, setScreenShareState] = useState({
    status: "idle",
    surface: "screen",
    error: "",
  });
  const [activePanelSpeaker, setActivePanelSpeaker] = useState(null);
  const activePanelSpeakerRef = useRef(null);
  const codeExtensions = useMemo(() => getCodingLanguageExtensions(codeLanguage), [codeLanguage]);

  const videoRef = useRef(null);
  const screenPreviewRef = useRef(null);
  const anamClientRef = useRef(null);
  const pipWindowRef = useRef(null);
  const browserSocketRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorNodeRef = useRef(null);
  const gainNodeRef = useRef(null);
  const cleanupPromiseRef = useRef(null);
  const startedRef = useRef(false);
  const mutedRef = useRef(false);
  const timerRef = useRef(null);
  const endedRef = useRef(false);
  const liveClosedRef = useRef(false);
  const transcriptListRef = useRef(null);
  const modelBufferRef = useRef("");
  const userBufferRef = useRef("");
  const codeSyncTimerRef = useRef(null);
  const screenFrameTimerRef = useRef(null);
  const screenCaptureCanvasRef = useRef(null);
  const lastSentCodeRef = useRef("");
  const anamAudioStreamRef = useRef(null);
  const mutedStateRef = useRef(false);
  // Panel mode: multiple Anam clients
  const panelVideoRefs = useRef({});
  const panelAnamClientsRef = useRef({});
  const panelAudioStreamsRef = useRef({});
  const transcriptEntries = useMemo(
    () => [
      ...transcript,
      ...(userBuffer.trim()
        ? [{ id: "live-user", role: "You", text: userBuffer.trim(), live: true }]
        : []),
      ...(modelBuffer.trim()
        ? [{ id: "live-model", role: agent?.name || "Agent", text: modelBuffer.trim(), live: true }]
        : []),
    ],
    [transcript, userBuffer, modelBuffer, agent?.name],
  );

  function mergeTranscriptChunk(previous, incoming) {
    const next = (incoming || "").trim();
    if (!next) return previous;
    if (!previous) return next;
    if (next.startsWith(previous)) return next;
    if (previous.startsWith(next)) return previous;
    return `${previous} ${next}`.trim();
  }

  function flushUserTranscript(finalText) {
    const cleaned = (finalText || "").trim();
    if (!cleaned) return;
    setTranscript((current) => [
      ...current,
      {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "You",
        text: cleaned,
        live: false,
      },
    ]);
  }

  function finalizeUserBuffer() {
    const finalText = userBufferRef.current.trim();
    if (!finalText) return;
    flushUserTranscript(finalText);
    setUserBuffer("");
    userBufferRef.current = "";
  }

  useEffect(() => {
    mutedRef.current = agentState?.session?.muted || false;
    mutedStateRef.current = agentState?.session?.muted || false;
  }, [agentState?.session?.muted]);

  useEffect(() => {
    if (!agent || !agentState) return;
    if (sessionName.trim()) return;

    patchAgent(slug, (current) => ({
      ...current,
      session: { ...current.session, status: "idle" },
    }));
    router.replace(`/agents/${slug}`);
  }, [agent, agentState, patchAgent, router, sessionName, slug]);

  useEffect(() => {
    if (!agent || !agentState) return;
    if (thread) return;

    patchAgent(slug, (current) => ({
      ...current,
      session: { ...current.session, status: "idle" },
    }));
    router.replace(`/agents/${slug}`);
  }, [agent, agentState, patchAgent, router, slug, thread]);

  useEffect(() => {
    if (!agent || !agentState) return undefined;
    let cancelled = false;

    async function initializeSession() {
      if (startedRef.current) return;
      endedRef.current = false;
      liveClosedRef.current = false;
      startedRef.current = true;
      patchAgent(slug, (current) => ({
        ...current,
        session: { ...current.session, status: "starting" },
      }));

      try {
        setStatusText("Requesting microphone access...");
        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = mediaStream;
        setPermissionState("granted");
        setSessionPhase("connecting");

        await startSessionFlow(mediaStream);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setPermissionState("denied");
        setSessionPhase("blocked");
        setStatusText("Microphone access is required to start the rehearsal room.");
        patchAgent(slug, (current) => ({
          ...current,
          session: { ...current.session, status: "idle" },
        }));
      }
    }

    initializeSession();

    const unloadHandler = () => {
      void performCleanup();
    };

    window.addEventListener("beforeunload", unloadHandler);
    window.addEventListener("pagehide", unloadHandler);

    return () => {
      cancelled = true;
      startedRef.current = false;
      window.removeEventListener("beforeunload", unloadHandler);
      window.removeEventListener("pagehide", unloadHandler);
      void performCleanup();
    };
    // Effect intentionally re-runs only on agent/slug/startAttempt — performCleanup and
    // startSessionFlow are stable closures that read latest values via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, patchAgent, slug, startAttempt]);

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setElapsed((current) => current + 1);
    }, 1000);

    return () => {
      window.clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const element = transcriptListRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [transcriptEntries]);

  async function closePipWindow() {
    const pipWindow = pipWindowRef.current;
    if (!pipWindow || pipWindow.closed) {
      pipWindowRef.current = null;
      return;
    }

    try {
      pipWindow.close();
    } catch (_error) {}

    pipWindowRef.current = null;
  }

  async function openPipWindow() {
    if (
      !canScreenShare ||
      screenShareState.status !== "active" ||
      sessionPhase !== "live" ||
      typeof window === "undefined" ||
      !("documentPictureInPicture" in window)
    ) {
      return;
    }

    if (pipWindowRef.current && !pipWindowRef.current.closed) return;

    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 360,
        height: 420,
      });

      pipWindowRef.current = pipWindow;
      const pipDocument = pipWindow.document;
      pipDocument.body.innerHTML = "";
      pipDocument.title = "SimCoach Demo Controls";

      const style = pipDocument.createElement("style");
      style.textContent = `
        :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
        body { margin: 0; background: #08111f; color: #f8fbff; }
        .pip-shell { display: grid; gap: 12px; padding: 14px; height: 100vh; box-sizing: border-box; }
        .pip-video { width: 100%; height: 100%; min-height: 250px; border-radius: 18px; background: #0b1220; object-fit: cover; border: 1px solid rgba(138, 180, 248, 0.2); }
        .pip-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .pip-title { font-size: 0.98rem; font-weight: 600; }
        .pip-badge { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 7px 11px; background: rgba(255, 255, 255, 0.08); color: #b5c1d6; font-size: 0.8rem; }
        .pip-dot { width: 8px; height: 8px; border-radius: 999px; background: #34a853; }
        .pip-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        button { min-height: 46px; border: 0; border-radius: 14px; color: #fff; cursor: pointer; font: inherit; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
        .pip-mute { background: #4285f4; }
        .pip-stop { background: #ea4335; }
        .pip-end { background: #c5221f; }
        .pip-icon { width: 18px; height: 18px; stroke: currentColor; }
      `;
      pipDocument.head.appendChild(style);

      const shell = pipDocument.createElement("div");
      shell.className = "pip-shell";

      const row = pipDocument.createElement("div");
      row.className = "pip-row";

      const title = pipDocument.createElement("div");
      title.className = "pip-title";
      title.textContent = agent.name;

      const badge = pipDocument.createElement("div");
      badge.className = "pip-badge";
      badge.innerHTML = `<span class="pip-dot"></span>${getScreenShareStatusLabel()}`;

      row.appendChild(title);
      row.appendChild(badge);

      const pipVideo = pipDocument.createElement("video");
      pipVideo.className = "pip-video";
      pipVideo.autoplay = true;
      pipVideo.playsInline = true;
      pipVideo.muted = true;

      if (videoRef.current?.captureStream) {
        try {
          pipVideo.srcObject = videoRef.current.captureStream();
        } catch (_error) {}
      }

      const actions = pipDocument.createElement("div");
      actions.className = "pip-actions";

      const getMuteIcon = (muted) =>
        muted
          ? `<svg class="pip-icon" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`
          : `<svg class="pip-icon" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;

      const muteButton = pipDocument.createElement("button");
      muteButton.className = "pip-mute";
      muteButton.innerHTML = getMuteIcon(mutedStateRef.current);
      muteButton.setAttribute(
        "aria-label",
        mutedStateRef.current ? "Unmute microphone" : "Mute microphone",
      );
      muteButton.title = mutedStateRef.current ? "Unmute microphone" : "Mute microphone";
      muteButton.addEventListener("click", () => {
        toggleMute();
        muteButton.innerHTML = getMuteIcon(mutedStateRef.current);
        muteButton.setAttribute(
          "aria-label",
          mutedStateRef.current ? "Unmute microphone" : "Mute microphone",
        );
        muteButton.title = mutedStateRef.current ? "Unmute microphone" : "Mute microphone";
      });

      const stopButton = pipDocument.createElement("button");
      stopButton.className = "pip-stop";
      stopButton.innerHTML = `<svg class="pip-icon" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
      stopButton.setAttribute("aria-label", "Stop sharing");
      stopButton.title = "Stop sharing";
      stopButton.addEventListener("click", () => {
        void stopScreenShare();
      });

      const endButton = pipDocument.createElement("button");
      endButton.className = "pip-end";
      endButton.innerHTML = `<svg class="pip-icon" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2"></path><path d="M8 13l-1.5 4"></path><path d="M16 13l1.5 4"></path><path d="M9 13h6"></path></svg>`;
      endButton.setAttribute("aria-label", "End call");
      endButton.title = "End call";
      endButton.addEventListener("click", () => {
        void endSession();
      });

      actions.appendChild(muteButton);
      actions.appendChild(stopButton);
      actions.appendChild(endButton);

      shell.appendChild(row);
      shell.appendChild(pipVideo);
      shell.appendChild(actions);
      pipDocument.body.appendChild(shell);

      pipWindow.addEventListener(
        "pagehide",
        () => {
          pipWindowRef.current = null;
        },
        { once: true },
      );
    } catch (_error) {
      pipWindowRef.current = null;
    }
  }

  useEffect(() => {
    if (!canScreenShare) return undefined;

    if (screenShareState.status === "active" && sessionPhase === "live") {
      void openPipWindow();
    }

    if (screenShareState.status !== "active") {
      void closePipWindow();
    }

    return () => {
      if (screenShareState.status !== "active") {
        void closePipWindow();
      }
    };
    // openPipWindow is a stable closure; we only react to share/session state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canScreenShare, screenShareState.status, sessionPhase]);

  useEffect(() => {
    const preview = screenPreviewRef.current;
    if (!preview) return;

    if (screenStreamRef.current) {
      preview.srcObject = screenStreamRef.current;
      const playPromise = preview.play?.();
      if (playPromise?.catch) playPromise.catch(() => {});
      return;
    }

    preview.srcObject = null;
  }, [screenShareState.status]);

  useEffect(() => {
    if (!isCodingAgent) return undefined;
    if (codeSyncTimerRef.current) {
      window.clearTimeout(codeSyncTimerRef.current);
    }

    if (!codeDraft.trim() || codeDraft === lastSentCodeRef.current) {
      if (sessionPhase === "live" && codeDraft === lastSentCodeRef.current) {
        setCodeSyncState("synced");
      }
      return undefined;
    }

    if (
      sessionPhase !== "live" ||
      !browserSocketRef.current ||
      browserSocketRef.current.readyState !== WebSocket.OPEN
    ) {
      setCodeSyncState("waiting");
      return undefined;
    }

    setCodeSyncState("typing");
    codeSyncTimerRef.current = window.setTimeout(() => {
      const socket = browserSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setCodeSyncState("waiting");
        return;
      }

      socket.send(
        JSON.stringify({
          type: "code_snapshot",
          language: codeLanguage,
          snapshot: codeDraft,
        }),
      );
      lastSentCodeRef.current = codeDraft;
      setCodeSyncState("synced");
    }, 3000);

    return () => {
      if (codeSyncTimerRef.current) {
        window.clearTimeout(codeSyncTimerRef.current);
      }
    };
  }, [codeDraft, codeLanguage, isCodingAgent, sessionPhase]);

  useEffect(() => {
    if (!canScreenShare || screenShareState.status !== "active" || sessionPhase !== "live") {
      if (screenFrameTimerRef.current) {
        window.clearInterval(screenFrameTimerRef.current);
        screenFrameTimerRef.current = null;
      }
      return undefined;
    }

    const captureFrame = () => {
      const socket = browserSocketRef.current;
      const preview = screenPreviewRef.current;
      const stream = screenStreamRef.current;

      if (
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        !preview ||
        !stream ||
        preview.readyState < 2 ||
        !preview.videoWidth ||
        !preview.videoHeight
      ) {
        return;
      }

      let canvas = screenCaptureCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        screenCaptureCanvasRef.current = canvas;
      }

      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / preview.videoWidth);
      canvas.width = Math.max(1, Math.round(preview.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));

      const context = canvas.getContext("2d");
      if (!context) return;

      context.drawImage(preview, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      const base64 = dataUrl.split(",")[1];

      if (!base64) return;

      socket.send(
        JSON.stringify({
          type: "screen_frame",
          data: base64,
          mimeType: "image/jpeg",
          surface: screenShareState.surface,
        }),
      );
    };

    captureFrame();
    screenFrameTimerRef.current = window.setInterval(captureFrame, 1200);

    return () => {
      if (screenFrameTimerRef.current) {
        window.clearInterval(screenFrameTimerRef.current);
        screenFrameTimerRef.current = null;
      }
    };
  }, [canScreenShare, screenShareState.status, screenShareState.surface, sessionPhase]);

  function normalizeDisplaySurface(displaySurface) {
    if (displaySurface === "browser") return "tab";
    if (displaySurface === "window") return "window";
    if (displaySurface === "monitor") return "screen";
    return "screen";
  }

  function getScreenShareStatusLabel() {
    if (screenShareState.status !== "active") return "Not sharing";
    if (screenShareState.surface === "tab") return "Sharing tab";
    if (screenShareState.surface === "window") return "Sharing window";
    return "Sharing screen";
  }

  function getScreenSharePanelTitle() {
    return agent?.screenShareTitle || "Live Screen Share";
  }

  function getScreenShareHelperText() {
    return (
      agent?.screenShareHelperText ||
      "Share a tab or window so the agent can react to what is visibly on screen."
    );
  }

  function getScreenShareEmptyText() {
    return (
      agent?.screenShareEmptyText ||
      "Start sharing when you want the agent to react to what is visibly on screen."
    );
  }

  async function notifyScreenShareState(active, surface = "screen") {
    const socket = browserSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ type: "screen_share_state", active, surface }));
  }

  async function stopScreenShare() {
    await closePipWindow();

    if (screenFrameTimerRef.current) {
      window.clearInterval(screenFrameTimerRef.current);
      screenFrameTimerRef.current = null;
    }

    const stream = screenStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }

    if (screenPreviewRef.current) {
      screenPreviewRef.current.srcObject = null;
    }

    setScreenShareState({ status: "idle", surface: "screen", error: "" });

    await notifyScreenShareState(false);
  }

  async function startScreenShare() {
    if (!canScreenShare || sessionPhase !== "live") return;

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenShareState({
        status: "error",
        surface: "screen",
        error: "Screen sharing is not supported in this browser.",
      });
      return;
    }

    try {
      setScreenShareState((current) => ({ ...current, status: "requesting", error: "" }));

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 8 } },
        audio: false,
      });

      const [track] = stream.getVideoTracks();
      const surface = normalizeDisplaySurface(track?.getSettings?.().displaySurface);

      track?.addEventListener(
        "ended",
        () => {
          void stopScreenShare();
        },
        { once: true },
      );

      screenStreamRef.current = stream;
      setScreenShareState({ status: "active", surface, error: "" });

      await notifyScreenShareState(true, surface);
      await openPipWindow();
    } catch (error) {
      const denied =
        error?.name === "NotAllowedError" ||
        error?.name === "PermissionDeniedError" ||
        error?.name === "AbortError";

      setScreenShareState({
        status: denied ? "denied" : "error",
        surface: "screen",
        error: denied
          ? "Screen sharing permission was denied. You can keep the session going without a demo."
          : error?.message || "Screen sharing could not be started.",
      });
    }
  }

  async function createMicPipeline(mediaStream) {
    const audioContext = new window.AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;

    sourceNode.connect(processorNode);
    processorNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    processorNode.onaudioprocess = (event) => {
      if (mutedRef.current) return;

      const socket = browserSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleFloat32(input, audioContext.sampleRate, 16000);
      const pcm16 = floatTo16BitPCM(downsampled);
      const audioBase64 = int16ToBase64(pcm16);

      socket.send(
        JSON.stringify({
          type: "user_audio",
          data: audioBase64,
          mimeType: "audio/pcm;rate=16000",
        }),
      );
    };

    audioContextRef.current = audioContext;
    sourceNodeRef.current = sourceNode;
    processorNodeRef.current = processorNode;
    gainNodeRef.current = gainNode;
  }

  function attachSocketHandlers(socket) {
    socket.onopen = () => {
      setStatusText("Connected to the live question bridge.");
      socket.send(
        JSON.stringify({
          type: "session_context",
          customContext: customContextText,
          threadContext: thread?.memory?.hiddenGuidance || "",
          companyUrl: companyUrl,
          externalResearch: preparedExternalResearch,
          upload: upload?.contextText
            ? { fileName: upload.fileName || "", contextText: upload.contextText }
            : null,
        }),
      );
      socket.send(JSON.stringify({ type: "get_history" }));
      if (isCodingAgent && codeDraft.trim()) {
        socket.send(
          JSON.stringify({
            type: "code_snapshot",
            language: codeLanguage,
            snapshot: codeDraft,
          }),
        );
        lastSentCodeRef.current = codeDraft;
        setCodeSyncState("synced");
      }
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "status") {
        setStatusText(message.message);
        return;
      }

      if (message.type === "live_closed") {
        liveClosedRef.current = true;
        setSessionPhase("ended");
        setStatusText(message.message || "Gemini Live session ended.");
        void performCleanup();
        return;
      }

      if (message.type === "error") {
        setSessionPhase("error");
        setStatusText(message.message || "The session encountered an error.");
        return;
      }

      // panel_speaker — server tells us who's about to speak (arrives before audio)
      if (message.type === "panel_speaker" && isPanelMode) {
        const persona = panelPersonas.find((p) => p.id === message.personaId);
        if (persona) {
          setActivePanelSpeaker(persona.id);
          activePanelSpeakerRef.current = persona.id;
        }
        return;
      }

      if (message.type === "model_text") {
        let text = message.text || "";
        let displayText = text;
        // In panel mode, detect active speaker from [PersonaName] prefix
        if (isPanelMode) {
          const match = text.match(/^\[([^\]]+)\]\s*/);
          if (match) {
            const speakerName = match[1];
            const persona = panelPersonas.find((p) => p.name === speakerName);
            if (persona) {
              setActivePanelSpeaker(persona.id);
              activePanelSpeakerRef.current = persona.id;
            }
            // Strip [Name] prefix from display only
            displayText = text.slice(match[0].length);
          }
          // Strip turn control tags from display only
          displayText = displayText.replace(/\[PASS\]/gi, "").replace(/\[FOLLOW-UP:[^\]]*\]/gi, "").replace(/\[PAUSE\]/gi, "");
        }
        // Always update the buffer (even if displayText is empty — keeps accumulation working)
        const cleanText = (displayText || "").trim();
        if (!cleanText) return;
        setModelBuffer((current) => {
          const next = mergeTranscriptChunk(current, cleanText);
          modelBufferRef.current = next;
          return next;
        });
        return;
      }

      if (message.type === "user_transcription") {
        const nextText = (message.text || "").trim();
        setUserBuffer(nextText);
        userBufferRef.current = nextText;

        if (message.finished) {
          finalizeUserBuffer();
          // Reset active speaker when founder speaks
          if (isPanelMode) { setActivePanelSpeaker(null); activePanelSpeakerRef.current = null; }
        }
        return;
      }

      if (message.type === "audio_chunk") {
        const pcm24kBytes = base64ToUint8Array(message.data);
        const pcm24kInt16 = pcmBytesToInt16Array(pcm24kBytes);
        const pcm16kInt16 = downsampleInt16(pcm24kInt16, 24000, 16000);
        const audioData = new Uint8Array(pcm16kInt16.buffer);

        if (isPanelMode) {
          // Route audio to the active speaker's Anam stream using ref (not stale state)
          const currentSpeaker = activePanelSpeakerRef.current;
          const activeStream = currentSpeaker ? panelAudioStreamsRef.current[currentSpeaker] : null;
          if (activeStream) {
            activeStream.sendAudioChunk(audioData);
          }
        } else if (anamAudioStreamRef.current) {
          anamAudioStreamRef.current.sendAudioChunk(audioData);
        }
        return;
      }

      if (message.type === "turn_complete") {
        const finalText = modelBufferRef.current.trim();
        if (isPanelMode) {
          const activeStream = panelAudioStreamsRef.current[activePanelSpeakerRef.current];
          if (activeStream) {
            try { activeStream.endSequence(); } catch (_) {}
          }
          setActivePanelSpeaker(null);
          activePanelSpeakerRef.current = null;
        } else if (anamAudioStreamRef.current) {
          try { anamAudioStreamRef.current.endSequence(); } catch (error) {
            console.error("Anam audio sequence end error:", error);
          }
        }
        if (finalText) {
          setTranscript((current) => [
            ...current,
            { id: `model-${Date.now()}`, role: agent.name, text: finalText, live: false },
          ]);
          socket.send(JSON.stringify({ type: "save_model_text", text: finalText }));
        }
        setModelBuffer("");
        modelBufferRef.current = "";
        return;
      }

      if (message.type === "history") {
        const nextTranscript = (message.history || [])
          .filter(
            (item) =>
              item.text &&
              !item.text.startsWith(`Begin this ${agent.name} rehearsal with a short greeting`),
          )
          .map((item) => ({
            id: `history-${item.role}-${item.text.slice(0, 32)}`,
            role: item.role === "user" ? "You" : agent.name,
            text: item.text,
            live: false,
          }));

        setTranscript((current) => {
          if (!current.length && !modelBufferRef.current.trim()) return nextTranscript;

          const existingKeys = new Set(
            current.map((entry) => `${entry.role}::${entry.text.trim()}`),
          );
          const additions = nextTranscript.filter(
            (entry) => !existingKeys.has(`${entry.role}::${entry.text.trim()}`),
          );
          return additions.length ? [...current, ...additions] : current;
        });
      }
    };

    socket.onerror = () => {
      setSessionPhase("error");
      setStatusText("The live browser bridge disconnected.");
    };

    socket.onclose = () => {
      if (!endedRef.current) setStatusText("The live browser bridge closed.");
    };
  }

  async function startSessionFlow(mediaStream) {
    try {
      setStatusText("Creating secure avatar session...");
      const tokenResponse = await fetch(getApiUrl("/api/anam-session-token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: slug }),
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenPayload?.sessionToken) {
        throw new Error(
          tokenPayload?.details || tokenPayload?.error || "Failed to create Anam session.",
        );
      }
      const selectedVoiceName = tokenPayload?.avatarProfile?.voiceName || "";

      const socketUrl = `${getBackendWsUrl()}/api/live?agent=${encodeURIComponent(slug)}&voice=${encodeURIComponent(selectedVoiceName)}`;
      const socket = new WebSocket(socketUrl);
      browserSocketRef.current = socket;
      attachSocketHandlers(socket);
      await createMicPipeline(mediaStream);

      setSessionPhase("live");
      setStatusText("Session is live.");
      patchAgent(slug, (current) => ({
        ...current,
        session: { ...current.session, status: "active" },
      }));

      if (isPanelMode) {
        // Panel mode: create 3 separate Anam sessions
        setStatusText("Connecting panel avatars...");
        for (let i = 0; i < panelPersonas.length; i++) {
          const persona = panelPersonas[i];
          try {
            const panelTokenRes = await fetch(getApiUrl("/api/anam-session-token"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agentSlug: slug,
                keyIndex: i,
                avatarId: persona.avatarId,
                avatarName: persona.name,
              }),
            });
            const panelTokenPayload = await panelTokenRes.json();
            if (!panelTokenRes.ok || !panelTokenPayload?.sessionToken) {
              console.warn(`Failed to get Anam token for ${persona.name}`);
              continue;
            }

            const panelClient = createClient(panelTokenPayload.sessionToken, {
              disableInputAudio: true,
            });

            panelClient.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
              console.log(`[panel] ${persona.name} avatar video started`);
            });

            panelClient.addListener(AnamEvent.CONNECTION_CLOSED, (_reason, details) => {
              if (endedRef.current) return;
              console.warn(`[panel] ${persona.name} avatar closed:`, details);
            });

            panelAnamClientsRef.current[persona.id] = panelClient;

            const videoElementId = `anam-panel-${persona.id}`;
            await panelClient.streamToVideoElement(videoElementId);

            panelAudioStreamsRef.current[persona.id] = panelClient.createAgentAudioInputStream({
              encoding: "pcm_s16le",
              sampleRate: 16000,
              channels: 1,
            });

            console.log(`[panel] ${persona.name} avatar connected`);
          } catch (anamError) {
            console.warn(`Anam avatar failed for ${persona.name}:`, anamError.message);
          }
        }
        setStatusText("Panel session is live.");
      } else if (videoRef.current) {
        try {
          const anamClient = createClient(tokenPayload.sessionToken, {
            disableInputAudio: true,
          });

          anamClient.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
            setStatusText("Avatar connected. Session is live.");
          });

          anamClient.addListener(AnamEvent.CONNECTION_CLOSED, (_reason, details) => {
            if (endedRef.current) return;
            console.warn("Anam connection closed:", details);
          });

          anamClient.addListener(AnamEvent.SERVER_WARNING, (message) => {
            console.warn("Anam warning:", message);
          });

          anamClientRef.current = anamClient;

          await anamClient.streamToVideoElement("anam-video-stage");
          anamAudioStreamRef.current = anamClient.createAgentAudioInputStream({
            encoding: "pcm_s16le",
            sampleRate: 16000,
            channels: 1,
          });
        } catch (anamError) {
          console.warn(
            "Anam avatar failed to connect (session continues without avatar):",
            anamError.message,
          );
        }
      }
    } catch (error) {
      console.error(error);
      setSessionPhase("error");
      setStatusText(error.message || "Failed to start the session.");
      patchAgent(slug, (current) => ({
        ...current,
        session: { ...current.session, status: "idle" },
      }));
    }
  }

  async function performCleanup() {
    if (cleanupPromiseRef.current) return cleanupPromiseRef.current;

    cleanupPromiseRef.current = (async () => {
      if (codeSyncTimerRef.current) {
        window.clearTimeout(codeSyncTimerRef.current);
        codeSyncTimerRef.current = null;
      }

      if (processorNodeRef.current) {
        processorNodeRef.current.disconnect();
        processorNodeRef.current = null;
      }

      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }

      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }

      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch (_error) {}
        audioContextRef.current = null;
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (screenFrameTimerRef.current) {
        window.clearInterval(screenFrameTimerRef.current);
        screenFrameTimerRef.current = null;
      }

      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }

      await closePipWindow();

      if (screenPreviewRef.current) {
        screenPreviewRef.current.srcObject = null;
      }

      if (browserSocketRef.current) {
        browserSocketRef.current.close();
        browserSocketRef.current = null;
      }

      if (anamClientRef.current) {
        try {
          await anamClientRef.current.stopStreaming();
        } catch (_error) {}
        anamClientRef.current = null;
      }
      anamAudioStreamRef.current = null;

      // Clean up panel Anam clients
      for (const [id, client] of Object.entries(panelAnamClientsRef.current)) {
        try { await client.stopStreaming(); } catch (_) {}
      }
      panelAnamClientsRef.current = {};
      panelAudioStreamsRef.current = {};
      setModelBuffer("");
      modelBufferRef.current = "";
      setUserBuffer("");
      userBufferRef.current = "";
      setScreenShareState({ status: "idle", surface: "screen", error: "" });
    })();

    await cleanupPromiseRef.current;
    cleanupPromiseRef.current = null;
  }

  async function retryMicAccess() {
    setPermissionState("pending");
    setSessionPhase("preflight");
    setStatusText("Requesting microphone access...");
    startedRef.current = false;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setStartAttempt((current) => current + 1);
  }

  async function endSession() {
    endedRef.current = true;
    setSessionPhase("ended");
    setStatusText("Ending rehearsal room...");
    const transcriptSnapshot = [...transcript];
    const finalUserText = userBufferRef.current.trim();
    const finalModelText = modelBufferRef.current.trim();

    if (finalUserText) {
      transcriptSnapshot.push({
        id: `user-${Date.now()}-final`,
        role: "You",
        text: finalUserText,
        live: false,
      });
    }

    if (finalModelText) {
      transcriptSnapshot.push({
        id: `model-${Date.now()}-final`,
        role: agent.name,
        text: finalModelText,
        live: false,
      });
    }

    await performCleanup();
    const now = new Date();
    createSessionRecord({
      id: `session-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      agentSlug: slug,
      agentName: agent.name,
      sessionName: sessionName.trim(),
      threadId: thread.id,
      startedAt: new Date(now.getTime() - elapsed * 1000).toISOString(),
      endedAt: now.toISOString(),
      durationLabel: formatDuration(elapsed),
      transcript: transcriptSnapshot,
      upload: upload.fileName
        ? {
            fileName: upload.fileName,
            contextPreview: upload.contextPreview,
            contextText: upload.contextText,
          }
        : null,
      coding: isCodingAgent
        ? {
            language: codeLanguage,
            finalCode: codeDraft,
            companyUrl: companyUrl.trim(),
            interviewQuestion: preparedExternalResearch,
          }
        : null,
      externalResearch: !isCodingAgent ? preparedExternalResearch : null,
      customContext: customContextText.trim(),
    });
    patchAgent(slug, (current) => ({
      ...current,
      upload: {
        status: "idle",
        fileName: "",
        previewUrl: "",
        previewOpen: false,
        contextPreview: "",
        contextText: "",
        error: "",
      },
      session: {
        ...current.session,
        status: "idle",
        lastEndedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        lastDurationLabel: formatDuration(elapsed),
      },
      researchPrep: { status: "idle", result: null, error: "" },
    }));
    router.replace(`/agents/${slug}?ended=1`);
  }

  function toggleMute() {
    mutedRef.current = !mutedRef.current;
    mutedStateRef.current = mutedRef.current;
    patchAgent(slug, (current) => ({
      ...current,
      session: { ...current.session, muted: mutedRef.current },
    }));
  }

  if (!agent || !agentState) {
    return (
      <AppShell compact>
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center">
            Missing session context. Return to the{" "}
            <Link href="/" className="text-primary underline-offset-4 hover:underline">
              landing page
            </Link>
            .
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const codeSyncBadgeVariant =
    codeSyncState === "synced" ? "success" : codeSyncState === "typing" ? "warning" : "outline";
  const codeSyncBadgeText =
    codeSyncState === "synced"
      ? "Code synced to interviewer"
      : codeSyncState === "typing"
        ? "Preparing snapshot..."
        : codeSyncState === "waiting"
          ? "Waiting for room connection"
          : "Type while you think aloud";

  const screenShareBadgeVariant =
    screenShareState.status === "active"
      ? "success"
      : screenShareState.status === "denied" || screenShareState.status === "error"
        ? "destructive"
        : "outline";

  return (
    <AppShell compact>
      <div className="flex h-[calc(100vh-8rem)] min-h-[640px] flex-col gap-4">
        <Card className="py-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-lg">
                <Sparkles className="size-5" />
              </div>
              <div>
                <div className="text-sm leading-tight font-semibold">{agent.name}</div>
                <div className="text-muted-foreground text-xs">
                  {agent.scenario}
                  {thread ? ` · ${thread.title}` : ""}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-right">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">
                  Document
                </div>
                <div className="text-sm font-medium">{upload.fileName || "No supporting file"}</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground text-xs tracking-wide uppercase">Elapsed</div>
                <div className="font-mono text-sm font-medium">{formatDuration(elapsed)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid flex-1 gap-4 overflow-hidden lg:grid-cols-[1.6fr_1fr]">
          <Card className="relative flex min-h-[360px] flex-col overflow-hidden p-0">
            <div className="bg-background/80 absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur">
              <span
                className={cn(
                  "size-2 rounded-full",
                  sessionPhase === "live"
                    ? "animate-pulse bg-[color:var(--success)]"
                    : "bg-muted-foreground",
                )}
              />
              {sessionPhase === "live"
                ? isPanelMode
                  ? "Live panel"
                  : "Live rehearsal"
                : isPanelMode
                  ? "Preparing panel"
                  : "Preparing room"}
            </div>
            {isPanelMode ? (
              <div className="grid h-full flex-1 grid-cols-1 gap-2 p-2 pt-12 sm:grid-cols-2 lg:grid-cols-3">
                {panelPersonas.map((persona) => (
                  <div
                    key={persona.id}
                    className={cn(
                      "relative flex flex-col overflow-hidden rounded-lg border-2 bg-black transition-all",
                      activePanelSpeaker === persona.id
                        ? "border-[color:var(--success)] shadow-[0_0_0_3px_rgba(52,168,83,0.25)]"
                        : "border-transparent",
                    )}
                  >
                    <video
                      id={`anam-panel-${persona.id}`}
                      className="min-h-0 w-full flex-1 object-cover"
                      autoPlay
                      playsInline
                    />
                    <div className="flex items-center gap-2 bg-black/60 px-3 py-2 text-xs font-semibold text-white backdrop-blur">
                      <span
                        className={cn(
                          "size-2 rounded-full transition-all",
                          activePanelSpeaker === persona.id
                            ? "animate-pulse bg-[color:var(--success)]"
                            : "bg-muted-foreground",
                        )}
                      />
                      <span>{persona.name}</span>
                      {persona.role ? (
                        <span className="ml-1 text-[0.7rem] opacity-60">({persona.role})</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <video
                id="anam-video-stage"
                ref={videoRef}
                className="h-full w-full bg-black object-cover"
                autoPlay
                playsInline
              />
            )}

            {(sessionPhase === "preflight" || sessionPhase === "connecting") && (
              <div className="bg-background/80 absolute inset-0 z-20 grid place-items-center backdrop-blur">
                <Card className="max-w-sm">
                  <CardContent className="flex flex-col items-center gap-3 text-center">
                    <Loader2 className="text-primary size-6 animate-spin" />
                    <div className="text-base font-semibold">Setting up your live room</div>
                    <p className="text-muted-foreground text-sm">{statusText}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {permissionState === "denied" && (
              <div className="bg-background/80 absolute inset-0 z-20 grid place-items-center backdrop-blur">
                <Card className="max-w-md">
                  <CardContent className="flex flex-col items-center gap-3 text-center">
                    <div className="text-base font-semibold">Microphone access required</div>
                    <p className="text-muted-foreground text-sm">
                      SimCoach cannot begin the session until browser audio permission is granted.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 pt-1">
                      <Button onClick={retryMicAccess}>Try again</Button>
                      <Button variant="outline" asChild>
                        <Link href={`/agents/${slug}`}>Back to setup</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {sessionPhase === "error" && (
              <div className="bg-background/80 absolute inset-0 z-20 grid place-items-center backdrop-blur">
                <Card className="max-w-md">
                  <CardContent className="flex flex-col items-center gap-3 text-center">
                    <div className="text-base font-semibold">Session unavailable</div>
                    <p className="text-muted-foreground text-sm">{statusText}</p>
                    <Button variant="destructive" onClick={endSession}>
                      Leave room
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {sessionPhase === "ended" && liveClosedRef.current && (
              <div className="bg-background/80 absolute inset-0 z-20 grid place-items-center backdrop-blur">
                <Card className="max-w-md">
                  <CardContent className="flex flex-col items-center gap-3 text-center">
                    <div className="text-base font-semibold">Session ended</div>
                    <p className="text-muted-foreground text-sm">{statusText}</p>
                    <Button variant="destructive" onClick={endSession}>
                      Back to setup
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}
          </Card>

          {isCodingAgent ? (
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>Live codepad</CardTitle>
                    <Badge variant={codeSyncBadgeVariant}>{codeSyncBadgeText}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="code-language">Language</Label>
                    <Select value={codeLanguage} onValueChange={setCodeLanguage}>
                      <SelectTrigger id="code-language" className="min-w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {codingLanguages.map((language) => (
                          <SelectItem key={language} value={language}>
                            {language}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="overflow-hidden rounded-md border">
                    <CodeMirror
                      value={codeDraft}
                      height="320px"
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: false,
                        highlightActiveLine: true,
                        highlightActiveLineGutter: true,
                        tabSize: 2,
                      }}
                      extensions={codeExtensions}
                      onChange={(value) => setCodeDraft(value)}
                      theme={state.theme === "light" ? "light" : "dark"}
                      placeholder="Write interview code here while explaining your thought process aloud."
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="flex-1">
                <CardHeader>
                  <CardTitle>Live transcript</CardTitle>
                  <p className="text-muted-foreground text-xs">Current status: {statusText}</p>
                </CardHeader>
                <CardContent>
                  <div
                    ref={transcriptListRef}
                    className="flex max-h-[280px] flex-col gap-2 overflow-y-auto pr-1"
                  >
                    {transcriptEntries.length ? (
                      transcriptEntries.map((entry, index) => (
                        <div
                          key={entry.id || `${entry.role}-${index}`}
                          className="bg-card/40 rounded-lg border p-3"
                        >
                          <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                            {entry.role}
                            {entry.live ? " • Live" : ""}
                          </div>
                          <p className="mt-1 text-sm">{entry.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
                        Transcript will appear here after the problem intro begins.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : canScreenShare ? (
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle>{getScreenSharePanelTitle()}</CardTitle>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {getScreenShareHelperText()}
                      </p>
                    </div>
                    <Badge variant={screenShareBadgeVariant}>{getScreenShareStatusLabel()}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={startScreenShare}
                      disabled={
                        sessionPhase !== "live" ||
                        screenShareState.status === "requesting" ||
                        screenShareState.status === "active"
                      }
                    >
                      {screenShareState.status === "requesting"
                        ? "Requesting access..."
                        : "Share Demo"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={stopScreenShare}
                      disabled={screenShareState.status !== "active"}
                    >
                      Stop Sharing
                    </Button>
                  </div>
                  {screenShareState.error ? (
                    <Alert variant="destructive">
                      <AlertTitle>Demo sharing unavailable</AlertTitle>
                      <AlertDescription>{screenShareState.error}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div
                    className={cn(
                      "overflow-hidden rounded-lg border",
                      screenShareState.status === "active" ? "bg-black" : "bg-card/40",
                    )}
                  >
                    {screenShareState.status === "active" ? (
                      <video
                        ref={screenPreviewRef}
                        className="h-48 w-full object-contain"
                        autoPlay
                        playsInline
                        muted
                      />
                    ) : (
                      <div className="p-4 text-center">
                        <div className="text-sm font-semibold">Not sharing</div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {getScreenShareEmptyText()}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="flex-1">
                <CardHeader>
                  <CardTitle>Live transcript</CardTitle>
                  <p className="text-muted-foreground text-xs">Current status: {statusText}</p>
                </CardHeader>
                <CardContent>
                  <div
                    ref={transcriptListRef}
                    className="flex max-h-[280px] flex-col gap-2 overflow-y-auto pr-1"
                  >
                    {transcriptEntries.length ? (
                      transcriptEntries.map((entry, index) => (
                        <div
                          key={entry.id || `${entry.role}-${index}`}
                          className="bg-card/40 rounded-lg border p-3"
                        >
                          <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                            {entry.role}
                            {entry.live ? " • Live" : ""}
                          </div>
                          <p className="mt-1 text-sm">{entry.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
                        Transcript will appear here after the session begins.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="flex min-h-0 flex-col">
              <CardHeader>
                <CardTitle>Live transcript</CardTitle>
                <p className="text-muted-foreground text-xs">Current status: {statusText}</p>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <div
                  ref={transcriptListRef}
                  className="flex h-full flex-col gap-2 overflow-y-auto pr-1"
                >
                  {transcriptEntries.length ? (
                    transcriptEntries.map((entry, index) => (
                      <div
                        key={entry.id || `${entry.role}-${index}`}
                        className="bg-card/40 rounded-lg border p-3"
                      >
                        <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                          {entry.role}
                          {entry.live ? " • Live" : ""}
                        </div>
                        <p className="mt-1 text-sm">{entry.text}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
                      Transcript will appear here after the greeting and first question begin.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="py-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant={agentState.session.muted ? "outline" : "default"}
                onClick={toggleMute}
                aria-label={agentState.session.muted ? "Unmute microphone" : "Mute microphone"}
              >
                {agentState.session.muted ? (
                  <MicOff className="size-4" />
                ) : (
                  <Mic className="size-4" />
                )}
                {agentState.session.muted ? "Unmute" : "Mute"}
              </Button>
              <div className="text-xs">
                <strong className="block">
                  {agentState.session.muted ? "Microphone muted" : "Microphone live"}
                </strong>
                <span className="text-muted-foreground">
                  {agentState.session.muted
                    ? "Your audio is paused until you unmute."
                    : "Your audio is streaming to the rehearsal room."}
                </span>
              </div>
              {modelBuffer.trim() ? (
                <Badge variant="warning">Transcript streaming live</Badge>
              ) : null}
              {transcript.length ? (
                <Badge variant="success">
                  {transcript.length} transcript turn{transcript.length > 1 ? "s" : ""}
                </Badge>
              ) : null}
              {!transcript.length && !modelBuffer.trim() ? (
                <Badge variant="outline">Waiting for transcript data</Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {canScreenShare ? (
                <Badge variant={screenShareBadgeVariant}>{getScreenShareStatusLabel()}</Badge>
              ) : null}
              <Button variant="destructive" onClick={endSession}>
                <PhoneOff className="size-4" />
                End call
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
