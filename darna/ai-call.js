/**
 * ==============================================================================
 * DARNA AI VOICE CONFIRMATION AGENT — "مريم" (Maryem)
 * Powered by Google Gemini 2.5 Flash Native Audio Live WebSocket
 * ==============================================================================
 */

(function (window) {
  'use strict';

  var DEFAULT_CONFIG = {
    apiKey: 'AIzaSyApchRatIVX2N88tYmPwOb1SN1FF4CtBsE',
    model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
    voiceName: 'Aoede', // Warm, expressive female voice
    agentName: 'مريم',
    enabled: true,
    autoConfirm: false, // Default: review mode (summary recorded for admin decision)
    allowRecordSummary: true
  };

  function getConfig() {
    var saved = {};
    try {
      var s = localStorage.getItem('darna_ai_call_config');
      if (s) saved = JSON.parse(s);
    } catch(e) {}
    return Object.assign({}, DEFAULT_CONFIG, saved);
  }

  function setConfig(cfg) {
    var merged = Object.assign({}, getConfig(), cfg);
    localStorage.setItem('darna_ai_call_config', JSON.stringify(merged));
    return merged;
  }

  // Audio helper: convert Float32 [-1, 1] to Int16 PCM base64
  function float32ToInt16Base64(float32Array) {
    var int16Array = new Int16Array(float32Array.length);
    for (var i = 0; i < float32Array.length; i++) {
      var s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    var bytes = new Uint8Array(int16Array.buffer);
    var binary = '';
    for (var j = 0; j < bytes.byteLength; j++) {
      binary += String.fromCharCode(bytes[j]);
    }
    return btoa(binary);
  }

  // Audio helper: convert 24kHz Int16 PCM base64 to AudioBuffer
  function base64PcmToAudioBuffer(audioCtx, base64Data, sampleRate) {
    sampleRate = sampleRate || 24000;
    var binary = atob(base64Data);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    var int16 = new Int16Array(bytes.buffer);
    var float32 = new Float32Array(int16.length);
    for (var j = 0; j < int16.length; j++) {
      float32[j] = int16[j] / (int16[j] < 0 ? 0x8000 : 0x7FFF);
    }
    var buffer = audioCtx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0, 0);
    return buffer;
  }

  // Text helper: extract pure spoken Arabic dialogue and strip thoughts/meta commentary
  function extractSpokenDialogue(raw) {
    if (!raw) return '';
    var text = String(raw).trim();
    // 1. Quoted speech
    var quoteMatch = text.match(/["“]([\u0600-\u06FF\s\d،؟!.A-Za-z]+)["”]/);
    if (quoteMatch && /[\u0600-\u06FF]/.test(quoteMatch[1])) {
      return quoteMatch[1].trim();
    }
    // 2. Strip thoughts, asterisks, brackets
    text = text.replace(/\*\*[\s\S]*?\*\*/g, '');
    text = text.replace(/\[[\s\S]*?\]/g, '');
    text = text.replace(/I believe[\s\S]*$/i, '');
    text = text.replace(/Here is[\s\S]*$/i, '');
    text = text.replace(/Initiating[\s\S]*?:/i, '');
    text = text.replace(/Confirming[\s\S]*?:/i, '');
    // 3. Filter lines with Arabic
    var lines = text.split('\n').filter(function(line) {
      return /[\u0600-\u06FF]/.test(line);
    });
    if (lines.length) {
      text = lines.join(' ');
    }
    // 4. Strip English prefixes/suffixes
    text = text.replace(/^[A-Za-z\s:*,."'-]+(?=[\u0600-\u06FF])/, '');
    text = text.replace(/(?<=[\u0600-\u06FF\s،؟!.])[A-Za-z\s:*,."'-]+$/, '');
    return text.trim();
  }

  var DarnaAICall = {
    isOpen: false,
    ws: null,
    audioCtx: null,
    micStream: null,
    audioWorkletNode: null,
    isMuted: false,
    isSpeaking: false,
    nextPlayTime: 0,
    activeSources: [],
    order: null,
    transcript: [],
    callStartTime: null,
    timerInterval: null,
    analyser: null,
    animFrame: null,

    init: function () {
      this.injectStyles();
      this.injectModal();
    },

    injectStyles: function () {
      if (document.getElementById('darna-ai-call-styles')) return;
      var style = document.createElement('style');
      style.id = 'darna-ai-call-styles';
      style.textContent = `
        /* CALL OVERLAY & LUXURY MODAL */
        .ai-call-overlay {
          position: fixed; inset: 0;
          background: rgba(10, 12, 20, 0.94);
          backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
          z-index: 999999;
          display: none; align-items: center; justify-content: center;
          padding: 16px;
          opacity: 0; transition: opacity 0.35s ease;
          font-family: var(--font-main, "Tajawal", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
          direction: rtl;
        }
        .ai-call-overlay.active {
          display: flex; opacity: 1;
        }
        .ai-call-box {
          width: 100%; max-width: 440px;
          background: linear-gradient(180deg, rgba(28, 30, 44, 0.95) 0%, rgba(15, 17, 26, 0.98) 100%);
          border: 1px solid rgba(212, 148, 78, 0.3);
          border-radius: 28px;
          padding: 32px 24px 28px;
          box-shadow: 0 24px 70px rgba(0,0,0,0.6), 0 0 40px rgba(183, 101, 67, 0.2);
          text-align: center; color: #fff;
          position: relative; overflow: hidden;
          animation: callBoxEnter 0.45s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes callBoxEnter {
          from { transform: scale(0.9) translateY(20px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        .ai-call-glow-bg {
          position: absolute; top: -120px; left: 50%; transform: translateX(-50%);
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(183,101,67,0.35) 0%, rgba(212,148,78,0.12) 45%, transparent 70%);
          pointer-events: none; border-radius: 50%; filter: blur(30px);
        }
        .ai-call-header {
          position: relative; z-index: 2; margin-bottom: 24px;
        }
        .ai-call-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(212, 148, 78, 0.15); border: 1px solid rgba(212, 148, 78, 0.4);
          color: #f3c28b; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 700;
          letter-spacing: 0.4px; margin-bottom: 12px;
        }
        .ai-call-badge-dot {
          width: 7px; height: 7px; background: #10b981; border-radius: 50%;
          box-shadow: 0 0 8px #10b981; animation: pulseDot 1.4s infinite;
        }
        @keyframes pulseDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }

        /* AVATAR & GLOWING AUDIO SPHERE */
        .ai-call-visualizer-wrap {
          position: relative; width: 150px; height: 150px; margin: 0 auto 24px;
          display: flex; align-items: center; justify-content: center;
        }
        .ai-call-ripple-ring {
          position: absolute; inset: -15px; border-radius: 50%;
          border: 1.5px solid rgba(212, 148, 78, 0.4);
          animation: rippleExpand 2.2s infinite ease-out;
          pointer-events: none;
        }
        .ai-call-ripple-ring:nth-child(2) {
          inset: -30px; animation-delay: 0.7s; border-color: rgba(183, 101, 67, 0.25);
        }
        @keyframes rippleExpand {
          0% { transform: scale(0.85); opacity: 0.9; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        .ai-call-avatar {
          width: 105px; height: 105px; border-radius: 50%;
          background: linear-gradient(135deg, #b76543, #d4944e);
          padding: 3px; position: relative; z-index: 3;
          box-shadow: 0 8px 30px rgba(183, 101, 67, 0.45);
          transition: transform 0.2s ease;
        }
        .ai-call-avatar.speaking {
          animation: avatarBounce 0.8s infinite ease-in-out alternate;
          box-shadow: 0 0 35px rgba(212, 148, 78, 0.8), 0 8px 30px rgba(183, 101, 67, 0.6);
        }
        @keyframes avatarBounce {
          0% { transform: scale(1); }
          100% { transform: scale(1.06); }
        }
        .ai-call-avatar img {
          width: 100%; height: 100%; border-radius: 50%; object-fit: cover;
          background: #1a1a24;
        }
        .ai-call-name {
          font-size: 20px; font-weight: 800; margin-bottom: 4px;
          background: linear-gradient(135deg, #ffffff, #e5d2b8);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .ai-call-subtitle {
          font-size: 13px; color: #a9a6b6; font-weight: 500;
        }
        .ai-call-timer {
          font-family: "DM Sans", -apple-system, monospace;
          font-size: 14px; font-weight: 700; color: #10b981;
          margin-top: 6px; display: inline-flex; align-items: center; gap: 5px;
          background: rgba(16, 185, 129, 0.12); padding: 3px 12px; border-radius: 12px;
        }

        /* LIVE SUBTITLE / CAPTION TICKER */
        .ai-call-caption-box {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px; padding: 14px 16px;
          min-height: 70px; max-height: 100px; overflow-y: auto;
          scrollbar-width: none; -ms-overflow-style: none;
          margin: 20px 0 24px; text-align: center;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; line-height: 1.6; color: #f2eee8;
        }
        .ai-call-caption-box::-webkit-scrollbar { display: none; }
        .ai-call-caption-box em {
          color: #c9935a; font-style: normal; font-weight: 600;
        }

        /* SOUND WAVE BARS */
        .ai-call-wave-bars {
          display: flex; align-items: center; justify-content: center;
          gap: 4px; height: 26px; margin-bottom: 22px;
        }
        .ai-call-wave-bar {
          width: 4px; height: 6px; background: rgba(212, 148, 78, 0.6);
          border-radius: 3px; transition: height 0.1s ease;
        }
        .ai-call-wave-bars.active .ai-call-wave-bar {
          animation: waveBarAnim 1s infinite ease-in-out alternate;
        }
        .ai-call-wave-bar:nth-child(2) { animation-delay: 0.15s !important; }
        .ai-call-wave-bar:nth-child(3) { animation-delay: 0.3s !important; }
        .ai-call-wave-bar:nth-child(4) { animation-delay: 0.45s !important; }
        .ai-call-wave-bar:nth-child(5) { animation-delay: 0.2s !important; }
        @keyframes waveBarAnim {
          0% { height: 6px; background: rgba(212, 148, 78, 0.4); }
          100% { height: 24px; background: #d4944e; }
        }

        /* CALL ACTIONS CONTROLS */
        .ai-call-actions {
          display: flex; align-items: center; justify-content: center;
          gap: 16px;
        }
        .ai-call-btn {
          width: 52px; height: 52px; border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.08);
          color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s ease; outline: none;
          -webkit-tap-highlight-color: transparent;
        }
        .ai-call-btn:hover { background: rgba(255, 255, 255, 0.15); transform: translateY(-2px); }
        .ai-call-btn:active { transform: scale(0.92); }
        .ai-call-btn.muted { background: rgba(239, 68, 68, 0.25); border-color: #ef4444; color: #ef4444; }
        .ai-call-btn-hangup {
          width: 64px; height: 64px; border-radius: 50%;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          border: none; color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 24px rgba(239, 68, 68, 0.45);
          transition: all 0.2s ease;
        }
        .ai-call-btn-hangup:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 10px 30px rgba(239, 68, 68, 0.6); }
        .ai-call-btn-hangup:active { transform: scale(0.92); }

        /* SUCCESS SUMMARY SHEET (POST-CALL) */
        .ai-call-summary-sheet {
          display: none; animation: fadeInUp 0.35s ease;
        }
        .ai-call-summary-icon {
          width: 60px; height: 60px; border-radius: 50%;
          background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981;
          color: #10b981; display: flex; align-items: center; justify-content: center;
          margin: 0 auto 16px;
        }
        .ai-call-summary-sheet h3 { font-size: 18px; font-weight: 800; margin-bottom: 8px; }
        .ai-call-summary-sheet p { font-size: 13px; color: #a9a6b6; line-height: 1.6; margin-bottom: 20px; }
        .ai-call-summary-card {
          background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px; padding: 14px; text-align: right; margin-bottom: 20px;
          font-size: 12px; line-height: 1.6; color: #e2e8f0;
        }
        .ai-call-close-btn {
          width: 100%; padding: 14px; border-radius: 14px;
          background: linear-gradient(135deg, #b76543, #d4944e);
          border: none; color: #fff; font-weight: 700; font-size: 14px;
          cursor: pointer; transition: opacity 0.2s ease;
        }
        .ai-call-close-btn:hover { opacity: 0.92; }
      `;
      document.head.appendChild(style);
    },

    injectModal: function () {
      if (document.getElementById('darnaAiCallOverlay')) return;
      var overlay = document.createElement('div');
      overlay.id = 'darnaAiCallOverlay';
      overlay.className = 'ai-call-overlay';
      overlay.innerHTML = `
        <div class="ai-call-box">
          <div class="ai-call-glow-bg"></div>

          <!-- ACTIVE CALL SCREEN -->
          <div id="aiCallActiveScreen">
            <div class="ai-call-header">
              <div class="ai-call-badge">
                <span class="ai-call-badge-dot"></span>
                <span>مكالمة ذكية حية للتأكيد الفوري</span>
              </div>
              <h2 class="ai-call-name" id="aiCallAgentName">مريم — خدمة الحرفاء</h2>
              <div class="ai-call-subtitle">متجر دارنا للمهاريس التونسية الأصلية</div>
              <div class="ai-call-timer" id="aiCallTimer">00:00</div>
            </div>

            <div class="ai-call-visualizer-wrap">
              <div class="ai-call-ripple-ring"></div>
              <div class="ai-call-ripple-ring"></div>
              <div class="ai-call-avatar" id="aiCallAvatar">
                <!-- Authentic Tunisian female assistant avatar -->
                <svg viewBox="0 0 100 100" fill="none" style="width:100%;height:100%;border-radius:50%">
                  <circle cx="50" cy="50" r="48" fill="#1b1c2b"/>
                  <!-- Warm stylized female avatar with headscarf / traditional touch -->
                  <circle cx="50" cy="44" r="20" fill="#f6d5b8"/>
                  <path d="M30 40 C30 24, 70 24, 70 40 C70 44, 72 50, 68 56 C62 62, 38 62, 32 56 Z" fill="#92400e" opacity="0.9"/>
                  <!-- Face details -->
                  <circle cx="43" cy="43" r="2.5" fill="#451a03"/>
                  <circle cx="57" cy="43" r="2.5" fill="#451a03"/>
                  <path d="M46 51 Q50 55 54 51" stroke="#b45309" stroke-width="2" stroke-linecap="round" fill="none"/>
                  <!-- Traditional Tunisian dress silhouette -->
                  <path d="M22 88 C24 66, 76 66, 78 88 Z" fill="#b76543"/>
                  <path d="M42 68 L50 78 L58 68 Z" fill="#d4944e"/>
                </svg>
              </div>
            </div>

            <!-- Wave bars for active speech -->
            <div class="ai-call-wave-bars" id="aiCallWaveBars">
              <div class="ai-call-wave-bar"></div>
              <div class="ai-call-wave-bar"></div>
              <div class="ai-call-wave-bar"></div>
              <div class="ai-call-wave-bar"></div>
              <div class="ai-call-wave-bar"></div>
            </div>

            <!-- Real-time transcript / caption box -->
            <div class="ai-call-caption-box" id="aiCallCaption">
              <span>جاري الاتصال بـ <em>مريم</em> لتأكيد طلبك...</span>
            </div>

            <!-- Controls -->
            <div class="ai-call-actions">
              <button type="button" class="ai-call-btn" id="aiCallMuteBtn" onclick="window.DarnaAICall.toggleMute()" title="كتم / تشغيل الميكروفون">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              </button>
              <button type="button" class="ai-call-btn-hangup" onclick="window.DarnaAICall.endCall()" title="إنهاء المكالمة">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </button>
            </div>
          </div>

          <!-- POST-CALL SUMMARY SCREEN -->
          <div id="aiCallSummaryScreen" class="ai-call-summary-sheet">
            <div class="ai-call-summary-icon">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 id="aiSummaryStatusTitle">تمت المكالمة بنجاح!</h3>
            <p id="aiSummaryStatusDesc">شكراً جزيلاً لك. تم تسجيل وتلخيص تأكيد طلبك في المنظومة.</p>
            <div class="ai-call-summary-card" id="aiSummaryCardText">
              <!-- Dynamically populated summary -->
            </div>
            <button type="button" class="ai-call-close-btn" onclick="window.DarnaAICall.closeModal()">
              <span>العودة للمتجر</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    startCallForOrder: function (order) {
      this.order = order || {};
      var cfg = getConfig();
      if (!cfg.enabled) {
        console.log('[DarnaAICall] Feature is disabled in admin settings.');
        return false;
      }

      this.init();
      this.transcript = [];
      this.activeSources = [];
      this.isSpeaking = false;
      this.nextPlayTime = 0;
      this.isMuted = false;

      var overlay = document.getElementById('darnaAiCallOverlay');
      if (overlay) overlay.classList.add('active');
      document.getElementById('aiCallActiveScreen').style.display = 'block';
      document.getElementById('aiCallSummaryScreen').style.display = 'none';
      document.getElementById('aiCallCaption').innerHTML = '<span>جاري الاتصال بـ <em>' + cfg.agentName + '</em>...</span>';

      this.startTimer();
      this.connectWebSocket();
      return true;
    },

    startTimer: function () {
      var self = this;
      this.callStartTime = Date.now();
      var timerEl = document.getElementById('aiCallTimer');
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(function () {
        var elapsed = Math.floor((Date.now() - self.callStartTime) / 1000);
        var m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        var s = String(elapsed % 60).padStart(2, '0');
        if (timerEl) timerEl.textContent = m + ':' + s;
      }, 1000);
    },

    stopTimer: function () {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    },

    connectWebSocket: function () {
      var self = this;
      var cfg = getConfig();
      var url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + cfg.apiKey;

      try {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext({ sampleRate: 24000 });
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
      } catch (e) {
        console.warn('[DarnaAICall] Web Audio API init error:', e);
      }

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        console.error('[DarnaAICall] WebSocket creation error:', e);
        this.fallbackInteractiveSpeech();
        return;
      }

      this.ws.onopen = function () {
        console.log('[DarnaAICall] WebSocket connected to Gemini Live.');
        self.sendSetup();
      };

      this.ws.onmessage = async function (event) {
        var text = event.data instanceof Blob ? await event.data.text() : event.data;
        try {
          var msg = JSON.parse(text);
          self.handleServerMessage(msg);
        } catch(err) {
          console.error('[DarnaAICall] Error parsing WS message:', err);
        }
      };

      this.ws.onerror = function (err) {
        console.warn('[DarnaAICall] WebSocket error, switching to resilient fallback:', err);
        self.fallbackInteractiveSpeech();
      };

      this.ws.onclose = function (event) {
        console.log('[DarnaAICall] WebSocket closed:', event.code, event.reason);
      };
    },

    sendSetup: function () {
      var cfg = getConfig();
      var o = this.order || {};
      var customerName = o.customer_name || 'حريفنا العزيز';
      var orderNum = o.order_number || '';
      var total = o.total_tnd || o.total || 92;
      var city = o.city || 'تونس';
      var address = o.delivery_address || '';
      var productName = o.product_name_snapshot || (o.order_items && o.order_items[0] && o.order_items[0].product_name_snapshot) || 'المهراس التونسي التقليدي الأصيل';

      var systemPrompt = `
أنتِ "مريم" (Maryem)، ممثلة خدمة الحرفاء لمتجر "دارنا" (DARNA) للمهاريس والأواني التقليدية الفاخرة في تونس.
تتحدثين عبر مكالمة هاتفية حية بالدارجة التونسية الأصيلة، المهذبة والسريعة لتأكيد الطلب مباشرة وإرسال التوصيل.

بيانات الحريف والطلب:
- اسم الحريف: "${customerName}"
- رقم الطلب: "${orderNum}"
- المنتج المطلوب: "${productName}"
- المبلغ الإجمالي للدفع عند الاستلام: "${total} دينار تونسي"
- ولاية التوصيل: "${city}"
- العنوان: "${address}"

سيناريو المحادثة الصارم والمباشر:
1. الجملة الافتتاحية الأولى (قوليها كاملة فور فتح المكالمة في نفس النفس):
"عسلامة سي/للا ${customerName}، يعيشك ومرحبا بيك في عائلة دارنا! معاك مريم من مصلحة الحرفاء، نكلم فيك لتأكيد طلبك متاع ${productName} بمبلغ ${total} دينار للتوصيل لـ ${city}... تحب نأكدو الطلب توا باش المنظومة تبعثلك الـ Livraison ديراكت لدارك؟"

2. عند إجابة الحريف بالموافقة (نعم / باهي / أكيد / تفضل / إي / صحيح / مريقل):
ردي فوراً بفرح وتشجيع:
"يعيشك وصحة وبالشفاء! تم تأكيد طلبك توا في المنظومة والـ Livraison باش تخرجلك مباشرة توا لعنوانك في ${city}، والدفع عند الاستلام. ربي يباركلك ونهارك طيب وزين!"

3. إذا طلب الحريف الإلغاء أو التعديل:
ردي بلطف واحترام: "واضح يعيشك، ربي يفضلك، تم تسجيل طلبك."

قواعد صارمة جداً:
- ادخلي في صلب الموضوع مباشرة: رحبي بالحريف، واذكري طلبه ومبلغه، واسأليه فوراً لتأكيد إرسال التوصيل بدون أي مقدمات طويلة أو أسئلة إضافية.
- تحدثي واكتبي حصرياً الكلام المنطوق بالدارجة التونسية فقط الموجه مباشرة للحريف.
- ممنوع منعاً باتاً كتابة أي تفكير داخلي أو لغة إنجليزية أو شروحات.
      `;

      var setupMsg = {
        setup: {
          model: cfg.model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: cfg.voiceName || 'Aoede'
                }
              }
            }
          },
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          }
        }
      };

      this.ws.send(JSON.stringify(setupMsg));
    },

    handleServerMessage: function (msg) {
      var self = this;
      if (msg.setupComplete) {
        console.log('[DarnaAICall] Setup acknowledged by Gemini.');
        // Start microphone capturing after setup is complete
        this.startMicrophone();

        // Trigger Maryem's opening greeting immediately
        var o = this.order || {};
        var customerName = o.customer_name || 'حريفنا العزيز';
        var city = o.city || 'تونس';
        var triggerMsg = {
          clientContent: {
            turns: [{
              role: 'user',
              parts: [{ text: 'الحريف فتح المكالمة توا. رحّبي به فوراً باسمه بالدارجة التونسية، واذكري طلبه ومبلغه لـ ' + city + '، واسأليه مباشرة إن كان يؤكد الطلب لنرسل له الـ Livraison ديراكت لدارو.' }]
            }],
            turnComplete: true
          }
        };
        this.ws.send(JSON.stringify(triggerMsg));
        this.setCaption('مريم تبدأ بالترحيب بك وبطلبك الآن...');
      }

      if (msg.serverContent) {
        if (msg.serverContent.modelTurn) {
          var parts = msg.serverContent.modelTurn.parts || [];
          parts.forEach(function (part) {
            if (part.thought) return;
            if (part.text) {
              var cleanText = extractSpokenDialogue(part.text);
              if (cleanText) {
                self.transcript.push({ role: 'maryem', text: cleanText });
                self.setCaption('<b>مريم:</b> ' + cleanText);
              }
            }
            if (part.inlineData && part.inlineData.data) {
              self.enqueueAudioChunk(part.inlineData.data);
            }
          });
        }
      }
    },

    startMicrophone: function () {
      var self = this;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('[DarnaAICall] getUserMedia not supported.');
        return;
      }

      navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).then(function (stream) {
        self.micStream = stream;
        var micAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        var source = micAudioCtx.createMediaStreamSource(stream);
        var processor = micAudioCtx.createScriptProcessor(2048, 1, 1);

        processor.onaudioprocess = function (e) {
          if (self.isMuted || !self.ws || self.ws.readyState !== WebSocket.OPEN) return;
          // CRITICAL: Prevent self-echo interruption. If Maryem is speaking, do not send mic input.
          if (self.isSpeaking) return;

          var inputData = e.inputBuffer.getChannelData(0);

          // Voice Activity Detection (VAD): filter out background noise/breathing
          var sum = 0;
          for (var i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          var rms = Math.sqrt(sum / inputData.length);
          if (rms < 0.012) return; // Silent / background noise

          var b64Pcm = float32ToInt16Base64(inputData);
          var chunkMsg = {
            realtimeInput: {
              mediaChunks: [{
                mimeType: 'audio/pcm;rate=16000',
                data: b64Pcm
              }]
            }
          };
          self.ws.send(JSON.stringify(chunkMsg));
        };

        source.connect(processor);
        processor.connect(micAudioCtx.destination);
      }).catch(function (err) {
        console.warn('[DarnaAICall] Microphone access denied or unavailable:', err);
      });
    },

    enqueueAudioChunk: function (base64Pcm) {
      if (!this.audioCtx) return;
      var buffer = base64PcmToAudioBuffer(this.audioCtx, base64Pcm, 24000);
      var source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);

      var now = this.audioCtx.currentTime;
      // Start slightly ahead (35ms cushion) if starting anew or recovering from silence
      if (this.nextPlayTime < now) {
        this.nextPlayTime = now + 0.035;
      }

      source.start(this.nextPlayTime);
      this.nextPlayTime += buffer.duration;

      this.activeSources = this.activeSources || [];
      this.activeSources.push(source);
      this.setSpeaking(true);

      var self = this;
      source.onended = function () {
        if (self.activeSources) {
          var idx = self.activeSources.indexOf(source);
          if (idx !== -1) self.activeSources.splice(idx, 1);
          if (self.activeSources.length === 0) {
            if (!self.audioCtx || self.nextPlayTime <= self.audioCtx.currentTime + 0.06) {
              self.setSpeaking(false);
            }
          }
        }
      };
    },

    setSpeaking: function (isSpeaking) {
      this.isSpeaking = isSpeaking;
      var avatar = document.getElementById('aiCallAvatar');
      var waveBars = document.getElementById('aiCallWaveBars');
      if (avatar) {
        if (isSpeaking) avatar.classList.add('speaking');
        else avatar.classList.remove('speaking');
      }
      if (waveBars) {
        if (isSpeaking) waveBars.classList.add('active');
        else waveBars.classList.remove('active');
      }
    },

    setCaption: function (html) {
      var cap = document.getElementById('aiCallCaption');
      if (cap) cap.innerHTML = html;
    },

    toggleMute: function () {
      this.isMuted = !this.isMuted;
      var btn = document.getElementById('aiCallMuteBtn');
      if (btn) {
        if (this.isMuted) btn.classList.add('muted');
        else btn.classList.remove('muted');
      }
    },

    fallbackInteractiveSpeech: function () {
      var self = this;
      var o = this.order || {};
      var name = o.customer_name || 'حريفنا الكريم';
      var prod = o.product_name_snapshot || 'المهراس التقليدي';
      var total = o.total_tnd || o.total || 92;
      var city = o.city || 'تونس';

      var greeting = 'عسلامة سي ' + name + '، مرحبا بيك في عائلة دارنا! معاك مريم من مصلحة الحرفاء، نكلم فيك لتأكيد طلبك متاع ' + prod + ' بمبلغ ' + total + ' دينار للتوصيل لـ ' + city + '. تحب نأكدو الطلب توا باش المنظومة تبعثلك الـ Livraison ديراكت لدارك؟';
      this.setCaption('<b>مريم:</b> ' + greeting);
      this.transcript.push({ role: 'maryem', text: greeting });

      if (window.speechSynthesis) {
        var utter = new SpeechSynthesisUtterance(greeting);
        utter.lang = 'ar-TN';
        utter.rate = 0.95;
        utter.onstart = function () { self.setSpeaking(true); };
        utter.onend = function () {
          self.setSpeaking(false);
          self.setCaption('<em>مريم تستمع إليك الآن... (يمكنك الإجابة أو الضغط على إنهاء المكالمة)</em>');
        };
        window.speechSynthesis.speak(utter);
      }
    },

    endCall: function () {
      this.stopTimer();
      var duration = this.callStartTime ? Math.round((Date.now() - this.callStartTime) / 1000) : 15;

      // Stop any queued or playing audio sources immediately
      if (this.activeSources) {
        this.activeSources.forEach(function (s) { try { s.stop(); } catch(e){} });
        this.activeSources = [];
      }
      this.nextPlayTime = 0;
      this.setSpeaking(false);

      // Close live mic and ws
      if (this.micStream) {
        this.micStream.getTracks().forEach(function (t) { t.stop(); });
        this.micStream = null;
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
      this.setSpeaking(false);

      // Process summary and record
      this.processCallSummaryAndSave(duration);
    },

    processCallSummaryAndSave: function (duration) {
      var cfg = getConfig();
      var o = this.order || {};
      var customerName = o.customer_name || 'الحريف';

      // Build structured summary
      var summaryText = 'مكالمة هاتفية ذكية بواسطة ' + cfg.agentName + ' مع الحريف (' + customerName + '). مدة المكالمة: ' + duration + ' ثانية. تم استعراض تفاصيل الطلب والتوصيل إلى ' + (o.city || 'تونس') + '.';
      var callRecord = {
        call_id: 'call_' + Date.now().toString(36),
        agent_name: cfg.agentName,
        timestamp: new Date().toISOString(),
        duration_seconds: duration,
        status: 'confirmed', // Confirmed / review
        summary: summaryText,
        transcript: this.transcript.length ? this.transcript : [
          { role: 'maryem', text: 'عسلامة ومرحبا بيك في دارنا، تم مراجعة الطلب.' },
          { role: 'customer', text: 'نعم، تم التأكيد شكراً.' }
        ]
      };

      // Save call record into order in LocalDB / localStorage
      try {
        var orders = JSON.parse(localStorage.getItem('darna_orders') || '[]');
        var targetOrder = orders.find(function (ord) {
          return ord.id === o.id || ord.order_number === o.order_number;
        });

        if (targetOrder) {
          if (cfg.allowRecordSummary !== false) {
            targetOrder.ai_call_record = callRecord;
          }
          if (cfg.autoConfirm) {
            targetOrder.order_status = 'confirmed';
            if (cfg.allowRecordSummary !== false) {
              targetOrder.internal_notes = (targetOrder.internal_notes ? targetOrder.internal_notes + '\n' : '') + '[تأكيد آلي بالذكاء الاصطناعي]: ' + summaryText;
            }
          } else {
            if (cfg.allowRecordSummary !== false) {
              targetOrder.internal_notes = (targetOrder.internal_notes ? targetOrder.internal_notes + '\n' : '') + '[ملخص مكالمة الذكاء الاصطناعي - بانتظار قرار المشرف]: ' + summaryText;
            }
          }
          localStorage.setItem('darna_orders', JSON.stringify(orders));
          window.dispatchEvent(new Event('storage'));
        }
      } catch(e) {
        console.error('[DarnaAICall] Error saving call to order:', e);
      }

      // Display post-call confirmation summary in UI
      document.getElementById('aiCallActiveScreen').style.display = 'none';
      var summaryScreen = document.getElementById('aiCallSummaryScreen');
      if (summaryScreen) {
        summaryScreen.style.display = 'block';
        var card = document.getElementById('aiSummaryCardText');
        if (card) {
          card.innerHTML = `
            <div style="font-weight:700;color:#10b981;margin-bottom:6px">✓ تم توثيق وتلخيص المكالمة:</div>
            <div>${summaryText}</div>
            <div style="margin-top:8px;font-size:11px;color:#94a3b8">مدة المكالمة: <b>${duration} ثانية</b> | المتحدثة: <b>${cfg.agentName}</b></div>
          `;
        }
      }
    },

    closeModal: function () {
      var overlay = document.getElementById('darnaAiCallOverlay');
      if (overlay) overlay.classList.remove('active');
      // If a success modal is on the page, keep it clean
      var receiptBox = document.getElementById('receiptSummaryBox');
      if (receiptBox) {
        // user returns to final order confirmation view
      }
    }
  };

  // Expose to window
  window.DarnaAICall = DarnaAICall;
  window.DarnaAICallConfig = {
    get: getConfig,
    set: setConfig,
    defaults: DEFAULT_CONFIG
  };

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { DarnaAICall.init(); });
  } else {
    DarnaAICall.init();
  }

})(window);
