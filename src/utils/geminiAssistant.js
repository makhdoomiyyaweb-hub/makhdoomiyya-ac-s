/**
 * geminiAssistant.js
 *
 * High-Availability Client-Side AI Engine with DUAL PROVIDER AUTOMATIC FAILOVER:
 * 1. Primary: Google Gemini API (gemini-3.1-flash-lite / gemini-3.8-flash)
 * 2. Fallback: NVIDIA DeepSeek API (deepseek-ai/deepseek-v4.1-flash / deepseek-coder / llama)
 *
 * When Gemini's quota is exhausted (Rate Limit / 429) or encounters any error,
 * it seamlessly switches to NVIDIA DeepSeek to ensure zero downtime.
 */

const MAX_GEMINI_REQUESTS_PER_HOUR = 5;
const RATE_LIMIT_STORAGE_KEY = 'dawa_ai_rate_timestamps';

// API keys must be supplied by the user and stay in their browser storage.
// Never commit provider secrets into a public client-side bundle.
export const DEFAULT_API_KEY = '';
export const DEFAULT_NVIDIA_KEY = '';

// Models in prioritized fallback order
const SUPPORTED_GEMINI_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest'
];

const SUPPORTED_NVIDIA_MODELS = [
  'meta/llama-3.2-11b-vision-instruct',
  'deepseek-ai/deepseek-v4.1-flash',
  'nvidia/nemotron-3-super-120b-a12b'
];

const SYSTEM_INSTRUCTION = `
നിങ്ങൾ മഖ്ദൂമിയ്യ അക്കാദമി (Makhdoomiyya Academy) സ്ഥാപനത്തിന്റെ അക്കൗണ്ട്സ് സ്മാർട്ട് അസിസ്റ്റന്റ് ആണ്.
താഴെ നൽകിയിരിക്കുന്ന പരിശോധിച്ചുറപ്പിച്ച ഔദ്യോഗിക സാമ്പത്തിക സംഗ്രഹത്തിൽ നിന്നും അൽഗോരിത തിരച്ചിൽ ഫലങ്ങളിൽ നിന്നും (Algorithmic Search Results) വിവരങ്ങൾ എടുത്ത് ഉപയോക്താവിന്റെ ചോദ്യത്തിന് വളരെ മനോഹരമായും വിനയത്തോടും കൃത്യമായും മലയാളത്തിൽ മറുപടി നൽകുക.

നിർദ്ദേശങ്ങൾ:
1. നൽകിയിരിക്കുന്ന വിവരങ്ങളിലുള്ള കൃത്യമായ തീയതി, വൗച്ചർ നമ്പർ, തുക, വ്യക്തിയുടെ പേര്, വിവരണം (Being), കാറ്റഗറി എന്നിവ വ്യക്തമായി എടുത്തു പറയുക. ഊഹിച്ച കണക്കുകൾ പറയരുത്.
2. ഉപയോക്താവ് ഒരു നിശ്ചിത ദിവസത്തെയോ (ഉദാ: 2026 ആഗസ്റ്റ് 20), പ്രത്യേക പെയ്മെന്റിനെയോ/പേരിനെയോ (ഉദാ: ഇറൽ ഹബീബ് / typography ilal habeeb), ഏതെങ്കിലും കാറ്റഗറിയെയോ (ഉദാ: ഫുഡ്), ഇവന്റുകളെയോ കുറിച്ച് ചോദിച്ചാൽ, സംഗ്രഹത്തിൽ കണ്ടെത്തിയ കൃത്യമായ വൗച്ചറുകളും തുകയും നൽകുക.
3. തുക പറയുമ്പോൾ രൂപ ചിഹ്നവും (₹) കോമയും കൃത്യമായി ഉപയോഗിക്കുക.
4. ചോദിച്ച പ്രത്യേക തീയതിയിലോ പേരിലോ ഡാറ്റാബേസിൽ രേഖകൾ ഒന്നും ഇല്ലെങ്കിൽ, ആ തീയതിയിൽ/പേരിൽ എൻട്രികൾ ലഭ്യമല്ലെന്ന് മാന്യമായി വ്യക്തമാക്കുക.
5. കണക്കുകൾ നൽകിയിരിക്കുന്ന പ്രാദേശിക ഡാറ്റാ സംഗ്രഹവുമായി പൊരുത്തപ്പെടണം; സംഗ്രഹത്തിലുള്ള കൃത്യമായ തുകയും എണ്ണവും മാറ്റുകയോ ഊഹിക്കുകയോ ചെയ്യരുത്.
6. ഒന്നിലധികം എൻട്രികൾ താരതമ്യം ചെയ്യുമ്പോഴോ ഉപയോക്താവ് പട്ടിക ചോദിക്കുമ്പോഴോ മാത്രം Markdown table ഉപയോഗിക്കുക. മറ്റുള്ള മറുപടികൾ ചെറുതായ headings, ശരിയായ Markdown bold, അല്ലെങ്കിൽ render ചെയ്യാവുന്ന list ആയി നൽകുക; Markdown symbols plain text ആയി വിടരുത്.
`.trim();

/**
 * Checks Gemini rolling hourly rate limit.
 */
export function checkRateLimit() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    let timestamps = raw ? JSON.parse(raw) : [];
    timestamps = timestamps.filter(t => t > oneHourAgo);
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(timestamps));

    const used = timestamps.length;
    const remaining = Math.max(0, MAX_GEMINI_REQUESTS_PER_HOUR - used);

    let resetMinutes = 0;
    if (timestamps.length > 0) {
      const oldest = Math.min(...timestamps);
      resetMinutes = Math.max(1, Math.ceil((oldest + 60 * 60 * 1000 - now) / 60000));
    }

    return {
      allowed: remaining > 0,
      remaining,
      totalLimit: MAX_GEMINI_REQUESTS_PER_HOUR,
      resetMinutes
    };
  } catch (err) {
    console.warn('[AIEngine] Rate limit check error, defaulting safe:', err);
    return { allowed: true, remaining: 1, totalLimit: MAX_GEMINI_REQUESTS_PER_HOUR, resetMinutes: 0 };
  }
}

/**
 * Records a successful Gemini query timestamp
 */
function recordGeminiTimestamp() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    const now = Date.now();
    let timestamps = raw ? JSON.parse(raw) : [];
    timestamps.push(now);
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(timestamps));
  } catch {
    // Non-critical
  }
}

/**
 * Primary Provider: Call Google Gemini API
 */
async function callGemini({ question, contextSummary, geminiKey }) {
  const prompt = `${SYSTEM_INSTRUCTION}

[ഔദ്യോഗിക സാമ്പത്തിക സംഗ്രഹം]:
${contextSummary}

[ഉപയോക്താവിന്റെ ചോദ്യം]:
${question}`;

  let lastError = null;

  for (const model of SUPPORTED_GEMINI_MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey.trim()}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 650
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData?.error?.message || response.statusText;
        lastError = new Error(`Gemini ${model} (${response.status}): ${message}`);

        if (response.status === 404 || response.status === 503) {
          console.warn(`[AIEngine] Gemini ${model} returned ${response.status}, trying next fallback model...`);
          continue;
        }

        throw lastError;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return text.trim();
      }
    } catch (err) {
      lastError = err;
      console.warn(`[AIEngine] Error with Gemini ${model}:`, err.message);
      if (err.message?.includes('429')) {
        // Quota exhausted on Gemini, break and let fallback handle immediately
        throw err;
      }
    }
  }

  throw lastError || new Error('Google Gemini സർവീസ് താൽക്കാലികമായി ലഭ്യമല്ല.');
}

/** Transcribe a short microphone recording with Gemini's speech-to-text model. */
export async function transcribeVoiceAudio({ audioBlob, geminiKey }) {
  if (!(audioBlob instanceof Blob) || audioBlob.size === 0) {
    throw new Error('No voice audio was captured. Please try again.');
  }
  if (audioBlob.size > 10 * 1024 * 1024) {
    throw new Error('Recording is too large. Please keep voice input under one minute.');
  }
  if (!geminiKey?.trim()) {
    throw new Error('Gemini API key is unavailable for voice transcription.');
  }

  const rawMimeType = (audioBlob.type || 'audio/webm').split(';')[0];
  const mimeType = rawMimeType === 'audio/mp4' ? 'audio/m4a' : rawMimeType;
  const base64Audio = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the voice recording.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) reject(new Error('Could not prepare the voice recording.'));
      else resolve(dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(audioBlob);
  });

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': geminiKey.trim()
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: 'Transcribe the spoken audio accurately. Keep the original language and do not answer or summarize.' },
          { inlineData: { mimeType, data: base64Audio } }
        ]
      }],
      generationConfig: {
        audioTranscriptionConfig: { languageCodes: [] },
        temperature: 0
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || response.statusText;
    throw new Error(`Voice transcription failed (${response.status}): ${message}`);
  }

  const transcript = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join(' ')
    .trim();
  if (!transcript) throw new Error('No speech was recognized. Please try again.');
  return transcript;
}

/**
 * Fallback Provider: Call NVIDIA DeepSeek API
 */
async function callNvidiaDeepSeek({ question, contextSummary, nvidiaKey }) {
  const userContent = `[ഔദ്യോഗിക സാമ്പത്തിക സംഗ്രഹം]:
${contextSummary}

[ഉപയോക്താവിന്റെ ചോദ്യം]:
${question}`;

  let lastError = null;

  // Prefer local proxy in browser/dev to bypass CORS restrictions
  const candidateEndpoints = [
    '/api/nvidia/v1/chat/completions',
    'https://integrate.api.nvidia.com/v1/chat/completions'
  ];

  for (const endpoint of candidateEndpoints) {
    for (const model of SUPPORTED_NVIDIA_MODELS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${nvidiaKey.trim()}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM_INSTRUCTION },
              { role: 'user', content: userContent }
            ],
            temperature: 0.2,
            max_tokens: 850
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const msg = errData?.error?.message || errData?.message || response.statusText;
          lastError = new Error(`NVIDIA ${model} (${response.status}): ${msg}`);
          console.warn(`[AIEngine] NVIDIA ${model} on ${endpoint} returned ${response.status}, trying next...`);
          // If local proxy doesn't exist (e.g. 404 in static hosting), jump immediately to next endpoint
          if (response.status === 404 && endpoint.startsWith('/api')) {
            break;
          }
          continue;
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) {
          return text.trim();
        }
      } catch (err) {
        lastError = err;
        console.warn(`[AIEngine] Error with NVIDIA ${model} on ${endpoint}:`, err.message);
        if (endpoint.startsWith('/api')) {
          break;
        }
      }
    }
  }

  throw lastError || new Error('NVIDIA DeepSeek സർവീസ് താൽക്കാലികമായി ലഭ്യമല്ല.');
}

/**
 * Unified Assistant Dispatcher: Primary (Gemini) with Failover to Secondary (NVIDIA DeepSeek)
 */
export async function askGeminiAssistant({ question, contextSummary, userApiKey, userNvidiaApiKey }) {
  const activeGeminiKey = (userApiKey && userApiKey.trim()) || localStorage.getItem('dawa_gemini_api_key') || DEFAULT_API_KEY;
  const activeNvidiaKey = (userNvidiaApiKey && userNvidiaApiKey.trim()) || localStorage.getItem('dawa_nvidia_api_key') || DEFAULT_NVIDIA_KEY;

  if (!activeGeminiKey && !activeNvidiaKey) {
    throw new Error('Add a Gemini or NVIDIA API key in AI settings to use the assistant.');
  }

  const rateStatus = checkRateLimit();

  // Step 1: Try Primary (Google Gemini) if quota allows
  if (rateStatus.allowed && activeGeminiKey) {
    try {
      const geminiReply = await callGemini({ question, contextSummary, geminiKey: activeGeminiKey });
      if (geminiReply) {
        recordGeminiTimestamp();
        return geminiReply;
      }
    } catch (geminiErr) {
      console.warn('[AIEngine Failover] Gemini failed or quota exhausted, switching to NVIDIA DeepSeek:', geminiErr.message);
    }
  } else {
    console.info('[AIEngine Failover] Gemini hourly limit reached, routing directly to NVIDIA DeepSeek fallback.');
  }

  // Step 2: Try Fallback (NVIDIA DeepSeek)
  if (activeNvidiaKey) {
    try {
      const deepSeekReply = await callNvidiaDeepSeek({ question, contextSummary, nvidiaKey: activeNvidiaKey });
      if (deepSeekReply) {
        return deepSeekReply;
      }
    } catch (nvidiaErr) {
      console.error('[AIEngine Failover] NVIDIA DeepSeek fallback failed:', nvidiaErr.message);
      throw new Error(`AI സർവീസ് താൽക്കാലികമായി ലഭ്യമല്ല (Gemini & DeepSeek Failover: ${nvidiaErr.message})`);
    }
  }

  throw new Error('AI സർവീസ് താൽക്കാലികമായി ലഭ്യമല്ല. ദയവായി അല്പം കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക.');
}
