import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import AssistantInsights from './AssistantInsights';
import AssistantMarkdown from './AssistantMarkdown';
import {
  X,
  Bot,
  Sparkles,
  BarChart3,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Send,
  Key,
  Calendar,
  RefreshCw,
  Wallet,
  Clock,
  PieChart,
  ShieldCheck,
  ChevronRight,
  Mic,
  MicOff
} from 'lucide-react';
import {
  getAvailableMonths,
  getPeriodAnalytics,
  getFullMasterContext
} from '../../utils/analyticsEngine';
import { askGeminiAssistant, checkRateLimit, DEFAULT_API_KEY, DEFAULT_NVIDIA_KEY, transcribeVoiceAudio } from '../../utils/geminiAssistant';
import { formatINR, formatDate } from '../../utils/formatters';
import './SmartAssistantModal.css';

const INTRODUCTION_KEY = 'dawa_assistant_intro_shown_at';
const INTRODUCTION_TEXT = 'Hello! I’m your accounts assistant. Ask me about income, expenses, categories, pending vouchers, or any reporting period.';
const INTRODUCTION_WINDOW_MS = 60 * 60 * 1000;

function getInitialChatMessages() {
  try {
    const lastShown = Number(localStorage.getItem(INTRODUCTION_KEY) || 0);
    if (lastShown && Date.now() - lastShown < INTRODUCTION_WINDOW_MS) return [];
  } catch {
    // If storage is unavailable, favor showing the introduction over hiding it.
  }
  return [{ role: 'assistant', text: INTRODUCTION_TEXT }];
}

export default function SmartAssistantModal({ isOpen, onClose }) {
  // Mobile-first: On mobile devices (< 768px), AI Assistant (chat) opens first
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return 'chat';
    }
    return 'chat';
  });

  // Range Filter: 'today' | 'this_week' | 'this_month' | 'custom_month' | 'all'
  const [rangeMode, setRangeMode] = useState('today');
  const [months, setMonths] = useState([]);
  const [customMonth, setCustomMonth] = useState('');

  // Metric View: 'summary' | 'top_expenses' | 'pending' | 'comparison'
  const [metricView, setMetricView] = useState('summary');

  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [analytics, setAnalytics] = useState(null);

  // AI Chat states - Dual Provider: Gemini (Primary) & NVIDIA DeepSeek (Fallback)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('dawa_gemini_api_key') || DEFAULT_API_KEY);
  const [nvidiaApiKey, setNvidiaApiKey] = useState(() => localStorage.getItem('dawa_nvidia_api_key') || DEFAULT_NVIDIA_KEY);
  const [showKeySettings, setShowKeySettings] = useState(false);
  const [rateInfo, setRateInfo] = useState({ allowed: true, remaining: 5, totalLimit: 5, resetMinutes: 0 });
  const [chatMessages, setChatMessages] = useState(getInitialChatMessages);
  const shouldMarkIntroRef = useRef(chatMessages[0]?.text === INTRODUCTION_TEXT);
  const [questionInput, setQuestionInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceTranscribing, setIsVoiceTranscribing] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const chatEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceTimerRef = useRef(null);
  const cancelVoiceRef = useRef(false);
  const voicePrefixRef = useRef('');

  const initialInputRef = useRef('');

  const stopListening = (cancelRecording = false) => {
    cancelVoiceRef.current = cancelRecording;
    if (recognitionRef.current) {
      try {
        const rec = recognitionRef.current;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch (error) {
        console.warn('[SpeechRecognition] stop error:', error);
      }
      recognitionRef.current = null;
    }
    if (voiceTimerRef.current) {
      window.clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (voiceRecorderRef.current?.state === 'recording') {
      try {
        voiceRecorderRef.current.stop();
      } catch (error) {
        console.warn('[VoiceRecorder] stop error:', error);
      }
    }
    if (cancelRecording) {
      voiceRecorderRef.current = null;
      voiceChunksRef.current = [];
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
    }
    setIsListening(false);
    initialInputRef.current = '';
  };

  // Stop speech recognition when modal closes or unmounts
  useEffect(() => {
    return () => {
      stopListening(true);
    };
  }, [isOpen]);

  const toggleListening = async () => {
    setSpeechError('');
    if (isListening) {
      if (voiceRecorderRef.current?.state === 'recording') {
        setIsVoiceTranscribing(true);
      }
      stopListening();
      return;
    }

    // Prefer recorded audio + transcription so voice input does not depend on each
    // browser's proprietary SpeechRecognition service. Keep native recognition as fallback.
    let stream = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (mediaErr) {
      console.warn('[Microphone] getUserMedia error:', mediaErr);
      if (mediaErr.name === 'NotAllowedError' || mediaErr.name === 'PermissionDeniedError') {
        setSpeechError('Microphone access is blocked. Allow microphone access in your browser settings.');
        return;
      } else if (mediaErr.name === 'NotFoundError' || mediaErr.name === 'DevicesNotFoundError') {
        setSpeechError('No microphone was found. Check that a microphone is connected.');
        return;
      }
    }

    if (stream && typeof window.MediaRecorder !== 'undefined') {
      try {
        const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        const mimeType = mimeCandidates.find((type) => window.MediaRecorder.isTypeSupported?.(type));
        const recorder = mimeType
          ? new window.MediaRecorder(stream, { mimeType })
          : new window.MediaRecorder(stream);

        initialInputRef.current = questionInput || '';
        voicePrefixRef.current = questionInput || '';
        voiceChunksRef.current = [];
        voiceStreamRef.current = stream;
        cancelVoiceRef.current = false;
        recorder.ondataavailable = (event) => {
          if (event.data?.size) voiceChunksRef.current.push(event.data);
        };
        recorder.onerror = (event) => {
          console.warn('[VoiceRecorder] error:', event.error);
          stopListening(true);
          setSpeechError('Microphone recording failed. Please try again or type your question.');
        };
        recorder.onstop = async () => {
          const chunks = voiceChunksRef.current;
          const cancelled = cancelVoiceRef.current;
          const blob = chunks.length
            ? new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' })
            : null;
          voiceRecorderRef.current = null;
          voiceChunksRef.current = [];
          voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
          voiceStreamRef.current = null;
          if (cancelled) return;

          setIsVoiceTranscribing(true);
          try {
            const activeKey = apiKey?.trim() || localStorage.getItem('dawa_gemini_api_key') || DEFAULT_API_KEY;
            const transcript = await transcribeVoiceAudio({ audioBlob: blob, geminiKey: activeKey });
            const prefix = voicePrefixRef.current ? `${voicePrefixRef.current.trim()} ` : '';
            setQuestionInput(`${prefix}${transcript}`.trim());
            setSpeechError('');
          } catch (transcriptionError) {
            console.warn('[VoiceTranscription] error:', transcriptionError);
            setSpeechError(transcriptionError.message || 'Voice transcription failed. Please try again or type your question.');
          } finally {
            initialInputRef.current = '';
            voicePrefixRef.current = '';
            setIsVoiceTranscribing(false);
          }
        };

        voiceRecorderRef.current = recorder;
        recorder.start(500);
        setIsListening(true);
        setSpeechError('');
        voiceTimerRef.current = window.setTimeout(() => {
          if (voiceRecorderRef.current?.state === 'recording') {
            setIsVoiceTranscribing(true);
            stopListening();
          }
        }, 60_000);
        return;
      } catch (recorderError) {
        console.warn('[VoiceRecorder] setup error:', recorderError);
        stream.getTracks().forEach((track) => track.stop());
      }
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      stream?.getTracks().forEach((track) => track.stop());
      setSpeechError('Voice input is not supported by this browser. Please type your question.');
      return;
    }

    // The native fallback uses the browser's speech service and may require internet access.
    stream?.getTracks().forEach((track) => track.stop());
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ml-IN'; // Malayalam
      recognition.continuous = true;
      recognition.interimResults = true;

      initialInputRef.current = questionInput || '';
      let accumulatedFinal = '';

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError('');
      };

      recognition.onresult = (event) => {
        let currentInterim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            accumulatedFinal += (accumulatedFinal ? ' ' : '') + trans.trim();
          } else {
            currentInterim += trans;
          }
        }

        const spokenText = accumulatedFinal + (currentInterim ? ' ' + currentInterim : '');
        const prefix = initialInputRef.current ? initialInputRef.current.trim() + ' ' : '';
        setQuestionInput((prefix + spokenText).trim());
      };

      recognition.onerror = (event) => {
        console.warn('[SpeechRecognition] error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setIsListening(false);
          setSpeechError('Microphone permission is blocked. Allow microphone access in your browser settings.');
        } else if (event.error === 'network') {
          setIsListening(false);
          setSpeechError('Voice input is temporarily unavailable. Please try again or type your question.');
        } else if (event.error === 'audio-capture') {
          setIsListening(false);
          setSpeechError('No microphone was found, or another app is using it.');
        } else if (event.error === 'no-speech') {
          // Do not cancel immediately if no speech
          setSpeechError('No speech was detected. Please try speaking again.');
        } else {
          setSpeechError(`Voice input error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('[SpeechRecognition] start error:', err);
      setIsListening(false);
      setSpeechError('Could not start the microphone: ' + (err.message || 'Unknown error'));
    }
  };

  // 1. Load available months on open & ensure mobile opens AI Assistant tab
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setActiveTab('chat');
    }

    async function initMonths() {
      const avail = await getAvailableMonths();
      if (!isMounted) return;
      setMonths(avail);
      if (avail.length > 0) {
        setCustomMonth(avail[0]);
      }
    }

    initMonths();
    setRateInfo(checkRateLimit());
    return () => { isMounted = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !shouldMarkIntroRef.current) return;
    try {
      localStorage.setItem(INTRODUCTION_KEY, String(Date.now()));
    } catch {
      // The chat remains usable when browser storage is unavailable.
    }
    shouldMarkIntroRef.current = false;
  }, [isOpen]);

  // 2. Fetch period analytics when rangeMode or customMonth changes
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setLoadingAnalytics(true);

    async function loadData() {
      const data = await getPeriodAnalytics(rangeMode, customMonth);
      if (!isMounted) return;
      setAnalytics(data);
      setLoadingAnalytics(false);
    }

    loadData();
    return () => { isMounted = false; };
  }, [isOpen, rangeMode, customMonth]);

  // 3. Scroll chat to bottom on new messages
  useEffect(() => {
    if (activeTab === 'chat') {
      const scrollArea = chatScrollRef.current;
      if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
      setRateInfo(checkRateLimit());
    }
  }, [chatMessages, isAiThinking, activeTab]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  const handleSaveApiKey = (e) => {
    e.preventDefault();
    if (apiKey) localStorage.setItem('dawa_gemini_api_key', apiKey.trim());
    if (nvidiaApiKey) localStorage.setItem('dawa_nvidia_api_key', nvidiaApiKey.trim());
    setShowKeySettings(false);
  };

  const handleAskQuestion = async (queryText) => {
    // Automatically turn off microphone when user sends a question
    stopListening();

    const q = queryText || questionInput;
    if (!q || !q.trim() || isAiThinking) return;

    // Refresh rate limit status
    const currentRate = checkRateLimit();
    setRateInfo(currentRate);

    const newMessages = [...chatMessages, { role: 'user', text: q }];
    setChatMessages(newMessages);
    setQuestionInput('');
    setIsAiThinking(true);

    try {
      // Pull complete multi-month, multi-year master context + algorithmic query results from local IndexedDB
      const masterContext = await getFullMasterContext(q);
      if (masterContext.startsWith('[LOCAL_DB_READ_ERROR]')) {
        throw new Error('Local account data could not be read. Please retry after the database is available.');
      }
      const answer = await askGeminiAssistant({
        question: q,
        contextSummary: masterContext,
        userApiKey: apiKey,
        userNvidiaApiKey: nvidiaApiKey
      });

      setChatMessages([...newMessages, { role: 'assistant', text: answer }]);
      setRateInfo(checkRateLimit());
    } catch (err) {
      setChatMessages([
        ...newMessages,
        {
          role: 'assistant',
          text: `I couldn’t retrieve a reliable answer: ${err.message || 'Please try again in a moment.'}`
        }
      ]);
    } finally {
      setIsAiThinking(false);
    }
  };

  if (!isOpen) return null;

  if (activeTab === 'insights') {
    return createPortal(
      <div className="assistant-overlay fixed inset-0 z-[100] flex flex-col sm:justify-center sm:items-center sm:p-5 font-sans bg-black/80 backdrop-blur-md">
        <div className="assistant-panel assistant-panel-chat assistant-panel-insights w-full flex flex-col overflow-hidden text-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Chatbot insights">
          <div className="assistant-header px-4 sm:px-6 py-3.5 sm:py-5 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="assistant-mark w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center shrink-0"><Bot size={21} /></div>
              <h2 className="text-sm sm:text-lg font-bold tracking-tight">Chatbot</h2>
            </div>
            <button type="button" onClick={onClose} className="assistant-header-button" aria-label="Close chatbot"><X size={19} /></button>
          </div>
          <div className="assistant-tabs assistant-view-tabs flex px-4 sm:px-6 shrink-0 gap-2">
            <button type="button" onClick={() => setActiveTab('chat')} className="assistant-view-tab"><Bot size={16} /> AI Assistant</button>
            <button type="button" className="assistant-view-tab assistant-view-tab-active"><BarChart3 size={16} /> Insights</button>
          </div>
          <AssistantInsights
            analytics={analytics}
            loading={loadingAnalytics}
            rangeMode={rangeMode}
            setRangeMode={setRangeMode}
            months={months}
            customMonth={customMonth}
            setCustomMonth={setCustomMonth}
          />
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      className={`assistant-overlay fixed inset-0 z-[100] flex flex-col sm:justify-center sm:items-center sm:p-5 font-malayalam ${activeTab === 'chat' ? 'bg-black/80 backdrop-blur-md' : 'bg-slate-950/70 backdrop-blur-sm'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`assistant-panel w-full flex flex-col overflow-hidden shadow-2xl ${activeTab === 'chat' ? 'assistant-panel-chat text-white' : 'glass-panel text-slate-800 sm:max-w-3xl sm:rounded-3xl'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Chatbot"
      >
        <div className={`px-4 sm:px-6 py-3.5 sm:py-5 text-white flex items-center justify-between shrink-0 ${activeTab === 'chat' ? 'assistant-header' : 'bg-teal-900/95 border-b border-teal-700/40'}`}>
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center shrink-0 ${activeTab === 'chat' ? 'assistant-mark' : 'bg-white/15 text-teal-200 border border-white/20'}`}>
              <Bot size={21} className="text-emerald-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-lg font-bold tracking-tight truncate">Chatbot</h2>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeTab === 'chat' && (
              <button type="button" onClick={() => setShowKeySettings((value) => !value)} className="assistant-header-button" aria-label="Gemini API key settings" title="Gemini API key settings" aria-expanded={showKeySettings}>
                <Key size={17} />
              </button>
            )}
            <button type="button" onClick={onClose} className="assistant-header-button" aria-label="Close chatbot" title="Close chatbot">
              <X size={19} />
            </button>
          </div>
        </div>

        {/* --- MAIN TABS (AI ASSISTANT vs INSIGHTS) --- */}
        <div className={`flex px-4 sm:px-6 shrink-0 gap-2 overflow-x-auto scrollbar-none ${activeTab === 'chat' ? 'assistant-tabs' : 'border-b border-slate-200/60 bg-white/60 pt-2'}`}>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'chat'
                ? 'border-emerald-400 text-emerald-200 bg-emerald-400/10 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sparkles size={16} className={activeTab === 'chat' ? 'text-emerald-300' : 'text-teal-700'} />
            <span>AI Assistant</span>
            <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-full font-mono ${activeTab === 'chat' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-teal-100 text-teal-800'}`}>
              {rateInfo.remaining}/{rateInfo.totalLimit}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('insights')}
            className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 font-bold text-xs sm:text-sm border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'insights'
                ? 'border-teal-700 text-teal-900 bg-white/90 rounded-t-xl shadow-xs'
                : 'border-transparent text-emerald-100/60 hover:text-white'
            }`}
          >
            <BarChart3 size={16} />
            <span>Insights</span>
          </button>
        </div>

        {/* --- CONTENT BODY --- */}
        {activeTab === 'insights' ? (
          /* =========================================================================
             TAB 1: MODE A - BUTTON-DRIVEN MODULAR INSIGHTS
             ========================================================================= */
          <div className="flex-1 overflow-y-auto p-4 sm:p-7 bg-slate-50/60 backdrop-blur-sm space-y-6">
            <div className="space-y-6 animate-fadeIn">

              {/* 1. TIME RANGE FILTER BUTTONS (ചെറിയ ബട്ടൺസ്) */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  കാലയളവ് തിരഞ്ഞെടുക്കുക:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setRangeMode('today')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      rangeMode === 'today'
                        ? 'bg-teal-800 text-white border-teal-800 shadow-sm'
                        : 'bg-white/80 text-slate-600 border-slate-200/80 hover:bg-white'
                    }`}
                  >
                    ഇന്ന് (Today)
                  </button>

                  <button
                    onClick={() => setRangeMode('this_week')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      rangeMode === 'this_week'
                        ? 'bg-teal-800 text-white border-teal-800 shadow-sm'
                        : 'bg-white/80 text-slate-600 border-slate-200/80 hover:bg-white'
                    }`}
                  >
                    ഈ ആഴ്ച (This Week)
                  </button>

                  <button
                    onClick={() => setRangeMode('this_month')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      rangeMode === 'this_month'
                        ? 'bg-teal-800 text-white border-teal-800 shadow-sm'
                        : 'bg-white/80 text-slate-600 border-slate-200/80 hover:bg-white'
                    }`}
                  >
                    ഈ മാസം (This Month)
                  </button>

                  {/* Specific month selector */}
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border transition-all ${
                    rangeMode === 'custom_month'
                      ? 'bg-teal-800 text-white border-teal-800 shadow-sm'
                      : 'bg-white/80 text-slate-600 border-slate-200/80'
                  }`}>
                    <Calendar size={13} />
                    <select
                      value={rangeMode === 'custom_month' ? customMonth : ''}
                      onChange={(e) => {
                        setCustomMonth(e.target.value);
                        setRangeMode('custom_month');
                      }}
                      className="bg-transparent font-bold cursor-pointer focus:outline-none"
                    >
                      <option value="" disabled className="text-slate-900 bg-white">മാസം തിരഞ്ഞെടുക്കുക</option>
                      {months.map(m => (
                        <option key={m} value={m} className="text-slate-900 bg-white font-mono">
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => setRangeMode('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      rangeMode === 'all'
                        ? 'bg-teal-800 text-white border-teal-800 shadow-sm'
                        : 'bg-white/80 text-slate-600 border-slate-200/80 hover:bg-white'
                    }`}
                  >
                    മൊത്തം (All-Time)
                  </button>
                </div>
              </div>

              {/* 2. TOPIC / METRIC SELECTOR BUTTONS */}
              <div className="space-y-2 pt-1 border-t border-slate-200/60">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  കാണേണ്ട വിവരങ്ങൾ:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    onClick={() => setMetricView('summary')}
                    className={`p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center font-bold text-xs transition-all cursor-pointer border ${
                      metricView === 'summary'
                        ? 'bg-white border-teal-600 text-teal-900 shadow-md ring-2 ring-teal-600/20'
                        : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                    }`}
                  >
                    <Wallet size={18} className={metricView === 'summary' ? 'text-teal-700' : 'text-slate-400'} />
                    <span>വരവ് - ചിലവ് സംഗ്രഹം</span>
                  </button>

                  <button
                    onClick={() => setMetricView('top_expenses')}
                    className={`p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center font-bold text-xs transition-all cursor-pointer border ${
                      metricView === 'top_expenses'
                        ? 'bg-white border-teal-600 text-teal-900 shadow-md ring-2 ring-teal-600/20'
                        : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                    }`}
                  >
                    <PieChart size={18} className={metricView === 'top_expenses' ? 'text-teal-700' : 'text-slate-400'} />
                    <span>ടോപ്പ് ചിലവുകൾ</span>
                  </button>

                  <button
                    onClick={() => setMetricView('pending')}
                    className={`p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center font-bold text-xs transition-all cursor-pointer border ${
                      metricView === 'pending'
                        ? 'bg-white border-teal-600 text-teal-900 shadow-md ring-2 ring-teal-600/20'
                        : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                    }`}
                  >
                    <Clock size={18} className={metricView === 'pending' ? 'text-teal-700' : 'text-slate-400'} />
                    <span>പെൻഡിങ് വൗച്ചറുകൾ</span>
                    {analytics?.pendingExpenses?.length > 0 && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded-full font-mono">
                        {analytics.pendingExpenses.length}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setMetricView('comparison')}
                    className={`p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center font-bold text-xs transition-all cursor-pointer border ${
                      metricView === 'comparison'
                        ? 'bg-white border-teal-600 text-teal-900 shadow-md ring-2 ring-teal-600/20'
                        : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                    }`}
                  >
                    <TrendingUp size={18} className={metricView === 'comparison' ? 'text-teal-700' : 'text-slate-400'} />
                    <span>മാസ താരതമ്യം</span>
                  </button>
                </div>
              </div>

              {/* 3. DYNAMIC FOCUSED VIEW CONTAINER */}
              {loadingAnalytics ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                  <RefreshCw size={26} className="animate-spin text-teal-700" />
                  <p className="text-xs font-semibold">കണക്കുകൂട്ടുന്നു...</p>
                </div>
              ) : (
                <div className="pt-2">
                  {/* VIEW A: SUMMARY */}
                  {metricView === 'summary' && (
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4 animate-fadeIn">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <span className="text-xs font-bold text-slate-500">{analytics?.periodLabel}</span>
                        <span className="text-xs font-semibold text-teal-800 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-100">
                          ക്യാഷ് ബുക്ക് നില
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-100">
                          <div className="text-xs text-emerald-800 font-bold mb-1 flex items-center justify-between">
                            <span>ആകെ വരവ് (Income)</span>
                            <TrendingUp size={16} />
                          </div>
                          <div className="text-2xl font-black text-emerald-800 font-mono">
                            {formatINR(analytics?.totalIncome)}
                          </div>
                          <div className="text-[11px] text-emerald-600/90 mt-1 font-medium">
                            {analytics?.incomeCount} എൻട്രികൾ
                          </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-rose-50/80 border border-rose-100">
                          <div className="text-xs text-rose-800 font-bold mb-1 flex items-center justify-between">
                            <span>ആകെ ചിലവ് (Expense)</span>
                            <TrendingDown size={16} />
                          </div>
                          <div className="text-2xl font-black text-rose-800 font-mono">
                            {formatINR(analytics?.totalExpenses)}
                          </div>
                          <div className="text-[11px] text-rose-600/90 mt-1 font-medium">
                            {analytics?.expenseCount} എൻട്രികൾ
                          </div>
                        </div>

                        <div className={`p-4 rounded-2xl border ${
                          (analytics?.netBalance || 0) >= 0
                            ? 'bg-teal-50/80 border-teal-200'
                            : 'bg-amber-50/80 border-amber-200'
                        }`}>
                          <div className="text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                            <span>നെറ്റ് ബാലൻസ്</span>
                            {(analytics?.netBalance || 0) >= 0
                              ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900">നീക്കിയിരിപ്പ്</span>
                              : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900">കമ്മി</span>
                            }
                          </div>
                          <div className={`text-2xl font-black font-mono ${
                            (analytics?.netBalance || 0) >= 0 ? 'text-teal-950' : 'text-rose-700'
                          }`}>
                            {formatINR(analytics?.netBalance)}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1 font-medium">
                            {(analytics?.netBalance || 0) >= 0 ? 'വരവ് കൂടുതൽ' : 'ചിലവ് കൂടുതൽ'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* VIEW B: TOP EXPENSES */}
                  {metricView === 'top_expenses' && (
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4 animate-fadeIn">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h4 className="text-sm font-bold text-slate-800">
                          പ്രധാന 5 ചെലവ് കാറ്റഗറികൾ (Top 5 Categories)
                        </h4>
                        <span className="text-xs font-mono text-slate-500">{analytics?.periodLabel}</span>
                      </div>

                      {analytics?.topCategories && analytics.topCategories.length > 0 ? (
                        <div className="space-y-3.5">
                          {analytics.topCategories.map((item, idx) => (
                            <div key={item.category} className="space-y-1.5">
                              <div className="flex justify-between text-xs font-bold">
                                <span className="text-slate-800">
                                  {idx + 1}. {item.category}
                                </span>
                                <span className="font-mono text-slate-900">
                                  {formatINR(item.amount)} <span className="text-teal-700 font-semibold">({item.percentage}%)</span>
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                <div
                                  className="bg-gradient-to-r from-teal-700 to-emerald-500 h-2.5 rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(item.percentage, 100)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 py-6 text-center">ഈ കാലയളവിൽ ചെലവുകൾ രേഖപ്പെടുത്തിയിട്ടില്ല.</p>
                      )}
                    </div>
                  )}

                  {/* VIEW C: PENDING PAYMENTS */}
                  {metricView === 'pending' && (
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4 animate-fadeIn">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <Clock size={16} className="text-amber-600" />
                          <h4 className="text-sm font-bold text-slate-800">നൽകാൻ ബാക്കിയുള്ള പെൻഡിങ് വൗച്ചറുകൾ</h4>
                        </div>
                        {analytics?.pendingExpenses?.length > 0 && (
                          <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 font-mono">
                            ആകെ: {formatINR(analytics.pendingAmount)}
                          </span>
                        )}
                      </div>

                      {analytics?.pendingExpenses && analytics.pendingExpenses.length > 0 ? (
                        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
                          {analytics.pendingExpenses.map(p => (
                            <div key={p.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50/70 transition-colors">
                              <div>
                                <div className="font-bold text-slate-900">
                                  വൗച്ചർ #{p.voucherNo} &bull; {p.paidTo}
                                </div>
                                {p.being && <div className="text-[11px] text-slate-500">{p.being}</div>}
                              </div>
                              <div className="text-right">
                                <div className="font-mono font-bold text-rose-600">{formatINR(p.amount)}</div>
                                <div className="text-[10px] text-slate-400">{formatDate(p.date)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 p-4 bg-emerald-50/70 rounded-xl border border-emerald-100 text-xs text-emerald-900 font-medium">
                          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                          <span>തിരഞ്ഞെടുത്ത കാലയളവിൽ നൽകാൻ ബാക്കിയുള്ള പെൻഡിങ് വൗച്ചറുകൾ ഒന്നുമില്ല. എല്ലാ ഇടപാടുകളും പൂർത്തിയായിട്ടുണ്ട്.</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* VIEW D: MONTH COMPARISON */}
                  {metricView === 'comparison' && (
                    <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4 animate-fadeIn">
                      <div className="border-b border-slate-100 pb-3">
                        <h4 className="text-sm font-bold text-slate-800">കഴിഞ്ഞ മാസവുമായുള്ള താരതമ്യം</h4>
                      </div>

                      {analytics?.comparison && analytics.comparison.prevExpenses > 0 ? (
                        <div className="space-y-4">
                          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                            <div>
                              <span className="text-xs text-slate-500 block">കഴിഞ്ഞ മാസത്തെ ചിലവ് ({analytics.comparison.prevMonth})</span>
                              <span className="text-lg font-black font-mono text-slate-800">{formatINR(analytics.comparison.prevExpenses)}</span>
                            </div>
                            <ChevronRight size={18} className="text-slate-400" />
                            <div>
                              <span className="text-xs text-slate-500 block">ഈ മാസത്തെ ചിലവ് ({analytics.customMonth || 'നിലവിലെ'})</span>
                              <span className="text-lg font-black font-mono text-slate-800">{formatINR(analytics.totalExpenses)}</span>
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl border flex items-center justify-between text-xs font-bold">
                            <span>ചെലവിലെ വ്യത്യാസം:</span>
                            {analytics.comparison.expenseDiff >= 0 ? (
                              <span className="text-rose-700 bg-rose-50 px-3 py-1 rounded-full border border-rose-200 font-mono">
                                +{Math.abs(analytics.comparison.expensePercent)}% (കൂടുതൽ) &bull; +{formatINR(analytics.comparison.expenseDiff)}
                              </span>
                            ) : (
                              <span className="text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 font-mono">
                                -{Math.abs(analytics.comparison.expensePercent)}% (കുറവ്) &bull; -{formatINR(Math.abs(analytics.comparison.expenseDiff))}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 py-6 text-center">
                          താരതമ്യം ചെയ്യാൻ മുൻ മാസങ്ങളിലെ ഡാറ്റ ലഭ്യമല്ല അല്ലെങ്കിൽ കസ്റ്റം മാസം തിരഞ്ഞെടുക്കുക.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* =========================================================================
             TAB 2: MODE B - STRICT RATE-LIMITED AI ASSISTANT (Mobile-optimized)
             ========================================================================= */
          <div className="assistant-chat flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="assistant-context-bar shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck size={16} className="text-emerald-300 shrink-0" />
                <span className="truncate">ഏത് മാസത്തെയും വർഷത്തെയും കണക്കുകൾ ചോദിക്കാം</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`assistant-quota shrink-0 cursor-default ${rateInfo.remaining === 0 ? 'bg-amber-900/40 text-amber-200 border border-amber-500/30' : ''}`}
                  title={rateInfo.remaining === 0 ? 'Gemini ന്റെ മണിക്കൂർ പരിധി പൂർത്തിയായി. DeepSeek fallback സജീവമാണ്.' : 'Gemini പ്രൈമറി എഞ്ചിൻ സജീവമാണ്. DeepSeek ഫാൾബാക്ക് സജ്ജമാണ്.'}
                >
                  {rateInfo.remaining > 0 ? (
                    <>Gemini: <span className="font-bold">{rateInfo.remaining}/{rateInfo.totalLimit}</span> &bull; DeepSeek സജ്ജം</>
                  ) : (
                    <><span className="text-amber-300 font-bold">Gemini കഴിഞ്ഞു</span> &bull; DeepSeek സജീവം</>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setShowKeySettings(prev => !prev)}
                  className="p-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-800/60 text-emerald-300 hover:text-white transition-colors border border-emerald-500/20"
                  title="API Key ക്രമീകരണങ്ങൾ"
                  aria-label="API Settings"
                >
                  <Key size={14} />
                </button>
              </div>
            </div>

            {/* Optional Key Settings Toggle */}
            {showKeySettings && (
              <form onSubmit={handleSaveApiKey} className="assistant-key-settings shrink-0">
                <div className="flex justify-between items-center font-bold text-emerald-100 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Key size={14} className="text-emerald-400" />
                    AI API ക്രമീകരണങ്ങൾ (Dual Engine)
                  </span>
                  <button type="button" onClick={() => setShowKeySettings(false)} className="text-emerald-200/70 hover:text-white cursor-pointer text-xs">Close</button>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[11px] font-semibold text-emerald-300">
                        Primary: Google Gemini API Key
                      </label>
                      <span className="text-[10px] text-emerald-400/70">5 ചോദ്യങ്ങൾ/മണിക്കൂർ</span>
                    </div>
                    <input
                      type="password"
                      placeholder="AIzaSy..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="w-full bg-[#0d1916] border border-emerald-500/30 rounded-xl px-3 py-1.5 text-white font-mono text-xs focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[11px] font-semibold text-emerald-300">
                        Fallback: NVIDIA DeepSeek API Key
                      </label>
                      <span className="text-[10px] text-emerald-400/70">ഓട്ടോമാറ്റിക് ബാക്കപ്പ്</span>
                    </div>
                    <input
                      type="password"
                      placeholder="nvapi-..."
                      value={nvidiaApiKey}
                      onChange={(e) => setNvidiaApiKey(e.target.value)}
                      className="w-full bg-[#0d1916] border border-emerald-500/30 rounded-xl px-3 py-1.5 text-white font-mono text-xs focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="submit" className="px-3.5 py-1.5 bg-emerald-400 text-[#07120f] font-bold rounded-lg cursor-pointer text-xs hover:bg-emerald-300 transition-colors">Save Keys</button>
                </div>
              </form>
            )}

            {/* Chat Messages - Flexible height fills screen */}
            <div ref={chatScrollRef} className="assistant-messages flex-1 min-h-0 overflow-y-auto" role="log" aria-label="Chat messages" aria-live="polite">
              <div className={`assistant-message-list ${chatMessages.length <= 1 && !isAiThinking ? 'assistant-message-list-empty' : ''}`}>
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`assistant-message-row ${msg.role === 'user' ? 'assistant-message-row-user' : ''}`}
                >
                  {msg.role === 'assistant' && <div className="assistant-avatar" aria-hidden="true"><Sparkles size={15} /></div>}
                  <div
                    className={`assistant-bubble ${msg.role === 'user' ? 'assistant-bubble-user' : 'assistant-bubble-ai'}`}
                  >
                    {msg.role === 'assistant' && <span className="assistant-message-label">AI Assistant</span>}
                    {msg.role === 'assistant' ? <AssistantMarkdown>{msg.text}</AssistantMarkdown> : msg.text}
                  </div>
                </div>
              ))}

              {isAiThinking && (
                <div className="assistant-message-row" role="status">
                  <div className="assistant-avatar" aria-hidden="true"><Sparkles size={15} /></div>
                  <div className="assistant-bubble assistant-bubble-ai assistant-thinking">
                    <span className="assistant-message-label">AI Assistant</span>
                    <span className="flex items-center gap-2"><span className="assistant-thinking-dots"><i /><i /><i /></span> Reviewing your account…</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
              </div>
            </div>

            <div className="assistant-composer shrink-0">
              <div className="assistant-suggestions scrollbar-none">
              <button
                onClick={() => handleAskQuestion('What are the income and expenses for this month?')}
                disabled={isAiThinking}
                className="assistant-suggestion"
              >
                This month’s summary
              </button>
              <button
                onClick={() => handleAskQuestion('Which month had the highest expenses?')}
                disabled={isAiThinking}
                className="assistant-suggestion"
              >
                Highest expense month
              </button>
              <button
                onClick={() => handleAskQuestion('How much was spent on food in total?')}
                disabled={isAiThinking}
                className="assistant-suggestion"
              >
                Total food expenses
              </button>
              <button
                onClick={() => handleAskQuestion('Which vouchers are currently pending?')}
                disabled={isAiThinking}
                className="assistant-suggestion"
              >
                Pending vouchers
              </button>
              </div>

            {/* Voice Listening / Error Indicators */}
            {isListening && (
              <div className="assistant-voice-status" role="status">
                <Mic size={14} className="animate-bounce" />
                <span className="font-medium">Recording… Tap the mic to stop. Audio is sent to Gemini for transcription (60 sec max).</span>
              </div>
            )}
            {isVoiceTranscribing && (
              <div className="assistant-voice-status" role="status">
                <span className="font-medium">Transcribing voice…</span>
              </div>
            )}
            {speechError && (
              <div className="assistant-voice-status" role="alert">
                {speechError}
              </div>
            )}

            {/* Chat Input Bar - pinned at bottom, touch-friendly, safe area */}
            <form
              className="assistant-input-row"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAskQuestion();
              }}
            >
              <textarea
                rows={1}
                placeholder={isListening ? "Listening…" : "Ask about your accounts…"}
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={isAiThinking}
                aria-label="Your question"
                className="assistant-textarea"
              />
              <button
                type="button"
                onClick={toggleListening}
                disabled={isAiThinking || isVoiceTranscribing}
                className={`assistant-action-button ${
                  isListening
                    ? 'assistant-mic-active'
                    : 'assistant-mic'
                }`}
                aria-label={isListening ? 'Stop voice input' : 'Use voice input'}
                title={isListening ? 'Stop voice input' : 'Use voice input'}
              >
                {isListening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button
                type="submit"
                disabled={!questionInput.trim() || isAiThinking}
                className="assistant-action-button assistant-send"
                aria-label="Send question"
                title="Send question"
              >
                <Send size={16} />
              </button>
            </form>
            <p className="assistant-composer-note">AI responses may be inaccurate. Verify important figures with your records.</p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
