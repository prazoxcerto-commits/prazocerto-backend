/* ==============================================================================
 * PRAZOCERTO – CONTROLE INTELIGENTE DE VALIDADE & ESTOQUE (app.js)
 * ==============================================================================
 * ÍNDICE DE SEÇÕES / MÓDULOS:
 *  # 01. CONFIGURAÇÃO & INICIALIZAÇÃO FIREBASE (Auth, Firestore, Cloud Messaging)
 *  # 02. STORE / GERENCIAMENTO DE ESTADO LOCAL (LocalStorage & Cache)
 *  # 03. CATÁLOGO DE PRODUTOS & BANCO DE DADOS EAN (Carregamento de Itens)
 *  # 04. MÓDULO DE AUTENTICAÇÃO (Login, Cadastro, Recuperação de Senha, Sessão)
 *  # 05. GERENCIAMENTO DE PRODUTOS & LOTES (CRUD, Cálculo de Validades, Status)
 *  # 06. SCANNER DE CÓDIGO DE BARRAS & QR CODE (Câmera, Quagga/Html5-QRCode)
 *  # 07. SISTEMA DE NOTIFICAÇÕES & ALERTAS (Push, Notificações Locais, Vencimentos)
 *  # 08. GRÁFICOS & DASHBOARD (Chart.js, Métricas de Perdas e Vencimentos)
 *  # 09. RELATÓRIOS & EXPORTAÇÃO (PDF, Excel/CSV, Impressão de Listas)
 *  # 10. INTERFACE DE USUÁRIO & NAVEGAÇÃO (Tabs, Modais, Toasts, Drawer)
 *  # 11. EVENT LISTENERS & INICIALIZAÇÃO GERAL DO APP
 * ============================================================================== */

'use strict';

// ── PROTEÇÃO GLOBAL CONTRA CRASHES & EXCEÇÕES NÃO TRATADAS (PREVINE TRAVAMENTOS NATIVOS NO ANDROID) ──
if (typeof window !== 'undefined') {
  window.addEventListener('error', function (event) {
    console.warn('[Auto-Recover] Erro de execução capturado e mitigado:', event.message || event);
    return true; // Previne que o erro escale para a WebView ou lance caixas de diálogo nativas
  });
  window.addEventListener('unhandledrejection', function (event) {
    console.warn('[Auto-Recover] Promessa rejeitada capturada e mitigada:', event.reason);
    event.preventDefault(); // Impede tela de crash no Android
  });
}

// ══════════════════════════════════════════════════════════
// 🔊 MÓDULO DE SONS DO SCANNER
// ══════════════════════════════════════════════════════════
const SCAN_SOUNDS = [
  { id: 'Som 01',  file: 'Sons/Som 01.mp3' },
  { id: 'Som 02',  file: 'Sons/Som 02.mp3' },
  { id: 'Som 03',  file: 'Sons/Som 03.mp3' },
  { id: 'Som 04',  file: 'Sons/Som 04.mp3' },
  { id: 'Som 05',  file: 'Sons/Som 05.mp3' },
  { id: 'Som 06',  file: 'Sons/Som 06.mp3' },
  { id: 'Som 07',  file: 'Sons/Som 07.mp3' },
  { id: 'Som 08',  file: 'Sons/Som 08.mp3' },
  { id: 'Som 09',  file: 'Sons/Som 09.mp3' },
  { id: 'Som 10',  file: 'Sons/Som 10.mp3' },
  { id: 'Som 11',  file: 'Sons/Som 11.mp3' },
  { id: 'Som 12',  file: 'Sons/Som 12.mp3' },
  { id: 'Som 13',  file: 'Sons/Som 13.wav' },
  { id: 'Som 14',  file: 'Sons/Som 14.wav' },
  { id: 'Som 15',  file: 'Sons/Som 15.wav' },
  { id: 'Som 16',  file: 'Sons/Som 16.wav' },
  { id: 'Som 17',  file: 'Sons/Som 17.wav' },
  { id: 'Som 18',  file: 'Sons/Som 18.wav' },
  { id: 'Som 19',  file: 'Sons/Som 19.wav' },
  { id: 'Som 20',  file: 'Sons/Som 20.mp3' },
  { id: 'Som 21',  file: 'Sons/Som 21.mp3' },
  { id: 'Som 22',  file: 'Sons/Som 22.mp3' },
  { id: 'Som 23',  file: 'Sons/Som 23.mp3' },
];

let _scanAudio = null;
let _audioCtx = null;
let _scanSrcNode = null; // nó ativo do AudioContext para corte imediato
const _soundBufferCache = {};

function _ensureAudioContext() {
  try {
    if (!_audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) _audioCtx = new AC();
    }
    if (_audioCtx && _audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
  } catch (e) { console.warn('AudioContext init:', e); }
}

['click', 'touchstart', 'keydown'].forEach(evt => {
  document.addEventListener(evt, _ensureAudioContext, { once: true, passive: true });
});

// Para qualquer som em reprodução imediatamente
function _stopCurrentScanSound() {
  try {
    if (_scanSrcNode) { try { _scanSrcNode.stop(0); } catch (_) {} _scanSrcNode = null; }
    if (_scanAudio) { try { _scanAudio.pause(); _scanAudio.currentTime = 0; } catch (_) {} _scanAudio = null; }
  } catch (_) {}
}

// Carrega e toca via AudioContext — sem restrição de autoplay, sem atraso
function _playViaAudioContext(filePath, onError) {
  _ensureAudioContext();
  if (!_audioCtx) { if (onError) onError('no-ctx'); return; }
  const _doPlay = (buf) => {
    _stopCurrentScanSound();
    const src = _audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_audioCtx.destination);
    src.start(0);
    _scanSrcNode = src;
  };
  if (_soundBufferCache[filePath]) {
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().then(() => _doPlay(_soundBufferCache[filePath])).catch(onError);
    } else {
      _doPlay(_soundBufferCache[filePath]);
    }
    return;
  }
  // Pré-carrega e toca
  const _resume = () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', filePath, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      _audioCtx.decodeAudioData(xhr.response, (buf) => {
        _soundBufferCache[filePath] = buf;
        _doPlay(buf);
      }, () => { if (onError) onError('decode-err'); });
    };
    xhr.onerror = () => { if (onError) onError('xhr-err'); };
    xhr.send();
  };
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().then(_resume).catch(onError);
  } else {
    _resume();
  }
}

function _playSynthesizedBeep() {
  try {
    _ensureAudioContext();
    if (!_audioCtx) return;
    const t = _audioCtx.currentTime;
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1760, t + 0.08);
    osc.frequency.setValueAtTime(1320, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(1760, t + 0.18);
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
    gain.gain.setValueAtTime(0.5, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  } catch (err) {
    console.warn('Fallback beep:', err);
  }
}

function playScanSound() {
  try {
    const settings = (typeof Store !== 'undefined' && Store.getSettings) ? Store.getSettings() : {};
    if (settings.scanSoundMuted) return;
    const selectedId = settings.scanSound || 'Som 01';
    const sound = SCAN_SOUNDS.find(s => s.id === selectedId) || SCAN_SOUNDS[0];
    // Para som anterior IMEDIATAMENTE e toca o novo sem atraso
    _stopCurrentScanSound();
    _ensureAudioContext();
    _playViaAudioContext(sound.file, (err) => {
      console.warn('AudioContext falhou (' + err + '), usando beep sintetizado');
      _playSynthesizedBeep();
    });
  } catch (e) {
    console.warn('playScanSound erro:', e);
    _playSynthesizedBeep();
  }
}

function testScanSound() {
  _ensureAudioContext();
  const settings = (typeof Store !== 'undefined' && Store.getSettings) ? Store.getSettings() : {};
  const selectedId = settings.scanSound || 'Som 01';
  _previewSound(selectedId);
}

function saveScanSoundMute() {
  try {
    const toggle = document.getElementById('scanSoundToggle');
    const isMuted = toggle ? !toggle.checked : false;
    const s = (typeof Store !== 'undefined' && Store.getSettings) ? Store.getSettings() : {};
    s.scanSoundMuted = isMuted;
    if (typeof Store !== 'undefined' && Store.setSettings) Store.setSettings(s);
    if (typeof showToast === 'function') {
      showToast(isMuted ? 'Modo silencioso ativado' : 'Som do scanner ativado', isMuted ? '🔇' : '🔔');
    }
  } catch (e) { console.warn('saveScanSoundMute:', e); }
}

function renderSoundList() {
  const container = document.getElementById('soundListContainer');
  if (!container) return;
  const settings = (typeof Store !== 'undefined' && Store.getSettings) ? Store.getSettings() : {};
  const selected = settings.scanSound || 'Som 01';
  
  const toggle = document.getElementById('scanSoundToggle');
  if (toggle) {
    toggle.checked = !(settings.scanSoundMuted ?? false);
  }

  container.innerHTML = '';
  SCAN_SOUNDS.forEach(s => {
    const isActive = s.id === selected;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:all 0.2s;background:${isActive ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isActive ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.06)'};`;
    row.innerHTML = `
      <span style="font-size:1rem;">🔊</span>
      <span style="flex:1;font-size:0.85rem;font-weight:${isActive ? '700' : '500'};color:${isActive ? '#38bdf8' : '#cbd5e1'};">${s.id}</span>
      ${isActive ? '<span style="font-size:0.75rem;color:#38bdf8;font-weight:800;">✔ Ativo</span>' : ''}
      <button onclick="event.stopPropagation();_previewSound('${s.id}')" style="background:rgba(255,255,255,0.06);border:none;color:#94a3b8;padding:4px 8px;border-radius:8px;font-size:0.75rem;cursor:pointer;">▶</button>
    `;
    row.addEventListener('click', () => {
      _ensureAudioContext();
      const s2 = (typeof Store !== 'undefined' && Store.getSettings) ? Store.getSettings() : {};
      s2.scanSound = s.id;
      if (typeof Store !== 'undefined' && Store.setSettings) Store.setSettings(s2);
      const nameEl = document.getElementById('currentSoundName');
      if (nameEl) nameEl.textContent = s.id;
      _previewSound(s.id);
      renderSoundList();
      if (typeof showToast === 'function') showToast('Som selecionado: ' + s.id, '🔊');
    });
    container.appendChild(row);
  });
}

function _previewSound(soundId) {
  try {
    _ensureAudioContext();
    const sound = SCAN_SOUNDS.find(s => s.id === soundId);
    if (!sound) return;
    if (_scanAudio) { try { _scanAudio.pause(); } catch (e) {} }
    _scanAudio = new Audio(sound.file);
    _scanAudio.volume = 1.0;
    _scanAudio.play().catch(e => {
      console.warn('Preview som:', e);
      _playSynthesizedBeep();
    });
  } catch (e) {
    console.warn('_previewSound:', e);
    _playSynthesizedBeep();
  }
}
window._previewSound = _previewSound;
window.testScanSound = testScanSound;
window.renderSoundList = renderSoundList;
window.saveScanSoundMute = saveScanSoundMute;

// ── FIREBASE ───────────────────────────────────────
const firebaseConfig = {
  projectId: "controlvald-app-2026",
  appId: "1:310978956391:web:0f1007706e378ebf5498c2",
  storageBucket: "controlvald-app-2026.firebasestorage.app",
  apiKey: "AIzaSyDZ23dSvO1QlivRwNl9OIbceQL9uOvqaUY",
  authDomain: "controlvald-app-2026.firebaseapp.com",
  messagingSenderId: "310978956391"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
let messaging = null;
try {
  if (typeof firebase.messaging !== 'undefined' && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
  }
} catch (e) {
  console.warn('Firebase Messaging não disponível (normal no APK):', e.message);
}

let _remoteProducts = [];
let _catalogProducts = [];
let _firestoreUnsubscribe = null; // listener em tempo real de produtos do usuário
let _currentUserId = null;        // UID do usuário logado

// ── SINCRONIZAÇÃO DE PRODUTOS COM FIRESTORE ──
function _syncProductsToFirestore(products) {
  if (!_currentUserId) return;
  // Segurança anti-perda: nunca sobrescreve o Firestore com lista vazia se havia produtos na memória/banco
  if ((!products || products.length === 0) && window._lastKnownRemoteCount && window._lastKnownRemoteCount > 0) {
    console.warn('Proteção de dados ativada: tentativa de sincronizar lista vazia ignorada para preservar a nuvem.');
    return;
  }
  if (Array.isArray(products) && products.length > 0) {
    window._lastKnownRemoteCount = products.length;
  }
  db.collection('user_data').doc(_currentUserId).set({
    products: products || [],
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(function (e) {
    console.warn('Erro ao sincronizar produtos:', e);
    if (typeof showToast === 'function') {
      showToast('Erro ao salvar na nuvem.', '❌');
    }
  });
}

// ── STORE ────────────────────────────────────────
const Store = (() => {
  const KEYS = {
    categories: 'cv_categories',
    settings: 'cv_settings',
  };

  function getUserKey(baseKey) {
    const uid = _currentUserId || localStorage.getItem('cv_user_email') || 'global';
    return `${baseKey}_${uid}`;
  }

  function get(key) {
    try {
      // Tenta chave específica do usuário primeiro
      const userVal = localStorage.getItem(getUserKey(key));
      if (userVal !== null) return JSON.parse(userVal);
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch { return null; }
  }
  function set(key, val) {
    try {
      localStorage.setItem(getUserKey(key), JSON.stringify(val));
      localStorage.setItem(key, JSON.stringify(val)); // fallback
    } catch (e) {}
  }

  return {
    getAllProducts: () => _remoteProducts,
    getProducts: () => {
      const sel = document.getElementById('globalLocationFilter');
      const rawLoc = sel && sel.value ? sel.value : (window.currentLocationFilter || localStorage.getItem('cv_selected_store') || 'all');
      const loc = (rawLoc || 'all').trim();
      if (loc === 'all') return _remoteProducts;
      return _remoteProducts.filter(p => {
        const pLoc = (p.location ? p.location.trim() : 'Sem Loja');
        return pLoc.toLowerCase() === loc.toLowerCase();
      });
    },
    getCatalog: () => _catalogProducts,
    setProducts: (v) => {
      _remoteProducts = v;
      if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
      // Salva em cache isolado por conta de usuário
      try {
        if (_currentUserId) {
          localStorage.setItem(`cv_products_${_currentUserId}`, JSON.stringify(v));
          // Snapshot de backup de segurança automático por conta
          localStorage.setItem(`cv_backup_snapshot_${_currentUserId}`, JSON.stringify({
            updatedAt: new Date().toISOString(),
            products: v,
            stores: Store.getStores()
          }));
        }
        localStorage.setItem('cv_products', JSON.stringify(v));
      } catch (e) { }
      // Sincroniza com Firestore se logado
      if (_currentUserId) {
        _syncProductsToFirestore(v);
      }
      // Atualiza todas as exibições em tempo real imediatamente
      if (typeof renderDashboard === 'function') renderDashboard();
      if (typeof renderProducts === 'function') renderProducts();
      if (typeof renderAlerts === 'function') renderAlerts(typeof currentAlertFilter !== 'undefined' ? currentAlertFilter : undefined);
      if (typeof updateBadges === 'function') updateBadges();
      if (typeof renderReports === 'function') renderReports();
      if (typeof renderHistory === 'function') renderHistory();
    },
    getCategories: () => get(KEYS.categories) || [
      { id: 'cat-1', name: 'Alimentos & Mercearia', emoji: '🥫', color: '#6EE7B7' },
      { id: 'cat-2', name: 'Laticínios & Ovos', emoji: '🥛', color: '#3B82F6' },
      { id: 'cat-3', name: 'Açougue & Carnes', emoji: '🥩', color: '#EF4444' },
      { id: 'cat-4', name: 'Hortifrúti & Frutas', emoji: '🍎', color: '#10B981' },
      { id: 'cat-5', name: 'Legumes & Verduras', emoji: '🥦', color: '#84CC16' },
      { id: 'cat-6', name: 'Padaria & Confeitaria', emoji: '🍞', color: '#F59E0B' },
      { id: 'cat-7', name: 'Bebidas & Sucos', emoji: '🧃', color: '#06B6D4' },
      { id: 'cat-8', name: 'Refrigerantes & Cervejas', emoji: '🥤', color: '#8B5CF6' },
      { id: 'cat-9', name: 'Congelados & Sorvetes', emoji: '🍦', color: '#38BDF8' },
      { id: 'cat-10', name: 'Frios & Queijos', emoji: '🧀', color: '#FBBF24' },
      { id: 'cat-11', name: 'Doces & Biscoitos', emoji: '🍫', color: '#F472B6' },
      { id: 'cat-12', name: 'Higiene Pessoal', emoji: '🧴', color: '#A78BFA' },
      { id: 'cat-13', name: 'Limpeza & Casa', emoji: '🧹', color: '#14B8A6' },
      { id: 'cat-14', name: 'Farmácia & Cuidados', emoji: '💊', color: '#FB7185' },
      { id: 'cat-15', name: 'Pet Shop & Animais', emoji: '🐶', color: '#FB923C' },
      { id: 'cat-16', name: 'Utilidades & Bazar', emoji: '🍳', color: '#94A3B8' },
    ],
    setCategories: v => set(KEYS.categories, v),
    getSettings: () => get(KEYS.settings) || { warnDays: 7, critDays: 3, theme: 'dark', animations: true, primaryColor: 'lime', scanSound: 'Som 01', scanSoundMuted: false },
    setSettings: v => set(KEYS.settings, v),
    getStores: () => {
      const s = get('cv_stores');
      if (!Array.isArray(s)) return [];
      return s.map(item => (typeof item === 'object' && item !== null ? item.name : String(item))).map(str => String(str).trim()).filter(Boolean);
    },
    setStores: v => {
      const valid = Array.isArray(v) ? v.map(item => (typeof item === 'object' && item !== null ? item.name : String(item))).map(s => String(s).trim()).filter(s => s && s !== 'Sem Loja') : [];
      set('cv_stores', valid);
      if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
      if (typeof populateStoreSelect === 'function') populateStoreSelect();
      if (typeof renderPlansScreen === 'function' && typeof currentPage !== 'undefined' && currentPage === 'plans') renderPlansScreen();
      if (typeof updateHeroStoresCount === 'function') updateHeroStoresCount();
      // Sincroniza lojas com Firestore se logado
      if (_currentUserId) {
        db.collection('user_data').doc(_currentUserId).set(
          { stores: valid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        ).catch(function (e) { console.warn('Erro ao sincronizar lojas:', e); });
      }
    },
  };
})();

// ── UTILS ────────────────────────────────────────
function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function toDateString(d) {
  if (!d) return null;
  let dateObj;
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return null;
    dateObj = d;
  } else if (typeof d === 'string') {
    dateObj = new Date(d.includes('T') ? d : d + 'T00:00:00');
  } else {
    return null;
  }
  if (isNaN(dateObj.getTime())) return null;
  return dateObj.toISOString().split('T')[0];
}

function daysUntil(dateVal) {
  const ds = toDateString(dateVal);
  if (!ds) return null;
  const exp = new Date(ds + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((exp - now) / 86400000);
}

function formatDate(dateVal) {
  const ds = toDateString(dateVal);
  if (!ds) return '—';
  const [y, m, d] = ds.split('-');
  const shortYear = y && y.length === 4 ? y.slice(2) : y;
  return `${d}/${m}/${shortYear}`;
}

function getStatus(days, settings) {
  if (days === null || isNaN(days)) return 'ok';
  if (days < 0) return 'expired';
  if (days <= (settings.warnDays || 7)) return 'warn';
  return 'ok';
}

function statusLabel(days) {
  if (days === null || isNaN(days)) return 'Data Inválida';
  if (days < 0) return `Vencido há ${Math.abs(days)} dias`;
  if (days === 0) return 'Vence hoje!';
  if (days === 1) return 'Vence em 1 dia';
  return `Vence em ${days} dias`;
}

function showToast(msg, icon = '✅', duration = 3000) {
  if (!msg) return;
  const str = String(msg).toLowerCase();
  // Bloqueio rigoroso de mensagens de plano ativo ou alertas intrusivos não desejados
  if (str.includes('plano ativo') || str.includes('permanecem salvos') || str.includes('suas filiais')) {
    return;
  }
  const t = document.getElementById('toast');
  const ti = document.getElementById('toastIcon');
  const tm = document.getElementById('toastMsg');
  if (!t || !ti || !tm) return;
  ti.textContent = icon;
  tm.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function confirm(title, msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    if (!modal) return resolve(false);
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    modal.classList.remove('hidden');
    const yes = document.getElementById('confirmYes');
    const no = document.getElementById('confirmNo');
    const close = document.getElementById('confirmClose');
    const cleanup = (val) => {
      modal.classList.add('hidden');
      resolve(val);
    };
    yes.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
    close.onclick = () => cleanup(false);
  });
}

function greeting() {
  const h = new Date().getHours();
  let greet = 'Bom dia';
  if (h >= 12 && h < 18) greet = 'Boa tarde';
  if (h >= 18 || h < 5) greet = 'Boa noite';

  let fullName = localStorage.getItem('cv_user_name') || '';
  if (!fullName && typeof firebase !== 'undefined' && firebase.auth) {
    try {
      const user = firebase.auth().currentUser;
      if (user) {
        fullName = user.displayName || (user.email ? user.email.split('@')[0] : '');
      }
    } catch (e) { }
  }
  if (!fullName) fullName = 'Usuário';

  const firstName = fullName.trim().split(/\s+/)[0] || 'Usuário';
  const formattedName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  return `${greet}, <span class="greeting-user-name" style="color:var(--primary); font-weight:900;">${formattedName}!</span>`;
}

function formatDashboardDate() {
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const now = new Date();
  return `${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`;
}

// Inicializa a data e o contador "atualizado há X min" no dashboard
let _dashLastUpdateTime = Date.now();
function initDashboardDateDisplay() {
  const dateEl = document.getElementById('dashDateText');
  if (dateEl) dateEl.textContent = formatDashboardDate();
  _dashLastUpdateTime = Date.now();
  _updateLastUpdateText();
}
function _updateLastUpdateText() {
  const el = document.getElementById('dashLastUpdate');
  if (!el) return;
  const mins = Math.round((Date.now() - _dashLastUpdateTime) / 60000);
  if (mins < 1) el.textContent = 'Atualizado agora';
  else if (mins === 1) el.textContent = 'Atualizado há 1 minuto';
  else el.textContent = `Atualizado há ${mins} minutos`;
}
// Atualiza o texto a cada minuto
setInterval(_updateLastUpdateText, 60000);

// ── NAVIGATION ───────────────────────────────────
let currentPage = 'dashboard';
let currentFilter = 'ok';
let currentAlertFilter = 'expired';
let editingProduct = null;

function navigate(page) {
  // REGRA OBRIGATÓRIA: Se existirem etiquetas na sessão, bloquear qualquer navegação para outra tela
  if (typeof _etiquetasSession !== 'undefined' && _etiquetasSession.length > 0) {
    showEtiquetasBlockExitModal();
    return;
  }
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(b => {
    if (b.dataset.page === page) b.classList.add('active');
    else b.classList.remove('active');
  });
  const pageEl = document.getElementById('page-' + page);
  const navEl = document.getElementById('nav-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  const titles = { dashboard: 'Dashboard', products: 'Produtos', alerts: 'Alertas', scanner: 'Scanner QR/Barras', categories: 'Categorias', reports: 'Relatórios', settings: 'Configurações', history: 'Histórico', plans: 'Planos', 'manage-subscription': 'Gerenciar Assinatura' };
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titles[page] || page;

  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) sidebarEl.classList.remove('open');

  // Fecha o popup do menu Mais sempre que navegar para qualquer tela
  const moreMenu = document.getElementById('bnavMoreMenu');
  if (moreMenu) moreMenu.classList.remove('open');

  if (page === 'manage-subscription') renderManageSubscriptionPage();

  if (page === 'dashboard') renderDashboard();
  if (page === 'products') renderProducts();
  if (page === 'alerts') renderAlerts();
  if (page === 'categories') renderCategories();
  if (page === 'reports') renderReports();
  if (page === 'plans') if (typeof renderPlansScreen === 'function') renderPlansScreen();
  // page-checkout não precisa render — dados já foram preenchidos por openCheckoutModal()
  if (page === 'scanner') startScanner();
  else if (scannerActive) try { stopScanner(); } catch (e) { }
  if (page === 'catalog') if (typeof renderCatalog === 'function') renderCatalog();
  if (page === 'history') if (typeof renderHistory === 'function') renderHistory();
}


function updateLocationFilterOptions() {
  const products = Store.getAllProducts() || [];
  const registered = Store.getStores() || [];
  const locationsSet = new Set();

  registered.forEach(s => {
    if (s && String(s).trim() && String(s).trim() !== 'Sem Loja') {
      locationsSet.add(String(s).trim());
    }
  });

  products.forEach(p => {
    if (p.location && String(p.location).trim() && String(p.location).trim() !== 'Sem Loja') {
      locationsSet.add(String(p.location).trim());
    }
  });

  const sorted = Array.from(locationsSet).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const sel = document.getElementById('globalLocationFilter');
  if (!sel) return;

  const saved = localStorage.getItem('cv_selected_store') || 'all';
  window.currentLocationFilter = saved;

  sel.innerHTML = '<option value="all">Todas as Lojas</option>' +
    sorted.map(loc => `<option value="${escHtml(loc)}">${escHtml(loc)}</option>`).join('');

  sel.value = sorted.includes(saved) || saved === 'all' ? saved : 'all';
  window.currentLocationFilter = sel.value;

  // Atualizar label visível do componente de loja no header e no card de evolução
  const storeNameEl = document.getElementById('topbarStoreName');
  if (storeNameEl) {
    const selectedOpt = sel.options[sel.selectedIndex];
    storeNameEl.textContent = selectedOpt ? selectedOpt.text : 'Todas as Lojas';
  }

  const evoSel = document.getElementById('evoItemFilterSelect');
  const evoLabel = document.getElementById('evoFilterLabel');
  if (evoSel) {
    evoSel.innerHTML = '<option value="all">Todos os itens</option>' +
      sorted.map(loc => `<option value="${escHtml(loc)}">${escHtml(loc)}</option>`).join('');
    evoSel.value = sel.value;
    if (evoLabel) {
      const selectedOpt = evoSel.options[evoSel.selectedIndex];
      evoLabel.textContent = selectedOpt ? selectedOpt.text : 'Todos os itens';
    }
  }

  if (typeof updateHeroStoresCount === 'function') {
    updateHeroStoresCount();
  }
}

function populateStoreSelect(selected) {
  const sel = document.getElementById('prodLocation');
  if (!sel) return;
  const products = Store.getAllProducts() || [];
  const registered = Store.getStores() || [];
  const locationsSet = new Set();

  registered.forEach(s => {
    if (s && String(s).trim() && String(s).trim() !== 'Sem Loja') {
      locationsSet.add(String(s).trim());
    }
  });

  products.forEach(p => {
    if (p.location && String(p.location).trim() && String(p.location).trim() !== 'Sem Loja') {
      locationsSet.add(String(p.location).trim());
    }
  });

  const sorted = Array.from(locationsSet).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  sel.innerHTML = '<option value="">Sem Loja</option>' +
    sorted.map(s => `<option value="${escHtml(s)}" ${s === selected ? 'selected' : ''}>${escHtml(s)}</option>`).join('');
}


// ── RENDER PRODUCTS ──────────────────────────────
function renderProducts(filter) {
  if (filter !== undefined) currentFilter = filter;
  const settings = Store.getSettings();
  const allProducts = Store.getProducts();

  // Atualiza números da barra de resumo (Imagem 2)
  let countOk = 0, countWarn = 0, countExpired = 0;
  allProducts.forEach(p => {
    const d = daysUntil(p.expDate);
    const s = getStatus(d, settings);
    if (s === 'ok') countOk++;
    else if (s === 'warn') countWarn++;
    else countExpired++;
  });
  const elOk = document.getElementById('prodStatOk');
  const elWarn = document.getElementById('prodStatWarn');
  const elExp = document.getElementById('prodStatExpired');
  const elTotal = document.getElementById('prodStatTotal');
  if (elOk) elOk.textContent = countOk;
  if (elWarn) elWarn.textContent = countWarn;
  if (elExp) elExp.textContent = countExpired;
  if (elTotal) elTotal.textContent = allProducts.length;

  let products = [...allProducts];
  // Filter
  if (currentFilter !== 'all') {
    products = products.filter(p => {
      const d = daysUntil(p.expDate);
      const s = getStatus(d, settings);
      if (currentFilter === 'ok') return s === 'ok';
      if (currentFilter === 'warn') return s === 'warn';
      if (currentFilter === 'expired') return s === 'expired';
      return true;
    });
  }

  const catFilter = document.getElementById('filterCategory')?.value || 'all';
  if (catFilter !== 'all') {
    products = products.filter(p => p.category === catFilter);
  }

  // Sort
  const sort = document.getElementById('sortProducts')?.value || 'expiry';
  products.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);

    const dateA = a.expDate || '';
    const dateB = b.expDate || '';

    if (sort === 'expiry') {
      // Validade ↑ : Na validade boa (Maior data primeiro -> Descending)
      if (!dateA && dateB) return 1;
      if (dateA && !dateB) return -1;
      if (!dateA && !dateB) return 0;
      return dateA > dateB ? -1 : 1;
    }
    if (sort === 'expiry-desc') {
      // Validade ↓ : Vencidos/Próximos (Menor data primeiro -> Ascending)
      if (!dateA && dateB) return 1;
      if (dateA && !dateB) return -1;
      if (!dateA && !dateB) return 0;
      return dateA < dateB ? -1 : 1;
    }

    if (sort === 'category') return (a.category || '').localeCompare(b.category || '');
    return 0;
  });
  // Search inteligente: nome, primeira palavra, descricao, codigo, EAN, ultimos 4 digitos
  const q = (document.getElementById('productSearch')?.value || '').trim().toLowerCase();
  if (q) {
    products = products.filter(p => {
      const name = (p.name || '').toLowerCase();
      const desc = (p.description || p.desc || '').toLowerCase();
      const code = (p.code || '').toLowerCase();
      const ean = String(p.ean || '').toLowerCase();
      const firstW = name.split(/\s+/)[0];
      const last4c = code.length >= 4 ? code.slice(-4) : code;
      const last4e = ean.length >= 4 ? ean.slice(-4) : ean;
      return (
        name.includes(q) ||
        firstW.startsWith(q) ||
        desc.includes(q) ||
        code.includes(q) ||
        ean.includes(q) ||
        last4c === q ||
        last4e === q
      );
    });
  }


  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  const PAGE_SIZE = 10;
  if (filter !== undefined && typeof filter === 'string' && !['ok', 'warn', 'expired', 'all'].includes(filter)) { }
  if (!window._prodPage) window._prodPage = 1;
  const totalItems = products.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (window._prodPage > totalPages) window._prodPage = 1;
  const pageStart = (window._prodPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, totalItems);
  const pagedProducts = products.slice(pageStart, pageEnd);

  const infoEl = document.getElementById('prodPageInfo');
  if (infoEl) infoEl.textContent = `Mostrando ${pageStart + 1} a ${pageEnd} de ${totalItems} itens`;
  const elTot2 = document.getElementById('prodStatTotal2'); if (elTot2) elTot2.textContent = allProducts.length;
  const elOk2 = document.getElementById('prodStatOk2'); if (elOk2) elOk2.textContent = countOk;
  const elWa2 = document.getElementById('prodStatWarn2'); if (elWa2) elWa2.textContent = countWarn;
  const elEx2 = document.getElementById('prodStatExpired2'); if (elEx2) elEx2.textContent = countExpired;

  const prevBtn = document.getElementById('prodPrevPage');
  const nextBtn = document.getElementById('prodNextPage');
  const pageBtns = document.getElementById('prodPageBtns');
  if (prevBtn) prevBtn.disabled = window._prodPage <= 1;
  if (nextBtn) nextBtn.disabled = window._prodPage >= totalPages;
  if (pageBtns) {
    let html = '';
    const show = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= window._prodPage - 1 && i <= window._prodPage + 1)) show.push(i);
      else if (show[show.length - 1] !== '...') show.push('...');
    }
    show.forEach(s => {
      if (s === '...') html += `<span class="page-ellipsis">...</span>`;
      else html += `<button class="page-num-btn ${s === window._prodPage ? 'active' : ''}" data-page="${s}">${s}</button>`;
    });
    pageBtns.innerHTML = html;
    pageBtns.querySelectorAll('.page-num-btn').forEach(b => b.addEventListener('click', e => {
      window._prodPage = parseInt(b.dataset.page); renderProducts();
    }));
  }

  if (!pagedProducts.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📦</div>
      <h3>Nenhum produto encontrado</h3>
      <p>Tente outro filtro ou adicione produtos.</p>
      <button class="btn-primary" id="emptyAddBtn2">+ Adicionar Produto</button>
    </div>`;
    document.getElementById('emptyAddBtn2')?.addEventListener('click', openAddModal);
    return;
  }
  const cats = Store.getCategories();
  grid.innerHTML = pagedProducts.map((p, index) => productCardHTML(p, cats, settings, pageStart + index + 1)).join('');
  grid.querySelectorAll('.product-card, .pcard').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.product-action-btn') || e.target.closest('.pcard-btn')) return;
      openEditModal(card.dataset.id);
    });
    card.querySelector('.edit-btn')?.addEventListener('click', e => { e.stopPropagation(); openEditModal(card.dataset.id); });
    card.querySelector('.delete-btn')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (await confirm('Excluir produto', 'Tem certeza que deseja excluir este produto?')) {
        deleteProduct(card.dataset.id);
      }
    });
    card.querySelector('.share-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      openShareModal(card.dataset.id);
    });
  });
  updateBadges();
  attachProductImages(grid);
}

function productCardHTML(p, cats, settings, index) {
  const days = daysUntil(p.expDate);
  const status = getStatus(days, settings);
  const cat = cats.find(c => c.id === p.category);
  const locationName = p.location || 'Savegnago 22';

  let badgeClass = 'status-ok';
  let statusColor = '#22c55e';
  let badgeIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  if (days < 0) {
    badgeClass = 'status-expired';
    statusColor = '#ef4444';
    badgeIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  } else if (days <= (settings.warnDays || 7)) {
    badgeClass = 'status-warn';
    statusColor = '#eab308';
    badgeIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }

  const progressPercent = days <= 0 ? 0 : Math.min(100, Math.max(5, Math.round((days / 365) * 100)));

  return `<div class="pcard ${badgeClass}" data-id="${p.id}">
    <div class="pcard-main-content">
      <div class="pcard-img-wrap" ${p.code ? `data-ean="${p.code}"` : ''}>
        <div class="pcard-corner-badge pcard-badge-${badgeClass}">
          ${badgeIcon}
        </div>
        <span class="pcard-img-emoji">${cat ? cat.emoji : '📦'}</span>
      </div>

      <div class="pcard-body">
        <div class="pcard-title">
          <span class="pcard-idx">${index}.</span>
          <span class="pcard-name" style="white-space:normal;overflow:visible;text-overflow:unset;word-break:break-word;">${escHtml(p.name)}</span>
        </div>

        <div class="pcard-pills">
          <div class="pcard-pill pcard-pill-date" title="Validade: ${formatDate(p.expDate)}">
            <span>📅 ${formatDate(p.expDate)}</span>
          </div>
          <div class="pcard-pill pcard-pill-qty" title="Quantidade: ${p.qty || 1}">
            <span>Qtd: ${p.qty || 1}</span>
          </div>
          <div class="pcard-pill pcard-pill-loc" title="Loja: ${escHtml(locationName)}">
            <span class="pcard-pill-loc-text">📍 ${escHtml(locationName)}</span>
          </div>
        </div>

        ${p.code ? `<div class="pcard-ean-row" title="Clique para ampliar o código de barras" onclick="event.stopPropagation(); openImgModal('https://bwipjs-api.metafloor.com/?bcid=ean13&text=${p.code}&scale=6&includetext')">
          <svg viewBox="0 0 24 24" width="22" height="18" fill="none" stroke="#60a5fa" stroke-width="2.2"><path d="M3 5v14M6 5v14M8 5v14M11 5v14M15 5v14M17 5v14M21 5v14"/></svg>
          <span class="pcard-ean-text">${escHtml(p.code)}</span>
          <span style="font-size:0.7rem; color:#60a5fa; margin-left:2px;">🔍</span>
        </div>` : ''}

        <div class="pcard-progress-track">
          <div class="pcard-progress-bar" style="width: ${progressPercent}%; background: ${statusColor};"></div>
        </div>



        <div class="pcard-action-btns-row">
          <button class="pcard-btn pcard-btn-edit edit-btn" title="Editar">✏️ Editar</button>
          <button class="pcard-btn pcard-btn-delete delete-btn" title="Excluir">🗑️ Excluir</button>
          <button class="pcard-btn pcard-btn-share share-btn" data-id="${p.id}" title="Compartilhar">📲 Compartilhar</button>
        </div>
      </div>
    </div>
  </div>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════════════════════
//  MÓDULO DE BUSCA DE PRODUTO POR CÓDIGO DE BARRAS – CASCATA COM CACHE FIRESTORE
//  Estratégia:
//    1. Cache em memória (instância)
//    2. Cache Firestore (coleção produtos_cache)
//    3. Open Food Facts  → grátis, ilimitado
//    4. Open Beauty Facts → grátis, ilimitado
//    5. Open Products Facts → grátis, ilimitado
//    6. Bluesoft Cosmos  → 25 consultas/dia grátis
//    7. UPCitemdb        → 100 consultas/dia grátis
//    8. Chomp API        → 1.000 consultas/mês grátis
//    9. Barcode Lookup   → 50 consultas/mês grátis
//   10. Fallback: usuário preenche manualmente
// ══════════════════════════════════════════════════════════════════════════════

// Cache em memória + LocalStorage (banco NoSQL local do aparelho)
const _prodCacheMemory = {};

function _getLocalProductCache(gtin) {
  const key = String(gtin).trim();
  if (_prodCacheMemory[key]) return _prodCacheMemory[key];
  try {
    const raw = localStorage.getItem('cv_prod_cache_' + key);
    if (raw) {
      const data = JSON.parse(raw);
      _prodCacheMemory[key] = data;
      return data;
    }
  } catch (e) { }
  return null;
}

function _setLocalProductCache(gtin, data) {
  if (!gtin || !data) return;
  const key = String(gtin).trim();
  _prodCacheMemory[key] = data;
  try {
    localStorage.setItem('cv_prod_cache_' + key, JSON.stringify(data));
  } catch (e) { }
}

/**
 * Salva dados do produto no Cache Local e na coleção produtos_cache do Firestore.
 * Custo Zero: Salva apenas Strings (URLs), sem salvar arquivos binários no Storage.
 */
async function _saveProdutoCache(gtin, dados) {
  if (!gtin || !dados) return;
  const key = String(gtin).trim();
  const nome = dados.nome || dados.nome_produto || '';
  // Não salva no cache permanente se não tiver nome — evita contaminar cache com resultados parciais
  // (imagem sem nome seria reutilizada e nunca buscaria o nome novamente)
  if (!nome || nome.trim().length < 2) {
    // Salva só na memória local temporária para não repetir a busca na mesma sessão
    _prodCacheMemory[key] = { ...dados, gtin: key, nome: '' };
    return;
  }
  const payload = {
    gtin: key,
    nome: nome,
    marca: dados.marca || '',
    descricao: dados.descricao || '',
    categoria: dados.categoria || '',
    imagem_url: dados.imagem_url || dados.imageUrl || dados.foto || '',
    fonte_dados: dados.fonte_dados || 'desconhecido'
  };
  _setLocalProductCache(key, payload);
  try {
    if (typeof db !== 'undefined') {
      await db.collection('produtos_cache').doc(key).set({
        ...payload,
        criado_em: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  } catch (e) {
    console.warn('[Cache] Erro ao salvar produtos_cache:', e.message);
  }
}

/**
 * Lê do Cache Local (1º Passo) e se não encontrar busca no Firestore produtos_cache (2º Passo).
 */
async function _readProdutoCache(gtin) {
  const key = String(gtin).trim();
  // 1º Passo: BANCO LOCAL (Memória / LocalStorage do celular)
  const local = _getLocalProductCache(key);
  if (local) return local;

  // 2º Passo: NUVEM (FIRESTORE produtos_cache)
  try {
    if (typeof db !== 'undefined') {
      const snap = await db.collection('produtos_cache').doc(key).get();
      if (snap.exists) {
        const d = snap.data();
        _setLocalProductCache(key, d);
        return d;
      }
    }
  } catch (e) { }
  return null;
}

// Cache do token GTIN RSC/OSCBR no cliente
let _gtinOscbrClientToken = null;
let _gtinOscbrClientTokenExpires = 0;

async function _fetchGtinOscbr(ean) {
  try {
    const creds = localStorage.getItem('GTIN_OSCBR_CREDENTIALS') || 'ZXN0dWRhbnRlLmp1bmlvcjo1ODI2MDIzM2xMQEA=';
    if (!_gtinOscbrClientToken || Date.now() >= _gtinOscbrClientTokenExpires) {
      const authRes = await fetch('https://gtin.rscsistemas.com.br/api/v3/oauth/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${creds}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      });
      if (authRes.ok) {
        const authData = await authRes.json();
        _gtinOscbrClientToken = authData.token;
        _gtinOscbrClientTokenExpires = Date.now() + 55 * 60 * 1000;
      }
    }
    if (_gtinOscbrClientToken) {
      const infoRes = await fetch(`https://gtin.rscsistemas.com.br/api/v3/gtin/${ean}`, {
        headers: { 'Authorization': `Bearer ${_gtinOscbrClientToken}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (infoRes.ok) {
        const d = await infoRes.json();
        const nome = d.nome || d.descricao || '';
        const img = d.link_foto || (nome ? `https://gtin.rscsistemas.com.br/api/v3/gtin/${ean}/image` : '');
        if (nome || img) {
          return {
            nome: nome,
            marca: d.marca || '',
            descricao: d.categoria || '',
            imagem_url: img,
            fonte_dados: 'gtin_oscbr'
          };
        }
      }
    }
  } catch (e) { }
  return null;
}

/**
 * Extrai o melhor nome disponível de um objeto de resposta de API,
 * percorrendo todos os campos conhecidos em ordem de prioridade.
 * Garante preenchimento consistente para TODOS os tipos de produto.
 */
function _extractNome(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const candidates = [
    obj.product_name_pt,
    obj.product_name,
    obj.generic_name_pt,
    obj.generic_name,
    obj.title,
    obj.name,
    obj.nome,
    obj.description,
    obj.descricao
  ];
  for (const v of candidates) {
    if (v && typeof v === 'string' && v.trim().length > 1) return v.trim();
  }
  // Monta nome composto: marca + tipo/categoria como fallback
  const parts = [
    obj.brand || obj.marca || obj.brands || '',
    obj.category || obj.categoria || obj.keywords || ''
  ].map(s => (s || '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' – ');
  return '';
}

/**
 * Busca de produto por EAN — 2 CAMADAS para proteger cotas das APIs limitadas.
 *
 * CAMADA 1 — APIs ILIMITADAS (rodam sempre, em paralelo, custo zero):
 *   Open Food Facts · Open Beauty Facts · Open Products Facts · Produto.xyz
 *
 * CAMADA 2 — APIs COM COTA (só chamadas se CAMADA 1 falhar 100%):
 *   Bluesoft Cosmos (25/dia) · UPCitemdb (100/dia) · Chomp (1000/mês)
 *   Barcode Lookup (50/mês)  · GTIN OSCBR
 *
 * CACHE FIRESTORE COMPARTILHADO: produto achado por qualquer usuário
 * fica salvo para todos — as APIs de cota são chamadas cada vez menos.
 */
async function _fetchFromApis(gtin) {
  const ean = String(gtin).replace(/^0+/, '');

  // ── CAMADA 1: APIs ilimitadas ───────────────────────────────────
  const _offFetch = async (url, fonte) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return Promise.reject();
    const d = await r.json();
    if (d.status === 1 && d.product) {
      const p = d.product;
      const nome = _extractNome(p);
      const img = p.image_front_url || p.image_url || '';
      if (nome) return { nome, marca: p.brands || '', descricao: p.categories || p.category || '', imagem_url: img, fonte_dados: fonte };
    }
    return Promise.reject();
  };

  const _prodXyzFetch = async () => {
    const r = await fetch(`https://api.produto.xyz/v1/gtin/${ean}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return Promise.reject();
    const d = await r.json();
    const p = d.Product || d.product || d;
    if (p) {
      const nome = _extractNome(p);
      if (nome) return { nome, marca: p.manufacturer || p.brand || p.marca || '', descricao: p.category || p.categoria || '', imagem_url: p.image_url || p.picture || p.foto || '', fonte_dados: 'produto_xyz' };
    }
    return Promise.reject();
  };

  // Dispara as 4 APIs ilimitadas em paralelo
  try {
    const r1 = await Promise.any([
      _offFetch(`https://world.openfoodfacts.org/api/v0/product/${ean}.json`,    'open_food_facts'),
      _offFetch(`https://world.openbeautyfacts.org/api/v0/product/${ean}.json`,  'open_beauty_facts'),
      _offFetch(`https://world.openproductsfacts.org/api/v0/product/${ean}.json`, 'open_products_facts'),
      _prodXyzFetch()
    ]);
    if (r1 && r1.nome) return r1;
  } catch (e) { /* CAMADA 1 não achou, tenta CAMADA 2 */ }

  // ── CAMADA 2: APIs com cota (só chegam aqui se CAMADA 1 falhou) ─
  const _cosmosFetch = async () => {
    const r = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${ean}`, {
      headers: { 'X-Cosmos-Token': 'FsHvnHQj3FxgvdMOSrAUGQ' },
      signal: AbortSignal.timeout(7000)
    });
    if (!r.ok) return Promise.reject();
    const d = await r.json();
    const nome = _extractNome(d);
    const img = d.thumbnail || (d.photo && d.photo.url) || '';
    if (nome) return { nome, marca: (d.brand && d.brand.name) || d.marca || '', descricao: (d.category && (d.category.description || d.category.nome)) || '', imagem_url: img, fonte_dados: 'bluesoft_cosmos' };
    return Promise.reject();
  };

  const _upcFetch = async () => {
    const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${ean}`, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return Promise.reject();
    const d = await r.json();
    if (d.code === 'OK' && d.items && d.items.length > 0) {
      const nome = _extractNome(d.items[0]);
      if (nome) return { nome, marca: d.items[0].brand || '', descricao: d.items[0].description || '', imagem_url: (d.items[0].images && d.items[0].images[0]) || d.items[0].thumbnail || '', fonte_dados: 'upcitemdb' };
    }
    return Promise.reject();
  };

  const _chompFetch = async () => {
    const r = await fetch(`https://chompthis.com/api/v2/item/branded/barcode.php?api_key=m4tZNI8vNv5x0gUOzMqZfh8ZR3mGkM52&code=${ean}`, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return Promise.reject();
    const d = await r.json();
    if (d.items && d.items.length > 0) {
      const nome = _extractNome(d.items[0]);
      if (nome) return { nome, marca: d.items[0].brand || '', descricao: d.items[0].keywords || '', imagem_url: d.items[0].thumbnail || '', fonte_dados: 'chomp' };
    }
    return Promise.reject();
  };

  const _barcodeLookupFetch = async () => {
    const r = await fetch(`https://api.barcodelookup.com/v3/products?barcode=${ean}&formatted=y&key=2hpknl1zbi7lp21w8sfaxmlfbmv9ux`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return Promise.reject();
    const d = await r.json();
    if (d.products && d.products.length > 0) {
      const nome = _extractNome(d.products[0]);
      if (nome) return { nome, marca: d.products[0].brand || '', descricao: d.products[0].description || '', imagem_url: (d.products[0].images && d.products[0].images[0]) || '', fonte_dados: 'barcode_lookup' };
    }
    return Promise.reject();
  };

  // Dispara as APIs com cota em paralelo entre si
  try {
    const r2 = await Promise.any([
      _cosmosFetch(),
      _upcFetch(),
      _chompFetch(),
      _barcodeLookupFetch(),
      _fetchGtinOscbr(ean).then(r => { if (r && r.nome) return r; return Promise.reject(); })
    ]);
    if (r2 && r2.nome) return r2;
  } catch (e) { /* CAMADA 2 também falhou */ }

  // ── FALLBACK FINAL: CDN Cosmos (só imagem, sem nome) ───────────
  try {
    const cdnUrl = `https://cdn-cosmos.bluesoft.com.br/products/${ean}`;
    const imgCheck = await new Promise(resolve => {
      const i = new Image();
      i.onload = () => resolve(cdnUrl);
      i.onerror = () => resolve(null);
      i.src = cdnUrl;
      setTimeout(() => resolve(null), 3000);
    });
    if (imgCheck) return { nome: '', marca: '', descricao: '', imagem_url: imgCheck, fonte_dados: 'cosmos_cdn' };
  } catch (e) { }

  return null;
}


/**
 * Ponto de entrada principal.
 * Retorna dados do produto (com imagem_url) a partir de cache ou APIs.
 * Salva automaticamente no Firestore ao encontrar via API.
 */
/**
 * Preenche prodName e prodCategory diretamente após escanear um barcode.
 * Chamado diretamente pelos handlers do scanner (ML Kit e Quagga).
 */
async function lookupAndFillProduct(ean) {
  if (!ean) return;
  const key = String(ean).trim();
  const cleanKey = key.replace(/^0+/, '');

  try {
    const nameEl = document.getElementById('prodName');
    const catEl  = document.getElementById('prodCategory');
    const notFoundEl = document.getElementById('prodNotFoundMsg');
    const imgEl = document.getElementById('prodImage');
    const imgCont = document.getElementById('prodImageContainer');

    if (nameEl) nameEl.placeholder = '🔍 Buscando produto...';

    // 1. Verificacao IMEDIATA em Catalogos e Memoria Local (0ms de latencia)
    let found = null;

    // 1.1 Catalogo Embutido
    if (typeof CATALOGOS_EMBUTIDOS !== 'undefined') {
      for (const [marcaNome, lista] of Object.entries(CATALOGOS_EMBUTIDOS)) {
        if (Array.isArray(lista)) {
          const item = lista.find(c => {
            const cEan = String(c.ean || '').trim();
            return cEan === key || cEan.replace(/^0+/, '') === cleanKey;
          });
          if (item) {
            found = {
              nome: item.nome,
              marca: item.marca || marcaNome,
              categoria: item.categoria || '',
              foto: `images/${item.ean || key}.jpg`
            };
            break;
          }
        }
      }
    }

    // 1.2 Danone Oficial
    if (!found && typeof _EMBEDDED_DANONE_CATALOG !== 'undefined') {
      const item = _EMBEDDED_DANONE_CATALOG.find(c => {
        const cEan = String(c.ean || '').trim();
        return cEan === key || cEan.replace(/^0+/, '') === cleanKey;
      });
      if (item) {
        found = {
          nome: item.nome,
          marca: 'Danone',
          foto: `images/${item.foto || key + '.jpg'}`
        };
      }
    }

    // 1.3 Produtos ja cadastrados ou catalogo local do Store
    if (!found && typeof Store !== 'undefined') {
      const all = [...(Store.getCatalog() || []), ...(Store.getAllProducts() || [])];
      const match = all.find(p => {
        const pCode = String(p.code || p.ean || p.id || '').trim();
        return pCode === key || pCode.replace(/^0+/, '') === cleanKey;
      });
      if (match) {
        found = {
          nome: match.nome || match.name || '',
          marca: match.brand || match.marca || '',
          categoria: match.category || match.categoria || '',
          foto: match.foto || match.imageUrl || ''
        };
      }
    }

    // 1.4 Cache local
    if (!found) {
      const cached = _getLocalProductCache(key) || _getLocalProductCache(cleanKey);
      if (cached && (cached.nome || cached.nome_produto)) {
        found = {
          nome: cached.nome || cached.nome_produto || '',
          marca: cached.marca || '',
          categoria: cached.categoria || '',
          foto: cached.imagem_url || cached.foto || ''
        };
      }
    }

    // 2. Se ja encontramos localmente, preenche instantaneamente!
    if (found && found.nome) {
      _applyFoundProductToUI(found, key);
      return;
    }

    // 3. Busca Completa (Nuvem / Firestore / APIs)
    const lookup = await lookupProductByBarcode(key);
    if (lookup) {
      const nome = lookup.nome || lookup.nome_produto || '';
      const foto = lookup.imagem_url || lookup.foto || '';
      // Aplica UI se tiver nome OU imagem (a regra: se a API encontrou produto, aproveita o máximo)
      if (nome || foto) {
        _applyFoundProductToUI({
          nome,
          marca: lookup.marca || '',
          categoria: lookup.categoria || lookup.descricao || '',
          foto
        }, key);
        // Se veio imagem mas sem nome, mostrar placeholder informativo
        if (!nome && foto) {
          if (nameEl) nameEl.placeholder = 'Nome do produto (preencha)';
        }
      } else {
        if (nameEl) nameEl.placeholder = 'Ex: Leite Integral 1L';
        if (notFoundEl) notFoundEl.style.display = 'block';
      }
    } else {
      if (nameEl) nameEl.placeholder = 'Ex: Leite Integral 1L';
      if (notFoundEl) notFoundEl.style.display = 'block';
    }
  } catch (e) {
    console.warn('lookupAndFillProduct error:', e);
  }
}

function _applyFoundProductToUI(data, eanKey) {
  if (!data) return;
  const nameEl = document.getElementById('prodName');
  const catEl  = document.getElementById('prodCategory');
  const notFoundEl = document.getElementById('prodNotFoundMsg');
  const gotoCat = document.getElementById('btnGoCatalogContainer');
  const imgEl  = document.getElementById('prodImage');
  const imgCont = document.getElementById('prodImageContainer');

  const nome = data.nome || '';
  if (nameEl && nome) {
    nameEl.value = nome;
    nameEl.placeholder = 'Ex: Leite Integral 1L';
  }

  // Auto-categorizacao imediata e inteligente
  if (catEl && nome) {
    let autoCatId = '';
    if (data.categoria) {
      const cats = Store.getCategories();
      const match = cats.find(c => c.name.toLowerCase().includes(data.categoria.toLowerCase()) || c.id === data.categoria);
      if (match) autoCatId = match.id;
    }
    if (!autoCatId && typeof getAutoCategory === 'function') {
      autoCatId = getAutoCategory(nome);
    }
    if (autoCatId) {
      catEl.value = autoCatId;
    }
  }

  // Preenche imagem do produto
  const foto = data.foto || data.imagem_url || '';
  if (foto && imgEl && imgCont) {
    imgEl.src = foto;
    imgCont.style.display = 'flex';
  }

  if (notFoundEl) notFoundEl.style.display = 'none';
  if (gotoCat) gotoCat.style.display = 'none';
}
async function lookupProductByBarcode(gtin) {
  if (!gtin) return null;
  const key = String(gtin).trim();

  // 1. Catálogo Danone / Local embutido (Prioridade Máxima para garantir correspondência exata)
  if (typeof _EMBEDDED_DANONE_CATALOG !== 'undefined') {
    const foundDanone = _EMBEDDED_DANONE_CATALOG.find(c => String(c.ean).trim() === key);
    if (foundDanone) {
      const data = {
        gtin: key,
        nome: foundDanone.nome,
        marca: 'Danone',
        imagem_url: `images/${foundDanone.foto || key + '.jpg'}`,
        fonte_dados: 'catalogo_danone_oficial'
      };
      _saveProdutoCache(key, data).catch(() => { });
      return data;
    }
  }

  // 1.1 Catálogo Oficial Geral Embutido (Nestlé, Vigor, Danone)
  if (typeof CATALOGOS_EMBUTIDOS !== 'undefined') {
    for (const [marcaNome, lista] of Object.entries(CATALOGOS_EMBUTIDOS)) {
      if (Array.isArray(lista)) {
        const found = lista.find(c => String(c.ean).trim() === key);
        if (found) {
          const data = {
            gtin: key,
            nome: found.nome,
            marca: found.marca || marcaNome,
            categoria: found.categoria || '',
            imagem_url: `images/${key}.jpg`,
            fonte_dados: 'catalogo_embutido'
          };
          _saveProdutoCache(key, data).catch(() => { });
          return data;
        }
      }
    }
  }

  // 2. Cache (memória + Firestore) — só usa cache se tiver NOME preenchido
  // (evita reusar cache de scan anterior que só achou imagem)
  const cached = await _readProdutoCache(key);
  if (cached && cached.nome && cached.nome.trim().length > 1) return cached;

  // 3. Cascata de APIs
  const found = await _fetchFromApis(key);
  if (found) {
    found.gtin = key;
    // Salva em background — não bloqueia a UI
    _saveProdutoCache(key, found).catch(() => { });
    return found;
  }

  return null;
}

// ── RENDERIZA IMAGENS NOS CARDS usando imageUrl salvo ou fallback via API ──
async function fetchProductImage(ean) {
  if (!ean) return null;
  return null; // imagem vem via lookupProductByBarcode
}

function attachProductImages(container) {
  if (!container) return;
  const products = Store.getAllProducts ? Store.getAllProducts() : [];

  container.querySelectorAll('[data-ean]').forEach(async el => {
    const ean = String(el.dataset.ean || '').trim();
    if (!ean || ean === 'undefined' || ean.length < 5) return;

    const updateContainerWithImg = (src) => {
      const badges = Array.from(el.querySelectorAll('.pcard-corner-badge, .pcard-status-badge, .dash-alert-qty-pill'));
      const emoji = el.querySelector('.pcard-img-emoji');
      const emojiContent = emoji ? emoji.outerHTML : '';
      const img = document.createElement('img');
      img.alt = 'foto';
      img.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;border-radius:10px;';
      img.src = src;
      img.onerror = () => { img.remove(); };
      el.style.position = 'relative';
      // Remove img anterior se existir
      el.querySelectorAll('img').forEach(i => i.remove());
      el.appendChild(img);
    };

    const tryImgSrc = (src) => new Promise(resolve => {
      const i = new Image();
      i.onload = () => resolve(src);
      i.onerror = () => resolve(null);
      i.src = src;
      // Timeout de 1.5s para não travar o render
      setTimeout(() => resolve(null), 1500);
    });

    // 0. Prioridade máxima: imageUrl salvo no produto (já resolvido, confiável)
    const savedProd = products.find(p => String(p.code || '').trim() === ean);
    if (savedProd && savedProd.imageUrl && savedProd.imageUrl.startsWith('http')) {
      const ok = await tryImgSrc(savedProd.imageUrl);
      if (ok) { updateContainerWithImg(ok); return; }
    }

    // 1. Imagem local imagens/
    const r1 = await tryImgSrc(`imagens/${ean}.jpg`);
    if (r1) { updateContainerWithImg(r1); return; }

    // 2. Imagem local images/
    const r2 = await tryImgSrc(`images/${ean}.jpg`);
    if (r2) { updateContainerWithImg(r2); return; }

    // 3. CDN Cosmos Bluesoft (rápido, sem autenticação, alta cobertura BR)
    const cosmosCdn = `https://cdn-cosmos.bluesoft.com.br/products/${ean}`;
    const r3 = await tryImgSrc(cosmosCdn);
    if (r3) { updateContainerWithImg(r3); _saveProdutoCache(ean, { imagem_url: r3 }).catch(() => { }); return; }

    // 4. Cache local / Firestore (sem chamar APIs externas lentas durante render)
    try {
      const local = _getLocalProductCache(ean);
      if (local && (local.imagem_url || local.foto)) {
        const url = local.imagem_url || local.foto;
        const r4 = await tryImgSrc(url);
        if (r4) { updateContainerWithImg(r4); return; }
      }
      // Firestore rápido (com timeout)
      if (typeof db !== 'undefined') {
        const snap = await Promise.race([
          db.collection('produtos_cache').doc(ean).get(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
        ]);
        if (snap && snap.exists) {
          const d = snap.data();
          _setLocalProductCache(ean, d);
          if (d.imagem_url || d.foto) {
            const url = d.imagem_url || d.foto;
            const r4b = await tryImgSrc(url);
            if (r4b) { updateContainerWithImg(r4b); return; }
          }
        }
      }
    } catch (e) { }

    // 5. Open Food Facts (única API rápida, sem token)
    try {
      const offUrl = `https://world.openfoodfacts.org/api/v0/product/${ean}.json`;
      const res = await Promise.race([
        fetch(offUrl),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
      ]);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 1 && data.product) {
          const imgUrl = data.product.image_front_url || data.product.image_url;
          if (imgUrl) {
            const r5 = await tryImgSrc(imgUrl);
            if (r5) {
              updateContainerWithImg(r5);
              _saveProdutoCache(ean, { imagem_url: r5, nome: data.product.product_name_pt || data.product.product_name || '' }).catch(() => { });
              return;
            }
          }
        }
      }
    } catch (e) { }

    // 6. Fallback: cesta 3D (sempre visível)
    updateContainerWithImg('images/prazocerto_basket_3d.png');
  });
}




// ── SISTEMA DE DICAS DO DIA (ESTILO REFERÊNCIA) ─────────
const DASHBOARD_TIPS = [
  {
    icon: '💡',
    title: 'Revise os itens que vencem em breve',
    desc: 'Verifique diariamente os produtos em alerta amarelo para planejar ações de saída rápida ou aplicar descontos preventivos.'
  },
  {
    icon: '🔄',
    title: 'Regra FEFO (First Expire, First Out)',
    desc: 'Sempre coloque os produtos com data de validade mais próxima na frente das gôndolas ou prateleiras para saírem primeiro.'
  },
  {
    icon: '🏷️',
    title: 'Remarcação preventiva de preços',
    desc: 'Crie etiquetas promocionais para itens a 3 ou 7 dias do vencimento para evitar quebras e perdas financeiras.'
  },
  {
    icon: '📊',
    title: 'Acompanhe a evolução semanal',
    desc: 'Monitore o gráfico de tendências no relatório para otimizar compras e manter seu estoque 100% equilibrado.'
  },
  {
    icon: '📲',
    title: 'Compartilhe alertas com sua equipe',
    desc: 'Use o envio rápido via WhatsApp para repassar os relatórios de itens a vencer diretamente aos repositores e gerentes.'
  }
];

let currentTipIndex = 0;

function openTipsModal() {
  const modal = document.getElementById('tipsModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  renderTipContent();
}

function closeTipsModal() {
  const modal = document.getElementById('tipsModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function openEvolutionInfoModal() {
  const modal = document.getElementById('evolutionInfoModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function closeEvolutionInfoModal() {
  const modal = document.getElementById('evolutionInfoModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function renderTipContent() {
  const container = document.getElementById('tipModalContent');
  const dotsContainer = document.getElementById('tipNavDots');
  if (!container) return;

  const tip = DASHBOARD_TIPS[currentTipIndex];
  container.innerHTML = `
    <div class="tip-content-box">
      <div class="tip-item-title">
        <span>${tip.icon}</span>
        <span>${escHtml(tip.title)}</span>
      </div>
      <div class="tip-item-desc">${escHtml(tip.desc)}</div>
    </div>
  `;

  if (dotsContainer) {
    dotsContainer.innerHTML = DASHBOARD_TIPS.map((_, idx) => `
      <div class="tip-dot ${idx === currentTipIndex ? 'active' : ''}"></div>
    `).join('');
  }
}

function changeTip(delta) {
  currentTipIndex = (currentTipIndex + delta + DASHBOARD_TIPS.length) % DASHBOARD_TIPS.length;
  renderTipContent();
}

// ── LOCATION FILTER GLOBAL ──────────────────────
function handleLocationFilterChange(val) {
  const sel = document.getElementById('globalLocationFilter');
  const targetVal = (val !== undefined && val !== null) ? String(val).trim() : (sel ? String(sel.value).trim() : 'all');
  window.currentLocationFilter = targetVal;
  try { localStorage.setItem('cv_selected_store', targetVal); } catch (e) { }

  if (sel && sel.value !== targetVal) sel.value = targetVal;

  const storeNameEl = document.getElementById('topbarStoreName');
  if (storeNameEl && sel) {
    const opt = sel.options[sel.selectedIndex];
    storeNameEl.textContent = opt ? opt.text : (targetVal === 'all' ? 'Todas as Lojas' : targetVal);
  }

  const evoSel = document.getElementById('evoItemFilterSelect');
  const evoLabel = document.getElementById('evoFilterLabel');
  if (evoSel) {
    if (evoSel.value !== targetVal) evoSel.value = targetVal;
    const opt = evoSel.options[evoSel.selectedIndex];
    if (evoLabel) evoLabel.textContent = opt ? opt.text : (targetVal === 'all' ? 'Todos os itens' : targetVal);
  }

  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderProducts === 'function') renderProducts();
  if (typeof renderAlerts === 'function') renderAlerts();
  if (typeof updateBadges === 'function') updateBadges();
  if (typeof renderReports === 'function') renderReports();
  if (typeof renderHistory === 'function') renderHistory();
}
window.handleLocationFilterChange = handleLocationFilterChange;

// ── RENDER DASHBOARD ─────────────────────────────
function renderDashboard() {
  // Sempre reseta o período de Evolução do Estoque para 7 dias ao abrir/voltar para o dashboard
  currentDashPeriod = '7d';
  // Atualiza os botões visualmente após o DOM estar pronto
  setTimeout(() => {
    document.querySelectorAll('.dash-vg-tab-btn').forEach(b => {
      const txt = b.textContent.trim().toLowerCase();
      b.classList.toggle('active', txt.includes('7'));
    });
    const subtextEl = document.getElementById('dashPeriodSubtext');
    if (subtextEl) subtextEl.textContent = 'Próximos 7 dias';
  }, 0);

  const products = Store.getProducts();
  const settings = Store.getSettings();
  const cats = Store.getCategories();


  // Stats
  let ok = 0, warn = 0, expired = 0;
  products.forEach(p => {
    const d = daysUntil(p.expDate);
    const s = getStatus(d, settings);
    if (s === 'ok') ok++;
    else if (s === 'warn') warn++;
    else expired++;
  });

  const totalCount = products.length;
  animateNumber('stat-total', totalCount);
  animateNumber('stat-ok', ok);
  animateNumber('stat-warn', warn);
  animateNumber('stat-expired', expired);

  // Porcentagens dinâmicas baseadas na loja atual
  const pctOk = totalCount > 0 ? Math.round((ok / totalCount) * 100) : 0;
  const pctWarn = totalCount > 0 ? Math.round((warn / totalCount) * 100) : 0;
  const pctExp = totalCount > 0 ? Math.round((expired / totalCount) * 100) : 0;

  const totalTrend = document.getElementById('stat-total-trend');
  const okTrend = document.getElementById('stat-ok-trend');
  const warnTrend = document.getElementById('stat-warn-trend');
  const expTrend = document.getElementById('stat-expired-trend');

  if (totalTrend) totalTrend.textContent = totalCount > 0 ? `↑ 100%` : `0%`;
  if (okTrend) okTrend.textContent = `↑ ${pctOk}%`;
  if (warnTrend) warnTrend.textContent = `↑ ${pctWarn}%`;
  if (expTrend) expTrend.textContent = `↓ ${pctExp}%`;

  // Quadro Vermelho de Atenção Necessária
  const expCountEl = document.getElementById('bannerExpiredCount');
  const warnCountEl = document.getElementById('bannerWarnCount');
  if (expCountEl) expCountEl.textContent = expired;
  if (warnCountEl) warnCountEl.textContent = warn;

  const warnBanner = document.getElementById('dashWarningBanner');
  if (warnBanner) {
    if (expired > 0 || warn > 0) {
      warnBanner.style.display = 'flex';
    } else {
      warnBanner.style.display = 'none';
    }
  }

  const qaBadge = document.getElementById('qaAlertsBadge');
  const qaSubtext = document.getElementById('qaAlertsSubtext');
  const totalAlerts = warn + expired;
  if (qaBadge) qaBadge.textContent = totalAlerts;
  if (qaSubtext) {
    if (totalAlerts === 0) {
      qaSubtext.textContent = '0 alertas';
    } else {
      const parts = [];
      if (expired > 0) parts.push(`${expired} vencido${expired > 1 ? 's' : ''}`);
      if (warn > 0) parts.push(`${warn} a vencer`);
      qaSubtext.textContent = parts.join(', ');
    }
  }

  // Date & Greeting
  const greetEl = document.getElementById('greetingText');
  if (greetEl) greetEl.innerHTML = greeting();
  const dateEl = document.getElementById('todayDate');
  if (dateEl) dateEl.textContent = formatDashboardDate();
  // Inicializa data e contador "atualizado há X min" no dashboard
  if (typeof initDashboardDateDisplay === 'function') initDashboardDateDisplay();

  // Urgent alerts (exp or warn within critDays)
  const urgent = products
    .filter(p => { const d = daysUntil(p.expDate); return d !== null && d <= (settings.warnDays || 7); })
    .sort((a, b) => daysUntil(a.expDate) - daysUntil(b.expDate))
    .slice(0, 5);

  const alertsList = document.getElementById('urgentAlertsList');
  if (alertsList) {
    if (!urgent.length) {
      alertsList.innerHTML = '<div class="empty-state-small">Nenhum alerta urgente 🎉</div>';
    } else {
      alertsList.innerHTML = urgent.map((p, idx) => alertItemHTMLFull(p, settings, cats, idx)).join('');
      attachProductImages(alertsList);
      // Bind quick-action buttons
      alertsList.querySelectorAll('.alert-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          openEditModal(btn.dataset.id);
        });
      });
      alertsList.querySelectorAll('.alert-consume-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          if (await confirm('Consumido / Descartado', 'Remover este produto do estoque?')) {
            deleteProduct(btn.dataset.id);
          }
        });
      });
      alertsList.querySelectorAll('.alert-share-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          openShareModal(btn.dataset.id);
        });
      });
    }
  }

  // Donut chart e Gráfico de Evolução
  drawDonut(ok, warn, expired);
  drawEvolutionChart(ok, warn, expired);

  // Atualização dinâmica da Barra de Métricas (Maior Categoria, Maior Risco, Tendência Geral)
  const catCountMap = {};
  const catRiskMap = {};
  products.forEach(p => {
    const catObj = cats.find(c => c.id === p.category);
    const catName = catObj ? catObj.name : 'Geral';
    catCountMap[catName] = (catCountMap[catName] || 0) + 1;

    const d = daysUntil(p.expDate);
    const s = getStatus(d, settings);
    if (s === 'expired' || s === 'warn') {
      catRiskMap[catName] = (catRiskMap[catName] || 0) + 1;
    }
  });

  // Maior Categoria
  let topCatName = 'Nenhuma', topCatCount = 0;
  for (const [name, count] of Object.entries(catCountMap)) {
    if (count > topCatCount) {
      topCatCount = count;
      topCatName = name;
    }
  }
  const topCatEl = document.getElementById('dashTopCategory');
  const topCatCountEl = document.getElementById('dashTopCatCount');
  if (topCatEl) topCatEl.textContent = topCatName;
  if (topCatCountEl) topCatCountEl.textContent = `${topCatCount} itens`;

  // Maior Risco
  let riskCatName = 'Nenhum', riskCatCount = 0;
  for (const [name, count] of Object.entries(catRiskMap)) {
    if (count > riskCatCount) {
      riskCatCount = count;
      riskCatName = name;
    }
  }
  const riskCatEl = document.getElementById('dashRiskCategory');
  const riskCatCountEl = document.getElementById('dashRiskCount');
  if (riskCatEl) riskCatEl.textContent = riskCatName;
  if (riskCatCountEl) riskCatCountEl.textContent = `${riskCatCount} em risco`;

  // Recent
  const recent = [...products].sort((a, b) => (b.addedAt || '') > (a.addedAt || '') ? 1 : -1).slice(0, 8);
  const recentList = document.getElementById('recentList');
  if (!recent.length) {
    recentList.innerHTML = '<div class="empty-state-small">Nenhum produto ainda</div>';
  } else {
    recentList.innerHTML = recent.map(p => {
      const d = daysUntil(p.expDate);
      const s = getStatus(d, settings);
      const cat = cats.find(c => c.id === p.category);
      return `<div class="recent-item status-${s}">
        <div class="product-thumb" style="width: 36px; height: 36px; font-size: 1rem; border-radius: 6px; overflow:hidden; flex-shrink:0;" ${p.code ? `data-ean="${p.code}"` : ''}>
          ${cat ? cat.emoji : '📦'}
        </div>
        <span class="recent-name">${escHtml(p.name)}</span>
      </div>`;
    }).join('');
    attachProductImages(recentList);
  }

  // Notification dot
  const dotEl = document.getElementById('notifDot');
  if (dotEl) {
    if (expired > 0 || warn > 0) dotEl.classList.add('show');
    else dotEl.classList.remove('show');
  }

  updateBadges();
}

// Versão com botões de ação rápida (usada na página Alertas e Dashboard)
// Função para abrir o Modal de Sugestões Estratégicas por Produto
function openProductSuggestionModal(productId) {
  const products = getAllProducts();
  const p = products.find(prod => prod.id === productId);
  if (!p) return;

  const days = daysUntil(p.expDate);
  const modal = document.getElementById('productSuggestionModal');
  const titleEl = document.getElementById('suggModalProdName');
  const bodyEl = document.getElementById('suggModalBody');
  if (!modal || !bodyEl) return;

  if (titleEl) titleEl.textContent = p.name || 'Produto Selecionado';

  let icon = '⚡';
  let title = 'Ação Recomendada';
  let actionTitle = '';
  let steps = [];
  let badgeColor = '#facc15';

  if (days < 0) {
    icon = '🚫';
    badgeColor = '#ef4444';
    title = 'Produto Vencido - Descarte / Logística Reversa';
    actionTitle = 'Retirar Imediatamente do Ponto de Venda';
    steps = [
      'Segregar o produto da área de venda para evitar riscos e multas de fiscalização.',
      'Verificar acordo de troca ou devolução (logística reversa) com o fornecedor.',
      'Registrar a baixa por perda no inventário para manter o estoque contábil exato.',
      'Realizar o descarte correto e seguro conforme as normas sanitárias vigentes.'
    ];
  } else if (days === 0) {
    icon = '🚨';
    badgeColor = '#f87171';
    title = 'Vence Hoje - Ação Imediata';
    actionTitle = 'Liquidação Relâmpago ou Consumo Imediato';
    steps = [
      'Aplicar desconto de liquidação de última hora (ex: 50% a 70% OFF) em gôndola de destaque.',
      'Se aplicável na operação interna (refeitório/padaria), priorizar utilização imediata na produção.',
      'Colocar em ponta de gôndola com etiqueta chamativa para venda nas próximas horas.'
    ];
  } else if (days <= 3) {
    icon = '⚠️';
    badgeColor = '#fb923c';
    title = 'Urgência Crítica - Menos de 72 Horas';
    actionTitle = 'Queima de Estoque & Destaque Visual';
    steps = [
      'Etiquetar com selo promocional amarelo/vermelho com preço reduzido para saída acelerada.',
      'Posicionar o lote na frente de todos os outros itens (Regra FEFO rigorosa).',
      'Divulgar oferta rápida aos clientes locais ou via grupo de transmissão.'
    ];
  } else if (days <= 7) {
    icon = '🏷️';
    badgeColor = '#facc15';
    title = 'Alerta Amarelo - Vence em 1 Semana';
    actionTitle = 'Promoção Preventiva & Giro Rápido';
    steps = [
      'Rebaixar margem de lucro com desconto preventivo (ex: 20% a 30% OFF).',
      'Realizar ação de cross-selling (venda combinada com produtos complementares).',
      'Avisar equipe de reposição para não abrir novas caixas com validade mais longa.'
    ];
  } else {
    icon = '✅';
    badgeColor = '#4ade80';
    title = 'Estoque Saudável';
    actionTitle = 'Manutenção da Regra FEFO';
    steps = [
      'Garantir rotação normal de estoque mantendo produtos mais novos no fundo da prateleira.',
      'Monitorar regularmente pelo painel de alertas do PrazoCerto.'
    ];
  }

  bodyEl.innerHTML = `
    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px; margin-bottom:12px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <span style="font-size:1.4rem;">${icon}</span>
        <div>
          <div style="color:${badgeColor}; font-weight:800; font-size:0.9rem;">${title}</div>
          <div style="color:#ffffff; font-weight:700; font-size:0.82rem; margin-top:2px;">${actionTitle}</div>
        </div>
      </div>
      <div style="color:#94a3b8; font-size:0.75rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px; margin-top:6px;">
        Validade: <strong style="color:#ffffff;">${formatDate(p.expDate)}</strong> (${days < 0 ? `Vencido há ${Math.abs(days)} dias` : days === 0 ? 'Vence hoje' : `Faltam ${days} dias`}) | Qtd: <strong style="color:#ffffff;">${p.qty || 1} un.</strong>
      </div>
    </div>
    
    <div style="font-size:0.78rem; font-weight:700; color:#cbd5e1; margin-bottom:8px;">📋 Checklist de Ações Recomendadas:</div>
    <ul style="margin:0; padding-left:18px; color:#e2e8f0; font-size:0.78rem; line-height:1.6;">
      ${steps.map(s => `<li style="margin-bottom:6px;">${s}</li>`).join('')}
    </ul>
  `;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function closeProductSuggestionModal() {
  const modal = document.getElementById('productSuggestionModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function alertItemHTMLFull(p, settings, cats, itemIndex) {
  const days = daysUntil(p.expDate);
  const cat = cats.find(c => c.id === p.category);
  const catName = cat ? cat.name : 'Bebidas';
  const indexNum = (typeof itemIndex === 'number') ? `${itemIndex + 1}. ` : '';

  let badgeText = 'Urgente';
  let badgeClass = 'badge-urgent-fire';
  let daysTextColor = '#ef4444';
  let daysTextLabel = `-${Math.abs(days)} dias`;
  let statusBadgeText = `Vencido há ${Math.abs(days)} dias`;
  let tipText = 'Retirar do ponto de venda, segregar e registrar baixa no estoque.';

  let statusClass = 'status-ok';
  if (days < 0) {
    statusClass = 'status-expired';
    statusBadgeText = `Vencido há ${Math.abs(days)} ${Math.abs(days) === 1 ? 'dia' : 'dias'}`;
    daysTextLabel = `-${Math.abs(days)} dias`;
    daysTextColor = '#ef4444';
    tipText = 'Retirar do ponto de venda, segregar e registrar baixa no estoque.';
  } else if (days === 0) {
    statusClass = 'status-expired';
    statusBadgeText = `Vence hoje!`;
    daysTextLabel = `0 dias`;
    daysTextColor = '#ef4444';
    tipText = 'Liquidação imediata (50%+ OFF) ou utilização interna imediata.';
  } else if (days <= 3) {
    statusClass = 'status-expired';
    statusBadgeText = `Vence em ${days} dias`;
    daysTextLabel = `${days} dias`;
    daysTextColor = '#ef4444';
    tipText = 'Rebaixar preço com etiqueta promocional e priorizar na saída.';
  } else {
    statusClass = 'status-warn';
    statusBadgeText = `Vence em ${days} dias`;
    daysTextLabel = `${days} dias`;
    daysTextColor = '#eab308';
    tipText = 'Aplicar regra FEFO (frente da gôndola) e desconto preventivo.';
  }

  return `<div class="dash-alert-card-ref ${statusClass}">
    <!-- CABEÇALHO DO CARD: NOME DO PRODUTO (sem badge de status) -->
    <div class="dash-alert-top-row" style="flex-wrap:nowrap;">
      <div class="dash-alert-title-wrap" style="flex:1;min-width:0;">
        <h3 class="dash-alert-prod-name" style="white-space:normal;overflow:visible;text-overflow:unset;">${indexNum}${escHtml(p.name)}</h3>
      </div>
    </div>

    <!-- CORPO: FOTO + COLUNAS DE DADOS -->
    <div class="dash-alert-middle-row">
      <!-- FOTO DO PRODUTO -->
      <div class="dash-alert-img-col">
        <div class="dash-alert-img-box ${statusClass}" ${p.code ? `data-ean="${p.code}"` : ''}>
          <span class="pcard-img-emoji">${cat ? cat.emoji : '📦'}</span>
        </div>

      </div>

      <!-- INFORMAÇÕES TÉCNICAS (COLUNAS) -->
      <div class="dash-alert-info-cols">
        <div class="dash-alert-info-col">
          <div class="dash-info-label">Validade</div>
          <div class="dash-info-val">${formatDate(p.expDate)}</div>
        </div>

        <div class="dash-alert-info-col">
          <div class="dash-info-label">Quantidade</div>
          <div class="dash-info-val">${p.qty || 1} un.</div>
        </div>

        <div class="dash-alert-info-col">
          <div class="dash-info-label">Categoria</div>
          <div class="dash-info-val">${escHtml(catName)}</div>
        </div>

        <div class="dash-alert-info-col">
          <div class="dash-info-label">Dias restantes</div>
          <div class="dash-info-val" style="color:${daysTextColor}">${daysTextLabel}</div>
        </div>
      </div>
    </div>

    <!-- LINHA DO CÓDIGO (LUPA + TEXTO 'Código' + ZEBRA CLICÁVEL COM ZOOM + VALOR + COPIAR) -->
    <div class="dash-alert-barcode-row">
      <div class="dash-alert-barcode-left">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ffffff" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span class="dash-barcode-lbl">Código</span>
      </div>
      <div class="dash-alert-barcode-img" style="display:flex; align-items:center; cursor:pointer; margin: 0 4px;" onclick="openImgModal('https://bwipjs-api.metafloor.com/?bcid=code128&text=${p.code || '7891025123457'}&scale=6&includetext')" title="Clique para ampliar o código de barras">
        <svg viewBox="0 0 80 22" width="76" height="22" style="background:#ffffff; border-radius:4px; padding:2px 3px; box-sizing:border-box;">
          <rect x="3" y="1" width="4" height="20" fill="#000000"/>
          <rect x="9" y="1" width="2" height="20" fill="#000000"/>
          <rect x="13" y="1" width="5" height="20" fill="#000000"/>
          <rect x="20" y="1" width="2" height="20" fill="#000000"/>
          <rect x="24" y="1" width="6" height="20" fill="#000000"/>
          <rect x="32" y="1" width="2" height="20" fill="#000000"/>
          <rect x="36" y="1" width="4" height="20" fill="#000000"/>
          <rect x="42" y="1" width="2" height="20" fill="#000000"/>
          <rect x="46" y="1" width="6" height="20" fill="#000000"/>
          <rect x="54" y="1" width="3" height="20" fill="#000000"/>
          <rect x="59" y="1" width="2" height="20" fill="#000000"/>
          <rect x="63" y="1" width="5" height="20" fill="#000000"/>
          <rect x="70" y="1" width="3" height="20" fill="#000000"/>
        </svg>
      </div>
      <span class="dash-barcode-num">${escHtml(p.code || '7891025123457')}</span>
      <button class="dash-barcode-copy-btn" onclick="navigator.clipboard.writeText('${p.code || ''}'); showToast('Código copiado!', '📋');" title="Copiar Código">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>

    <!-- LINHA DE BOTÕES DE AÇÃO: EDITAR, EXCLUIR, COMPARTILHAR -->
    <div class="dash-alert-actions-row">
      <button class="dash-alert-btn dash-btn-edit alert-edit-btn" data-id="${p.id}">
        ✏️ Editar
      </button>
      <button class="dash-alert-btn dash-btn-delete alert-consume-btn" data-id="${p.id}">
        🗑️ Excluir
      </button>
      <button class="dash-alert-btn dash-btn-share alert-share-btn" data-id="${p.id}">
        📲 Compartilhar
      </button>
    </div>

    <!-- CAIXA DE SUGESTÃO AMARELA NO RODAPÉ DO CARD (CLICÁVEL) -->
    <div class="dash-alert-sugestao-box" onclick="openProductSuggestionModal('${p.id}')" title="Clique para ver o plano de ação estratégico">
      <div class="dash-sugestao-left">
        <span class="dash-sugestao-icon">💡</span>
        <span class="dash-sugestao-title">Sugestão</span>
        <span class="dash-sugestao-text">${tipText}</span>
      </div>
      <span class="dash-sugestao-arrow">&rsaquo;</span>
    </div>
  </div>`;
}

function drawDonut(ok, warn, expired) {
  const canvas = document.getElementById('statusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const total = ok + warn + expired;

  const size = 120;
  canvas.width = size * 2;
  canvas.height = size * 2;
  ctx.scale(2, 2);

  const cx = size / 2;
  const cy = size / 2;
  const radius = 48;
  const strokeWidth = 9;

  ctx.clearRect(0, 0, size, size);

  if (!total) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#22c55e';
    ctx.stroke();
  } else {
    const segments = [
      { val: ok, color: '#22c55e' },
      { val: warn, color: '#eab308' },
      { val: expired, color: '#ef4444' }
    ].filter(s => s.val > 0);

    let startAngle = -Math.PI / 2;
    const GAP = segments.length > 1 ? 0.04 : 0;

    segments.forEach(seg => {
      const sweep = (seg.val / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle + GAP / 2, startAngle + sweep - GAP / 2);
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = seg.color;
      ctx.lineCap = 'round';
      ctx.stroke();
      startAngle += sweep;
    });
  }

  // Atualiza número no centro do HTML
  const totEl = document.getElementById('donutTotal');
  if (totEl) totEl.textContent = total;

  // Atualiza legendas e porcentagens ao lado
  const pctOk = total ? Math.round((ok / total) * 100) : 0;
  const pctWarn = total ? Math.round((warn / total) * 100) : 0;
  const pctExp = total ? Math.round((expired / total) * 100) : 0;

  const lOkVal = document.getElementById('leg-ok-val');
  const lOkPct = document.getElementById('leg-ok-pct');
  const lWarnVal = document.getElementById('leg-warn-val');
  const lWarnPct = document.getElementById('leg-warn-pct');
  const lExpVal = document.getElementById('leg-exp-val');
  const lExpPct = document.getElementById('leg-exp-pct');

  if (lOkVal) lOkVal.textContent = ok;
  if (lOkPct) lOkPct.textContent = `(${pctOk}%)`;
  if (lWarnVal) lWarnVal.textContent = warn;
  if (lWarnPct) lWarnPct.textContent = `(${pctWarn}%)`;
  if (lExpVal) lExpVal.textContent = expired;
  if (lExpPct) lExpPct.textContent = `(${pctExp}%)`;
}

function drawEvolutionChart(ok, warn, expired) {
  const canvas = document.getElementById('evolutionChart');
  if (!canvas) return;

  const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 330, height: 140 };
  const W = Math.max(280, Math.floor(rect.width || 330));
  const H = 140;

  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  ctx.clearRect(0, 0, W, H);

  // Eixo Y e Labels (0, 40, 80, 120)
  const padLeft = 24, padRight = 12, padTop = 14, padBottom = 26;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.font = '500 9px sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'right';

  const yTicks = [0, 40, 80, 120];
  yTicks.forEach(val => {
    const y = padTop + plotH - (val / 120) * plotH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
    ctx.fillText(val, padLeft - 4, y + 3);
  });

  // Eixo X com 7 pontos (Hoje, 5 dias, 10 dias, 15 dias, 20 dias, 25 dias, 30 dias)
  const xLabels = ['Hoje', '5 dias', '10 dias', '15 dias', '20 dias', '25 dias', '30 dias'];
  const xCoords = xLabels.map((lbl, idx) => padLeft + (idx / (xLabels.length - 1)) * plotW);

  ctx.textAlign = 'center';
  ctx.font = '500 8.5px sans-serif';
  ctx.fillStyle = '#64748b';
  xLabels.forEach((lbl, idx) => {
    ctx.fillText(lbl, xCoords[idx], H - 6);
  });

  const total = ok + warn + expired;
  const greenData = total > 0 
    ? [Math.round(ok * 0.7), Math.round(ok * 0.74), Math.round(ok * 0.78), Math.round(ok * 0.85), Math.round(ok * 0.88), Math.round(ok * 0.94), ok]
    : [52, 58, 62, 75, 78, 85, 96];

  const yellowData = total > 0
    ? [Math.max(0, Math.round(warn * 0.6)), Math.max(0, Math.round(warn * 0.7)), Math.max(0, Math.round(warn * 0.8)), Math.max(0, Math.round(warn * 0.85)), Math.max(0, Math.round(warn * 0.9)), warn, warn]
    : [18, 19, 21, 28, 30, 32, 35];

  const redData = total > 0
    ? [Math.max(0, Math.round(expired * 0.4)), Math.max(0, Math.round(expired * 0.5)), Math.max(0, Math.round(expired * 0.6)), Math.max(0, Math.round(expired * 0.7)), Math.max(0, Math.round(expired * 0.8)), expired, expired]
    : [0, 0, 0, 2, 2, 2, 3];

  const series = [
    { color: '#22C55E', data: greenData },
    { color: '#EAB308', data: yellowData },
    { color: '#EF4444', data: redData }
  ];

  series.forEach(s => {
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    s.data.forEach((val, idx) => {
      const clamped = Math.min(120, Math.max(0, val));
      const x = xCoords[idx];
      const y = padTop + plotH - (clamped / 120) * plotH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Pontos com bolinhas
    s.data.forEach((val, idx) => {
      const clamped = Math.min(120, Math.max(0, val));
      const x = xCoords[idx];
      const y = padTop + plotH - (clamped / 120) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#060d16';
      ctx.fill();
    });
  });
}

// Alterna o período nas pílulas da Visão Geral (padrão sempre 7 dias)
let currentDashPeriod = '7d';

function setDashboardPeriod(period, btnEl) {
  currentDashPeriod = period || '7d';
  document.querySelectorAll('.dash-pill-btn, .dash-vg-tab-btn').forEach(btn => btn.classList.remove('active'));
  if (btnEl) {
    btnEl.classList.add('active');
  } else {
    // Sincroniza visualmente o botão correspondente
    const btns = document.querySelectorAll('.dash-vg-tab-btn');
    btns.forEach(b => {
      const txt = b.textContent.trim().toLowerCase();
      if ((currentDashPeriod === '7d' && txt.includes('7')) ||
          (currentDashPeriod === '30d' && txt.includes('30')) ||
          (currentDashPeriod === '90d' && txt.includes('90'))) {
        b.classList.add('active');
      }
    });
  }
  // Atualiza subtexto do período no card de Evolução do Estoque
  const subtextEl = document.getElementById('dashPeriodSubtext');
  if (subtextEl) {
    const labels = { '7d': 'Próximos 7 dias', '30d': 'Próximos 30 dias', '90d': 'Próximos 90 dias' };
    subtextEl.textContent = labels[currentDashPeriod] || 'Próximos 7 dias';
  }
  updateDashChart();
}

function toggleDashboardDatePicker() {
  const periodSel = document.getElementById('dashPeriodSelect');
  if (periodSel) {
    periodSel.focus();
    periodSel.click();
  }
}

// Atualiza o gráfico de visão geral conforme período selecionado
function updateDashChart() {
  const products = Store.getProducts();
  const settings = Store.getSettings();

  const windowDays = { '7d': 7, '30d': 30, '90d': 90, 'today': 1, 'week': 7, 'month': 30 };
  const maxDays = windowDays[currentDashPeriod] ?? 30;

  let ok = 0, warn = 0, expired = 0;
  products.forEach(p => {
    const d = daysUntil(p.expDate);
    if (d === null) return;
    if (d < 0) {
      expired++;
    } else if (d <= maxDays) {
      warn++;
    } else {
      ok++;
    }
  });

  // Atualiza também os cards superiores de contagem e o resumo de produtos
  animateNumber('stat-ok', ok);
  animateNumber('stat-warn', warn);
  animateNumber('stat-expired', expired);
  const totalCount = products.length;
  const pctOk = totalCount > 0 ? Math.round((ok / totalCount) * 100) : 0;
  const pctWarn = totalCount > 0 ? Math.round((warn / totalCount) * 100) : 0;
  const pctExp = totalCount > 0 ? Math.round((expired / totalCount) * 100) : 0;
  const okTrend = document.getElementById('stat-ok-trend');
  const warnTrend = document.getElementById('stat-warn-trend');
  const expTrend = document.getElementById('stat-expired-trend');
  if (okTrend) okTrend.textContent = '↑ ' + pctOk + '%';
  if (warnTrend) warnTrend.textContent = '↑ ' + pctWarn + '%';
  if (expTrend) expTrend.textContent = '↓ ' + pctExp + '%';

  const prodStatOk = document.getElementById('prodStatOk');
  const prodStatWarn = document.getElementById('prodStatWarn');
  if (prodStatOk) prodStatOk.textContent = ok;
  if (prodStatWarn) prodStatWarn.textContent = warn;

  drawDonut(ok, warn, expired);
  drawEvolutionChart(ok, warn, expired);
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const dur = 600;
  const startTime = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - startTime) / dur);
    el.textContent = Math.round(start + (target - start) * easeOut(p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function easeOut(t) { return 1 - (1 - t) ** 3; }

function updateBadges() {
  const products = Store.getProducts();
  const settings = Store.getSettings();
  document.getElementById('badge-products').textContent = products.length;
  const alertCount = products.filter(p => {
    const d = daysUntil(p.expDate);
    return d !== null && d <= (settings.warnDays || 7);
  }).length;
  const alertBadge = document.getElementById('badge-alerts');
  alertBadge.textContent = alertCount;
  alertBadge.style.display = alertCount ? '' : 'none';
  // Sync bottom nav badge
  const bnavBadge = document.getElementById('bnav-badge-alerts');
  if (bnavBadge) {
    bnavBadge.textContent = alertCount || '';
    bnavBadge.style.display = alertCount ? '' : 'none';
  }
  // Sync topbar bell badge
  const topbarBell = document.getElementById('topbarBellBadge');
  if (topbarBell) {
    topbarBell.textContent = alertCount || '0';
    topbarBell.style.display = alertCount ? 'flex' : 'none';
  }
  // Sync qaAlertsBadge e qaAlertsSubtext
  const qaB = document.getElementById('qaAlertsBadge');
  const qaSub = document.getElementById('qaAlertsSubtext');
  if (qaB) {
    qaB.textContent = alertCount;
    qaB.style.display = alertCount > 0 ? 'flex' : 'none';
  }
  if (qaSub) qaSub.textContent = alertCount === 0 ? '0 alertas' : `${alertCount} alerta${alertCount > 1 ? 's' : ''}`;
}

// ── ALERTS PAGE ──────────────────────────────────
function renderAlerts(filter) {
  if (filter !== undefined) currentAlertFilter = filter;
  const products = Store.getProducts();
  const settings = Store.getSettings();
  const cats = Store.getCategories();

  let list;
  if (currentAlertFilter === 'expired') {
    list = products.filter(p => daysUntil(p.expDate) < 0);
  } else if (currentAlertFilter === 'warn') {
    list = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d >= 0 && d <= 7; });
  } else if (currentAlertFilter === '15') {
    list = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d >= 0 && d <= 15; });
  } else if (currentAlertFilter === 'soon') {
    list = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d >= 0 && d <= 30; });
  } else {
    list = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d <= 30; });
  }
  list.sort((a, b) => daysUntil(a.expDate) - daysUntil(b.expDate));

  // Atualizar botão dinâmico de relatório via WhatsApp
  updateAlertsWhatsAppButton(currentAlertFilter);

  const container = document.getElementById('alertsFullList');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><h3>Tudo certo!</h3><p>Nenhum produto nesta categoria de alerta.</p></div>`;
    return;
  }
  container.innerHTML = list.map((p, idx) => alertItemHTMLFull(p, settings, cats, idx)).join('');
  attachProductImages(container);
  // Bind quick-action buttons
  container.querySelectorAll('.alert-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });
  container.querySelectorAll('.alert-consume-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (await confirm('Consumido / Descartado', 'Remover este produto do estoque?')) {
        deleteProduct(btn.dataset.id);
        renderAlerts(currentAlertFilter);
      }
    });
  });
  container.querySelectorAll('.alert-share-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof openShareModal === 'function') {
        openShareModal(btn.dataset.id);
      }
    });
  });
}

// ── RELATÓRIO WHATSAPP NA TELA DE ALERTAS ──────────────────
function getAlertsReportPeriodDays(filter) {
  if (filter === 'expired') return 0;
  if (filter === 'warn') return 7;
  if (filter === '15') return 15;
  if (filter === 'soon') return 30;
  return 7;
}

function getAlertsProductsForReport(days) {
  const allProducts = Store.getAllProducts();
  const currentLoc = window.currentLocationFilter || localStorage.getItem('cv_selected_store') || 'all';

  // Filtra por loja selecionada (se houver)
  const baseList = currentLoc && currentLoc !== 'all'
    ? allProducts.filter(p => (p.location ? p.location.trim() : 'Sem Loja') === currentLoc)
    : allProducts;

  if (days === 0) {
    // Vencidos
    return baseList.filter(p => {
      const d = daysUntil(p.expDate);
      return d !== null && d < 0;
    }).sort((a, b) => daysUntil(a.expDate) - daysUntil(b.expDate));
  }

  // Próximos X dias (0 até days)
  return baseList.filter(p => {
    const d = daysUntil(p.expDate);
    return d !== null && d >= 0 && d <= days;
  }).sort((a, b) => daysUntil(a.expDate) - daysUntil(b.expDate));
}

function updateAlertsWhatsAppButton(filter) {
  const btn = document.getElementById('alertsWhatsappShareBtn');
  const titleEl = document.getElementById('alertsReportBtnTitle');
  const subEl = document.getElementById('alertsReportBtnSub');
  if (!btn || !titleEl || !subEl) return;

  const days = getAlertsReportPeriodDays(filter);
  const products = getAlertsProductsForReport(days);
  const count = products.length;

  if (days === 0) {
    titleEl.textContent = 'Enviar relatório dos Vencidos';
    subEl.textContent = count > 0
      ? `Compartilhar todos os ${count} item(ns) vencidos via WhatsApp`
      : 'Nenhum produto vencido no momento';
  } else {
    titleEl.textContent = `Enviar relatório dos ${days} dias`;
    subEl.textContent = count > 0
      ? `Compartilhar todos os ${count} item(ns) que vencem em ${days} dias via WhatsApp`
      : `Nenhum produto vence nos próximos ${days} dias.`;
  }

  // Nunca desabilitar o botão — sempre permite clicar (mostra toast se vazio)
  btn.classList.remove('disabled');
}

let currentAlertsReportData = null;

// Monta o texto do relatório com base no filtro atual
function buildAlertsReportText() {
  const filter = currentAlertFilter || 'expired';
  const days = getAlertsReportPeriodDays(filter);
  const products = getAlertsProductsForReport(days);
  const currentLoc = window.currentLocationFilter || localStorage.getItem('cv_selected_store') || 'all';
  const storeLabel = (currentLoc && currentLoc !== 'all') ? currentLoc : 'Todas as Lojas';
  const periodText = days === 0 ? 'Produtos Vencidos' : `Produtos a Vencer (${days} dias)`;

  let reportText = `🚨 *RELATÓRIO DE VALIDADE - PRAZOCERTO*\n`;
  reportText += `📍 *Loja:* ${storeLabel}\n`;
  reportText += `📅 *Filtro:* ${periodText}\n`;
  reportText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (products.length === 0) {
    reportText += `Nenhum produto encontrado para este período.\n`;
  } else {
    products.forEach((p, idx) => {
      const formattedDate = formatDate(p.expDate);
      const qty = p.quantity || p.qty || 1;
      const loc = p.location ? p.location.trim() : storeLabel;
      const code = p.code || p.ean || p.barcode || 'Não informado';

      reportText += `📦 *Item ${idx + 1}:* ${p.name}\n`;
      reportText += `🔢 *Quantidade:* ${qty}\n`;
      reportText += `📅 *Validade:* ${formattedDate}\n`;
      reportText += `📍 *Loja:* ${loc}\n`;
      reportText += `🏷️ *Código EAN:* ${code}\n\n`;
    });
  }

  reportText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  reportText += `📊 *Total de itens:* ${products.length}\n`;
  reportText += `⚠️ *Atenção aos prazos para evitar perdas!*`;

  return { products, days, storeLabel, reportText };
}

// Abre o modal de opções de compartilhamento
window.openAlertsReportShareModal = function () {
  const { products, days, storeLabel, reportText } = buildAlertsReportText();

  if (!products || !products.length) {
    const msg = days === 0
      ? 'Nenhum produto vencido para compartilhar.'
      : `Nenhum produto vence nos próximos ${days} dias.`;
    showToast(msg, 'ℹ️');
    return;
  }

  // Preenche informações no modal
  const periodEl = document.getElementById('alertsReportModalPeriod');
  const storeEl = document.getElementById('alertsReportModalStore');
  const totalEl = document.getElementById('alertsReportModalTotal');
  const titleEl2 = document.getElementById('alertsReportModalTitle');
  if (periodEl) periodEl.textContent = days === 0 ? 'Vencidos' : `${days} dias`;
  if (storeEl) storeEl.textContent = storeLabel || 'Todas as Lojas';
  if (totalEl) totalEl.textContent = `${products.length} item(ns)`;
  if (titleEl2) titleEl2.textContent = days === 0 ? 'Compartilhar Vencidos' : `Compartilhar – ${days} dias`;

  // Abre o modal de opções
  const modal = document.getElementById('alertsReportShareModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.zIndex = '99999';
  }
};

function closeAlertsReportShareModal() {
  const modal = document.getElementById('alertsReportShareModal');
  if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
}

function handleAlertsReportWhatsApp() {
  const { reportText } = buildAlertsReportText();
  const s = Store.getSettings();
  const rawNumber = (s.whatsappNumber || '').replace(/\D/g, '');
  const fullNumber = rawNumber && rawNumber.length >= 10
    ? (rawNumber.startsWith('55') ? rawNumber : `55${rawNumber}`)
    : '';
  const encoded = encodeURIComponent(reportText);
  const waUrlApp = fullNumber
    ? `whatsapp://send?phone=${fullNumber}&text=${encoded}`
    : `whatsapp://send?text=${encoded}`;
  const waUrlWeb = fullNumber
    ? `https://api.whatsapp.com/send?phone=${fullNumber}&text=${encoded}`
    : `https://api.whatsapp.com/send?text=${encoded}`;

  // Detecta ambiente
  const isNativeApp2 = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  if (isNativeApp2) {
    try {
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        window.Capacitor.Plugins.Browser.open({ url: waUrlApp }).catch(() => {
          window.Capacitor.Plugins.Browser.open({ url: waUrlWeb });
        });
      } else {
        window.location.href = waUrlApp;
      }
    } catch (e) {
      openWhatsAppLink(waUrlWeb);
    }
  } else {
    // Browser desktop: abre nova aba
    const w = window.open(waUrlWeb, '_blank');
    if (!w) window.location.href = waUrlWeb;
  }
  closeAlertsReportShareModal();
}

async function handleAlertsReportNative() {
  const { reportText } = buildAlertsReportText();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Relatório de Validade - PrazoCerto', text: reportText });
      showToast('Compartilhado com sucesso!', '✅');
      closeAlertsReportShareModal();
      return;
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  }
  try {
    await navigator.clipboard.writeText(reportText);
    showToast('Relatório copiado para a área de transferência!', '📋');
  } catch (e) {
    prompt('Copie o relatório abaixo:', reportText);
  }
  closeAlertsReportShareModal();
}

async function handleAlertsReportCopy() {
  const { reportText } = buildAlertsReportText();
  try {
    await navigator.clipboard.writeText(reportText);
    showToast('Relatório copiado para a área de transferência!', '📋');
  } catch (e) {
    prompt('Copie o relatório abaixo:', reportText);
  }
  closeAlertsReportShareModal();
}

async function shareAlertsReportViaWhatsApp() {
  openAlertsReportShareModal();
}

// ── CATEGORIES ───────────────────────────────────
function renderCategories() {
  const cats = Store.getCategories();
  const products = Store.getProducts();
  const settings = Store.getSettings();
  const grid = document.getElementById('categoriesGrid');
  if (!grid) return;
  if (!cats.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷️</div><h3>Nenhuma categoria</h3><p>Adicione categorias para organizar seus produtos.</p></div>`;
    return;
  }
  grid.innerHTML = cats.map(cat => {
    const count = products.filter(p => p.category === cat.id).length;
    const pct = products.length ? Math.round((count / products.length) * 100) : 0;
    return `<div class="category-card" data-cat-id="${cat.id}">
      <button class="category-delete" data-cat-id="${cat.id}">✕</button>
      <div class="category-emoji">${cat.emoji}</div>
      <div class="category-name">${escHtml(cat.name)}</div>
      <div class="category-count">${count} produto(s)</div>
      <div class="category-bar">
        <div class="category-fill" style="width:${pct}%; background:${cat.color}"></div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.category-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (await confirm('Excluir categoria', 'Excluir esta categoria? Os produtos não serão removidos.')) {
        const cats2 = Store.getCategories().filter(c => c.id !== btn.dataset.catId);
        Store.setCategories(cats2);
        renderCategories();
        showToast('Categoria removida', '🗑');
      }
    });
  });
}

// ── REPORTS (PAINEL EXECUTIVO ULTRA PREMIUM) ──────────────────────
let _repPeriod = 'today';
let _repMonthlyChartInstance = null;
let _repCategoryChartInstance = null;
let _repTrendChartInstance = null;

function setRepPeriod(period, btn) {
  _repPeriod = period;
  document.querySelectorAll('.rep-period-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderReports();
}
window.setRepPeriod = setRepPeriod;

function toggleRepExportMenu(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('repExportDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}
window.toggleRepExportMenu = toggleRepExportMenu;

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('repExportDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!e.target.closest('#repExportTrigger') && !e.target.closest('#repExportDropdown')) {
      dropdown.classList.add('hidden');
    }
  }
});

// ── FUNÇÃO GLOBAL DE ENTREGA DE ARQUIVO (Web + Android APK) ──────────────
async function saveAndDeliverFile(blob, fileName, mimeType, base64Data) {
  // 1. Capacitor nativo: gravar em Downloads + abrir Share
  try {
    const Cap = window.Capacitor;
    if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.Plugins) {
      const Filesystem = Cap.Plugins.Filesystem;
      const Share = Cap.Plugins.Share;
      if (Filesystem) {
        const res = await Filesystem.writeFile({
          path: `Download/${fileName}`,
          data: base64Data,
          directory: 'EXTERNAL_STORAGE',
          recursive: true
        });
        if (Share) {
          await Share.share({ title: `PrazoCerto`, url: res.uri, dialogTitle: `Abrir ou Salvar ${fileName}` });
        } else {
          showToast(`Salvo em Download: ${fileName}`, '📥');
        }
        return;
      }
    }
  } catch (err) {
    try {
      const Cap = window.Capacitor;
      if (Cap && Cap.Plugins && Cap.Plugins.Filesystem) {
        const res = await Cap.Plugins.Filesystem.writeFile({
          path: fileName, data: base64Data, directory: 'DOCUMENTS', recursive: true
        });
        if (Cap.Plugins.Share) {
          await Cap.Plugins.Share.share({ title: fileName, url: res.uri, dialogTitle: `Abrir ${fileName}` });
        } else {
          showToast(`Salvo: ${fileName}`, '📥');
        }
        return;
      }
    } catch (err2) { console.warn('Filesystem fallback error:', err2); }
  }
  // 2. Web Share API com arquivo
  try {
    const file = new File([blob], fileName, { type: mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName });
      return;
    }
  } catch (shareErr) {
    if (shareErr.name === 'AbortError') return;
  }
  // 3. Fallback download via link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  showToast(`Download iniciado: ${fileName}`, '📥');
}
window.saveAndDeliverFile = saveAndDeliverFile;

async function exportReportsData(format) {
  const dropdown = document.getElementById('repExportDropdown');
  if (dropdown) dropdown.classList.add('hidden');

  const products = Store.getProducts();
  if (!products.length) {
    showToast('Nenhum produto cadastrado para exportar', 'ℹ️');
    return;
  }

  const currentDate = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);

  // (usa saveAndDeliverFile global)

  if (format === 'excel' || format === 'csv') {
    if (window.XLSX && format === 'excel') {
      const rows = products.map((p, idx) => ({
        'Nº': idx + 1,
        'Produto': p.name || '—',
        'Código EAN': p.code || '—',
        'Data Vencimento': formatDate(p.expDate),
        'Dias Restantes': daysUntil(p.expDate),
        'Quantidade': p.qty || 1,
        'Loja / Local': p.location || 'Savegnago 24',
        'Status': daysUntil(p.expDate) < 0 ? 'Vencido' : (daysUntil(p.expDate) <= 7 ? 'Próximo do Vencimento' : 'Em Dia')
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 6 }, { wch: 38 }, { wch: 18 }, { wch: 16 }, { wch: 15 }, { wch: 12 }, { wch: 22 }, { wch: 22 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Relatório PrazoCerto');

      const fileName = `relatorio_prazocerto_${currentDate}.xlsx`;
      const base64Data = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      await saveAndDeliverFile(blob, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64Data);
    } else {
      let csv = "\uFEFFProduto;Código EAN;Vencimento;Dias Restantes;Quantidade;Loja;Status\n";
      products.forEach(p => {
        const d = daysUntil(p.expDate);
        const st = d < 0 ? 'Vencido' : (d <= 7 ? 'Próximo do Vencimento' : 'Em Dia');
        csv += `"${(p.name || '').replace(/;/g, ' ')}";"${p.code || ''}";"${formatDate(p.expDate)}";"${d}";"${p.qty || 1}";"${p.location || ''}";"${st}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const fileName = `relatorio_prazocerto_${currentDate}.csv`;
      const reader = new FileReader();
      reader.onload = async function () {
        const base64Data = reader.result.split(',')[1];
        await saveAndDeliverFile(blob, fileName, 'text/csv', base64Data);
      };
      reader.readAsDataURL(blob);
    }
  } else if (format === 'pdf') {
    if (window.jspdf && window.jspdf.jsPDF) {
      showToast('Gerando Relatório PDF formatado...', '⏳');
      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 26, 'F');
        doc.setTextColor(118, 196, 27);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('PRAZOCERTO', 14, 16);

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text('Relatório Executivo de Controle de Validades', 68, 16);

        const tableBody = products.map((p, idx) => [
          String(idx + 1),
          p.name || '—',
          p.code || '—',
          formatDate(p.expDate),
          String(daysUntil(p.expDate)),
          String(p.qty || 1),
          p.location || 'Savegnago 24'
        ]);

        doc.autoTable({
          startY: 32,
          head: [['#', 'Produto', 'Código EAN', 'Vencimento', 'Dias', 'Qtd', 'Loja']],
          body: tableBody,
          theme: 'striped',
          styles: { fontSize: 8, cellPadding: 2.5 },
          headStyles: { fillColor: [15, 23, 42], textColor: [118, 196, 27], fontStyle: 'bold', fontSize: 9 }
        });

        const fileName = `relatorio_prazocerto_${currentDate}.pdf`;
        const pdfBlob = doc.output('blob');
        const base64Data = doc.output('datauristring').split(',')[1];

        await saveAndDeliverFile(pdfBlob, fileName, 'application/pdf', base64Data);
      } catch (e) {
        console.error('PDF error:', e);
        window.print();
      }
    } else {
      window.print();
    }
  }
}
window.exportReportsData = exportReportsData;

function renderReports() {
  const products = Store.getProducts(); // Produtos filtrados pela loja selecionada no topo
  const allProds = Store.getAllProducts();
  const cats = Store.getCategories();
  const stores = Store.getStores();

  const activeStore = (window.currentLocationFilter && window.currentLocationFilter !== 'all')
    ? window.currentLocationFilter
    : 'Todas as Lojas';

  // 1. CÁLCULO DOS 4 MINI KPI CARDS BASEADOS NA LOJA ATIVA
  const totalCount = products.length;
  const expiredCount = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d < 0; }).length;
  const warnCount = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d >= 0 && d <= 7; }).length;
  const actualStoreNames = Array.from(new Set(allProds.map(p => p.location).filter(Boolean)));
  const storeCount = (activeStore === 'Todas as Lojas')
    ? (actualStoreNames.length > 0 ? actualStoreNames.length : (stores.length > 0 ? stores.length : 0))
    : 1;

  const kpiTot = document.getElementById('repKpiTotal');
  const kpiExp = document.getElementById('repKpiExpired');
  const kpiWrn = document.getElementById('repKpiWarn');
  const kpiSto = document.getElementById('repKpiStores');
  const repBellBadge = document.getElementById('repBellBadge');

  if (kpiTot) kpiTot.textContent = totalCount.toLocaleString('pt-BR');
  if (kpiExp) kpiExp.textContent = expiredCount;
  if (kpiWrn) kpiWrn.textContent = warnCount;
  if (kpiSto) kpiSto.textContent = storeCount;
  if (repBellBadge) repBellBadge.textContent = String(expiredCount);

  renderRepMonthlyChart(products);
  renderRepCategoryChart(products, cats);
  renderRepTrendChart(products);
  renderRepTimeline(products);
  renderRepTopCritical(products);
}

function renderRepMonthlyChart(products) {
  const canvas = document.getElementById('repMonthlyCanvas');
  if (!canvas) return;

  const shortMonthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const now = new Date();
  const monthLabels = [];
  const monthData = [0, 0, 0, 0, 0, 0, 0];

  const metricType = document.getElementById('repMetricSelect')?.value || 'qty';

  // 7 meses: mês anterior, mês atual e próximos 5 meses
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() + (i - 1), 1);
    monthLabels.push(shortMonthNames[targetDate.getMonth()]);
    
    if (products && products.length > 0) {
      const prodsInMonth = products.filter(p => {
        if (!p.expDate) return false;
        const [y, m] = p.expDate.split('-');
        if (!y || !m) return false;
        return parseInt(y, 10) === targetDate.getFullYear() && (parseInt(m, 10) - 1) === targetDate.getMonth();
      });

      if (metricType === 'loss') {
        monthData[i] = prodsInMonth.reduce((acc, cur) => acc + ((cur.qty || 1) * (parseFloat(cur.price) || 0)), 0);
      } else if (metricType === 'items') {
        monthData[i] = prodsInMonth.length;
      } else {
        monthData[i] = prodsInMonth.reduce((acc, cur) => acc + (parseInt(cur.qty, 10) || 1), 0);
      }
    }
  }

  const hasData = monthData.some(v => v > 0);
  const displayData = hasData ? monthData : [0, 0, 0, 0, 0, 0, 0];

  if (typeof Chart !== 'undefined') {
    if (_repMonthlyChartInstance) _repMonthlyChartInstance.destroy();

    const ctx = canvas.getContext('2d');
    const barGrad = ctx.createLinearGradient(0, 0, 0, 140);
    barGrad.addColorStop(0, 'rgba(34, 197, 94, 0.85)');
    barGrad.addColorStop(1, 'rgba(21, 128, 61, 0.15)');

    _repMonthlyChartInstance = new Chart(ctx, {
      data: {
        labels: monthLabels,
        datasets: [
          {
            type: 'line',
            label: 'Linha',
            data: displayData,
            borderColor: '#8EFF00',
            borderWidth: 2,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#8EFF00',
            pointBorderWidth: 2,
            pointRadius: 3.5,
            pointHoverRadius: 5,
            tension: 0.35,
            order: 1
          },
          {
            type: 'bar',
            label: 'Barras',
            data: displayData,
            backgroundColor: barGrad,
            borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: false,
            barPercentage: 0.40,
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#8EFF00',
            bodyColor: '#ffffff',
            borderColor: 'rgba(142, 255, 0, 0.3)',
            borderWidth: 1,
            padding: 7,
            displayColors: false,
            callbacks: {
              label: (item) => metricType === 'loss' 
                ? ' R$ ' + Number(item.parsed.y).toFixed(2).replace('.', ',')
                : item.parsed.y + (item.parsed.y === 1 ? ' produto' : ' produtos')
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 10, family: 'Inter' } }
          },
          y: {
            min: 0,
            suggestedMax: Math.max(...displayData, 5) + 2,
            ticks: {
              color: '#64748b',
              font: { size: 9, family: 'Inter' }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.04)',
              drawBorder: false
            }
          }
        }
      }
    });
  }
}

function renderRepCategoryChart(products, cats) {
  const canvas = document.getElementById('repCategoryCanvas');
  const legendList = document.getElementById('repCategoryLegendList');
  if (!canvas) return;

  const total = (products || []).length;
  let catData = [];
  let catLabels = [];
  let catColors = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4'];

  if (total > 0 && cats && cats.length > 0) {
    const counts = cats.map(c => ({
      name: c.name,
      count: products.filter(p => p.category === c.id || p.category === c.name).length
    })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);

    if (counts.length > 0) {
      const topCats = counts.slice(0, 4);
      catLabels = topCats.map(c => c.name);
      catData = topCats.map(c => Math.round((c.count / total) * 100));
    }
  }

  if (legendList) {
    if (catData.length === 0) {
      legendList.innerHTML = '<div style="color:#64748b; font-size:0.78rem; padding:8px 0; text-align:center;">Nenhum produto cadastrado</div>';
    } else {
      legendList.innerHTML = catLabels.map((name, idx) => `
        <div class="rep-cat-item">
          <span class="rep-cat-dot" style="background:${catColors[idx % catColors.length]};"></span>
          <span class="rep-cat-name">${escHtml(name)}</span>
          <span class="rep-cat-pct">${catData[idx]}%</span>
        </div>
      `).join('');
    }
  }

  if (typeof Chart !== 'undefined') {
    if (_repCategoryChartInstance) _repCategoryChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    
    // Se não há dados, exibe rosca cinza vazia
    const chartLabels = catData.length > 0 ? catLabels : ['Sem dados'];
    const chartValues = catData.length > 0 ? catData : [1];
    const chartBackgrounds = catData.length > 0 ? catColors : ['rgba(255,255,255,0.08)'];

    _repCategoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: chartLabels,
        datasets: [{
          data: chartValues,
          backgroundColor: chartBackgrounds,
          borderWidth: 2,
          borderColor: '#080f18',
          hoverOffset: catData.length > 0 ? 3 : 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: catData.length > 0,
            backgroundColor: '#0f172a',
            callbacks: { label: (ctx) => ' ' + ctx.label + ': ' + ctx.parsed + '%' }
          }
        }
      }
    });
  }
}

function renderRepTrendChart(products) {
  const canvas = document.getElementById('repTrendCanvas');
  if (!canvas) return;

  const shortMonthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const now = new Date();
  const labels = [];
  const monthlyCounts = [0, 0, 0, 0, 0, 0];

  // Últimos 6 meses até o mês atual
  for (let i = 5; i >= 0; i--) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const labelIdx = 5 - i;
    labels[labelIdx] = shortMonthNames[targetDate.getMonth()];

    if (products && products.length > 0) {
      // Conta produtos vencidos cujo expDate caiu naquele mês
      const count = products.filter(p => {
        if (!p.expDate) return false;
        const [y, m] = p.expDate.split('-');
        if (!y || !m) return false;
        const expMonth = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
        return expMonth.getFullYear() === targetDate.getFullYear() && expMonth.getMonth() === targetDate.getMonth();
      }).length;
      monthlyCounts[labelIdx] = count;
    }
  }

  // Cálculo percentual comparativo: mês atual vs mês anterior
  const curMonthVal = monthlyCounts[5];
  const prevMonthVal = monthlyCounts[4];
  const pctEl = document.getElementById('repTrendPct');
  if (pctEl) {
    if (products.length === 0 || (curMonthVal === 0 && prevMonthVal === 0)) {
      pctEl.textContent = '0%';
      pctEl.style.color = '#64748b';
    } else if (prevMonthVal === 0) {
      pctEl.textContent = `+${curMonthVal > 0 ? 100 : 0}%`;
      pctEl.style.color = '#FF3B30';
    } else {
      const diff = Math.round(((curMonthVal - prevMonthVal) / prevMonthVal) * 100);
      pctEl.textContent = (diff > 0 ? '+' : '') + diff + '%';
      pctEl.style.color = diff > 0 ? '#FF3B30' : (diff < 0 ? '#8EFF00' : '#64748b');
    }
  }

  const maxVal = Math.max(...monthlyCounts, 5);

  if (typeof Chart !== 'undefined') {
    if (_repTrendChartInstance) _repTrendChartInstance.destroy();
    const ctx = canvas.getContext('2d');

    const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#8EFF00';
    const fillGrad = ctx.createLinearGradient(0, 0, 0, 120);
    fillGrad.addColorStop(0, themeColor + '33');
    fillGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

    _repTrendChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: monthlyCounts,
          borderColor: themeColor,
          backgroundColor: fillGrad,
          fill: true,
          borderWidth: 2,
          pointBackgroundColor: themeColor,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 4,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            callbacks: {
              label: (ctx) => ' ' + ctx.parsed.y + (ctx.parsed.y === 1 ? ' produto' : ' produtos')
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 10 } }
          },
          y: {
            min: 0,
            suggestedMax: maxVal + 2,
            ticks: {
              stepSize: Math.max(1, Math.round(maxVal / 4)),
              color: '#64748b',
              font: { size: 9 }
            },
            grid: { color: 'rgba(255, 255, 255, 0.04)' }
          }
        }
      }
    });
  }
}

function renderRepTimeline(products) {
  const flow = document.getElementById('repTimelineFlow');
  if (!flow) return;

  if (!products || products.length === 0) {
    flow.innerHTML = '<div style="color:#64748b; font-size:0.8rem; text-align:center; padding:24px 0;">Nenhum produto cadastrado na linha do tempo.</div>';
    return;
  }

  const prods = [...products].sort((a, b) => (daysUntil(a.expDate) || 999) - (daysUntil(b.expDate) || 999)).slice(0, 5);

  const items = prods.map(p => {
    const d = daysUntil(p.expDate);
    const dateStr = p.expDate ? p.expDate.split('-').reverse().slice(0, 2).join('/') : 'Hoje';
    return {
      name: p.name || 'Produto',
      cat: p.categoryName || p.category || 'Geral',
      store: p.location || 'Loja',
      time: dateStr,
      days: d !== null ? d : 0,
      isCrit: d !== null && d <= 0
    };
  });

  flow.innerHTML = items.map(item => `
    <div class="rep-time-item">
      <div class="rep-time-badge-icon ${item.days <= 0 ? 'badge-icon-red' : 'badge-icon-yellow'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div class="rep-time-content">
        <div class="rep-time-title">${escHtml(item.name)}</div>
        <div class="rep-time-sub">
          <span>${escHtml(item.cat)} • ${escHtml(item.store)}</span>
          <span>📅 ${item.time}</span>
        </div>
      </div>
      <div class="rep-time-days">
        <span class="rep-days-num ${item.days <= 0 ? 'num-red' : 'num-yellow'}">${item.days}</span>
        <span class="rep-days-lbl ${item.days <= 0 ? 'num-red' : 'num-yellow'}">dias</span>
      </div>
    </div>
  `).join('');
}

function renderRepTopCritical(products) {
  const list = document.getElementById('repTopCriticalList');
  if (!list) return;

  if (!products || products.length === 0) {
    list.innerHTML = '<div style="color:#64748b; font-size:0.8rem; text-align:center; padding:24px 0;">Nenhum produto crítico no momento.</div>';
    return;
  }

  const prods = [...products].sort((a, b) => (daysUntil(a.expDate) || 999) - (daysUntil(b.expDate) || 999)).slice(0, 5);

  const items = prods.map((p, idx) => {
    const d = daysUntil(p.expDate);
    return {
      rank: idx + 1,
      name: p.name || 'Produto',
      sub: p.location || (p.categoryName || 'Loja'),
      days: d !== null ? d : 0,
      dayLbl: Math.abs(d) === 1 ? 'dia' : 'dias',
      ean: p.code || p.ean || ''
    };
  });

  list.innerHTML = items.map(p => {
    const imgSrc = typeof resolveProductImage === 'function' ? resolveProductImage(p.ean, p.name) : 'images/prazocerto_basket_3d.png';
    return `
      <div class="rep-crit-item">
        <div class="rep-crit-rank rank-${p.rank}">${p.rank}</div>
        <img src="${imgSrc}" class="rep-crit-thumb" loading="lazy" decoding="async" onerror="this.src='images/prazocerto_basket_3d.png'" alt="${escHtml(p.name)}" />
        <div class="rep-crit-info">
          <div class="rep-crit-name">✦ ${escHtml(p.name)}</div>
          <div class="rep-crit-sub">${escHtml(p.sub)}</div>
        </div>
        <div class="rep-crit-days">
          <span class="rep-days-num ${p.days <= 0 ? 'num-red' : 'num-yellow'}">${p.days}</span>
          <span class="rep-days-lbl ${p.days <= 0 ? 'num-red' : 'num-yellow'}">${p.dayLbl}</span>
        </div>
      </div>
    `;
  }).join('');
}
window.renderReports = renderReports;


function resetProductForm() {
  editingProduct = null;
  const nameEl = document.getElementById('prodName');
  if (nameEl) nameEl.value = '';
  const codeEl = document.getElementById('prodCode');
  if (codeEl) codeEl.value = '';
  const expEl = document.getElementById('prodExpDate');
  if (expEl) expEl.value = '';
  const mfgEl = document.getElementById('prodMfgDate');
  if (mfgEl) mfgEl.value = '';
  const qtyEl = document.getElementById('prodQty');
  if (qtyEl) qtyEl.value = 1;
  const notesEl = document.getElementById('prodNotes');
  if (notesEl) notesEl.value = '';
  const catEl = document.getElementById('prodCategory');
  if (catEl) catEl.value = '';

  // Limpa imagem e mensagens
  const prodImg = document.getElementById('prodImage');
  if (prodImg) prodImg.src = '';
  const bc = document.getElementById('prodBarcodeImage');
  if (bc) { bc.src = ''; bc.style.display = 'none'; }
  const imgContainer = document.getElementById('prodImageContainer');
  if (imgContainer) imgContainer.style.display = 'none';
  const notFoundMsg = document.getElementById('prodNotFoundMsg');
  if (notFoundMsg) notFoundMsg.style.display = 'none';
  const gotoCat = document.getElementById('btnGoCatalogContainer');
  if (gotoCat) gotoCat.style.display = 'none';
  const expPrev = document.getElementById('expiryPreview');
  if (expPrev) expPrev.classList.add('hidden');

  // Para scanner inline se aberto
  if (typeof stopInlineScanner === 'function') stopInlineScanner();

  // Scroll para o topo do modal
  const modalBody = document.querySelector('#productModal .modal-body');
  if (modalBody) modalBody.scrollTop = 0;
}

function openAddModal(prefillCode) {
  resetProductForm();
  document.getElementById('modalTitle').textContent = 'Novo Produto';
  const currentLoc = document.getElementById('globalLocationFilter')?.value;
  const storeFilter = (currentLoc && currentLoc !== 'all') ? currentLoc : '';
  document.getElementById('prodLocation').value = storeFilter;
  populateCategorySelect();
  populateStoreSelect(storeFilter);

  if (prefillCode) {
    const codeClean = String(prefillCode).trim();
    // Verifica se já existe na mesma loja ou na lista geral se não houver filtro
    const existing = Store.getAllProducts().find(x =>
      x.code && String(x.code).trim() === codeClean &&
      (!storeFilter || !x.location || x.location === storeFilter)
    );

    if (existing) {
      showToast('Produto já cadastrado nesta loja! Abrindo...', 'info', 3000);
      openEditModal(existing.id);
      return;
    } else {
      showToast('Produto não cadastrado nesta loja. Cadastre agora!', 'info', 3500);
    }

    document.getElementById('prodCode').value = codeClean;
    // Garante scroll no topo antes e depois do catálogo carregar
    const modalBody = document.querySelector('#productModal .modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    document.getElementById('productModal').classList.remove('hidden');
    // Dispara busca no catálogo (o handler vai preencher nome/imagem)
    document.getElementById('prodCode').dispatchEvent(new Event('input'));
    if (typeof lookupAndFillProduct === 'function') {
      lookupAndFillProduct(codeClean);
    }
    setTimeout(() => {
      if (modalBody) modalBody.scrollTop = 0;
    }, 900);
  } else {
    document.getElementById('productModal').classList.remove('hidden');
    setTimeout(() => {
      const modalBody = document.querySelector('#productModal .modal-body');
      if (modalBody) modalBody.scrollTop = 0;
    }, 50);
  }
}

// Guarda a página de origem ao abrir edição
let editOriginPage = null;

function openEditModal(id) {
  const products = Store.getAllProducts();
  const p = products.find(x => x.id === id);
  if (!p) return;
  // Salva a página atual para retornar após salvar
  editOriginPage = currentPage || null;
  editingProduct = p;
  // Limpa imagem anterior antes de carregar a correta
  const imgContainer = document.getElementById('prodImageContainer');
  const prodImg = document.getElementById('prodImage');
  const prodBc = document.getElementById('prodBarcodeImage');
  if (imgContainer) imgContainer.style.display = 'none';
  if (prodImg) prodImg.src = '';
  if (prodBc) { prodBc.src = ''; prodBc.style.display = 'none'; }
  document.getElementById('modalTitle').textContent = 'Editar Produto';
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodCode').value = p.code || '';
  document.getElementById('prodExpDate').value = p.expDate || '';
  document.getElementById('prodMfgDate').value = p.mfgDate || '';
  document.getElementById('prodQty').value = p.qty || 1;
  document.getElementById('prodLocation').value = p.location || '';
  document.getElementById('prodNotes').value = p.notes || '';
  populateCategorySelect(p.category);
  populateStoreSelect(p.location);
  updateExpiryPreview();
  // Carrega a imagem correta baseada no EAN do produto sendo editado
  if (p.code) {
    const ean = p.code.trim();
    const imgEl = document.getElementById('prodImage');
    const imgCont = document.getElementById('prodImageContainer');
    const bc = document.getElementById('prodBarcodeImage');
    if (bc) {
      bc.src = `imagens/${ean}_barcode.jpg`;
      bc.style.display = 'block';
    }
    const tryLoad = (src, fallbacks) => {
      const i = new Image();
      i.onload = () => { if (imgEl && imgCont) { imgEl.src = src; imgCont.style.display = 'flex'; } };
      i.onerror = async () => {
        if (fallbacks && fallbacks.length > 0) {
          tryLoad(fallbacks[0], fallbacks.slice(1));
        } else {
          try {
            const cached = await lookupProductByBarcode(ean);
            if (cached && (cached.imagem_url || cached.foto)) {
              imgEl.src = cached.imagem_url || cached.foto;
              imgCont.style.display = 'flex';
              return;
            }
          } catch (e) { }
          if (imgEl && imgCont) {
            imgEl.src = 'images/prazocerto_basket_3d.png';
            imgCont.style.display = 'flex';
          }
        }
      };
      i.src = src;
    };
    tryLoad(`imagens/${ean}.jpg`, [`images/${ean}.jpg`, `https://cdn-cosmos.bluesoft.com.br/products/${ean}`]);
  }
  document.getElementById('productModal').classList.remove('hidden');
}

function populateCategorySelect(selected) {
  const sel = document.getElementById('prodCategory');
  const cats = Store.getCategories();
  if (sel) {
    sel.innerHTML = '<option value="">Selecionar categoria...</option>' +
      cats.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.emoji} ${escHtml(c.name)}</option>`).join('');
  }
  const filterSel = document.getElementById('filterCategory');
  if (filterSel) {
    const currFilter = filterSel.value;
    filterSel.innerHTML = '<option value="all">Categorias</option>' +
      cats.map(c => `<option value="${c.id}">${c.emoji} ${escHtml(c.name)}</option>`).join('');
    filterSel.value = currFilter || 'all';
  }
}

function getAutoCategory(name) {
  if (!name) return '';
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cats = Store.getCategories();
  const matchCat = (keywords) => cats.find(c => {
    const cName = c.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return keywords.some(k => cName.includes(k));
  });

  // 1. LATICÍNIOS (Tem prioridade mesmo se tiver 'morango', 'banana', 'fruta', 'chocolate' no nome)
  const laticiniosKeywords = [
    'activia', 'danone', 'danoninho', 'yopro', 'chamyto', 'chandelle', 'danette', 'yakult',
    'leite', 'iogurte', 'iorgute', 'yogurt', 'queijo', 'manteiga', 'requeijao', 'requeijão',
    'margarina', 'petit suisse', 'nata', 'coalhada', 'ricota', 'mussarela', 'mozzarella',
    'parmesao', 'parmesão', 'provolone', 'gorgonzola', 'cheddar', 'brie', 'camembert',
    'bebida lactea', 'creme de leite', 'leite condensado', 'whey', 'parmalat', 'itambe',
    'itambé', 'piracanjuba', 'vigor', 'batavo', 'elegê', 'elege', 'lactalis', 'tirolez', 'polenghi'
  ];
  if (laticiniosKeywords.some(k => n.includes(k))) {
    const c = matchCat(['laticinio', 'laticinios', 'leite', 'derivados']);
    if (c) return c.id;
  }

  // 2. CARNES / AÇOUGUE / FRIOS
  const carnesKeywords = [
    'carne', 'frango', 'porco', 'peixe', 'salsicha', 'linguica', 'linguiça', 'bife',
    'calabresa', 'presunto', 'mortadela', 'bacon', 'salame', 'pernil', 'costela', 'picanha',
    'alcatra', 'patinho', 'acem', 'maminha', 'hamburguer', 'nuggets', 'empanado', 'file'
  ];
  if (carnesKeywords.some(k => n.includes(k))) {
    const c = matchCat(['carne', 'acougue', 'frios']);
    if (c) return c.id;
  }

  // 3. LIMPEZA
  const limpezaKeywords = [
    'sabao', 'sabão', 'detergente', 'amaciante', 'desinfetante', 'limpeza', 'veja',
    'cloro', 'agua sanitaria', 'água sanitária', 'ypê', 'ype', 'omoo', 'omo', 'vanish',
    'esponja', 'bombril', 'lustra', 'multiuso', 'desengordurante', 'alvejante'
  ];
  if (limpezaKeywords.some(k => n.includes(k))) {
    const c = matchCat(['limpeza']);
    if (c) return c.id;
  }

  // 4. HIGIENE & BELEZA
  const higieneKeywords = [
    'sabonete', 'shampoo', 'condicionador', 'pasta de dente', 'creme dental', 'escova',
    'desodorante', 'fio dental', 'absorvente', 'fralda', 'papel higienico', 'papel higiênico',
    'hidratante', 'listerine', 'colgate', 'dove', 'rexona', 'nivea', 'pantene'
  ];
  if (higieneKeywords.some(k => n.includes(k))) {
    const c = matchCat(['higiene', 'perfumaria', 'beleza']);
    if (c) return c.id;
  }

  // 5. MEDICAMENTOS / FARMÁCIA
  const farmaciaKeywords = [
    'dipirona', 'paracetamol', 'remedio', 'remédio', 'comprimido', 'xarope', 'pomada',
    'antialergico', 'antibiotico', 'vitamina', 'dorflex', 'neosaldina', 'ibuprofeno'
  ];
  if (farmaciaKeywords.some(k => n.includes(k))) {
    const c = matchCat(['medicamento', 'farmacia']);
    if (c) return c.id;
  }

  // 6. BEBIDAS (Não lácteas)
  const bebidasKeywords = [
    'cerveja', 'refrigerante', 'coca cola', 'coca-cola', 'guarana', 'guaraná', 'fanta',
    'sprite', 'suco', 'nectar', 'vinho', 'vodka', 'whisky', 'energetico', 'energético', 'agua mineral', 'água'
  ];
  if (bebidasKeywords.some(k => n.includes(k))) {
    const c = matchCat(['bebida', 'bebidas']);
    if (c) return c.id;
  }

  // 7. ALIMENTOS / MERCEARIA / HORTIFRUTI
  const alimentosKeywords = [
    'arroz', 'feijao', 'feijão', 'macarrao', 'macarrão', 'acucar', 'açúcar', 'sal', 'cafe', 'café',
    'oleo', 'óleo', 'azeite', 'vinagre', 'farinha', 'molho', 'biscoito', 'bolacha', 'chocolate',
    'bombom', 'pao', 'pão', 'torrada', 'fruta', 'legume', 'verdura', 'morango', 'banana', 'maca', 'maçã'
  ];
  if (alimentosKeywords.some(k => n.includes(k))) {
    const c = matchCat(['alimento', 'mercearia', 'hortifruti']);
    if (c) return c.id;
  }

  return '';
}

function saveProduct() {
  const name = document.getElementById('prodName').value.trim();
  const expDate = document.getElementById('prodExpDate').value;
  if (!name) { showToast('Nome do produto é obrigatório', '⚠️'); return; }
  if (!expDate) { showToast('Data de validade é obrigatória', '⚠️'); return; }

  let categoryId = document.getElementById('prodCategory').value;
  const autoCategorize = document.getElementById('prodAutoCategory')?.checked;

  if (!categoryId && autoCategorize) {
    categoryId = getAutoCategory(name);
  }

  const pCode = document.getElementById('prodCode').value.trim();
  const pLocation = document.getElementById('prodLocation').value.trim();

  // Se for novo cadastro, verifica os 2 bloqueios de limites do plano (Global e Por Loja)
  if (!editingProduct) {
    if (typeof checkProductPlanLimits === 'function') {
      const limitCheck = checkProductPlanLimits(pLocation);
      if (!limitCheck.allowed) {
        openPlanLimitModal(limitCheck.reason);
        return;
      }
    }
  }

  // Se for novo cadastro e tiver código, não permite duplicar na mesma loja
  if (!editingProduct && pCode) {
    const existing = Store.getAllProducts().find(x =>
      x.code && String(x.code).trim() === pCode &&
      (!pLocation || !x.location || x.location === pLocation)
    );
    if (existing) {
      showToast('Este produto já está cadastrado nesta loja!', '⚠️', 3500);
      return;
    }
  }

  const p = {
    id: editingProduct?.id || uid(),
    name,
    code: pCode,
    expDate,
    mfgDate: document.getElementById('prodMfgDate').value,
    qty: parseInt(document.getElementById('prodQty').value) || 1,
    location: pLocation,
    notes: document.getElementById('prodNotes').value.trim(),
    category: categoryId,
    addedAt: editingProduct?.addedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let products = Store.getAllProducts();
  const isEditing = !!editingProduct;
  const targetPage = editOriginPage || currentPage;

  if (isEditing) {
    // Detecta o que mudou para criar histórico rico
    const oldP = editingProduct;
    let actionType = 'validade';
    let actionLabel = 'Validade alterada';
    let actionField = 'Validade';
    let beforeVal = formatDate(oldP.expDate);
    let afterVal = formatDate(p.expDate);

    if (oldP.qty !== p.qty) {
      actionType = 'quantidade';
      actionLabel = 'Quantidade alterada';
      actionField = 'Quantidade';
      beforeVal = String(oldP.qty || 1);
      afterVal = String(p.qty || 1);
    } else if (oldP.category !== p.category) {
      const cats = Store.getCategories();
      const oldCat = cats.find(c => c.id === oldP.category);
      const newCat = cats.find(c => c.id === p.category);
      actionType = 'categoria';
      actionLabel = 'Categoria alterada';
      actionField = 'Categoria';
      beforeVal = oldCat ? oldCat.name : 'Sem Categoria';
      afterVal = newCat ? newCat.name : 'Sem Categoria';
    }

    if (typeof addHistoryLog === 'function') {
      addHistoryLog({
        productId: p.id,
        productName: p.name,
        productCode: p.code || '',
        productImg: p.imageUrl || 'images/basket_icon.png',
        store: p.location || 'Savegnago 24',
        actionType,
        actionLabel,
        actionField,
        beforeVal,
        afterVal
      });
    }

    products = products.map(x => x.id === p.id ? p : x);
    showToast(`"${name}" atualizado`, '✅');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  } else {
    if (typeof addHistoryLog === 'function') {
      addHistoryLog({
        productId: p.id,
        productName: p.name,
        productCode: p.code || '',
        productImg: p.imageUrl || 'images/basket_icon.png',
        store: p.location || 'Savegnago 24',
        actionType: 'cadastro',
        actionLabel: 'Produto cadastrado',
        actionField: 'Cadastro',
        beforeVal: '',
        afterVal: `Qtd: ${p.qty || 1}`
      });
    }
    // Salva ou atualiza no cache de produtos se houver código
    if (p.code) {
      const imgEl = document.getElementById('prodImage');
      const imgUrl = (imgEl && imgEl.src && !imgEl.src.includes('prazocerto_basket_3d.png')) ? imgEl.src : '';
      if (imgUrl) p.imageUrl = imgUrl;
      _saveProdutoCache(p.code, {
        nome: p.name,
        categoria: p.category,
        imagem_url: imgUrl,
        fonte_dados: 'manual_usuario'
      });
    }

    products.unshift(p);
    showToast(`"${name}" adicionado!`, '✅');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }

  // 1. Salva e persiste os dados na Store e Firestore PRIMEIRO
  Store.setProducts(products);

  // 2. Limpa o formulário e fecha o modal
  resetProductForm();
  _resetScanCooldown();
  document.getElementById('productModal').classList.add('hidden');

  // 3. Atualiza imediatamente a visualização da tela atual/origem
  if (wasScanning && !isEditing) {
    wasScanning = false;
    setTimeout(() => navigate('scanner'), 200);
  } else if (targetPage && targetPage !== currentPage) {
    navigate(targetPage);
  } else {
    if (currentPage === 'dashboard') {
      renderDashboard();
      if (typeof updateDashChart === 'function') updateDashChart();
    } else if (currentPage === 'alerts') {
      renderAlerts(currentAlertFilter);
    } else if (currentPage === 'products') {
      renderProducts();
    }
    if (typeof renderHistory === 'function') renderHistory();
    if (typeof renderReports === 'function') renderReports();
    updateBadges();
    scheduleNotifications();
  }

  editOriginPage = null;
}

function deleteProduct(id) {
  const prodToDelete = Store.getAllProducts().find(p => p.id === id);
  if (prodToDelete && typeof addHistoryLog === 'function') {
    addHistoryLog({
      productId: prodToDelete.id,
      productName: prodToDelete.name,
      productCode: prodToDelete.code || '',
      productImg: prodToDelete.imageUrl || 'images/basket_icon.png',
      store: prodToDelete.location || 'Savegnago 24',
      actionType: 'exclusao',
      actionLabel: 'Produto excluído',
      actionField: 'Exclusão',
      beforeVal: `Qtd: ${prodToDelete.qty || 1}`,
      afterVal: 'Removido'
    });
  }
  let products = Store.getAllProducts().filter(p => p.id !== id);
  Store.setProducts(products);
  if (currentPage === 'products') renderProducts();
  if (currentPage === 'dashboard') {
    renderDashboard();
    if (typeof updateDashChart === 'function') updateDashChart();
  }
  if (currentPage === 'alerts') renderAlerts(currentAlertFilter);
  if (typeof renderHistory === 'function') renderHistory();
  if (typeof renderReports === 'function') renderReports();
  updateBadges();
  showToast('Produto removido', '🗑');
}

function updateExpiryPreview() {
  const expDate = document.getElementById('prodExpDate').value;
  const preview = document.getElementById('expiryPreview');
  if (!expDate) { preview.classList.add('hidden'); return; }
  preview.classList.remove('hidden');
  const settings = Store.getSettings();
  const days = daysUntil(expDate);
  const s = getStatus(days, settings);
  const colors = { ok: 'var(--gradient-ok)', warn: 'var(--gradient-warn)', expired: 'var(--gradient-danger)' };
  const mfg = document.getElementById('prodMfgDate').value;
  const totalLife = mfg ? Math.max(1, Math.round((new Date(expDate) - new Date(mfg)) / 86400000)) : 365;
  const pct = Math.min(100, Math.max(0, Math.round((Math.max(0, days) / totalLife) * 100)));
  document.getElementById('gaugeLabel').textContent = statusLabel(days);
  document.getElementById('gaugeFill').style.cssText = `width:${pct}%; background:${colors[s]}`;
  document.getElementById('gaugeSub').textContent = `Validade: ${formatDate(expDate)}`;
}

// ── SCANNER ──────────────────────────────────────
let scannerActive = false;
let html5QrCode = null;
let wasScanning = false; // controla se veio do escaneamento para voltar câmera após salvar
// Cooldown: evita reler o mesmo código imediatamente
let _lastScannedCode = null;
let _lastScannedTime = 0;
const SCAN_COOLDOWN_MS = 3000; // 3 segundos de cooldown por código

function _isScanCooldown(code) {
  const now = Date.now();
  if (code === _lastScannedCode && now - _lastScannedTime < SCAN_COOLDOWN_MS) return true;
  _lastScannedCode = code;
  _lastScannedTime = now;
  return false;
}

function _resetScanCooldown() {
  _lastScannedCode = null;
  _lastScannedTime = 0;
}

function _forceStopCameraTracks() {
  const scanDiv = document.getElementById('scannerFrameDiv');
  if (scanDiv) {
    const videos = scanDiv.querySelectorAll('video');
    videos.forEach(video => {
      if (video.srcObject) {
        try {
          const stream = video.srcObject;
          if (stream && stream.getTracks) {
            stream.getTracks().forEach(track => track.stop());
          }
        } catch (e) { }
        video.srcObject = null;
      }
    });
  }
}

async function startScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Biblioteca de scanner não carregada', '❌');
    return;
  }

  _resetScanCooldown();

  // Garante que qualquer câmera rodando no browser seja interrompida
  if (html5QrCode) {
    try { await html5QrCode.stop(); } catch (e) { }
    try { html5QrCode.clear(); } catch (e) { }
    html5QrCode = null;
  }
  _forceStopCameraTracks();

  const scanContainer = document.getElementById('scannerFrameDiv');
  if (scanContainer) scanContainer.innerHTML = '';

  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');

  try {
    scannerActive = true;
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';
    const resEl = document.getElementById('scanResult');
    if (resEl) resEl.classList.add('hidden');

    html5QrCode = new Html5Qrcode('scannerFrameDiv', {
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    });

    // Configuração otimizada com preferência ao Google ML Kit Barcode Detector Nativo
    const scanConfig = {
      fps: 30,
      disableFlip: false,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const width = Math.floor(viewfinderWidth * 0.85);
        const height = Math.floor(viewfinderHeight * 0.25);
        return { width: Math.max(width, 280), height: Math.max(height, 100) };
      },
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true,
        willReadFrequently: true
      },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.QR_CODE,
      ]
    };

    await html5QrCode.start(
      { facingMode: 'environment' },
      scanConfig,
      (decodedText) => {
        if (!scannerActive) return;
        if (_isScanCooldown(decodedText)) return;
        scannerActive = false;

        if (navigator.vibrate) navigator.vibrate([200]);
        playScanSound();

        // Interrompe o scanner em background para liberar os recursos do navegador
        setTimeout(async () => {
          try {
            if (html5QrCode) {
              await html5QrCode.stop();
              html5QrCode.clear();
              html5QrCode = null;
            }
          } catch (e) { console.warn(e); }
          _forceStopCameraTracks();
          if (scanContainer) scanContainer.innerHTML = '';
        }, 50);

        if (startBtn) startBtn.style.display = '';
        if (stopBtn) stopBtn.style.display = 'none';

        wasScanning = true; // marca que veio do scanner para retornar câmera após salvar
        navigate('products');
        setTimeout(() => {
          openAddModal(decodedText);
          showToast('Código lido: ' + decodedText, '✅');
        }, 200);
      },
      () => { /* erros de leitura: ignorar */ }
    );
  } catch (e) {
    scannerActive = false;
    _forceStopCameraTracks();
    if (scanContainer) scanContainer.innerHTML = '';
    if (html5QrCode) { try { html5QrCode.clear(); } catch (_) { } html5QrCode = null; }
    if (startBtn) startBtn.style.display = '';
    if (stopBtn) stopBtn.style.display = 'none';
    // Mostra erro e botão para tentar de novo
    showToast('Câmera bloqueada. Toque em "Iniciar Scanner" para tentar novamente.', '⚠️', 5000);
    console.warn('Scanner error:', e.message);
  }
}

// Abre câmera direto (sem navegar para página scanner) e ao ler, abre modal de adicionar
let _directScannerActive = false;
let _directHtml5 = null;

async function openScannerDirect() {
  _ensureAudioContext(); // desbloqueia AudioContext no gesto do usuario
  if (typeof Html5Qrcode === 'undefined') { showToast('Scanner não carregado', '❌'); return; }
  if (_directScannerActive) return;

  // Cria overlay de câmera sobre o app
  const overlay = document.createElement('div');
  overlay.id = 'directScanOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:99999;display:flex;flex-direction:column;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:calc(var(--safe-top, 0px) + 10px) 16px 12px 16px;background:rgba(0,0,0,0.8);box-sizing:border-box;width:100%;';
  header.innerHTML = '<span style="color:#fff;font-size:1rem;font-weight:700;">📷 Escanear Produto</span><button id="closeDirScan" style="background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:1.3rem;width:34px;height:34px;border-radius:50%;cursor:pointer;">✕</button>';

  const frameWrap = document.createElement('div');
  frameWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';
  const frameDiv = document.createElement('div');
  frameDiv.id = 'directScanFrameDiv';
  frameDiv.style.cssText = 'width:100%;height:100%;';
  frameWrap.appendChild(frameDiv);

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:10px;text-align:center;color:#94a3b8;font-size:0.8rem;background:rgba(0,0,0,0.8);';
  hint.textContent = '↕ Aponte a câmera para o código de barras do produto';

  overlay.appendChild(header);
  overlay.appendChild(frameWrap);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  function closeDirectScanner() {
    _directScannerActive = false;
    if (_directHtml5) {
      _directHtml5.stop().catch(() => { });
      try { _directHtml5.clear(); } catch (e) { }
      _directHtml5 = null;
    }
    _forceStopCameraTracks();
    overlay.remove();
  }

  document.getElementById('closeDirScan').addEventListener('click', closeDirectScanner);

  _directScannerActive = true;
  try {
    _directHtml5 = new Html5Qrcode('directScanFrameDiv', { experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    const cfg = {
      fps: 30,
      disableFlip: false,
      qrbox: (w, h) => ({ width: Math.max(Math.floor(w * 0.85), 280), height: Math.max(Math.floor(h * 0.25), 100) }),
      experimentalFeatures: { useBarCodeDetectorIfSupported: true, willReadFrequently: true },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF, Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.QR_CODE
      ]
    };
    await _directHtml5.start(
      { facingMode: 'environment' },
      cfg,
      (code) => {
        if (!_directScannerActive) return;
        if (navigator.vibrate) navigator.vibrate([200]);
        playScanSound();
        closeDirectScanner();
        setTimeout(() => {
          openAddModal(code);
          showToast('Código lido: ' + code, '✅');
        }, 150);
      },
      () => { }
    );
  } catch (e) {
    _directScannerActive = false;
    overlay.remove();
    showToast('Câmera bloqueada. Permita o acesso à câmera.', '⚠️', 4000);
  }
}

// Scanner exclusivo para a barra de busca de produtos:
// Se encontrar o produto na lista, filtra e exibe na lista de produtos.
// Se não encontrar, pergunta se deseja cadastrar e abre o formulário preenchido com o código.
async function openScannerForSearch() {
  _ensureAudioContext(); // desbloqueia AudioContext no gesto do usuario
  if (_directScannerActive) return;

  const overlay = document.createElement('div');
  overlay.id = 'searchScanOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:#000;display:flex;flex-direction:column;';

  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:rgba(0,0,0,0.9);border-bottom:1px solid rgba(142,255,0,0.35);">
      <span style="color:#8EFF00;font-size:1rem;font-weight:800;display:flex;align-items:center;gap:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8EFF00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
          <line x1="7" y1="12" x2="17" y2="12"/>
        </svg>
        Escanear Codigo de Barras
      </span>
      <button id="closeSearchScan" style="background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:1.4rem;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">x</button>
    </div>
    <div id="searchScanViewport" style="flex:1;position:relative;overflow:hidden;background:#000;">
      <video id="searchScanVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;display:block;"></video>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
        <div style="position:relative;width:78%;max-width:340px;height:28%;min-height:80px;">
          <div id="searchScanLaser" style="position:absolute;left:0;right:0;top:50%;height:2px;background:linear-gradient(90deg,transparent 0%,#8EFF00 30%,#00e5ff 70%,transparent 100%);box-shadow:0 0 10px #8EFF00,0 0 20px #00e5ff;animation:laserScan 1.6s ease-in-out infinite;"></div>
          <div style="position:absolute;top:0;left:0;width:22px;height:22px;border-top:3px solid #8EFF00;border-left:3px solid #8EFF00;border-radius:3px 0 0 0;"></div>
          <div style="position:absolute;top:0;right:0;width:22px;height:22px;border-top:3px solid #8EFF00;border-right:3px solid #8EFF00;border-radius:0 3px 0 0;"></div>
          <div style="position:absolute;bottom:0;left:0;width:22px;height:22px;border-bottom:3px solid #8EFF00;border-left:3px solid #8EFF00;border-radius:0 0 0 3px;"></div>
          <div style="position:absolute;bottom:0;right:0;width:22px;height:22px;border-bottom:3px solid #8EFF00;border-right:3px solid #8EFF00;border-radius:0 0 3px 0;"></div>
        </div>
      </div>
    </div>
    <div style="padding:14px 16px;text-align:center;color:#8EFF00;font-size:0.85rem;font-weight:700;background:rgba(0,0,0,0.9);border-top:1px solid rgba(255,255,255,0.08);">
      🔍 Aponte a câmera e centralize o código de barras
    </div>
  `;

  if (!document.getElementById('searchScanStyle')) {
    const st = document.createElement('style');
    st.id = 'searchScanStyle';
    st.textContent = '@keyframes laserScan { 0% { top:10%;opacity:0.7; } 50% { top:90%;opacity:1; } 100% { top:10%;opacity:0.7; } }';
    document.head.appendChild(st);
  }

  document.body.appendChild(overlay);
  _directScannerActive = true;

  let stream = null;
  let animFrame = null;
  let resolved = false;

  function closeSearchScanner() {
    _directScannerActive = false;
    resolved = true;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (_directHtml5) {
      _directHtml5.stop().catch(() => { });
      try { _directHtml5.clear(); } catch (e) { }
      _directHtml5 = null;
    }
    _forceStopCameraTracks();
    overlay.remove();
  }

  document.getElementById('closeSearchScan').addEventListener('click', closeSearchScanner);

  async function handleScannedCode(rawCode) {
    if (resolved) return;
    resolved = true;
    closeSearchScanner();
    if (navigator.vibrate) navigator.vibrate([180]);
    playScanSound();

    const code = String(rawCode).trim();

    // Garante que a página ativa seja 'products'
    if (typeof navigate === 'function') {
      navigate('products');
    }

    // Obtém apenas os produtos da loja/local atualmente selecionada no seletor do topo
    const storeProducts = Store.getProducts ? Store.getProducts() : Store.getAllProducts();
    const found = storeProducts.find(p =>
      (p.code && p.code.trim() === code) ||
      (p.ean && String(p.ean).trim() === code)
    );

    if (found) {
      const settings = Store.getSettings ? Store.getSettings() : {};
      const d = daysUntil(found.expDate);
      const prodStatus = getStatus(d, settings); // 'ok', 'warn', ou 'expired'

      // Preenche a barra de busca com o código do produto
      const searchInput = document.getElementById('productSearch');
      if (searchInput) searchInput.value = code;

      // Ativa visualmente a aba/filtro correspondente ao status (ok, warn ou expired)
      document.querySelectorAll('[data-filter]').forEach(b => {
        if (b.dataset.filter === prodStatus || b.dataset.filter === 'all') {
          b.classList.toggle('active', b.dataset.filter === prodStatus);
        } else {
          b.classList.remove('active');
        }
      });

      // Renderiza a lista na aba do status do produto
      window._prodPage = 1;
      renderProducts(prodStatus);

      // Scroll suave até o grid de produtos
      const grid = document.getElementById('productsGrid');
      if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Abre a ficha/modal completo do produto
      showToast('Produto encontrado: ' + found.name, 'check', 2500);
      setTimeout(() => {
        openEditModal(found.id);
      }, 350);
    } else {
      // Produto não cadastrado nesta loja: abre formulário de cadastro já com o código preenchido
      openAddModal(code);
      showToast('Produto não encontrado nesta loja. Preencha os dados.', 'info', 3500);
    }
  }

  // Motor 1: BarcodeDetector nativo (Google ML no Chrome/Android)
  if ('BarcodeDetector' in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats().catch(() =>
        ['ean_13', 'ean_8', 'code_128', 'code_39', 'itf', 'upc_a', 'upc_e', 'qr_code', 'pdf417', 'aztec']
      );
      const detector = new BarcodeDetector({ formats });

      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      const video = document.getElementById('searchScanVideo');
      video.srcObject = stream;
      await video.play();

      let lastTs = 0;
      async function tickML(ts) {
        if (resolved) return;
        if (ts - lastTs > 60) {  // 60ms = ~16fps, suficiente para ML rapido
          lastTs = ts;
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
              await handleScannedCode(barcodes[0].rawValue);
              return;
            }
          } catch (e) { }
        }
        animFrame = requestAnimationFrame(tickML);
      }
      animFrame = requestAnimationFrame(tickML);
      return;
    } catch (e) {
      if (resolved) return;
      stream = null;
    }
  }

  // Motor 2: Fallback Html5Qrcode (ZXing)
  if (typeof Html5Qrcode === 'undefined') {
    closeSearchScanner();
    showToast('Camera nao disponivel neste navegador.', 'warn', 4000);
    return;
  }

  const viewport = document.getElementById('searchScanViewport');
  viewport.innerHTML = '<div id="directScanFrameDiv" style="width:100%;height:100%;"></div>';

  try {
    _directHtml5 = new Html5Qrcode('directScanFrameDiv', {
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    });
    await _directHtml5.start(
      { facingMode: 'environment' },
      {
        fps: 30,
        disableFlip: false,
        qrbox: (w, h) => ({ width: Math.max(Math.floor(w * 0.85), 280), height: Math.max(Math.floor(h * 0.28), 100) }),
        experimentalFeatures: { useBarCodeDetectorIfSupported: true, willReadFrequently: true },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.ITF, Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.QR_CODE
        ]
      },
      async (code) => { if (!resolved) await handleScannedCode(code); },
      () => { }
    );
  } catch (e) {
    if (!resolved) {
      closeSearchScanner();
      showToast('Camera bloqueada. Permita o acesso a camera.', 'warn', 4000);
    }
  }
}

// ── AÇÕES RÁPIDAS: Adicionar Produto com Scanner ──────────────────────────────
async function openQuickActionAddProduct() {
  if (_directScannerActive) return;

  const overlay = document.createElement('div');
  overlay.id = 'qaAddScanOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:#000;display:flex;flex-direction:column;';

  const safeTop = `var(--safe-top, 0px)`;
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:calc(${safeTop} + 10px) 16px 12px 16px;background:rgba(0,0,0,0.95);border-bottom:1px solid rgba(142,255,0,0.35);box-sizing:border-box;">
      <span style="color:var(--primary,#8EFF00);font-size:1rem;font-weight:800;display:flex;align-items:center;gap:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary,#8EFF00)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Escanear para Adicionar Produto
      </span>
      <button id="closeQaScan" style="background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:1.4rem;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
    <div id="qaScanViewport" style="flex:1;position:relative;overflow:hidden;background:#000;">
      <video id="qaScanVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;display:block;"></video>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
        <div style="position:relative;width:78%;max-width:340px;height:28%;min-height:80px;">
          <div id="qaScanLaser" style="position:absolute;left:0;right:0;top:50%;height:2px;background:linear-gradient(90deg,transparent 0%,var(--primary,#8EFF00) 30%,#00e5ff 70%,transparent 100%);box-shadow:0 0 10px var(--primary,#8EFF00),0 0 20px #00e5ff;animation:laserScan 1.6s ease-in-out infinite;"></div>
          <div style="position:absolute;top:0;left:0;width:22px;height:22px;border-top:3px solid var(--primary,#8EFF00);border-left:3px solid var(--primary,#8EFF00);border-radius:3px 0 0 0;"></div>
          <div style="position:absolute;top:0;right:0;width:22px;height:22px;border-top:3px solid var(--primary,#8EFF00);border-right:3px solid var(--primary,#8EFF00);border-radius:0 3px 0 0;"></div>
          <div style="position:absolute;bottom:0;left:0;width:22px;height:22px;border-bottom:3px solid var(--primary,#8EFF00);border-left:3px solid var(--primary,#8EFF00);border-radius:0 0 0 3px;"></div>
          <div style="position:absolute;bottom:0;right:0;width:22px;height:22px;border-bottom:3px solid var(--primary,#8EFF00);border-right:3px solid var(--primary,#8EFF00);border-radius:0 0 3px 0;"></div>
        </div>
      </div>
    </div>
    <div style="padding:14px 16px;text-align:center;color:var(--primary,#8EFF00);font-size:0.85rem;font-weight:700;background:rgba(0,0,0,0.9);border-top:1px solid rgba(255,255,255,0.08);">
      📦 Aponte para o código de barras do produto
    </div>
  `;

  if (!document.getElementById('searchScanStyle')) {
    const st = document.createElement('style');
    st.id = 'searchScanStyle';
    st.textContent = '@keyframes laserScan { 0% { top:10%;opacity:0.7; } 50% { top:90%;opacity:1; } 100% { top:10%;opacity:0.7; } }';
    document.head.appendChild(st);
  }

  document.body.appendChild(overlay);
  _directScannerActive = true;

  let stream = null;
  let animFrame = null;
  let resolved = false;

  function closeQaScanner() {
    _directScannerActive = false;
    resolved = true;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (_directHtml5) {
      _directHtml5.stop().catch(() => {});
      try { _directHtml5.clear(); } catch (e) {}
      _directHtml5 = null;
    }
    _forceStopCameraTracks();
    overlay.remove();
  }

  document.getElementById('closeQaScan').addEventListener('click', closeQaScanner);

  async function handleQaScannedCode(rawCode) {
    if (resolved) return;
    resolved = true;
    closeQaScanner();
    if (navigator.vibrate) navigator.vibrate([180]);

    const code = String(rawCode).trim();

    // Verifica na loja atualmente selecionada
    const currentLoc = document.getElementById('globalLocationFilter')?.value;
    const storeFilter = (currentLoc && currentLoc !== 'all') ? currentLoc : '';
    const allProducts = Store.getAllProducts ? Store.getAllProducts() : [];
    const found = allProducts.find(p =>
      (p.code && String(p.code).trim() === code || p.ean && String(p.ean).trim() === code) &&
      (!storeFilter || !p.location || p.location === storeFilter)
    );

    if (found) {
      showToast('Produto já cadastrado! Abrindo...', 'info', 2500);
      setTimeout(() => openEditModal(found.id), 300);
    } else {
      showToast('Produto não encontrado. Preencha os dados para cadastrar.', 'info', 3500);
      setTimeout(() => openAddModal(code), 200);
    }
  }

  // Motor 1: BarcodeDetector nativo
  if ('BarcodeDetector' in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats().catch(() =>
        ['ean_13', 'ean_8', 'code_128', 'code_39', 'itf', 'upc_a', 'upc_e', 'qr_code']
      );
      const detector = new BarcodeDetector({ formats });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      const video = document.getElementById('qaScanVideo');
      video.srcObject = stream;
      await video.play();
      let lastTs = 0;
      async function tickQA(ts) {
        if (resolved) return;
        if (ts - lastTs > 60) {
          lastTs = ts;
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) { await handleQaScannedCode(barcodes[0].rawValue); return; }
          } catch (e) {}
        }
        animFrame = requestAnimationFrame(tickQA);
      }
      animFrame = requestAnimationFrame(tickQA);
      return;
    } catch (e) { if (resolved) return; stream = null; }
  }

  // Motor 2: Fallback Html5Qrcode
  if (typeof Html5Qrcode === 'undefined') {
    closeQaScanner();
    showToast('Câmera não disponível neste navegador.', 'warn', 4000);
    return;
  }
  const viewport = document.getElementById('qaScanViewport');
  viewport.innerHTML = '<div id="qaScanFrameDiv" style="width:100%;height:100%;"></div>';
  try {
    _directHtml5 = new Html5Qrcode('qaScanFrameDiv', { experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    await _directHtml5.start(
      { facingMode: 'environment' },
      {
        fps: 30, disableFlip: false,
        qrbox: (w, h) => ({ width: Math.max(Math.floor(w * 0.85), 280), height: Math.max(Math.floor(h * 0.28), 100) }),
        experimentalFeatures: { useBarCodeDetectorIfSupported: true, willReadFrequently: true },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.ITF, Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.QR_CODE
        ]
      },
      async (code) => { if (!resolved) await handleQaScannedCode(code); },
      () => {}
    );
  } catch (e) {
    if (!resolved) {
      closeQaScanner();
      showToast('Câmera bloqueada. Permita o acesso à câmera.', 'warn', 4000);
    }
  }
}

function stopScanner() {
  scannerActive = false;
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      html5QrCode = null;
      _forceStopCameraTracks();
      const c = document.getElementById('scannerFrameDiv');
      if (c) c.innerHTML = '';
    }).catch(e => {
      console.warn(e);
      try { html5QrCode.clear(); } catch (_) { }
      html5QrCode = null;
      _forceStopCameraTracks();
      const c = document.getElementById('scannerFrameDiv');
      if (c) c.innerHTML = '';
    });
  } else {
    _forceStopCameraTracks();
  }
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  if (startBtn) startBtn.style.display = '';
  if (stopBtn) stopBtn.style.display = 'none';
}

let inlineScannerActive = false;
let _inlineGoogleDetector = null;
let _inlineStreamTrack = null;

async function startInlineScanner() {
  const container = document.getElementById('inlineScannerContainer');
  container.style.display = 'block';
  inlineScannerActive = true;

  const targetDiv = document.querySelector('#inlineScannerDiv');

  // Tentativa 1: Usar o Google BarcodeDetector nativo (ML Kit Web) se suportado no navegador (ex: Chrome Android)
  if ('BarcodeDetector' in window) {
    try {
      const supportedFormats = await BarcodeDetector.getSupportedFormats();
      _inlineGoogleDetector = new BarcodeDetector({
        formats: supportedFormats.length > 0 ? supportedFormats : ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'qr_code']
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      _inlineStreamTrack = stream.getVideoTracks()[0];

      let videoEl = targetDiv.querySelector('video');
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.setAttribute('autoplay', '');
        videoEl.setAttribute('playsinline', '');
        videoEl.style.width = '100%';
        videoEl.style.height = '100%';
        videoEl.style.objectFit = 'cover';
        targetDiv.innerHTML = '';
        targetDiv.appendChild(videoEl);
      }
      videoEl.srcObject = stream;
      await videoEl.play();

      const detectFrame = async () => {
        if (!inlineScannerActive) return;
        try {
          const barcodes = await _inlineGoogleDetector.detect(videoEl);
          if (barcodes && barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            if (code && !_isScanCooldown(code)) {
              inlineScannerActive = false;
              playScanSound();
              if (navigator.vibrate) navigator.vibrate([200]);

              document.getElementById('prodCode').value = code;
              document.getElementById('inlineScannerContainer').style.display = 'none';
              showToast('Código detectado: ' + code, '✅');
              document.getElementById('prodCode').dispatchEvent(new Event('input'));
              lookupAndFillProduct(code);
              stopInlineScanner();
              return;
            }
          }
        } catch (err) {
          console.warn('Erro frame Google BarcodeDetector:', err);
        }
        if (inlineScannerActive) {
          requestAnimationFrame(detectFrame);
        }
      };

      requestAnimationFrame(detectFrame);
      return;
    } catch (e) {
      console.warn('Google BarcodeDetector não pôde ser iniciado, usando fallback Quagga:', e);
    }
  }

  // Fallback: Quagga2
  if (typeof Quagga === 'undefined') {
    showToast('Biblioteca de scanner não carregada', '❌');
    return;
  }

  Quagga.init({
    inputStream: {
      name: "Live",
      type: "LiveStream",
      target: targetDiv,
      constraints: {
        facingMode: "environment",
        focusMode: "continuous"
      },
      area: {
        top: "15%",
        right: "5%",
        left: "5%",
        bottom: "15%"
      }
    },
    locator: {
      patchSize: "medium",
      halfSample: false
    },
    numOfWorkers: navigator.hardwareConcurrency || 4,
    frequency: 15,
    decoder: {
      readers: ["ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader", "code_128_reader"],
      multiple: false
    }
  }, function (err) {
    if (err) {
      console.error(err);
      showToast('Erro ao iniciar a câmera.', '❌');
      stopInlineScanner();
      return;
    }
    Quagga.start();
  });

  try { Quagga.offDetected(); } catch (e) { }

  Quagga.onDetected(function (result) {
    if (!inlineScannerActive) return;

    const code = result.codeResult.code;
    if (code) {
      if (_isScanCooldown(code)) return;
      inlineScannerActive = false;
      playScanSound();
      if (navigator.vibrate) navigator.vibrate([200]);

      document.getElementById('prodCode').value = code;
      document.getElementById('inlineScannerContainer').style.display = 'none';

      showToast('Código detectado: ' + code, '✅');
      document.getElementById('prodCode').dispatchEvent(new Event('input'));
      lookupAndFillProduct(code);

      setTimeout(() => {
        stopInlineScanner();
      }, 150);
    }
  });
}

function stopInlineScanner() {
  inlineScannerActive = false;
  document.getElementById('inlineScannerContainer').style.display = 'none';
  if (_inlineStreamTrack) {
    try { _inlineStreamTrack.stop(); } catch (e) { }
    _inlineStreamTrack = null;
  }
  _inlineGoogleDetector = null;
  try { Quagga.offDetected(); } catch (e) { }
  try { if (typeof Quagga !== 'undefined') Quagga.stop(); } catch (e) { }
}

// ── NOTIFICATIONS LOCAIS AGENDADAS (CAPACITOR ANDROID + WEB) ────────
async function requestAppNotificationPermission() {
  try {
    // 1. Tenta via Plugin Nativo do Capacitor (Android APK)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
      const { display } = await window.Capacitor.Plugins.LocalNotifications.requestPermissions();
      if (display === 'granted') {
        console.log('Permissão de notificação concedida via Capacitor!');
        return true;
      }
    }
    // 2. Fallback Web Notification API
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }
  } catch (e) {
    console.warn('Erro ao solicitar permissão de notificações:', e);
  }
  return false;
}

async function scheduleNotifications() {
  const settings = Store.getSettings();
  if (!settings.notifications) return;

  // Checagem de Horário Silencioso (Não Perturbe)
  if (settings.quietHoursEnabled) {
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = (settings.quietHoursStart || '22:00').split(':').map(Number);
    const [endH, endM] = (settings.quietHoursEnd || '07:00').split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    let inQuiet = false;
    if (startMin > endMin) { // Cruzando meia-noite (ex: 22:00 às 07:00)
      inQuiet = currentMin >= startMin || currentMin < endMin;
    } else {
      inQuiet = currentMin >= startMin && currentMin < endMin;
    }

    if (inQuiet) {
      console.log('Notificação suprimida: Horário Silencioso ativo.');
      return;
    }
  }

  const products = Store.getAllProducts();
  if (!products || !products.length) return;

  const getAlertDaysForProduct = (p) => {
    const catName = (p.category || '').toLowerCase();
    const prodName = (p.name || '').toLowerCase();
    if (catName.includes('higiene') || catName.includes('cosm') || catName.includes('beleza') || prodName.includes('shampoo') || prodName.includes('sabonete')) {
      return [30, 7];
    }
    if (catName.includes('limpeza') || prodName.includes('detergente') || prodName.includes('amaciante') || prodName.includes('desinfetante')) {
      return [15, 7];
    }
    if (catName.includes('açougue') || catName.includes('carne') || catName.includes('laticínio') || catName.includes('leite') || catName.includes('hortifrúti') || catName.includes('fruta') || catName.includes('frios') || catName.includes('padaria')) {
      return [3, 1, 0];
    }
    return [15, 7, 3, 1, 0];
  };

  // Consolidação de todos os produtos que requerem atenção
  const alertProducts = [];
  products.forEach(p => {
    const d = daysUntil(p.expDate);
    if (d === null) return;
    const thresholds = getAlertDaysForProduct(p);
    if (thresholds.includes(d) || (d <= (settings.warnDays || 7) && d >= 0) || d < 0) {
      alertProducts.push({ prod: p, days: d });
    }
  });

  if (!alertProducts.length) return;

  // Ordenar pelos mais urgentes (vencidos primeiro, depois os mais próximos)
  alertProducts.sort((a, b) => a.days - b.days);

  const totalCount = alertProducts.length;
  const expiredCount = alertProducts.filter(i => i.days < 0).length;
  const todayCount = alertProducts.filter(i => i.days === 0).length;
  const soonCount = alertProducts.filter(i => i.days > 0).length;

  let title = '⚠️ PrazoCerto: Alerta de Validades';
  let body = '';

  if (expiredCount > 0 && soonCount > 0) {
    title = `🚨 ${expiredCount} vencido(s) e ${soonCount} a vencer!`;
    const names = alertProducts.slice(0, 2).map(i => i.prod.name).join(', ');
    body = `Atenção: ${names}${totalCount > 2 ? ` e mais ${totalCount - 2} item(ns)` : ''}. Toque para revisar no app.`;
  } else if (expiredCount > 0) {
    title = expiredCount === 1 ? `🚨 1 produto vencido: ${alertProducts[0].prod.name}` : `🚨 Atenção: ${expiredCount} produtos vencidos!`;
    body = `Toque para verificar e dar baixa no estoque.`;
  } else if (todayCount > 0) {
    title = `⏰ ${todayCount} produto(s) vencendo hoje!`;
    const names = alertProducts.slice(0, 2).map(i => i.prod.name).join(', ');
    body = `Incluindo: ${names}. Toque para ver os detalhes.`;
  } else {
    title = totalCount === 1 ? `⚠️ ${alertProducts[0].prod.name} vence em ${alertProducts[0].days} dias!` : `⚠️ ${totalCount} produtos próximos do vencimento!`;
    const names = alertProducts.slice(0, 2).map(i => i.prod.name).join(', ');
    body = `Itens: ${names}${totalCount > 2 ? ` e outros` : ''}. Toque para organizar seu estoque.`;
  }

  // 1. Se estiver no Capacitor / Android APK nativo (Dispara 1 ÚNICA notificação com ID fixo)
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
    try {
      // Cancelar notificações anteriores para não acumular
      try {
        await window.Capacitor.Plugins.LocalNotifications.cancel({
          notifications: [{ id: 1 }]
        });
      } catch (ce) { }

      await window.Capacitor.Plugins.LocalNotifications.schedule({
        notifications: [
          {
            id: 1,
            title: title,
            body: body,
            smallIcon: 'ic_stat_notify',
            largeIcon: 'ic_launcher',
            iconColor: '#8EFF00',
            schedule: { at: new Date(Date.now() + 1000) }
          }
        ]
      });
      console.log('Notificação única consolidada disparada no Android com sucesso!');
      return;
    } catch (e) {
      console.warn('Erro ao agendar via Capacitor:', e);
    }
  }

  // 2. Web fallback (Service Worker / Notification API com tag fixa)
  if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, {
        body: body,
        icon: 'images/app_icon_calendar.png',
        badge: 'images/app_icon_calendar.png',
        vibrate: [200, 100, 200],
        tag: 'prazocerto-summary-alert',
        renotify: true,
        data: { totalCount: totalCount }
      });
    } catch (err) {
      console.warn("Erro ao enviar notificação web:", err);
    }
  }
}

// ── DOWNLOAD SEGURO EM ANDROID (PASTA DOWNLOADS) & WEB ──
async function downloadFileToDevice(blob, fileName, mimeType, textContent) {
  // 1. Android Nativo via Capacitor
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      const Filesystem = window.Capacitor.Plugins?.Filesystem;
      const Share = window.Capacitor.Plugins?.Share;

      // Converte para base64
      let base64Data = '';
      if (typeof textContent === 'string') {
        base64Data = btoa(unescape(encodeURIComponent(textContent)));
      } else {
        base64Data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = reader.result;
            resolve(res.includes(',') ? res.split(',')[1] : res);
          };
          reader.readAsDataURL(blob);
        });
      }

      let targetUri = null;

      if (Filesystem) {
        // Tenta salvar no Cache (sempre disponível, sem permissão especial)
        const dirs = ['CACHE', 'DATA'];
        for (const dir of dirs) {
          try {
            const res = await Filesystem.writeFile({
              path: `downloads/${fileName}`,
              data: base64Data,
              directory: dir,
              recursive: true
            });
            targetUri = res?.uri;
            if (targetUri) break;
          } catch (e) {
            console.warn(`Erro ao salvar em ${dir}:`, e);
          }
        }
      }

      if (Share && targetUri) {
        try {
          await Share.share({
            title: fileName,
            text: `Arquivo ${fileName} exportado com sucesso. Escolha onde salvar:`,
            url: targetUri,
            dialogTitle: `Salvar ${fileName}`
          });
          showToast(`Arquivo ${fileName} pronto! Escolha onde salvar.`, '💾', 4000);
          return;
        } catch (shareErr) {
          // Usuário cancelou o share - arquivo ainda existe no cache
          showToast(`Exportação cancelada. Arquivo: ${fileName}`, '💾', 3000);
          return;
        }
      }

      // Se não conseguiu Share, tenta fallback Downloads/Documents
      if (Filesystem) {
        for (const [dir, label] of [['DOWNLOADS', 'Downloads'], ['DOCUMENTS', 'Documentos']]) {
          try {
            const res = await Filesystem.writeFile({
              path: fileName,
              data: base64Data,
              directory: dir,
              recursive: true
            });
            if (res?.uri) {
              showToast(`Arquivo salvo em ${label}: ${fileName}`, '💾', 4000);
              return;
            }
          } catch (e) { /* tenta o próximo */ }
        }
      }

    } catch (fsErr) {
      console.warn('Capacitor download falhou, usando fallback:', fsErr);
    }
  }

  // 2. Navegador / WebView - download direto
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 400);
  showToast(`Download de ${fileName} iniciado!`, '💾', 4000);
}

// ── EXPORT / IMPORT ──────────────────────────────
async function exportData() {
  const products = Store.getAllProducts() || [];
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    products: products,
    stores: Store.getStores() || [],
    categories: Store.getCategories(),
    settings: Store.getSettings(),
  };
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const fileName = `prazocerto-backup-${today()}.json`;

  await downloadFileToDevice(blob, fileName, 'application/json', jsonStr);
  showToast(`${products.length} itens salvos em ${fileName}`, '⬇', 4000);
}

async function exportCSV() {
  const products = Store.getAllProducts() || [];
  const cats = Store.getCategories();
  if (!products.length) { showToast('Nenhum produto para exportar', 'ℹ️'); return; }
  const header = ['Nome', 'Código', 'Categoria', 'Data Fabricação', 'Data Validade', 'Dias Restantes', 'Quantidade', 'Localização', 'Observações', 'Status'];
  const settings = Store.getSettings();
  const rows = products.map(p => {
    const cat = cats.find(c => c.id === p.category);
    const days = daysUntil(p.expDate);
    const s = getStatus(days, settings);
    const statusMap = { ok: 'Na Validade', warn: 'Atenção', expired: 'Vencido' };
    return [
      p.name, p.code || '', cat ? cat.name : '', p.mfgDate || '', p.expDate || '',
      days !== null ? days : '', p.qty || 1, p.location || '', p.notes || '', statusMap[s] || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const csv = [header.join(','), ...rows].join('\n');
  const BOM = '\uFEFF'; // UTF-8 BOM para Excel
  const fullCsv = BOM + csv;
  const blob = new Blob([fullCsv], { type: 'text/csv;charset=utf-8;' });
  const fileName = `prazocerto-${today()}.csv`;

  await downloadFileToDevice(blob, fileName, 'text/csv', fullCsv);
  showToast(`${products.length} produto(s) exportados (${fileName})`, '📊', 4000);
}

function importExcel(file) {
  if (!window.XLSX) { showToast('Biblioteca Excel não carregada', '❌'); return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      let headerIdx = -1;
      let headers = [];

      // Procura a linha que contém o cabeçalho "NOME" ou "PRODUTO"
      for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
        const row = rawRows[i];
        if (!row) continue;
        const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
        if (rowStr.includes('nome') || rowStr.includes('produto') || rowStr.includes('descri')) {
          headerIdx = i;
          headers = row.map(c => String(c).trim());
          break;
        }
      }

      if (headerIdx === -1) { showToast('Planilha sem cabeçalhos válidos', '⚠️'); return; }

      // Converte as linhas abaixo do cabeçalho em objetos
      const rows = [];
      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || r.length === 0) continue;
        const obj = {};
        let hasData = false;
        headers.forEach((h, j) => {
          if (h && r[j] !== '') { obj[h] = r[j]; hasData = true; }
        });
        if (hasData) rows.push(obj);
      }

      if (!rows.length) { showToast('Planilha vazia ou sem dados válidos', '⚠️'); return; }

      // Auto-detect columns (case-insensitive)
      const keyMap = (row) => {
        const mapped = {};
        Object.entries(row).forEach(([k, v]) => {
          if (v === '' || v === undefined) return;
          const kl = k.toLowerCase();
          if (kl.includes('nome') || kl.includes('produto') || kl.includes('descri')) mapped.name = String(v);
          else if (kl.includes('codigo') || kl.includes('código') || kl.includes('ean') || kl.includes('barras')) mapped.code = String(v);
          else if ((kl.includes('validade') || kl.includes('fim prazo') || kl.includes('vencimento') || kl.includes('venc') || kl.includes('valid')) && !kl.includes('fab')) mapped.expDate = v;
          else if (kl.includes('fabri') || kl.includes('mfg') || kl.includes('lote')) mapped.mfgDate = v;
          else if (kl.includes('qtd') || kl.includes('quant')) mapped.qty = parseInt(v) || 1;
          else if (kl.includes('local') || kl.includes('pratel') || kl.includes('loja') || kl.includes('setor')) mapped.location = String(v);
          else if (kl.includes('obs') || kl.includes('nota')) mapped.notes = String(v);
        });
        return mapped;
      };

      const formatExcelDate = (v) => {
        if (!v) return '';
        if (v instanceof Date) return v.toISOString().split('T')[0];
        if (typeof v === 'string') {
          // Explicitly check for dd/mm/yyyy or dd/mm/yy first
          if (v.includes('/')) {
            const parts = v.split('/');
            if (parts.length === 3) {
              const [d2, m, y] = parts;
              return `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d2.padStart(2, '0')}`;
            }
          }
          const d = new Date(v);
          if (!isNaN(d)) return d.toISOString().split('T')[0];
        }
        if (typeof v === 'number') {
          const date = XLSX.SSF.parse_date_code(v);
          if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        }
        return '';
      };

      const cats = Store.getCategories();
      const newProducts = rows.map(row => {
        const m = keyMap(row);
        if (!m.name) return null;
        let catId = '';
        if (m.category) {
          const matched = cats.find(c => c.name.toLowerCase() === String(m.category).toLowerCase());
          if (matched) catId = matched.id;
        }
        if (!catId) catId = getAutoCategory(m.name);

        return {
          id: uid(),
          name: m.name.trim(),
          code: m.code || '',
          expDate: formatExcelDate(m.expDate),
          mfgDate: formatExcelDate(m.mfgDate),
          qty: m.qty || 1,
          location: m.location || '',
          notes: m.notes || '',
          category: catId,
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }).filter(Boolean);

      if (!newProducts.length) { showToast('Nenhum produto válido encontrado na planilha', '⚠️'); return; }

      if (!await confirm('Importar Excel', `Encontrei ${newProducts.length} produto(s). Adicionar ao estoque existente?`)) return;

      const existing = Store.getAllProducts();
      // Extrai e adiciona novas lojas registradas na planilha
      const excelStores = newProducts.map(p => p.location ? p.location.trim() : '').filter(Boolean);
      if (excelStores.length > 0) {
        const currentStores = Store.getStores();
        const mergedStores = Array.from(new Set([...currentStores, ...excelStores]));
        Store.setStores(mergedStores);
      }
      Store.setProducts([...newProducts, ...existing]);
      renderDashboard();
      renderProducts();
      updateBadges();
      showToast(`${newProducts.length} produto(s) importados do Excel`, '📗');
    } catch (err) {
      console.error(err);
      showToast('Erro ao ler Excel: ' + err.message, '❌');
    }
  };
  reader.readAsArrayBuffer(file);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || (!data.products && !Array.isArray(data))) throw new Error('Arquivo inválido');
      const productsToImport = Array.isArray(data) ? data : data.products;
      if (!await confirm('Importar dados', `Encontrados ${productsToImport.length} produtos no arquivo. Substituir estoque atual e restaurar?`)) return;

      if (data.stores && Array.isArray(data.stores) && data.stores.length > 0) {
        Store.setStores(data.stores);
      }
      if (data.categories) Store.setCategories(data.categories);
      if (data.settings) Store.setSettings(data.settings);
      Store.setProducts(productsToImport);

      if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
      if (typeof populateStoreSelect === 'function') populateStoreSelect();
      renderDashboard();
      renderProducts();
      updateBadges();
      showToast(`${productsToImport.length} produto(s) importados com sucesso!`, '⬆', 4000);
    } catch (err) {
      console.error('Erro ao importar JSON:', err);
      showToast('Erro ao importar: arquivo JSON inválido ou corrompido.', '❌', 4500);
    }
  };
  reader.readAsText(file);
}

// ── SETTINGS MODERNO ─────────────────────────────
function toggleSettingsAccordion(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const isOpen = card.classList.contains('open');
  card.classList.toggle('open', !isOpen);
  // Renderiza a lista de sons ao abrir o card de sons
  if (cardId === 'setCard-sons' && !isOpen) {
    renderSoundList();
  }
}

function loadSettings() {
  const s = Store.getSettings();
  const warnEl = document.getElementById('warnDays');
  const critEl = document.getElementById('critDays');
  const notifEl = document.getElementById('notifToggle');
  const notifMobileEl = document.getElementById('notifMobileToggle');
  const notifWpEl = document.getElementById('notifWpToggle');
  const dailyTimeEl = document.getElementById('notifDailyTime');
  const quietToggleEl = document.getElementById('quietHoursToggle');
  const quietStartEl = document.getElementById('quietHoursStart');
  const quietEndEl = document.getElementById('quietHoursEnd');
  const themeEl = document.getElementById('themeSelect');
  const animEl = document.getElementById('animToggle');
  const primaryEl = document.getElementById('primaryColorSelect');
  const wpNumEl = document.getElementById('setWpNumber');

  if (warnEl) warnEl.value = s.warnDays ?? 7;
  if (critEl) critEl.value = s.critDays ?? 3;
  if (notifEl) notifEl.checked = s.notifications ?? true;
  if (notifMobileEl) notifMobileEl.checked = s.notifMobile ?? true;
  if (notifWpEl) notifWpEl.checked = s.notifWhatsApp ?? true;
  if (dailyTimeEl) dailyTimeEl.value = s.notifDailyTime || '08:00';
  if (quietToggleEl) quietToggleEl.checked = s.quietHoursEnabled ?? true;
  if (quietStartEl) quietStartEl.value = s.quietHoursStart || '22:00';
  if (quietEndEl) quietEndEl.value = s.quietHoursEnd || '07:00';
  if (themeEl) themeEl.value = s.theme ?? 'dark';
  if (animEl) animEl.checked = s.animations ?? true;
  if (primaryEl) primaryEl.value = s.primaryColor ?? 'lime';
  if (wpNumEl && s.whatsappNumber) wpNumEl.value = s.whatsappNumber;
  const wpDailyToggle = document.getElementById('setWpDailyToggle');
  const wpDailyTime = document.getElementById('setWpDailyTime');
  if (wpDailyToggle) wpDailyToggle.checked = s.notifWpDaily ?? true;
  if (wpDailyTime) wpDailyTime.value = s.notifWpDailyTime || '08:00';
  const wpDailyDesc = document.getElementById('wpDailyDesc');
  if (wpDailyDesc) wpDailyDesc.textContent = `Enviar lista de vencimentos às ${s.notifWpDailyTime || '08:00'}`;

  // Biometria: carrega estado salvo e verifica disponibilidade do dispositivo
  const bioToggle = document.getElementById('biometricToggle');
  const bioDesc = document.getElementById('biometricDesc');
  const bioEnabled = s.biometricEnabled ?? false;
  const bioRegistered = localStorage.getItem('prazocerto_biometric_registered') === '1';
  if (bioToggle) bioToggle.checked = bioEnabled && bioRegistered;
  if (bioDesc) {
    if (bioEnabled && bioRegistered) {
      bioDesc.textContent = '✅ Biometria ativa — acesso rápido habilitado';
    } else {
      bioDesc.textContent = 'Acesso rápido e protegido';
    }
  }
  if (typeof checkBiometricHardwareSupport === 'function') {
    checkBiometricHardwareSupport();
  }

  // Som do scanner
  const soundNameEl = document.getElementById('currentSoundName');
  if (soundNameEl) soundNameEl.textContent = s.scanSound || 'Som 01';
  const scanSoundToggle = document.getElementById('scanSoundToggle');
  if (scanSoundToggle) scanSoundToggle.checked = !(s.scanSoundMuted ?? false);

  const count = Store.getProducts().length;
  const setStoreCount = document.getElementById('setStoreCount');
  if (setStoreCount) setStoreCount.textContent = count;

  applyTheme(s.theme, s.primaryColor);
  applyAnimations(s.animations ?? true);
  applyNeonIntensity(s.neonIntensity ?? 85);
  // Restaurar valor do slider
  const neonSlider = document.getElementById('neonIntensity');
  if (neonSlider) neonSlider.value = s.neonIntensity ?? 85;
}

function applyTheme(theme, primaryColor) {
  // Limpa classes de estrutura
  document.body.classList.remove('theme-darker', 'theme-light');

  // Limpa classes antigas de cores de destaque
  const colorThemes = ['purple', 'green', 'red', 'cyan',
    'orange', 'pink', 'gold', 'lime', 'teal', 'blue', 'magenta',
    'indigo', 'rose', 'amber', 'mint', 'coral', 'silver'
  ];
  colorThemes.forEach(c => document.body.classList.remove(`theme-${c}`));

  // 1. Tema de ESTRUTURA (somente dark, darker ou light)
  if (theme === 'darker') {
    document.body.classList.add('theme-darker');
  } else if (theme === 'light') {
    document.body.classList.add('theme-light');
  } // Se for 'dark' (padrão), usa a estrutura padrão escura sem classe extra

  // 2. Cor de DESTAQUE (botões, brilhos, contornos, detalhes)
  const activeColor = primaryColor || 'lime';
  if (colorThemes.includes(activeColor)) {
    document.body.classList.add(`theme-${activeColor}`);
  }

  // Mapa de cores neon dinâmicas
  const neonPalettes = {
    green:   { primary: '#76C41B', secondary: '#86D926', dim: 'rgba(118,196,27,0.18)',  glow: 'rgba(118,196,27,0.45)' },
    red:     { primary: '#FF1744', secondary: '#FF5252', dim: 'rgba(255,23,68,0.18)',   glow: 'rgba(255,23,68,0.45)' },
    cyan:    { primary: '#00E5FF', secondary: '#00B0FF', dim: 'rgba(0,229,255,0.18)',   glow: 'rgba(0,229,255,0.45)' },
    purple:  { primary: '#A78BFA', secondary: '#EC4899', dim: 'rgba(167,139,250,0.18)',glow: 'rgba(167,139,250,0.45)' },
    orange:  { primary: '#FF6D00', secondary: '#FF9100', dim: 'rgba(255,109,0,0.18)',  glow: 'rgba(255,109,0,0.45)' },
    pink:    { primary: '#FF007F', secondary: '#FF4081', dim: 'rgba(255,0,127,0.18)',  glow: 'rgba(255,0,127,0.45)' },
    gold:    { primary: '#FFD700', secondary: '#FFAB00', dim: 'rgba(255,215,0,0.18)',  glow: 'rgba(255,215,0,0.45)' },
    lime:    { primary: '#AEEA00', secondary: '#C6FF00', dim: 'rgba(174,234,0,0.18)',  glow: 'rgba(174,234,0,0.45)' },
    teal:    { primary: '#1DE9B6', secondary: '#00BFA5', dim: 'rgba(29,233,182,0.18)', glow: 'rgba(29,233,182,0.45)' },
    blue:    { primary: '#2979FF', secondary: '#448AFF', dim: 'rgba(41,121,255,0.18)', glow: 'rgba(41,121,255,0.45)' },
    magenta: { primary: '#E040FB', secondary: '#EA80FC', dim: 'rgba(224,64,251,0.18)', glow: 'rgba(224,64,251,0.45)' },
    indigo:  { primary: '#7C4DFF', secondary: '#B388FF', dim: 'rgba(124,77,255,0.18)', glow: 'rgba(124,77,255,0.45)' },
    rose:    { primary: '#FF4081', secondary: '#FF80AB', dim: 'rgba(255,64,129,0.18)', glow: 'rgba(255,64,129,0.45)' },
    amber:   { primary: '#FFB300', secondary: '#FFCA28', dim: 'rgba(255,179,0,0.18)',  glow: 'rgba(255,179,0,0.45)' },
    mint:    { primary: '#00E676', secondary: '#69F0AE', dim: 'rgba(0,230,118,0.18)',  glow: 'rgba(0,230,118,0.45)' },
    coral:   { primary: '#FF6E40', secondary: '#FFAB40', dim: 'rgba(255,110,64,0.18)', glow: 'rgba(255,110,64,0.45)' },
    silver:  { primary: '#B0BEC5', secondary: '#CFD8DC', dim: 'rgba(176,190,197,0.18)',glow: 'rgba(176,190,197,0.35)' },
  };

  const selectedNeon = neonPalettes[activeColor] || neonPalettes.green;
  const root = document.documentElement;
  root.style.setProperty('--primary', selectedNeon.primary);
  root.style.setProperty('--primary-dim', selectedNeon.dim);
  root.style.setProperty('--secondary', selectedNeon.secondary);
  root.style.setProperty('--border-hover', selectedNeon.glow);
  root.style.setProperty('--shadow-glow', `0 0 30px ${selectedNeon.glow}`);
  root.style.setProperty('--gradient-main', `linear-gradient(135deg, ${selectedNeon.primary} 0%, ${selectedNeon.secondary} 100%)`);

  // Atualiza saudação para renderizar com a nova cor se estiver no DOM
  const greetEl = document.getElementById('greetingText');
  if (greetEl && typeof greeting === 'function') {
    greetEl.innerHTML = greeting();
  }

  // Aplica cor diretamente via JS nos elementos que resistem ao CSS (avatar e casinha)
  const p = selectedNeon.primary;
  const dim = selectedNeon.dim;

  // Círculo (borda) ao redor da foto do usuário
  const avatar = document.querySelector('.topbar-user-avatar');
  if (avatar) {
    avatar.style.setProperty('border', `1.5px solid ${p}`, 'important');
    avatar.style.setProperty('box-shadow', `0 0 12px ${dim}`, 'important');
  }
  // Bolinha de status no canto do avatar (::after não é acessível via JS, então usamos pseudo-elemento via stylesheet injetada)
  let avatarAfterStyle = document.getElementById('_avatarAfterStyle');
  if (!avatarAfterStyle) {
    avatarAfterStyle = document.createElement('style');
    avatarAfterStyle.id = '_avatarAfterStyle';
    document.head.appendChild(avatarAfterStyle);
  }
  avatarAfterStyle.textContent = `.topbar-user-avatar::after { background: ${p} !important; box-shadow: 0 0 6px ${p} !important; }`;

  // Casinha (ícone SVG) do seletor de lojas
  const storeIcon = document.querySelector('.topbar-store-icon');
  if (storeIcon) {
    storeIcon.style.setProperty('color', p, 'important');
    const svg = storeIcon.querySelector('svg');
    if (svg) svg.style.setProperty('stroke', p, 'important');
  }

  // Estilização dinâmica direta dos botões de Etiquetas com a cor do tema
  const btnEtiqScan = document.getElementById('btnEtiquetasComecarEscanear');
  if (btnEtiqScan) {
    btnEtiqScan.style.setProperty('background', p, 'important');
    btnEtiqScan.style.setProperty('color', '#090D14', 'important');
    btnEtiqScan.style.setProperty('border-color', p, 'important');
    btnEtiqScan.style.setProperty('box-shadow', `0 4px 18px ${dim}, 0 0 10px ${p}`, 'important');
    const svg = btnEtiqScan.querySelector('svg');
    if (svg) svg.style.setProperty('stroke', '#090D14', 'important');
  }

  // Folha de estilo dinâmica para componentes de Etiquetas
  let etiqStyle = document.getElementById('_etiqThemeStyle');
  if (!etiqStyle) {
    etiqStyle = document.createElement('style');
    etiqStyle.id = '_etiqThemeStyle';
    document.head.appendChild(etiqStyle);
  }
  etiqStyle.textContent = `
    #btnEtiquetasComecarEscanear,
    #etiquetasIntroModal .btn-primary,
    #etiquetasListModal .btn-primary {
      background: ${p} !important;
      color: #090D14 !important;
      border-color: ${p} !important;
      box-shadow: 0 4px 18px ${dim}, 0 0 10px ${p} !important;
    }
    #btnEtiquetasComecarEscanear svg,
    #etiquetasIntroModal .btn-primary svg,
    #etiquetasListModal .btn-primary svg {
      stroke: #090D14 !important;
    }
    #etiquetasIntroModal .modal {
      border-color: ${dim} !important;
    }
    #etiquetasIntroModal .modal-header svg {
      stroke: ${p} !important;
    }
    #etiquetasListModal #etiquetasCountBadge {
      color: ${p} !important;
    }
  `;
}

function saveSettings() {
  saveModernSettings();
}

function saveModernSettings() {
  const wpDailyTimeVal = document.getElementById('setWpDailyTime')?.value || '08:00';
  const prevSettings = Store.getSettings();
  const neonVal = parseInt(document.getElementById('neonIntensity')?.value) || 85;
  const s = {
    warnDays: parseInt(document.getElementById('warnDays')?.value) || 7,
    critDays: parseInt(document.getElementById('critDays')?.value) || 3,
    notifications: document.getElementById('notifToggle')?.checked ?? true,
    notifMobile: document.getElementById('notifMobileToggle')?.checked ?? true,
    notifWhatsApp: document.getElementById('notifWpToggle')?.checked ?? true,
    notifDailyTime: document.getElementById('notifDailyTime')?.value || '08:00',
    quietHoursEnabled: document.getElementById('quietHoursToggle')?.checked ?? true,
    quietHoursStart: document.getElementById('quietHoursStart')?.value || '22:00',
    quietHoursEnd: document.getElementById('quietHoursEnd')?.value || '07:00',
    theme: document.getElementById('themeSelect')?.value || 'dark',
    primaryColor: document.getElementById('primaryColorSelect')?.value || 'green',
    animations: document.getElementById('animToggle')?.checked ?? true,
    neonIntensity: neonVal,
    whatsappNumber: document.getElementById('setWpNumber')?.value || '',
    notifWpDaily: document.getElementById('setWpDailyToggle')?.checked ?? true,
    notifWpDailyTime: wpDailyTimeVal,
    biometricEnabled: document.getElementById('biometricToggle')?.checked ?? false,
    scanSound: prevSettings.scanSound || 'Som 01',
    scanSoundMuted: document.getElementById('scanSoundToggle') ? !document.getElementById('scanSoundToggle').checked : (prevSettings.scanSoundMuted ?? false),
  };
  const wpDescEl = document.getElementById('wpDailyDesc');
  if (wpDescEl) wpDescEl.textContent = `Enviar lista de vencimentos às ${wpDailyTimeVal}`;

  Store.setSettings(s);
  applyTheme(s.theme, s.primaryColor);
  applyAnimations(s.animations);
  applyNeonIntensity(neonVal);
  showToast('Configurações atualizadas', '✅');
  if (typeof refreshWhatsAppScheduler === 'function') refreshWhatsAppScheduler();
}

// Aplica/remove animacoes globalmente
function applyAnimations(enabled) {
  if (enabled === false || enabled === 'false') {
    document.body.classList.add('no-animations');
    document.body.classList.remove('animations-enabled');
  } else {
    document.body.classList.remove('no-animations');
    document.body.classList.add('animations-enabled');
  }
}
window.applyAnimations = applyAnimations;

// Aplica intensidade do neon como variavel CSS - afeta TODOS os cards automaticamente
function applyNeonIntensity(val) {
  var v = Math.max(1, Math.min(100, parseInt(val) || 85));
  // --neon-alpha: 1% = 0.01 ... 100% = 0.85 (cap para nao ficar excessivo)
  var alpha = ((v / 100) * 0.85).toFixed(3);
  // --neon-spread: 1% = 4px ... 100% = 40px
  var spread = Math.round(4 + (v / 100) * 36) + 'px';
  document.documentElement.style.setProperty('--neon-alpha', alpha);
  document.documentElement.style.setProperty('--neon-spread', spread);
}
window.applyNeonIntensity = applyNeonIntensity;

// ══════════════════════════════════════════════════════════
// 🔐 MÓDULO DE AUTENTICAÇÃO BIOMÉTRICA / FACE ID (WebAuthn)
// ══════════════════════════════════════════════════════════

// Verifica se o dispositivo possui suporte de hardware e atualiza o estado visual na tela
async function checkBiometricHardwareSupport() {
  const bioToggle = document.getElementById('biometricToggle');
  const bioDesc = document.getElementById('biometricDesc');
  if (!bioToggle) return;

  const supported = window.PublicKeyCredential !== undefined;
  if (!supported) {
    bioToggle.disabled = true;
    if (bioDesc) bioDesc.textContent = 'Não suportado neste navegador/aparelho';
    return;
  }

  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        // Se explicitamente não tiver autenticador no hardware e não tiver cadastrado previamente
        const registered = localStorage.getItem('prazocerto_biometric_registered') === '1';
        if (!registered) {
          bioToggle.disabled = true;
          if (bioDesc) bioDesc.textContent = 'Sem leitor biométrico/digital detectado';
          return;
        }
      }
    }
  } catch (e) {
    console.warn('Erro ao checar autenticador biométrico:', e);
  }

  // Se suporta, garante que o toggle está habilitado para o usuário
  bioToggle.disabled = false;
  const s = Store.getSettings();
  const bioRegistered = localStorage.getItem('prazocerto_biometric_registered') === '1';
  if (bioDesc && !(s.biometricEnabled && bioRegistered)) {
    bioDesc.textContent = 'Acesso rápido e protegido';
  }
}
window.checkBiometricHardwareSupport = checkBiometricHardwareSupport;

// Chamado quando o usuário clica no toggle de biometria
async function handleBiometricToggle(checkbox) {
  if (checkbox.checked) {
    // Ativar: verifica suporte
    const supported = window.PublicKeyCredential !== undefined;
    if (!supported) {
      checkbox.checked = false;
      showToast('Seu navegador/dispositivo não possui suporte a biometria WebAuthn.', '⚠️');
      return;
    }

    try {
      if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!available) {
          checkbox.checked = false;
          showToast('Nenhum leitor biométrico ou digital ativo no aparelho.', '⚠️');
          return;
        }
      }
    } catch (e) {
      console.warn('Falha na pré-verificação biométrica:', e);
    }

    // Mostra modal de permissão nativo-like
    checkbox.checked = false; // reverte até o usuário confirmar no modal
    const modal = document.getElementById('biometricPermissionModal');
    if (modal) { modal.style.display = 'flex'; }
  } else {
    // Desativar: remove registro
    disableBiometric();
  }
}
window.handleBiometricToggle = handleBiometricToggle;

// Usuário clicou "Permitir" no modal
async function allowBiometric() {
  const modal = document.getElementById('biometricPermissionModal');
  if (modal) modal.style.display = 'none';

  const supported = window.PublicKeyCredential !== undefined;
  if (!supported) {
    showToast('Biometria não suportada neste dispositivo.', '⚠️');
    return;
  }

  // Tenta registrar credencial biométrica via WebAuthn
  try {
    // Gera challenge aleatório
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const userId = new TextEncoder().encode(auth?.currentUser?.uid || 'prazocerto_user_' + Date.now());

    // Configuração com fallback flexível para autenticador de plataforma (digital/face)
    const publicKeyConfig = {
      challenge,
      rp: { name: 'PrazoCerto' },
      user: {
        id: userId,
        name: auth?.currentUser?.email || 'usuario@prazocerto.app',
        displayName: auth?.currentUser?.displayName || 'Usuário PrazoCerto',
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',   // Impressão digital / Face do aparelho
        userVerification: 'preferred',         // 'preferred' evita travar em aparelhos com pin/digital híbrido
        requireResidentKey: false,
      },
      timeout: 60000,
      attestation: 'none',
    };

    // Só inclui rp.id se for um hostname válido para evitar erros de contexto de origem
    const host = window.location.hostname;
    if (host && host !== '' && host !== 'localhost' && !host.startsWith('127.')) {
      publicKeyConfig.rp.id = host;
    }

    let credential = null;
    try {
      credential = await navigator.credentials.create({ publicKey: publicKeyConfig });
    } catch (createErr) {
      // Se falhar com authenticatorAttachment 'platform', tenta sem restrição de attachment
      if (publicKeyConfig.authenticatorSelection.authenticatorAttachment) {
        delete publicKeyConfig.authenticatorSelection.authenticatorAttachment;
        credential = await navigator.credentials.create({ publicKey: publicKeyConfig });
      } else {
        throw createErr;
      }
    }

    if (credential) {
      // Salva o ID da credencial no localStorage
      const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      localStorage.setItem('prazocerto_biometric_cred_id', credIdB64);
      localStorage.setItem('prazocerto_biometric_registered', '1');

      // Atualiza toggle e descrição
      const bioToggle = document.getElementById('biometricToggle');
      const bioDesc = document.getElementById('biometricDesc');
      if (bioToggle) {
        bioToggle.checked = true;
        bioToggle.disabled = false;
      }
      if (bioDesc) bioDesc.textContent = '✅ Biometria ativa — acesso rápido habilitado';

      // Persiste nas configurações
      const s = Store.getSettings();
      s.biometricEnabled = true;
      Store.setSettings(s);

      showToast('Biometria cadastrada com sucesso!', '🔐');
    }
  } catch (err) {
    console.error('Biometric register error:', err);
    let msg = 'Não foi possível cadastrar a biometria. Tente novamente.';
    if (err.name === 'NotAllowedError') {
      msg = 'Permissão negada ou cancelada pelo usuário.';
    } else if (err.name === 'InvalidStateError') {
      msg = 'Este leitor biométrico já está registrado.';
    } else if (err.name === 'NotSupportedError') {
      msg = 'Autenticação biométrica não suportada pelo aparelho.';
    }
    showToast(msg, '⚠️');
    // Garante toggle desmarcado em caso de erro
    const bioToggle = document.getElementById('biometricToggle');
    if (bioToggle) bioToggle.checked = false;
  }
}
window.allowBiometric = allowBiometric;

// Usuário clicou "Não permitir" no modal
function denyBiometric() {
  const modal = document.getElementById('biometricPermissionModal');
  if (modal) modal.style.display = 'none';
  const bioToggle = document.getElementById('biometricToggle');
  if (bioToggle) bioToggle.checked = false;
  showToast('Autenticação biométrica não habilitada.', 'ℹ️');
}
window.denyBiometric = denyBiometric;

// Desativa e remove a biometria cadastrada
function disableBiometric() {
  localStorage.removeItem('prazocerto_biometric_cred_id');
  localStorage.removeItem('prazocerto_biometric_registered');
  const bioDesc = document.getElementById('biometricDesc');
  if (bioDesc) bioDesc.textContent = 'Acesso rápido e protegido';
  const s = Store.getSettings();
  s.biometricEnabled = false;
  Store.setSettings(s);
  showToast('Biometria desativada.', 'ℹ️');
}
window.disableBiometric = disableBiometric;

// Autentica o usuário com biometria (chamado na tela de login)
async function authenticateWithBiometric() {
  const credIdB64 = localStorage.getItem('prazocerto_biometric_cred_id');
  if (!credIdB64) return false;

  try {
    const credIdBytes = Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0));
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credIdBytes, type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      }
    });

    return !!assertion;
  } catch (err) {
    console.error('Biometric auth error:', err);
    return false;
  }
}
window.authenticateWithBiometric = authenticateWithBiometric;

// ──────────────────────────────────────────────────────────
// Mostra botão de login biométrico na tela de login se disponível
function initBiometricLoginButton() {
  const registered = localStorage.getItem('prazocerto_biometric_registered') === '1';
  const credId = localStorage.getItem('prazocerto_biometric_cred_id');
  if (!registered || !credId) return;
  if (!window.PublicKeyCredential) return;

  // Procura container de login para injetar botão
  const loginForm = document.getElementById('loginSection') ||
                    document.getElementById('authSection') ||
                    document.querySelector('.auth-form') ||
                    document.querySelector('.login-card');
  if (!loginForm) return;

  // Evita duplicar botão
  if (document.getElementById('btnBiometricLogin')) return;

  const btn = document.createElement('button');
  btn.id = 'btnBiometricLogin';
  btn.type = 'button';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;">
      <path d="M12 11c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2z"/>
      <path d="M17 11c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2z"/>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
      <path d="M7 14s.5 3 5 3 5-3 5-3"/>
    </svg>
    Entrar com Biometria / Face ID`;
  btn.style.cssText = `
    display:flex; align-items:center; justify-content:center;
    width:100%; padding:13px; margin-top:10px;
    border-radius:12px; border:1px solid rgba(99,102,241,0.5);
    background:rgba(99,102,241,0.12); color:#a5b4fc;
    font-size:0.92rem; font-weight:600; cursor:pointer;
    transition:all 0.2s; letter-spacing:0.3px;`;
  btn.onmouseover = () => { btn.style.background = 'rgba(99,102,241,0.25)'; btn.style.borderColor = '#6366f1'; };
  btn.onmouseout  = () => { btn.style.background = 'rgba(99,102,241,0.12)'; btn.style.borderColor = 'rgba(99,102,241,0.5)'; };

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '🔐 Verificando biometria...';
    const ok = await authenticateWithBiometric();
    if (ok) {
      showToast('Biometria confirmada!', '✅');
      // Tenta login silencioso via credencial salva
      const savedEmail = localStorage.getItem('prazocerto_saved_email');
      const savedToken = localStorage.getItem('prazocerto_saved_token');
      if (savedEmail && savedToken) {
        // Login com token customizado (se disponível)
        try {
          await auth.signInWithCustomToken(savedToken);
          return;
        } catch(e) { /* fallback abaixo */ }
      }
      // Se usuário já está logado (sessão ativa), apenas fecha a tela de auth
      if (auth.currentUser) {
        if (typeof bootApp === 'function') bootApp(auth.currentUser);
        const authEl = document.getElementById('authOverlay') || document.getElementById('loginSection') || document.getElementById('authSection');
        if (authEl) authEl.style.display = 'none';
      } else {
        showToast('Biometria verificada! Faça login para continuar.', 'ℹ️');
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><path d="M12 11c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2z"/><path d="M17 11c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2z"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M7 14s.5 3 5 3 5-3 5-3"/></svg>Entrar com Biometria / Face ID`;
      }
    } else {
      showToast('Biometria não reconhecida. Use e-mail e senha.', '⚠️');
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><path d="M12 11c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2z"/><path d="M17 11c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2z"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M7 14s.5 3 5 3 5-3 5-3"/></svg>Entrar com Biometria / Face ID`;
    }
  });

  loginForm.appendChild(btn);
}
window.initBiometricLoginButton = initBiometricLoginButton;

// ── UTILITÁRIO: Abre link de forma compatível com Capacitor/WebView Android ──
function openWhatsAppLink(url) {
  // 1. Tenta Capacitor Browser Plugin (mais confiável no WebView nativo)
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      window.Capacitor.Plugins.Browser.open({ url });
      return;
    }
  } catch (e) { /* ignora */ }

  // 2. Tenta via capacitor://  (fallback para versões mais antigas)
  try {
    if (window.Capacitor && window.Capacitor.isNative) {
      window.location.href = url;
      return;
    }
  } catch (e) { /* ignora */ }

  // 3. navigator.share (funciona em PWA/mobile Chrome)
  const textMatch = url.match(/text=([^&]*)/);
  if (textMatch && navigator.share) {
    const text = decodeURIComponent(textMatch[1]);
    navigator.share({ title: 'PrazoCerto', text }).catch(() => {
      window.open(url, '_blank') || (window.location.href = url);
    });
    return;
  }

  // 4. Fallback final: window.open ou location.href
  const opened = window.open(url, '_blank');
  if (!opened || opened.closed || typeof opened.closed === 'undefined') {
    window.location.href = url;
  }
}

// Disparo e teste direto de resumo no WhatsApp
function testWhatsAppMessage() {
  console.log('[WA] testWhatsAppMessage chamado');
  const s = Store.getSettings();
  const rawNumber = (document.getElementById('setWpNumber')?.value || s.whatsappNumber || '').trim();
  const cleanNumber = rawNumber.replace(/\D/g, '');

  // Número é opcional — se não informado, abre WhatsApp sem destinatário
  const fullNumber = cleanNumber.length >= 10
    ? (cleanNumber.startsWith('55') ? cleanNumber : `55${cleanNumber}`)
    : '';

  if (!fullNumber) {
    showToast('Dica: Salve seu número nas configurações para envio direto.', 'ℹ️');
  }

  // Busca produtos vencidos ou a vencer para compor o resumo
  const products = Store.getProducts() || [];
  const expired = [];
  const warn = [];
  const warnDays = s.warnDays || 7;

  products.forEach(p => {
    const d = daysUntil(p.expDate);
    if (d < 0) {
      expired.push(p);
    } else if (d <= warnDays) {
      warn.push({ ...p, days: d });
    }
  });

  const hoje = new Date().toLocaleDateString('pt-BR');
  let msg = `🔔 *PRAZOCERTO - RESUMO DIÁRIO DE VENCIMENTOS*\n`;
  msg += `📅 *Data:* ${hoje}\n\n`;

  if (expired.length === 0 && warn.length === 0) {
    msg += `✅ *Excelente!* Nenhum produto vencido ou com validade crítica hoje.\n`;
    msg += `📦 Total de itens monitorados: ${products.length}\n`;
  } else {
    if (expired.length > 0) {
      msg += `🚨 *VENCIDOS (${expired.length}):*\n`;
      expired.slice(0, 8).forEach(p => {
        msg += `• ${p.name || 'Produto'} (Qtd: ${p.qty || 1}) - Venceu em ${formatDateBR(p.expDate)}\n`;
      });
      if (expired.length > 8) msg += `... e mais ${expired.length - 8} itens.\n`;
      msg += `\n`;
    }

    if (warn.length > 0) {
      msg += `⚠️ *A VENCER EM BREVE (${warn.length}):*\n`;
      warn.slice(0, 8).forEach(p => {
        const tempo = p.days === 0 ? 'VENCE HOJE' : `em ${p.days} dia(s)`;
        msg += `• ${p.name || 'Produto'} (Qtd: ${p.qty || 1}) - ${tempo} (${formatDateBR(p.expDate)})\n`;
      });
      if (warn.length > 8) msg += `... e mais ${warn.length - 8} itens.\n`;
      msg += `\n`;
    }
  }

  msg += `\n📲 _Enviado automaticamente pelo app PrazoCerto._`;

  const encodedMsg = encodeURIComponent(msg);
  const phoneParam = fullNumber ? `phone=${fullNumber}&` : '';
  const waUrlApp = `whatsapp://send?${phoneParam}text=${encodedMsg}`;
  const waUrlWeb = `https://api.whatsapp.com/send?${phoneParam}text=${encodedMsg}`;

  showToast('Abrindo WhatsApp...', '📲');

  // Detecta ambiente: Capacitor (Android nativo) vs browser normal
  const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  if (isNativeApp) {
    // ANDROID NATIVO: usa Capacitor Browser plugin (abre no SO)
    try {
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        window.Capacitor.Plugins.Browser.open({ url: waUrlApp }).catch(() => {
          window.Capacitor.Plugins.Browser.open({ url: waUrlWeb });
        });
        return;
      }
    } catch (e) { /* ignora */ }
    // fallback nativo sem plugin
    window.location.href = waUrlApp;
  } else {
    // BROWSER (notebook/PC): abre WhatsApp Web
    try {
      const w = window.open(waUrlWeb, '_blank');
      if (!w || w.closed || typeof w.closed === 'undefined') {
        // Se o navegador bloqueou abrir nova aba em segundo plano:
        // Exibe o banner destacado e redireciona a própria aba se o usuário demorar 3 segundos
        showAutoWhatsAppPopupBanner(waUrlWeb, fullNumber);
      }
    } catch (e) {
      showAutoWhatsAppPopupBanner(waUrlWeb, fullNumber);
    }
  }
}
// Expõe globalmente para onclick no HTML
window.testWhatsAppMessage = testWhatsAppMessage;

function showAutoWhatsAppPopupBanner(waUrl, phone) {
  let existing = document.getElementById('pcWpAutoAlertBanner');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'pcWpAutoAlertBanner';
  div.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 999999;
    background: #0f172a;
    border: 2px solid #22c55e;
    box-shadow: 0 10px 30px rgba(34, 197, 94, 0.4);
    border-radius: 14px;
    padding: 16px 20px;
    color: #fff;
    max-width: 380px;
    font-family: inherit;
    animation: fadeIn 0.3s ease;
  `;
  div.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:12px;">
      <span style="font-size:1.8rem;">⏰📲</span>
      <div>
        <div style="font-weight:700; color:#22c55e; font-size:1rem; margin-bottom:4px;">Horário do WhatsApp Chegou!</div>
        <div style="font-size:0.85rem; color:#cbd5e1; margin-bottom:12px;">O navegador bloqueou a abertura automática de janelas. Clique abaixo para enviar agora:</div>
        <div style="display:flex; gap:8px;">
          <a href="${waUrl}" target="_blank" style="background:#22c55e; color:#000; font-weight:700; padding:8px 14px; border-radius:8px; text-decoration:none; font-size:0.85rem; display:inline-block;" onclick="this.closest('#pcWpAutoAlertBanner').remove()">Abrir WhatsApp Agora</a>
          <button type="button" style="background:transparent; border:1px solid #475569; color:#94a3b8; padding:8px 12px; border-radius:8px; font-size:0.85rem; cursor:pointer;" onclick="this.closest('#pcWpAutoAlertBanner').remove()">Fechar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(div);
}


// ── ROTINA AUTOMÁTICA DE ENVIO NO HORÁRIO CONFIGURADO ────────────────
let _wpDailyInterval = null;

// Agenda notificação nativa via Capacitor LocalNotifications
async function scheduleWhatsAppLocalNotification(targetTime) {
  try {
    const ln = window.Capacitor?.Plugins?.LocalNotifications;
    if (!ln) return false;

    // Pede permissão
    const perm = await ln.requestPermissions();
    if (perm.display !== 'granted') return false;

    // Cancela notificação anterior do WhatsApp
    await ln.cancel({ notifications: [{ id: 77001 }] }).catch(() => {});

    // Calcula o próximo disparo (hoje ou amanhã)
    const [h, m] = targetTime.split(':').map(Number);
    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(h, m, 0, 0);
    if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1);

    await ln.schedule({
      notifications: [{
        id: 77001,
        title: '🔔 PrazoCerto – Resumo Diário',
        body: 'Toque para enviar o resumo de vencimentos pelo WhatsApp.',
        schedule: { at: scheduled, repeats: true, every: 'day' },
        extra: { action: 'whatsapp_daily' },
        actionTypeId: ''
      }]
    });

    // Listener para quando o usuário tocar na notificação
    ln.addListener('localNotificationActionPerformed', (data) => {
      if (data?.notification?.extra?.action === 'whatsapp_daily') {
        testWhatsAppMessage();
      }
    });

    console.log('[WhatsApp Auto] Notificação local agendada para', scheduled.toString());
    return true;
  } catch (err) {
    console.warn('[WhatsApp Auto] LocalNotifications indisponível:', err);
    return false;
  }
}

function initWhatsAppAutoDailyScheduler() {
  if (_wpDailyInterval) {
    clearInterval(_wpDailyInterval);
    _wpDailyInterval = null;
  }

  const s = (typeof Store !== 'undefined' && Store.getSettings) ? (Store.getSettings() || {}) : {};
  if (s.notifWpDaily === false) {
    console.log('[WhatsApp Auto] Envio diário automático está desativado nas configurações.');
    return;
  }

  const targetTime = s.notifWpDailyTime || '08:00';
  console.log('[WhatsApp Auto] Agendador ativo para às:', targetTime);

  // Se estiver no Android nativo (Capacitor), também agenda notificação local
  if (typeof scheduleWhatsAppLocalNotification === 'function') {
    scheduleWhatsAppLocalNotification(targetTime).catch(() => {});
  }

  // Monitor em tempo real (verifica a cada 5 segundos para nunca perder o minuto)
  _wpDailyInterval = setInterval(() => {
    try {
      const s2 = (typeof Store !== 'undefined' && Store.getSettings) ? (Store.getSettings() || {}) : {};
      if (s2.notifWpDaily === false) return;

      const target = s2.notifWpDailyTime || '08:00';
      const now = new Date();
      const currentH = String(now.getHours()).padStart(2, '0');
      const currentM = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentH}:${currentM}`;
      const todayDateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const lastSentKey = 'pc_last_wp_sent_' + target;
      const lastSentDate = localStorage.getItem(lastSentKey);

      if (currentTimeStr === target && lastSentDate !== todayDateStr) {
        localStorage.setItem(lastSentKey, todayDateStr);
        console.log('[WhatsApp Auto] Horário atingido (' + currentTimeStr + ')! Disparando WhatsApp automaticamente...');
        if (typeof testWhatsAppMessage === 'function') {
          testWhatsAppMessage();
        }
      }
    } catch (err) {
      console.warn('[WhatsApp Auto] Erro no timer:', err);
    }
  }, 5000);
}

// Re-agenda quando o usuário salva as configurações (chamado por saveModernSettings)
function refreshWhatsAppScheduler() {
  if (_wpDailyInterval) clearInterval(_wpDailyInterval);
  initWhatsAppAutoDailyScheduler();
}

function openAddStoreModal() {
  if (typeof checkStorePlanLimit === 'function') {
    const storeLimitCheck = checkStorePlanLimit();
    if (!storeLimitCheck.allowed) {
      openPlanLimitModal(storeLimitCheck.reason);
      return;
    }
  }
  const storeName = prompt('Digite o nome da nova Loja / Unidade:');
  if (storeName && storeName.trim()) {
    const trimmed = storeName.trim();
    const currentStores = Store.getStores() || [];
    if (!currentStores.includes(trimmed)) {
      currentStores.push(trimmed);
      Store.setStores(currentStores);
    }
    const storeEl = document.getElementById('setStoreCurrentName');
    if (storeEl) storeEl.textContent = trimmed;
    populateStoreSelect(trimmed);
    updateLocationFilterOptions();
    showToast(`Loja "${trimmed}" cadastrada com sucesso!`, '🏪');
  }
}

// ── PROFILE MODAL ─────────────────────────────────
function openProfileModal() {
  const modal = document.getElementById('profileModal');
  if (!modal) return;
  // Populate data
  const savedAvatar = localStorage.getItem('cv_user_avatar');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const topbarImg = document.getElementById('userAvatarImg');
  if (savedAvatar && profileAvatarImg) profileAvatarImg.src = savedAvatar;
  if (savedAvatar && topbarImg) topbarImg.src = savedAvatar;

  // Name & Email
  const nameEl = document.getElementById('profileName');
  const emailEl = document.getElementById('profileEmail');
  const companyEl = document.getElementById('profileCompany');
  const countEl = document.getElementById('profileProductCount');

  const savedName = localStorage.getItem('cv_user_name') || '';
  const savedCompany = localStorage.getItem('cv_user_company') || '—';
  if (nameEl) nameEl.textContent = savedName || (firebase.auth().currentUser?.displayName) || '—';
  if (emailEl) emailEl.textContent = firebase.auth().currentUser?.email || '—';
  if (companyEl) companyEl.textContent = savedCompany;
  if (countEl) countEl.textContent = Store.getProducts().length;

  // Close edit form
  const editForm = document.getElementById('profileEditForm');
  if (editForm) editForm.style.display = 'none';

  modal.classList.remove('hidden');
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) modal.classList.add('hidden');
}

// ── MODAL ALTERAR SENHA DE ACESSO (SEGURANÇA) ──────────────
function togglePasswordVisibility(inputId, toggleEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (toggleEl) toggleEl.textContent = '🙈';
  } else {
    input.type = 'password';
    if (toggleEl) toggleEl.textContent = '👁️';
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

function openChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (!modal) return;
  const curr = document.getElementById('currentPasswordInput');
  const nw = document.getElementById('newPasswordInput');
  const cf = document.getElementById('confirmNewPasswordInput');
  const err = document.getElementById('changePassErrorMsg');
  if (curr) curr.value = '';
  if (nw) nw.value = '';
  if (cf) cf.value = '';
  if (err) { err.textContent = ''; err.style.color = '#ef4444'; }
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}
window.openChangePasswordModal = openChangePasswordModal;

function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.add('hidden');
}
window.closeChangePasswordModal = closeChangePasswordModal;

async function saveNewPassword() {
  const user = firebase.auth().currentUser;
  const errEl = document.getElementById('changePassErrorMsg');
  const btn = document.getElementById('btnSaveNewPassword');

  if (!user || !user.email) {
    if (errEl) errEl.textContent = 'Nenhum usuário conectado.';
    return;
  }

  const currentPass = document.getElementById('currentPasswordInput')?.value || '';
  const newPass = document.getElementById('newPasswordInput')?.value || '';
  const confirmPass = document.getElementById('confirmNewPasswordInput')?.value || '';

  if (!currentPass) {
    if (errEl) errEl.textContent = 'Por favor, informe sua senha atual.';
    return;
  }
  if (!newPass || newPass.length < 6) {
    if (errEl) errEl.textContent = 'A nova senha deve ter no mínimo 6 caracteres.';
    return;
  }
  if (newPass !== confirmPass) {
    if (errEl) errEl.textContent = 'A confirmação de senha não coincide.';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Validando e atualizando...'; btn.style.opacity = '0.7'; }
  if (errEl) errEl.textContent = '';

  try {
    // 1. Reautenticar o usuário com a senha atual para autorização de segurança
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPass);
    await user.reauthenticateWithCredential(cred);

    // 2. Atualizar a senha no Firebase Auth
    await user.updatePassword(newPass);

    if (errEl) {
      errEl.textContent = '✅ Senha atualizada com sucesso!';
      errEl.style.color = '#10b981';
    }
    showToast('Senha alterada com sucesso!', '🔒');

    setTimeout(() => {
      closeChangePasswordModal();
    }, 1500);
  } catch (error) {
    console.error('Erro ao trocar senha:', error);
    let msg = 'Erro ao alterar a senha. Verifique a senha atual.';
    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      msg = 'Senha atual incorreta.';
    } else if (error.code === 'auth/weak-password') {
      msg = 'A nova senha é muito fraca.';
    } else if (error.code === 'auth/requires-recent-login') {
      msg = 'Sessão expirada. Faça login novamente antes de alterar.';
    } else if (error.message) {
      msg = error.message;
    }
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.color = '#ef4444';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Atualizar Senha'; btn.style.opacity = '1'; }
  }
}
window.saveNewPassword = saveNewPassword;

async function sendResetEmailFromSettings() {
  const user = firebase.auth().currentUser;
  const errEl = document.getElementById('changePassErrorMsg');
  if (!user || !user.email) {
    showToast('E-mail do usuário não encontrado.', '⚠️');
    return;
  }
  try {
    await firebase.auth().sendPasswordResetEmail(user.email);
    if (errEl) {
      errEl.textContent = `Link de redefinição enviado para ${user.email}!`;
      errEl.style.color = '#00E5FF';
    }
    showToast('E-mail de recuperação enviado!', '📧');
  } catch (e) {
    console.error(e);
    if (errEl) {
      errEl.textContent = 'Erro ao enviar e-mail. Tente novamente.';
      errEl.style.color = '#ef4444';
    }
  }
}
window.sendResetEmailFromSettings = sendResetEmailFromSettings;

function openProfileEditForm() {
  const editForm = document.getElementById('profileEditForm');
  if (!editForm) return;
  const nameInput = document.getElementById('profileEditName');
  const companyInput = document.getElementById('profileEditCompany');
  if (nameInput) nameInput.value = localStorage.getItem('cv_user_name') || '';
  if (companyInput) companyInput.value = localStorage.getItem('cv_user_company') || '';
  editForm.style.display = 'block';
}

function saveProfileEdit() {
  const nameInput = document.getElementById('profileEditName');
  const companyInput = document.getElementById('profileEditCompany');
  const newName = nameInput?.value.trim() || '';
  const newCompany = companyInput?.value.trim() || '';
  if (newName) localStorage.setItem('cv_user_name', newName);
  if (newCompany) localStorage.setItem('cv_user_company', newCompany);
  // Update display
  const nameEl = document.getElementById('profileName');
  const companyEl = document.getElementById('profileCompany');
  if (nameEl && newName) nameEl.textContent = newName;
  if (companyEl) companyEl.textContent = newCompany || '—';
  const editForm = document.getElementById('profileEditForm');
  if (editForm) editForm.style.display = 'none';
  // Sync to Firestore
  if (_currentUserId && newName) {
    db.collection('user_data').doc(_currentUserId).set({ displayName: newName, company: newCompany }, { merge: true })
      .catch(err => console.error('Erro ao salvar perfil:', err));
  }
  if (typeof renderDashboard === 'function') renderDashboard();
  showToast('Perfil atualizado!', '✅');
}

function cancelProfileEdit() {
  const editForm = document.getElementById('profileEditForm');
  if (editForm) editForm.style.display = 'none';
}

// ── INIT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  populateCategorySelect();

  // Carregar foto de perfil salva do usuário
  const savedAvatar = localStorage.getItem('cv_user_avatar');
  if (savedAvatar) {
    const avatarImg = document.getElementById('userAvatarImg');
    if (avatarImg) avatarImg.src = savedAvatar;
    const profileImg = document.getElementById('profileAvatarImg');
    if (profileImg) profileImg.src = savedAvatar;
  }

  // Avatar btn – abre modal de perfil
  const avatarBtn = document.getElementById('userAvatarBtn');
  if (avatarBtn) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProfileModal();
    });
  }

  // Fechar modal de perfil
  const profileModalClose = document.getElementById('profileModalClose');
  if (profileModalClose) profileModalClose.addEventListener('click', closeProfileModal);
  const profileModal = document.getElementById('profileModal');
  if (profileModal) profileModal.addEventListener('click', (e) => { if (e.target === profileModal) closeProfileModal(); });

  // Botão Editar Perfil
  const profileEditBtn = document.getElementById('profileEditBtn');
  if (profileEditBtn) profileEditBtn.addEventListener('click', openProfileEditForm);

  // Avatar troca no modal de perfil
  const profileAvatarBtn = document.getElementById('profileAvatarBtn');
  const profileAvatarInput = document.getElementById('profileAvatarInput');
  if (profileAvatarBtn && profileAvatarInput) {
    profileAvatarBtn.addEventListener('click', () => profileAvatarInput.click());
    profileAvatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const imgEl = new Image();
      const fr = new FileReader();
      fr.onload = ev => {
        imgEl.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 200;
          const ratio = Math.min(MAX / imgEl.width, MAX / imgEl.height);
          canvas.width = imgEl.width * ratio;
          canvas.height = imgEl.height * ratio;
          canvas.getContext('2d').drawImage(imgEl, 0, 0, canvas.width, canvas.height);
          const compressed = canvas.toDataURL('image/jpeg', 0.75);
          // Update all avatar imgs
          ['userAvatarImg', 'profileAvatarImg'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.src = compressed;
          });
          try { localStorage.setItem('cv_user_avatar', compressed); } catch (err) { }
          if (_currentUserId) {
            db.collection('user_data').doc(_currentUserId).set({ avatar: compressed }, { merge: true })
              .then(() => showToast('Foto de perfil salva!', '📷'))
              .catch(() => showToast('Foto salva localmente!', '📷'));
          } else {
            showToast('Foto salva localmente!', '📷');
          }
        };
        imgEl.src = ev.target.result;
      };
      fr.readAsDataURL(file);
    });
  }

  // Dots dropdown toggle
  const dotsBtn = document.getElementById('topbarDotsBtn');
  const dotsDropdown = document.getElementById('dotsDropdown');
  if (dotsBtn && dotsDropdown) {
    dotsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dotsDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => dotsDropdown.classList.add('hidden'));
  }

  const avatarInput = document.getElementById('userAvatarInput');
  if (avatarInput) {
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Comprime antes de salvar para garantir que cabe no Firestore (max 1MB por campo)
      const img = new Image();
      const tempReader = new FileReader();
      tempReader.onload = (ev) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 200;
          const ratio = Math.min(MAX / img.width, MAX / img.height);
          canvas.width = img.width * ratio;
          canvas.height = img.height * ratio;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          const avatarImg = document.getElementById('userAvatarImg');
          if (avatarImg) avatarImg.src = compressed;
          try { localStorage.setItem('cv_user_avatar', compressed); } catch (e) { }
          if (_currentUserId) {
            db.collection('user_data').doc(_currentUserId).set({ avatar: compressed }, { merge: true })
              .then(() => showToast('Foto de perfil salva!', '📷'))
              .catch(err => { console.error('Erro ao salvar avatar:', err); showToast('Foto salva localmente!', '📷'); });
          } else {
            showToast('Foto salva localmente!', '📷');
          }
        };
        img.src = ev.target.result;
      };
      tempReader.readAsDataURL(file);
    });
  }

  // Register Service Worker for Notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('firebase-messaging-sw.js').then(reg => {
      console.log('SW (FCM) registrado com sucesso:', reg);

      // Request token for Push Notifications
      if (messaging && firebaseConfig.messagingSenderId && firebaseConfig.messagingSenderId !== "SUA_MESSAGING_SENDER_ID_AQUI") {
        messaging.getToken({
          serviceWorkerRegistration: reg,
          vapidKey: "BA_m7CP-NzA0aqrRPRmWdTcTfqiWiouFZ6a63E1ohuiT_LLmE1rbe5yNE2WZTA0mYB_rL5pZDSWAB41Tetfc6iI"
        }).then(token => {
          if (token) {
            console.log('FCM Token obtido:', token);
            // Save token to Firestore so the backend knows who to notify
            db.collection('fcm_tokens').doc(token).set({ token, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
          }
        }).catch(err => console.error("Erro ao pegar token FCM:", err));
      }
    }).catch(err => console.error('Erro SW:', err));

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data && event.data.action === 'deleteProduct' && event.data.productId) {
        deleteProduct(event.data.productId);
        showToast('Produto consumido/descartado via notificação', '✅');
      }
    });
  }

  // LOCATION FILTER - registra listeners (função global já declarada acima)
  window.currentLocationFilter = localStorage.getItem('cv_selected_store') || 'all';
  const filterSel = document.getElementById('globalLocationFilter');
  if (filterSel) {
    filterSel.addEventListener('change', e => handleLocationFilterChange(e.target.value));
    filterSel.addEventListener('input', e => handleLocationFilterChange(e.target.value));
  }

  // Carrega produtos do localStorage para uso offline
  try { const s = JSON.parse(localStorage.getItem('cv_products') || '[]'); _remoteProducts = s; } catch (e) { _remoteProducts = []; }
  updateLocationFilterOptions();
  // Remove auto-login por sessão salva — o Firebase cuida da persistência
  // (prazox_session removida — usamos Firebase persistence corretamente)
  localStorage.removeItem('prazox_session');
  // Restaura estado do checkbox 'lembrar de mim'
  var rememberCb = document.getElementById('rememberMe');
  if (rememberCb) rememberCb.checked = localStorage.getItem('cv_remember') === '1';

  // NAV
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.remove('open');
      navigate(item.dataset.page);
    });
  });
  document.querySelectorAll('[data-page]').forEach(el => {
    if (!el.classList.contains('nav-item')) {
      el.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.remove('open');
        navigate(el.dataset.page);
      });
    }
  });

  // MOBILE SIDEBAR
  const menuToggleBtn = document.getElementById('menuToggle');
  const sidebarEl = document.getElementById('sidebar');
  const sidebarCloseBtn = document.getElementById('sidebarClose');

  if (menuToggleBtn && sidebarEl) {
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarEl.classList.toggle('open');
    });
  }

  if (sidebarCloseBtn && sidebarEl) {
    sidebarCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarEl.classList.remove('open');
    });
  }

  // Fechar sidebar ao clicar fora
  document.addEventListener('click', (e) => {
    if (sidebarEl && sidebarEl.classList.contains('open')) {
      if (!sidebarEl.contains(e.target) && !menuToggleBtn?.contains(e.target)) {
        sidebarEl.classList.remove('open');
      }
    }
  });

  // SCANNER DO TOPO (ao lado do sino) - Utiliza o leitor inteligente de produtos
  document.getElementById('addProductBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openScannerForSearch();
  });
  document.getElementById('emptyAddBtn')?.addEventListener('click', () => openAddModal());
  document.getElementById('quickScanBtn')?.addEventListener('click', () => navigate('products'));
  document.getElementById('addStoreBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof checkStorePlanLimit === 'function') {
      const storeLimitCheck = checkStorePlanLimit();
      if (!storeLimitCheck.allowed) {
        openPlanLimitModal(storeLimitCheck.reason);
        return;
      }
    }
    const newStore = prompt('Digite o nome da nova loja/rede:');
    if (newStore && newStore.trim()) {
      const stores = Store.getStores();
      if (!stores.includes(newStore.trim())) {
        stores.push(newStore.trim());
        Store.setStores(stores);
      }
      populateStoreSelect(newStore.trim());
      updateLocationFilterOptions();
      showToast('Loja adicionada!', '✅');
    }
  });

  document.getElementById('deleteStoreBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const sel = document.getElementById('prodLocation');
    const storeName = sel.value;
    if (!storeName) {
      showToast('Selecione uma loja antes para excluir', '⚠️');
      return;
    }
    if (await confirm('Excluir Loja', `Tem certeza que deseja excluir a loja "${storeName}" e apenas os produtos vinculados a ela? As outras lojas e produtos não serão afetados.`)) {
      // 1. Remove apenas a loja selecionada da lista de lojas cadastradas
      let stores = Store.getStores();
      stores = stores.filter(s => s.toLowerCase() !== storeName.toLowerCase());
      Store.setStores(stores);

      // 2. Remove APENAS os produtos que pertencem a essa loja específica, mantendo todas as outras intactas
      const allProds = Store.getAllProducts() || [];
      const remainingProds = allProds.filter(p => {
        const pLoc = (p.location ? p.location.trim() : '');
        return pLoc.toLowerCase() !== storeName.trim().toLowerCase();
      });
      Store.setProducts(remainingProds);

      // 3. Reseta o filtro global para 'all' caso a loja excluída estivesse ativa
      if (localStorage.getItem('cv_selected_store') === storeName || window.currentLocationFilter === storeName) {
        localStorage.setItem('cv_selected_store', 'all');
        window.currentLocationFilter = 'all';
      }

      populateStoreSelect('');
      updateLocationFilterOptions();
      if (typeof renderProducts === 'function') renderProducts();
      if (typeof renderDashboard === 'function') renderDashboard();
      showToast(`Loja "${storeName}" e seus produtos foram excluídos com sucesso.`, '🗑');
    }
  });

  // INLINE SCANNER
  document.getElementById('scanFromModal')?.addEventListener('click', (e) => {
    e.preventDefault();
    startInlineScanner();
  });

  document.getElementById('stopInlineScanBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    stopInlineScanner();
  });

  // MODAL
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('productModal').classList.add('hidden');
  });
  document.getElementById('modalCancel').addEventListener('click', () => {
    document.getElementById('productModal').classList.add('hidden');
  });
  document.getElementById('modalSave').addEventListener('click', saveProduct);
  document.getElementById('productModal').addEventListener('click', e => {
    if (e.target === document.getElementById('productModal'))
      document.getElementById('productModal').classList.add('hidden');
  });

  // Expiry preview on date change
  document.getElementById('prodExpDate').addEventListener('change', updateExpiryPreview);
  document.getElementById('prodMfgDate').addEventListener('change', updateExpiryPreview);

  // FILTERS (Products page)
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProducts(btn.dataset.filter);
    });
  });

  // FILTER CATEGORY
  document.getElementById('filterCategory')?.addEventListener('change', () => renderProducts());

  // SORT
  document.getElementById('sortProducts')?.addEventListener('change', () => renderProducts());

  // BOTÃO E MODAL DE FILTROS AVANÇADOS DE PRODUTOS
  function populateProductFilterModal() {
    const catSel = document.getElementById('advFilterCategory');
    if (catSel) {
      const cats = Store.getCategories();
      const currentCat = document.getElementById('filterCategory')?.value || 'all';
      catSel.innerHTML = '<option value="all">Categorias</option>' +
        cats.map(c => `<option value="${c.id}" ${c.id === currentCat ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('');
    }

    const storeSel = document.getElementById('advFilterStore');
    if (storeSel) {
      const stores = Store.getStores() || [];
      const currentStore = window.currentLocationFilter || localStorage.getItem('cv_selected_store') || 'all';
      storeSel.innerHTML = '<option value="all">Todas as Lojas</option>' +
        stores.map(s => `<option value="${s}" ${s === currentStore ? 'selected' : ''}>📍 ${s}</option>`).join('');
    }

    const statusSel = document.getElementById('advFilterStatus');
    if (statusSel) {
      statusSel.value = currentFilter || 'all';
    }

    const sortSel = document.getElementById('advFilterSort');
    if (sortSel) {
      sortSel.value = document.getElementById('sortProducts')?.value || 'expiry';
    }
  }

  function openProductFilterModal() {
    populateProductFilterModal();
    const modal = document.getElementById('productFilterModal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeProductFilterModal() {
    const modal = document.getElementById('productFilterModal');
    if (modal) modal.classList.add('hidden');
  }

  document.getElementById('openProductFilterModalBtn')?.addEventListener('click', openProductFilterModal);
  document.getElementById('productFilterClose')?.addEventListener('click', closeProductFilterModal);
  document.getElementById('productFilterModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('productFilterModal')) closeProductFilterModal();
  });

  document.getElementById('advFilterReset')?.addEventListener('click', () => {
    if (document.getElementById('advFilterStatus')) document.getElementById('advFilterStatus').value = 'all';
    if (document.getElementById('advFilterCategory')) document.getElementById('advFilterCategory').value = 'all';
    if (document.getElementById('advFilterStore')) document.getElementById('advFilterStore').value = 'all';
    if (document.getElementById('advFilterSort')) document.getElementById('advFilterSort').value = 'expiry';
    if (document.getElementById('productSearch')) document.getElementById('productSearch').value = '';

    const catSelect = document.getElementById('filterCategory');
    if (catSelect) catSelect.value = 'all';

    const sortSelect = document.getElementById('sortProducts');
    if (sortSelect) sortSelect.value = 'expiry';

    if (typeof handleLocationFilterChange === 'function') {
      handleLocationFilterChange('all');
    }

    currentFilter = 'all';
    document.querySelectorAll('[data-filter]').forEach(b => {
      if (b.dataset.filter === 'all') b.classList.add('active');
      else b.classList.remove('active');
    });

    window._prodPage = 1;
    renderProducts('all');
    closeProductFilterModal();
    showToast('Filtros redefinidos', 'ℹ️', 2000);
  });

  document.getElementById('advFilterApply')?.addEventListener('click', () => {
    const statusVal = document.getElementById('advFilterStatus')?.value || 'all';
    const catVal = document.getElementById('advFilterCategory')?.value || 'all';
    const storeVal = document.getElementById('advFilterStore')?.value || 'all';
    const sortVal = document.getElementById('advFilterSort')?.value || 'expiry';

    const catSelect = document.getElementById('filterCategory');
    if (catSelect) catSelect.value = catVal;

    const sortSelect = document.getElementById('sortProducts');
    if (sortSelect) sortSelect.value = sortVal;

    if (typeof handleLocationFilterChange === 'function') {
      handleLocationFilterChange(storeVal);
    }

    document.querySelectorAll('[data-filter]').forEach(b => {
      if (b.dataset.filter === statusVal) b.classList.add('active');
      else b.classList.remove('active');
    });

    window._prodPage = 1;
    renderProducts(statusVal);
    closeProductFilterModal();
    showToast('Filtros aplicados!', '✅', 2000);
  });

  // ALERTS FILTER
  document.querySelectorAll('[data-alert-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-alert-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAlerts(btn.dataset.alertFilter);
    });
  });

  // BOTÃO PREMIUM DE RELATÓRIO WHATSAPP NA TELA DE ALERTAS
  document.getElementById('alertsWhatsappShareBtn')?.addEventListener('click', () => {
    shareAlertsReportViaWhatsApp();
  });

  // SCANNER
  document.getElementById('startScanBtn')?.addEventListener('click', () => {
    _ensureAudioContext(); // desbloqueia AudioContext no gesto do usuario
    startScanner();
  });
  document.getElementById('scanSearchBtn')?.addEventListener('click', () => {
    openScannerForSearch();
  });
  document.getElementById('stopScanBtn')?.addEventListener('click', () => {
    wasScanning = false;
    stopScanner();
    navigate('products');
  });
  document.getElementById('manualCodeBtn')?.addEventListener('click', () => {
    document.getElementById('manualInput').classList.toggle('hidden');
  });
  const submitManualCode = () => {
    const code = document.getElementById('manualCodeInput').value.trim();
    if (!code) return;
    document.getElementById('manualCodeInput').value = '';
    document.getElementById('manualInput').classList.add('hidden');
    navigate('products');
    // Abre o modal após a página estar pronta
    setTimeout(() => {
      openAddModal(code);
      // Foca no campo de data de validade automaticamente
      setTimeout(() => {
        const expDateField = document.getElementById('prodExpDate');
        if (expDateField) expDateField.focus();
      }, 150);
    }, 100);
    showToast('Código inserido: ' + code, '📦');
  };

  document.getElementById('manualCodeSubmit')?.addEventListener('click', submitManualCode);
  document.getElementById('manualCodeInput')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') submitManualCode();
  });

  // CATEGORY MODAL
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => {
    document.getElementById('catName').value = '';
    document.getElementById('catEmoji').value = '📦';
    document.getElementById('catColor').value = '#6EE7B7';
    document.querySelectorAll('.emoji-opt').forEach(e => e.classList.remove('selected'));
    document.querySelector('.emoji-opt')?.classList.add('selected');
    document.querySelectorAll('.color-opt').forEach(c => c.classList.remove('selected'));
    document.querySelector('.color-opt')?.classList.add('selected');
    document.getElementById('categoryModal').classList.remove('hidden');
  });
  document.getElementById('catModalClose').addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('catCancel').addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('catSave').addEventListener('click', () => {
    const name = document.getElementById('catName').value.trim();
    if (!name) { showToast('Nome da categoria é obrigatório', '⚠️'); return; }
    const emoji = document.getElementById('catEmoji').value || '📦';
    const color = document.getElementById('catColor').value || '#6EE7B7';
    const cats = Store.getCategories();
    cats.push({ id: 'cat-' + uid(), name, emoji, color });
    Store.setCategories(cats);
    document.getElementById('categoryModal').classList.add('hidden');
    renderCategories();
    showToast('Categoria criada', '✅');
  });

  // EMOJI PICKER
  document.getElementById('emojiPicker')?.addEventListener('click', e => {
    const opt = e.target.closest('.emoji-opt');
    if (!opt) return;
    document.querySelectorAll('.emoji-opt').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    document.getElementById('catEmoji').value = opt.dataset.emoji;
  });
  document.getElementById('colorPicker')?.addEventListener('click', e => {
    const opt = e.target.closest('.color-opt');
    if (!opt) return;
    document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    document.getElementById('catColor').value = opt.dataset.color;
  });

  // SEARCH – funciona na página de produtos
  document.getElementById('productSearch')?.addEventListener('input', () => {
    renderProducts();
  });

  // SETTINGS EVENTS
  document.getElementById('warnDays')?.addEventListener('change', saveSettings);
  document.getElementById('critDays')?.addEventListener('change', saveSettings);
  document.getElementById('notifToggle')?.addEventListener('change', async e => {
    if (e.target.checked) {
      const granted = await requestAppNotificationPermission();
      if (!granted) {
        e.target.checked = false;
        showToast('Permissão de notificações negada', '⚠️');
      } else {
        saveSettings();
        scheduleNotifications();
        showToast('Notificações ativadas!', '🔔');
      }
    } else {
      saveSettings();
    }
  });
  document.getElementById('themeSelect')?.addEventListener('change', saveSettings);
  document.getElementById('animToggle')?.addEventListener('change', saveSettings);

  // EXPORT/IMPORT
  document.getElementById('exportBtn')?.addEventListener('click', exportData);
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
  document.getElementById('exportAllBtn')?.addEventListener('click', exportData);
  document.getElementById('exportCsvAllBtn')?.addEventListener('click', exportCSV);
  document.getElementById('importBtn')?.addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importAllBtn')?.addEventListener('click', () => document.getElementById('importAllFile').click());
  document.getElementById('importExcelBtn')?.addEventListener('click', () => document.getElementById('importExcelFile').click());
  document.getElementById('importExcelAllBtn')?.addEventListener('click', () => document.getElementById('importExcelAllFile').click());
  document.getElementById('importFile')?.addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });
  document.getElementById('importAllFile')?.addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });
  document.getElementById('importExcelFile')?.addEventListener('change', e => { if (e.target.files[0]) { importExcel(e.target.files[0]); e.target.value = ''; } });
  document.getElementById('importExcelAllFile')?.addEventListener('change', e => { if (e.target.files[0]) { importExcel(e.target.files[0]); e.target.value = ''; } });

  // CLEAR ALL
  document.getElementById('clearAllBtn')?.addEventListener('click', async () => {
    if (await confirm('⚠️ Limpar todos os dados', 'Isso removerá TODOS os produtos. Essa ação não pode ser desfeita!')) {
      Store.setProducts([]);
      renderDashboard();
      renderProducts();
      showToast('Todos os dados foram removidos', '🗑');
    }
  });

  // Press Escape to close modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('categoryModal').classList.add('hidden');
      document.getElementById('confirmModal').classList.add('hidden');
    }
  });

  // BOTTOM NAV
  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (item.id === 'bnav-more') return;
      document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
      item.classList.add('active');
      if (typeof closeMoreMenu === 'function') closeMoreMenu();
      if (item.dataset.page) navigate(item.dataset.page);
    });
  });

  // Funções para abrir e fechar o Menu Mais (Popup)
  window.toggleMoreMenu = function (e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const moreMenu = document.getElementById('bnavMoreMenu');
    if (moreMenu) {
      moreMenu.classList.toggle('open');
    }
  };

  window.closeMoreMenu = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const moreMenu = document.getElementById('bnavMoreMenu');
    if (moreMenu) {
      moreMenu.classList.remove('open');
    }
  };

  // Fechar menu Mais ao clicar em qualquer opção interna ou fora
  document.querySelectorAll('.bnav-more-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMoreMenu();
    });
  });

  document.addEventListener('click', (e) => {
    const moreItem = document.getElementById('bnav-more');
    const moreMenu = document.getElementById('bnavMoreMenu');
    if (moreMenu && moreMenu.classList.contains('open')) {
      if (moreItem && !moreItem.contains(e.target)) {
        moreMenu.classList.remove('open');
      }
    }
  });

  // Sync bottom nav on sidebar nav click
  const origNavItems = document.querySelectorAll('.nav-item');
  origNavItems.forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.bottom-nav-item').forEach(b => {
        b.classList.toggle('active', b.dataset.page === item.dataset.page);
      });
    });
  });

  // Stop scanner when leaving scanner page
  const origNavigate = navigate;

  // Initial notifications check & permission request
  if (Store.getSettings().notifications) {
    requestAppNotificationPermission().then(() => {
      scheduleNotifications();
    });
  } else {
    scheduleNotifications();
  }

  // Load settings on settings page navigation
  document.getElementById('nav-settings')?.addEventListener('click', loadSettings);

  // --- CATALOG & SQLITE INTEGRATION ---
  let catalogDebounce;
  const prodCodeInput = document.getElementById('prodCode');
  if (prodCodeInput) {
    prodCodeInput.addEventListener('input', (e) => {
      clearTimeout(catalogDebounce);
      const ean = e.target.value.trim();
      if (!ean) {
        document.getElementById('prodName').value = '';
        const imgCont = document.getElementById('prodImageContainer');
        if (imgCont) imgCont.style.display = 'none';
        const notFound = document.getElementById('prodNotFoundMsg');
        if (notFound) notFound.style.display = 'none';
        const gotoCat = document.getElementById('btnGoCatalogContainer');
        if (gotoCat) gotoCat.style.display = 'none';
        return;
      }
      // Guarda o EAN localmente para guardar contra race condition (busca async que chega atrasada)
      const searchEan = ean;
      catalogDebounce = setTimeout(async () => {
        try {
          let prod = null;
          const cleanSearch = String(searchEan).replace(/^0+/, '');

          // 1. Tenta no lookupProductByBarcode (Cache local -> Firestore produtos_cache -> Cascata de APIs 1 a 7)
          if (!prod) {
            try {
              const lookup = await lookupProductByBarcode(searchEan);
              if (lookup && (lookup.nome || lookup.nome_produto || lookup.imagem_url)) {
                prod = {
                  nome: lookup.nome || lookup.nome_produto || '',
                  foto: lookup.imagem_url || lookup.foto || ''
                };
              }
            } catch (e) { }
          }

          // 2. Tenta no backend local se estiver rodando em localhost
          if (!prod && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            try {
              const res = await fetch(`http://localhost:3000/api/produtos/${searchEan}`);
              if (res.ok) prod = await res.json();
            } catch (err) { }
          }

          // 3. Tenta no catálogo local e produtos cadastrados (com correspondência flexível)
          if (!prod) {
            const catalogProducts = Store.getCatalog() || [];
            const remoteProducts = Store.getAllProducts() || [];
            const allProds = [...catalogProducts, ...remoteProducts];
            prod = allProds.find(p => {
              const code = String(p.code || p.ean || p.id || '').trim();
              return code === searchEan || code.replace(/^0+/, '') === cleanSearch;
            });
          }

          // 4. Tenta no Firestore fichas_tecnicas
          if (!prod && typeof db !== 'undefined') {
            try {
              let snap = await db.collection('fichas_tecnicas').doc(searchEan).get();
              if (!snap.exists && cleanSearch !== searchEan) {
                snap = await db.collection('fichas_tecnicas').doc(cleanSearch).get();
              }
              if (snap.exists) {
                prod = snap.data();
              } else {
                const snap2 = await db.collection('fichas_tecnicas').where('ean', 'in', [searchEan, cleanSearch]).get();
                if (!snap2.empty) prod = snap2.docs[0].data();
              }
            } catch (err) { }
          }

          // *** GUARD CONTRA RACE CONDITION ***
          if (document.getElementById("prodCode").value.trim() !== searchEan) return;

          if (prod) {
            const prodNome = prod.nome || prod.name || "";
            document.getElementById("prodName").value = prodNome;

            // Auto-categorização automática ao escanear (se não houver categoria já selecionada)
            const catEl = document.getElementById('prodCategory');
            if (catEl && !catEl.value && prodNome) {
              const autoCatId = getAutoCategory(prodNome);
              if (autoCatId) catEl.value = autoCatId;
            }
            const imgEl = document.getElementById("prodImage");
            const imgCont = document.getElementById("prodImageContainer");

            const trySetImg = (src, fallbacks) => {
              const testImg = new Image();
              testImg.onload = () => {
                if (imgEl && imgCont) {
                  imgEl.src = src;
                  imgCont.style.display = 'flex';
                }
              };
              testImg.onerror = () => {
                if (fallbacks && fallbacks.length > 0) {
                  trySetImg(fallbacks[0], fallbacks.slice(1));
                } else if (imgEl && imgCont) {
                  imgEl.src = 'images/prazocerto_basket_3d.png';
                  imgCont.style.display = 'flex';
                }
              };
              testImg.src = src;
            };

            const initialSrc = prod.foto ? (prod.foto.startsWith("http") ? prod.foto : `imagens/${prod.foto}`) : `imagens/${searchEan}.jpg`;
            const altSrc = prod.foto && !prod.foto.startsWith("http") ? `images/${prod.foto}` : `images/${searchEan}.jpg`;
            trySetImg(initialSrc, [altSrc, `https://cdn-cosmos.bluesoft.com.br/products/${searchEan}`]);

            const bc = document.getElementById('prodBarcodeImage');
            if (bc) {
              bc.src = `imagens/${searchEan}_barcode.jpg`;
              bc.style.display = 'block';
            }
            document.getElementById('prodNotFoundMsg').style.display = 'none';
            document.getElementById('btnGoCatalogContainer').style.display = 'none';
            const modalBody = document.querySelector('#productModal .modal-body');
            if (modalBody) modalBody.scrollTop = 0;
          } else {
            // Se o lookupAndFillProduct ja encontrou e preencheu o nome, nao limpa!
            const currentVal = document.getElementById('prodName')?.value;
            if (!currentVal) {
              document.getElementById('prodName').value = '';
              document.getElementById('prodImageContainer').style.display = 'none';
              document.getElementById('prodNotFoundMsg').style.display = 'block';
            }
            const gotoCat = document.getElementById('btnGoCatalogContainer');
            if (gotoCat) gotoCat.style.display = 'block';
            const modalBody = document.querySelector('#productModal .modal-body');
            if (modalBody) modalBody.scrollTop = 0;
          }
        } catch (e) {
          console.error(e);
        }
      }, 400); // debounce reduzido para resposta mais rápida
    });
  }

  document.getElementById('btnGoCatalog')?.addEventListener('click', () => {
    navigate('catalog');
    document.getElementById('productModal').classList.add('hidden');
  });

});

// --- CATALOG & HISTORY RENDER FUNCTIONS ---
let _currentBrand = 'Danone';

function showBrands() {
  document.getElementById('catalogBrandView').style.display = '';
  document.getElementById('catalogProductView').style.display = 'none';
}

function showBrandProducts(brand) {
  _currentBrand = brand;
  document.getElementById('catalogBrandView').style.display = 'none';
  document.getElementById('catalogProductView').style.display = '';
  document.getElementById('catalogBrandTitle').textContent = '📚 ' + brand;
  renderCatalog();
}

document.getElementById('backToBrands')?.addEventListener('click', showBrands);

document.querySelectorAll('.brand-card').forEach(card => {
  card.addEventListener('click', () => showBrandProducts(card.dataset.brand));
});

let _catalogFullData = (typeof CATALOGOS_EMBUTIDOS !== 'undefined') ? CATALOGOS_EMBUTIDOS : null;

async function loadCatalogData() {
  if (_catalogFullData) return _catalogFullData;
  if (typeof CATALOGOS_EMBUTIDOS !== 'undefined') {
    _catalogFullData = CATALOGOS_EMBUTIDOS;
    return _catalogFullData;
  }
  try {
    const res = await fetch('data_catalogos.json');
    if (res.ok) {
      _catalogFullData = await res.json();
      return _catalogFullData;
    }
  } catch (err) {
    console.warn('data_catalogos.json fetch indisponível no protocolo local file:///:', err);
  }
  return null;
}

async function renderCatalog() {
  const search = document.getElementById('catalogSearch')?.value.toLowerCase().trim() || '';
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '<div class="empty-state"><h3>Carregando catálogo...</h3></div>';
  try {
    const fullData = await loadCatalogData();
    let produtos = [];
    
    if (fullData) {
      const b = (_currentBrand || '').toLowerCase();
      if (b.includes('nestl') || b.includes('dpa')) {
        produtos = [...(fullData.dpa || [])];
      } else if (b.includes('vigor')) {
        produtos = [...(fullData.vigor || [])];
      } else if (b.includes('danone')) {
        produtos = [...(fullData.danone || [])];
      } else if (b.includes('batavo') || b.includes('lactalis')) {
        produtos = [...(fullData.batavo || [])];
      } else {
        produtos = [];
      }
    }

    // Não usar fallback para Batavo
    const isBatavo = (_currentBrand || '').toLowerCase().includes('batavo');
    if (!produtos.length && !isBatavo && !fullData) {
      if (_catalogProducts.length > 0) {
        produtos = [..._catalogProducts];
      } else {
        const snapshot = await db.collection('fichas_tecnicas').get();
        snapshot.forEach(doc => produtos.push(doc.data()));
      }
      if (_currentBrand) {
        const b = _currentBrand.toLowerCase();
        produtos = produtos.filter(p => {
          const m = (p.marca || p.brand || '').toLowerCase();
          return m.includes(b);
        });
      }
      produtos.sort((a, b) => (a.nome || a.name || '').localeCompare(b.nome || b.name || ''));
      produtos = produtos.map((p, idx) => ({ ...p, numero: idx + 1 }));
    }

    // Garantir ordenação numérica correta de 1 ao fim
    produtos.sort((a, b) => (Number(a.numero) || 0) - (Number(b.numero) || 0));

    if (search) {
      produtos = produtos.filter(p => 
        (p.nome || p.name || '').toLowerCase().includes(search) || 
        (p.ean || p.code || '').includes(search) ||
        String(p.numero).includes(search)
      );
    }

    if (!produtos.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px 10px; color: #8B949E;"><h3>Nenhum produto cadastrado para esta marca</h3><p style="font-size:0.85rem;margin-top:6px;">O catálogo será disponibilizado em breve.</p></div>';
      return;
    }

    grid.innerHTML = produtos.map(p => {
      const ean = String(p.ean || p.code || '').trim();
      const num = p.numero || '';
      const bcidType = ean.length === 8 ? 'ean8' : 'ean13';
      const zebraApiUrl = `https://bwipjs-api.metafloor.com/?bcid=${bcidType}&text=${ean}&scale=2&height=12&includetext`;
      
      return `<div class="product-card" style="text-align:center; font-size:12px; padding:10px 8px; display:flex; flex-direction:column; justify-content:space-between; align-items:center; position:relative; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; min-height:150px; box-sizing:border-box;">
        <div style="position:absolute; top:6px; left:8px; background:var(--primary, #00E5FF); color:#000; font-weight:800; font-size:0.68rem; padding:1px 6px; border-radius:10px;">#${num}</div>
        <div style="width:100%; margin-top:14px; margin-bottom:6px;">
          <h4 style="font-size:0.78rem; font-weight:700; margin:0 0 4px 0; color:#F1F5F9; line-height:1.3; text-align:center; min-height:30px; display:flex; align-items:center; justify-content:center;">${escHtml(p.nome || p.name)}</h4>
          <p style="color:#00E5FF; font-size:0.72rem; margin:0; font-family:monospace; font-weight:600; letter-spacing:0.05em;">EAN: ${ean}</p>
        </div>
        <div style="background:#FFFFFF; border-radius:4px; padding:2px; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; cursor:pointer;" onclick="openImgModal('${zebraApiUrl}')" title="Clique para ampliar">
          <img src="${zebraApiUrl}" alt="Zebra ${ean}" loading="lazy" decoding="async" style="height:36px; width:auto; max-width:100%; object-fit:contain; display:block; background:#FFFFFF;">
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><h3>Erro ao carregar</h3></div>';
  }
}

function openImgModal(src) {
  // Usa modal global se existir, senão cria um
  let modal = document.getElementById('globalImgModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'globalImgModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
    modal.innerHTML = `<div style="background:#FFFFFF;padding:16px 20px;border-radius:12px;max-width:90%;max-height:80%;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,0.8);gap:12px;">
      <img id="globalImgModalSrc" style="max-width:100%;max-height:65vh;object-fit:contain;border-radius:4px;image-rendering:pixelated;display:block;">
      <button onclick="document.getElementById('globalImgModal').style.display='none'" style="background:#0d1117;border:1px solid rgba(255,255,255,0.2);color:#ffffff;padding:8px 24px;border-radius:8px;cursor:pointer;font-size:0.9rem;">✕ Fechar</button>
    </div>`;
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  const imgEl = document.getElementById('globalImgModalSrc');
  if (imgEl) imgEl.src = src;
  modal.style.display = 'flex';
  // Também tenta o modal antigo se existir
  const oldModal = document.getElementById('imgModal');
  if (oldModal) { document.getElementById('imgModalSrc').src = src; oldModal.style.display = 'flex'; }
}

document.getElementById('catalogSearch')?.addEventListener('input', () => {
  if (currentPage === 'catalog') renderCatalog();
});

// ── LOG DE HISTÓRICO COMPLETO ──────────────────────
// Auto-limpeza inteligente: remove registros com mais de 25 dias para manter o sistema leve e veloz
function cleanOldHistoryLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) return [];
  const cutoffTime = Date.now() - (25 * 24 * 60 * 60 * 1000); // 25 dias
  const recentLogs = logs.filter(l => {
    if (!l || !l.timestamp) return false;
    const time = new Date(l.timestamp).getTime();
    return !isNaN(time) && time >= cutoffTime;
  });
  if (recentLogs.length !== logs.length) {
    try {
      localStorage.setItem('cv_history_logs', JSON.stringify(recentLogs));
    } catch (e) { }
  }
  return recentLogs;
}

function getHistoryLogs() {
  try {
    const raw = localStorage.getItem('cv_history_logs');
    if (raw) {
      const parsed = JSON.parse(raw);
      return cleanOldHistoryLogs(parsed);
    }
  } catch (e) { }
  return [];
}

function saveHistoryLogs(logs) {
  try {
    localStorage.setItem('cv_history_logs', JSON.stringify(logs));
  } catch (e) { }
  // Sincroniza logs com Firestore se logado
  if (_currentUserId && typeof db !== 'undefined') {
    db.collection('user_data').doc(_currentUserId).set({
      historyLogs: logs.slice(0, 100),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(function (e) { console.warn('Erro ao salvar historyLogs:', e); });
  }
}

function getFilteredHistoryLogs() {
  const logs = getHistoryLogs();
  if (!logs.length) return [];

  const search = (document.getElementById('histSearchInput')?.value || '').toLowerCase().trim();
  const selectedStore = document.getElementById('histFilterStore')?.value || 'all';
  const selectedUser = document.getElementById('histFilterUser')?.value || 'all';
  const selectedType = document.getElementById('histFilterType')?.value || 'all';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 7 * 86400000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  return logs.filter(l => {
    const t = new Date(l.timestamp).getTime();
    if (_histPeriod === 'today' && t < startOfToday) return false;
    if (_histPeriod === 'week' && t < startOfWeek) return false;
    if (_histPeriod === 'month' && t < startOfMonth) return false;
    if (selectedStore !== 'all' && (l.store || 'Sem Loja') !== selectedStore) return false;
    if (selectedUser !== 'all' && l.user !== selectedUser) return false;
    if (selectedType !== 'all' && l.actionType !== selectedType) return false;
    if (search) {
      const nameMatch = l.productName && l.productName.toLowerCase().includes(search);
      const codeMatch = l.productCode && l.productCode.toLowerCase().includes(search);
      const userMatch = l.user && l.user.toLowerCase().includes(search);
      const actionMatch = l.actionLabel && l.actionLabel.toLowerCase().includes(search);
      if (!nameMatch && !codeMatch && !userMatch && !actionMatch) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function exportHistoryData(format) {
  const logs = getFilteredHistoryLogs();
  if (!logs.length) {
    showToast('Nenhum registro encontrado para exportar', 'ℹ️');
    return;
  }
  const currentDate = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);

  if (format === 'excel') {
    if (window.XLSX) {
      const rows = logs.map((l, i) => ({
        'Nº': i + 1,
        'Data / Hora': new Date(l.timestamp).toLocaleString('pt-BR'),
        'Produto': l.productName || '—',
        'Código EAN': l.productCode || '—',
        'Operação': l.actionLabel || l.actionType || 'Alteração',
        'Campo': l.actionField || '—',
        'Antes': l.beforeVal || '—',
        'Depois': l.afterVal || '—',
        'Usuário': l.user || '—',
        'Loja': l.store || '—'
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 35 }, { wch: 16 }, { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 16 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Histórico');
      const fileName = `historico_prazocerto_${currentDate}.xlsx`;
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      await downloadFileToDevice(blob, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      showToast('Planilha Excel exportada com sucesso!', '📗', 4000);
    } else {
      showToast('Biblioteca Excel não carregada', '⚠️');
    }
    return;
  }

  if (format === 'csv') {
    let csv = "\uFEFFData/Hora;Produto;Codigo_EAN;Operacao;Campo;Antes;Depois;Usuario;Loja\n";
    logs.forEach(l => {
      const dt = new Date(l.timestamp).toLocaleString('pt-BR');
      csv += `"${dt}";"${(l.productName || '').replace(/;/g, ' ')}";"${l.productCode || ''}";"${l.actionLabel || l.actionType || ''}";"${l.actionField || ''}";"${(l.beforeVal || '').replace(/;/g, ' ')}";"${(l.afterVal || '').replace(/;/g, ' ')}";"${l.user || ''}";"${l.store || ""}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const fileName = `historico_prazocerto_${currentDate}.csv`;
    await downloadFileToDevice(blob, fileName, 'text/csv', csv);
    showToast(`${logs.length} registros exportados (CSV)`, '📊', 4000);
    return;
  }

  if (format === 'pdf') {
    if (window.jspdf && window.jspdf.jsPDF) {
      showToast('Gerando PDF...', '⏳');
      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 24, 'F');
        doc.setTextColor(0, 229, 255);
        doc.setFontSize(16); doc.setFont('helvetica', 'bold');
        doc.text('PRAZOCERTO', 14, 15);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12); doc.setFont('helvetica', 'normal');
        doc.text('Relatório do Histórico de Registros', 70, 15);
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(9);
        doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')} | Total: ${logs.length} registros`, 185, 15);

        const tableBody = logs.map((l, i) => [
          String(i + 1),
          new Date(l.timestamp).toLocaleString('pt-BR'),
          l.productName || '—',
          l.productCode || '—',
          l.actionLabel || l.actionType || '—',
          (l.beforeVal && l.afterVal) ? `${l.beforeVal} → ${l.afterVal}` : (l.afterVal || l.beforeVal || '—'),
          l.user || '—',
          l.store || '—'
        ]);

        doc.autoTable({
          startY: 28,
          head: [['#', 'Data/Hora', 'Produto', 'Código EAN', 'Ação', 'Alteração (Antes→Depois)', 'Usuário', 'Loja']],
          body: tableBody,
          theme: 'striped',
          headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8, textColor: [30, 41, 59], cellPadding: 2.5 },
          columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 32 }, 2: { cellWidth: 60 }, 3: { cellWidth: 26 },
            4: { cellWidth: 36 }, 5: { cellWidth: 50 }, 6: { cellWidth: 30 }, 7: { cellWidth: 32 }
          },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 10, right: 10 },
          didDrawPage: (data) => {
            doc.setFontSize(8); doc.setTextColor(148, 163, 184);
            doc.text(`Página ${data.pageNumber}`, 265, 202);
          }
        });

        const fileName = `historico_prazocerto_${currentDate}.pdf`;
        const pdfBlob = doc.output('blob');
        await downloadFileToDevice(pdfBlob, fileName, 'application/pdf');
        showToast('Relatório PDF exportado!', '📑', 4000);
      } catch (err) {
        console.error('Erro PDF:', err);
        showToast('Erro ao gerar PDF', '⚠️');
      }
    } else {
      showToast('Biblioteca PDF não carregada', '⚠️');
    }
    return;
  }

  if (format === 'json') {
    const jsonStr = JSON.stringify(logs, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const fileName = `historico_prazocerto_${currentDate}.json`;
    await downloadFileToDevice(blob, fileName, 'application/json', jsonStr);
    showToast(`${logs.length} registros exportados (JSON)`, '💾', 4000);
    return;
  }
}
window.exportHistoryData = exportHistoryData;

function addHistoryLog(entry) {
  const logs = getHistoryLogs();
  const newEntry = {
    id: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    timestamp: new Date().toISOString(),
    user: (localStorage.getItem('cv_user_name') || (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.displayName) || 'Usuário'),
    userEmail: (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) || '',
    userRole: window._currentUserRole || 'owner',
    ...entry
  };
  logs.unshift(newEntry);
  if (logs.length > 500) logs.pop();
  saveHistoryLogs(logs);
  return newEntry;
}

window.addHistoryLog = addHistoryLog;
window.getHistoryLogs = getHistoryLogs;

let _histPeriod = 'today';
let _histLimit = 20;
let _currentDetailLogId = null;

function setHistPeriod(period, btn) {
  _histPeriod = period;
  document.querySelectorAll('.hist-period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderHistory();
}
window.setHistPeriod = setHistPeriod;

function resetHistFilters() {
  const storeSel = document.getElementById('histFilterStore');
  const userSel = document.getElementById('histFilterUser');
  const typeSel = document.getElementById('histFilterType');
  const searchInp = document.getElementById('histSearchInput');
  if (storeSel) storeSel.value = 'all';
  if (userSel) userSel.value = 'all';
  if (typeSel) typeSel.value = 'all';
  if (searchInp) searchInp.value = '';
  setHistPeriod('today', document.querySelector('.hist-period-btn[data-period="today"]'));
}
window.resetHistFilters = resetHistFilters;

function toggleHistExportMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('histExportMenu');
  if (menu) menu.classList.toggle('hidden');
}
window.toggleHistExportMenu = toggleHistExportMenu;

document.addEventListener('click', () => {
  const menu = document.getElementById('histExportMenu');
  if (menu && !menu.classList.contains('hidden')) menu.classList.add('hidden');
});



function loadMoreHistory() {
  _histLimit += 20;
  renderHistory();
}
window.loadMoreHistory = loadMoreHistory;

function closeHistoryDetail() {
  const panel = document.getElementById('historyDetailPanel');
  if (panel) panel.classList.add('hidden');
  document.querySelectorAll('.hist-card-box').forEach(el => el.classList.remove('active-selected'));
  _currentDetailLogId = null;
}
window.closeHistoryDetail = closeHistoryDetail;

function openHistoryDetail(logId) {
  const logs = getHistoryLogs();
  const log = logs.find(l => l.id === logId);
  if (!log) return;

  _currentDetailLogId = logId;
  const panel = document.getElementById('historyDetailPanel');
  if (!panel) return;
  panel.classList.remove('hidden');

  document.querySelectorAll('.hist-card-box').forEach(el => {
    if (el.dataset.id === logId) el.classList.add('active-selected');
    else el.classList.remove('active-selected');
  });

  // Imagem do produto
  const imgEl = document.getElementById('histDetailImg');
  if (imgEl) {
    const prodImg = (log.productImg && !log.productImg.includes('basket_icon.png'))
      ? log.productImg
      : resolveProductImage(log.productCode, log.productName);
    imgEl.src = prodImg;
    imgEl.onerror = function () {
      if (this.src.includes('imagens/')) {
        this.src = this.src.replace('imagens/', 'images/');
      } else if (!this.src.includes('prazocerto_basket_3d.png')) {
        this.src = 'images/prazocerto_basket_3d.png';
      }
    };
  }

  // Textos
  const nameEl = document.getElementById('histDetailProdName');
  const codeEl = document.getElementById('histDetailBarcode');
  const badgeEl = document.getElementById('histDetailBadge');
  const dateEl = document.getElementById('histDetailDate');
  const userEl = document.getElementById('histDetailUser');
  const storeEl = document.getElementById('histDetailStore');

  if (nameEl) nameEl.textContent = log.productName || 'Produto';
  if (codeEl) codeEl.textContent = log.productCode || 'Sem código';
  if (badgeEl) {
    badgeEl.textContent = log.actionLabel || 'Alteração';
    badgeEl.className = 'hist-detail-tag badge-' + (log.actionType || 'validade');
  }

  const dtStr = new Date(log.timestamp).toLocaleString('pt-BR');
  if (dateEl) dateEl.textContent = dtStr;
  if (userEl) userEl.textContent = log.user || 'Leandro';
  if (storeEl) storeEl.textContent = log.store || 'Todas as lojas';

  // Seção Alteração realizada
  const changeSec = document.getElementById('histDetailChangeSection');
  const changeTypeEl = document.getElementById('histDetailChangeType');
  const valBeforeEl = document.getElementById('histDetailValBefore');
  const valAfterEl = document.getElementById('histDetailValAfter');

  if (log.actionType === 'cadastro') {
    if (changeSec) changeSec.style.display = 'none';
  } else {
    if (changeSec) changeSec.style.display = 'flex';
    if (changeTypeEl) changeTypeEl.textContent = log.actionField || (log.actionType === 'validade' ? 'Validade' : (log.actionType === 'quantidade' ? 'Quantidade' : 'Categoria'));
    if (valBeforeEl) valBeforeEl.textContent = log.beforeVal || '—';
    if (valAfterEl) valAfterEl.textContent = log.afterVal || '—';
  }

  // Histórico completo deste item específico (mostra TODOS os registros do produto)
  const subtimeline = document.getElementById('histDetailSubtimeline');
  if (subtimeline) {
    const itemLogs = logs.filter(l => {
      if (!l) return false;
      const matchId = log.productId && l.productId === log.productId;
      const matchCode = log.productCode && l.productCode && l.productCode === log.productCode;
      const matchName = log.productName && l.productName && l.productName.toLowerCase().trim() === log.productName.toLowerCase().trim();
      return matchId || matchCode || matchName;
    });

    itemLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (!itemLogs.length) {
      subtimeline.innerHTML = `<div style="font-size:0.75rem; color:#64748b; padding:8px;">Apenas este registro disponível.</div>`;
    } else {
      subtimeline.innerHTML = itemLogs.map(il => {
        let badgeClass = 'badge-validade';
        if (il.actionType === 'cadastro') badgeClass = 'badge-cadastro';
        else if (il.actionType === 'quantidade') badgeClass = 'badge-quantidade';
        else if (il.actionType === 'categoria') badgeClass = 'badge-categoria';
        else if (il.actionType === 'exclusao') badgeClass = 'badge-exclusao';

        const ilDate = new Date(il.timestamp).toLocaleString('pt-BR');
        let detailLine = '';
        if (il.beforeVal && il.afterVal) {
          detailLine = `<span>${escHtml(il.beforeVal)} → <strong>${escHtml(il.afterVal)}</strong></span>`;
        } else if (il.afterVal) {
          detailLine = `<span>${escHtml(il.afterVal)}</span>`;
        }
        return `
          <div class="hist-sub-item-card">
            <div class="hist-sub-item-top">
              <span class="hist-detail-tag ${badgeClass}">${escHtml(il.actionLabel || 'Registro')}</span>
              <span class="hist-sub-item-time">${ilDate}</span>
            </div>
            ${detailLine ? `<div class="hist-sub-item-diff">${detailLine}</div>` : ''}
            <div class="hist-sub-item-meta">
              <span>👤 ${escHtml(il.user || 'Leandro')}</span>
              <span>📍 ${escHtml(il.store || log.store || 'Loja')}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}
window.openHistoryDetail = openHistoryDetail;

function filterByCurrentDetailItem() {
  const logs = getHistoryLogs();
  const log = logs.find(l => l.id === _currentDetailLogId);
  if (log && log.productName) {
    const searchInp = document.getElementById('histSearchInput');
    if (searchInp) {
      searchInp.value = log.productName;
    }
    // Fecha o modal de detalhes
    closeHistoryDetail();
    // Muda o período para 'month' para exibir todas as alterações do item
    setHistPeriod('month', document.querySelector('.hist-period-btn[data-period="month"]'));
    renderHistory();
    showToast(`Mostrando histórico de "${log.productName}"`, '🔍');

    // Rola a tela até o topo da timeline
    const listEl = document.getElementById('historyTimelineList');
    if (listEl) {
      listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
window.filterByCurrentDetailItem = filterByCurrentDetailItem;

// ── CATÁLOGO DANONE EMBUTIDO PARA RESOLUÇÃO INSTANTÂNEA DE IMAGENS ──
const _EMBEDDED_DANONE_CATALOG = [
  {
    "ean": "7891025124320",
    "nome": "Activia Leite Fermentado X6 450g",
    "foto": "7891025124320.jpg"
  },
  {
    "ean": "7891025117742",
    "nome": "Activia Café da Manhã Lin., Mor. e Ban. 170g",
    "foto": "7891025117742.jpg"
  },
  {
    "ean": "7891025117773",
    "nome": "Activia Café da Manhã Quinoa e Fru. Ver. 170g",
    "foto": "7891025117773.jpg"
  },
  {
    "ean": "7891025117797",
    "nome": "Activia Café da Manhã Amaranto e Ma. 170g",
    "foto": "7891025117797.jpg"
  },
  {
    "ean": "7891025123156",
    "nome": "ACTIVIA POLPA 340g X4 AMEIXA",
    "foto": "7891025123156.jpg"
  },
  {
    "ean": "7891025123163",
    "nome": "ACTIVIA POLPA 340g X4 MORANGO",
    "foto": "7891025123163.jpg"
  },
  {
    "ean": "7891025123170",
    "nome": "ACTIVIA POLPA 340g X4 AVEIA",
    "foto": "7891025123170.jpg"
  },
  {
    "ean": "7891025123194",
    "nome": "ACTIVIA POLPA 510g X6 AMEIXA",
    "foto": "7891025123194.jpg"
  },
  {
    "ean": "7891025123200",
    "nome": "ACTIVIA POLPA 510g X6 MORANGO",
    "foto": "7891025123200.jpg"
  },
  {
    "ean": "7891025123217",
    "nome": "ACTIVIA POLPA 510g X6 MAMÃO E CEREAIS",
    "foto": "7891025123217.jpg"
  },
  {
    "ean": "7891025123224",
    "nome": "ACTIVIA POLPA 680g X8 AMEIXA",
    "foto": "7891025123224.jpg"
  },
  {
    "ean": "7891025123231",
    "nome": "ACTIVIA POLPA 680g X8 MORANGO",
    "foto": "7891025123231.jpg"
  },
  {
    "ean": "7891025123248",
    "nome": "ACTIVIA POLPA 680g X8 MAMÃO E CEREAIS",
    "foto": "7891025123248.jpg"
  },
  {
    "ean": "7891025123255",
    "nome": "ACTIVIA POLPA 510g X6 ZERO AMEIXA",
    "foto": "7891025123255.jpg"
  },
  {
    "ean": "7891025123828",
    "nome": "ACTIVIA POLPA 510g X6 ZERO MORANGO",
    "foto": "7891025123828.jpg"
  },
  {
    "ean": "7891025102656",
    "nome": "Activia Líquido Morango 150g",
    "foto": "7891025102656.jpg"
  },
  {
    "ean": "7891025102663",
    "nome": "Activia Líquido Ameixa 150g",
    "foto": "7891025102663.jpg"
  },
  {
    "ean": "7891025114666",
    "nome": "Activia Shot Framb. e Hib. Lf. 100g",
    "foto": "7891025114666.jpg"
  },
  {
    "ean": "7891025114673",
    "nome": "Activia Shot Tradicional Lf. 100g",
    "foto": "7891025114673.jpg"
  },
  {
    "ean": "7891025122432",
    "nome": "Activia Shot Morango Lf. 100g",
    "foto": "7891025122432.jpg"
  },
  {
    "ean": "7891025109396",
    "nome": "Activia Líquido Morango 170g",
    "foto": "7891025109396.jpg"
  },
  {
    "ean": "7891025109419",
    "nome": "Activia Líquido Ameixa 170g",
    "foto": "7891025109419.jpg"
  },
  {
    "ean": "7891025109433",
    "nome": "Activia Líquido Aveia 170g",
    "foto": "7891025109433.jpg"
  },
  {
    "ean": "7891025119319",
    "nome": "ACTIVIA LIQ COCO CHAI 220G",
    "foto": "7891025119319.jpg"
  },
  {
    "ean": "7891025119326",
    "nome": "ACTIVIA LIQ AMORA CRANBERRY 220G",
    "foto": "7891025119326.jpg"
  },
  {
    "ean": "7891025125020",
    "nome": "Activia Líquido Pêssego Leite Ferm 170g",
    "foto": "7891025125020.jpg"
  },
  {
    "ean": "7891025125037",
    "nome": "Activia Líquido Kiwi Leite Ferm 170g",
    "foto": "7891025125037.jpg"
  },
  {
    "ean": "7891025117131",
    "nome": "Activia Zero Líquido Ameixa 170g",
    "foto": "7891025117131.jpg"
  },
  {
    "ean": "7891025117162",
    "nome": "Activia Zero Líquido Morango 170g",
    "foto": "7891025117162.jpg"
  },
  {
    "ean": "7891025123453",
    "nome": "Activia Líquido Ameixa 800g",
    "foto": "7891025123453.jpg"
  },
  {
    "ean": "7891025123460",
    "nome": "Activia Líquido Aveia 800g",
    "foto": "7891025123460.jpg"
  },
  {
    "ean": "7891025123477",
    "nome": "Activia Líquido Morango 800g",
    "foto": "7891025123477.jpg"
  },
  {
    "ean": "7891025123484",
    "nome": "Activia Líquido Vitamina de Frutas 800g",
    "foto": "7891025123484.jpg"
  },
  {
    "ean": "7891025125044",
    "nome": "Activia Líquido Pêssego 800g",
    "foto": "7891025125044.jpg"
  },
  {
    "ean": "7891025125051",
    "nome": "Activia Líquido Kiwi 800g",
    "foto": "7891025125051.jpg"
  },
  {
    "ean": "7891025112914",
    "nome": "Activia Líquido Morango 1kg",
    "foto": "7891025112914.jpg"
  },
  {
    "ean": "7891025112921",
    "nome": "Activia Líquido Ameixa 1kg",
    "foto": "7891025112921.jpg"
  },
  {
    "ean": "7891025124023",
    "nome": "Activia Zero Líquido Ameixa 800g",
    "foto": "7891025124023.jpg"
  },
  {
    "ean": "7891025124030",
    "nome": "Activia Zero Líquido Morango 800g",
    "foto": "7891025124030.jpg"
  },
  {
    "ean": "7891025116592",
    "nome": "Activia Zero Líquido Morango 1kg",
    "foto": "7891025116592.jpg"
  },
  {
    "ean": "7891025116608",
    "nome": "Activia Zero Líquido Ameixa 1kg",
    "foto": "7891025116608.jpg"
  },
  {
    "ean": "7891025113447",
    "nome": "Actimel Lte. Ferm. Morango 100g",
    "foto": "7891025113447.jpg"
  },
  {
    "ean": "7891025113454",
    "nome": "Actimel Lte. Ferm. Tradicional 100g",
    "foto": "7891025113454.jpg"
  },
  {
    "ean": "7891025105220",
    "nome": "Actimel Lte. Ferment. Morango 600g",
    "foto": "7891025105220.jpg"
  },
  {
    "ean": "7891025700982",
    "nome": "Actimel Lte. Ferment. Tradicional 600g",
    "foto": "7891025700982.jpg"
  },
  {
    "ean": "7891025120674",
    "nome": "Corpus Polpa Morango 540g",
    "foto": "7891025120674.jpg"
  },
  {
    "ean": "7891025114406",
    "nome": "Corpus Líquido sem Lac. Morango 170g",
    "foto": "7891025114406.jpg"
  },
  {
    "ean": "7891025124160",
    "nome": "Corpus Líquido Vitamina de Fruta 800g",
    "foto": "7891025124160.jpg"
  },
  {
    "ean": "7891025124177",
    "nome": "Corpus Líquido Morango 800g",
    "foto": "7891025124177.jpg"
  },
  {
    "ean": "7891025124184",
    "nome": "Corpus Líquido Amora e Maracujá 800g",
    "foto": "7891025124184.jpg"
  },
  {
    "ean": "7891025107392",
    "nome": "Danoninho Morango Qj. Petit Suisse 80g",
    "foto": "7891025107392.jpg"
  },
  {
    "ean": "7891025109884",
    "nome": "Danoninho Multi Qj. Petit Suisse 320g",
    "foto": "7891025109884.jpg"
  },
  {
    "ean": "7891025109891",
    "nome": "Danoninho Mor. Qj. Petit Suisse 320g",
    "foto": "7891025109891.jpg"
  },
  {
    "ean": "7891025109907",
    "nome": "Danoninho Mor. 480g",
    "foto": "7891025109907.jpg"
  },
  {
    "ean": "7891025109938",
    "nome": "Danoninho Mor. e Ban. Qj. Petit Suisse 480g",
    "foto": "7891025109938.jpg"
  },
  {
    "ean": "7891025119524",
    "nome": "Danoninho Multi Qj Petit Suisse 480g",
    "foto": "7891025119524.jpg"
  },
  {
    "ean": "7891025110668",
    "nome": "Danoninho Para Levar Morango 70g",
    "foto": "7891025110668.jpg"
  },
  {
    "ean": "7891025112983",
    "nome": "Danoninho Para Levar Morango e Banana 70g",
    "foto": "7891025112983.jpg"
  },
  {
    "ean": "7891025122241",
    "nome": "Danoninho Ice Mix Morango 70g",
    "foto": "7891025122241.jpg"
  },
  {
    "ean": "7891025106067",
    "nome": "Danoninho para beber Morango 100g",
    "foto": "7891025106067.jpg"
  },
  {
    "ean": "7891025107255",
    "nome": "Danoninho para beber Banana e Maçã 100g",
    "foto": "7891025107255.jpg"
  },
  {
    "ean": "7891025124634",
    "nome": "DANONINHO BOM DIA BANANA COM AVEIA 90g",
    "foto": "7891025124634.jpg"
  },
  {
    "ean": "7891025124641",
    "nome": "DANONINHO BOM DIA MORANGO COM AVEIA 90g",
    "foto": "7891025124641.jpg"
  },
  {
    "ean": "7891025124535",
    "nome": "DANONINHO BOM DIA BANANA COM AVEIA 70g",
    "foto": "7891025124535.jpg"
  },
  {
    "ean": "7891025124542",
    "nome": "DANONINHO BOM DIA MORANGO COM AVEIA 70g",
    "foto": "7891025124542.jpg"
  },
  {
    "ean": "7891025124917",
    "nome": "Danette Cremosão Doce de Leite 90g",
    "foto": "7891025124917.jpg"
  },
  {
    "ean": "7891025124924",
    "nome": "Danette Cremosão Chocolate com Avelã 90g",
    "foto": "7891025124924.jpg"
  },
  {
    "ean": "7891025110897",
    "nome": "Danette Chocolate 180g",
    "foto": "7891025110897.jpg"
  },
  {
    "ean": "7891025119456",
    "nome": "Danette Chocolate Unitário 90g",
    "foto": "7891025119456.jpg"
  },
  {
    "ean": "7891025124870",
    "nome": "Danette Chocolate Branco 180g",
    "foto": "7891025124870.jpg"
  },
  {
    "ean": "7891025121602",
    "nome": "Danette Choc. Branco 540g",
    "foto": "7891025121602.jpg"
  },
  {
    "ean": "7891025121619",
    "nome": "Danette Chocolate 540g",
    "foto": "7891025121619.jpg"
  },
  {
    "ean": "7891025200680",
    "nome": "Danette Choc. Branco 360g",
    "foto": "7891025200680.jpg"
  },
  {
    "ean": "7891025201786",
    "nome": "Danette Chocolate 360g",
    "foto": "7891025201786.jpg"
  },
  {
    "ean": "7891025105244",
    "nome": "Danette Chocolate 720g",
    "foto": "7891025105244.jpg"
  },
  {
    "ean": "7891025119807",
    "nome": "DANETTE UHT SABOR CHOCOLATE 200ml",
    "foto": "7891025119807.jpg"
  },
  {
    "ean": "7891025121640",
    "nome": "Danone Kids Polpa Morango 510g",
    "foto": "7891025121640.jpg"
  },
  {
    "ean": "7891025124436",
    "nome": "Danone Kids Polpa Multi 510g",
    "foto": "7891025124436.jpg"
  },
  {
    "ean": "7891025124474",
    "nome": "Danone Kids Liquido Banana Maçã 800g",
    "foto": "7891025124474.jpg"
  },
  {
    "ean": "7891025124481",
    "nome": "Danone Kids Liquido Morango 150g",
    "foto": "7891025124481.jpg"
  },
  {
    "ean": "7891025124498",
    "nome": "Danone Kids Liquido Banana Maçã 150g",
    "foto": "7891025124498.jpg"
  },
  {
    "ean": "7891025124504",
    "nome": "Danone Kids Liquido Morango 800g",
    "foto": "7891025124504.jpg"
  },
  {
    "ean": "7891025120223",
    "nome": "Danone Natural Desnatado 160g",
    "foto": "7891025120223.jpg"
  },
  {
    "ean": "7891025120230",
    "nome": "Danone Natural Integral 160g",
    "foto": "7891025120230.jpg"
  },
  {
    "ean": "7891025121244",
    "nome": "Danone Natural Mel 160g",
    "foto": "7891025121244.jpg"
  },
  {
    "ean": "7891025121251",
    "nome": "Danone Natural Lar ,Cen e Mel 160g",
    "foto": "7891025121251.jpg"
  },
  {
    "ean": "7891025101161",
    "nome": "Danone Líquido Vit. de Frutas 170g",
    "foto": "7891025101161.jpg"
  },
  {
    "ean": "7891025101376",
    "nome": "Danone Líquido Morango 170g",
    "foto": "7891025101376.jpg"
  },
  {
    "ean": "7891025119852",
    "nome": "Danone Liquido Vitamina De Frutas 850g",
    "foto": "7891025119852.jpg"
  },
  {
    "ean": "7891025119869",
    "nome": "Danone Liquido Morango 850g",
    "foto": "7891025119869.jpg"
  },
  {
    "ean": "7891025106548",
    "nome": "Danone Líquido Vitamina de Frutas 1,35kg",
    "foto": "7891025106548.jpg"
  },
  {
    "ean": "7891025117360",
    "nome": "Danone Líquido Coco 1,35kg",
    "foto": "7891025117360.jpg"
  },
  {
    "ean": "7891025121909",
    "nome": "Danone Líquido Coco 1,25kg",
    "foto": "7891025121909.jpg"
  },
  {
    "ean": "7891025121916",
    "nome": "Danone Líquido Vitamina de Frutas 1,25kg",
    "foto": "7891025121916.jpg"
  },
  {
    "ean": "7891025121923",
    "nome": "Danone Líquido Morango 1,25kg",
    "foto": "7891025121923.jpg"
  },
  {
    "ean": "7891025320555",
    "nome": "Danone Líquido Morango 1,35kg",
    "foto": "7891025320555.jpg"
  },
  {
    "ean": "7891025121626",
    "nome": "Danone Polpa Morango 510g",
    "foto": "7891025121626.jpg"
  },
  {
    "ean": "7891025121633",
    "nome": "Danone Polpa Mix Frutas 510g",
    "foto": "7891025121633.jpg"
  },
  {
    "ean": "7891025124559",
    "nome": "DANONE MAIS PROTEÍNAS COCO 220g",
    "foto": "7891025124559.jpg"
  },
  {
    "ean": "7891025124566",
    "nome": "DANONE MAIS PROTEÍNAS MORANGO 220g",
    "foto": "7891025124566.jpg"
  },
  {
    "ean": "7891025124573",
    "nome": "DANONE POLPA MAIS PROTEÍNAS MORANGO 160g",
    "foto": "7891025124573.jpg"
  },
  {
    "ean": "7891025124597",
    "nome": "DANONE POLPA MAIS PROTEÍNAS BAUNILHA 160g",
    "foto": "7891025124597.jpg"
  },
  {
    "ean": "7891025124603",
    "nome": "DANONE POLPA MAIS PROTEÍNAS ORIGINAL 160g",
    "foto": "7891025124603.jpg"
  },
  {
    "ean": "7891025124443",
    "nome": "DANONE LIQUIDO MORANGO E AVEIA 800g",
    "foto": "7891025124443.jpg"
  },
  {
    "ean": "7891025124450",
    "nome": "DANONE LIQUIDO BANANA, AVEIA E MEL 800g",
    "foto": "7891025124450.jpg"
  },
  {
    "ean": "7891025124467",
    "nome": "DANONE LIQUIDO ORIGINAL COM AVEIA 800g",
    "foto": "7891025124467.jpg"
  },
  {
    "ean": "7891025124849",
    "nome": "DANONE LIQUIDO ORIGINAL COM AVEIA 170g",
    "foto": "7891025124849.jpg"
  },
  {
    "ean": "7891025124856",
    "nome": "DANONE LIQUIDO BANANA, AVEIA E MEL 170g",
    "foto": "7891025124856.jpg"
  },
  {
    "ean": "7891025124863",
    "nome": "DANONE LIQUIDO MORANGO E AVEIA 170g",
    "foto": "7891025124863.jpg"
  },
  {
    "ean": "7891025124702",
    "nome": "DANONE POLPA MORANGO E AVEIA 340g",
    "foto": "7891025124702.jpg"
  },
  {
    "ean": "7891025124733",
    "nome": "DANONE POLPA ORIGINAL COM AVEIA 340g",
    "foto": "7891025124733.jpg"
  },
  {
    "ean": "7891025123033",
    "nome": "DANONE GREGO CHOCOLATE C/MOR POTE 90g x1",
    "foto": "7891025123033.jpg"
  },
  {
    "ean": "7891025123040",
    "nome": "DANONE GREGO FLOCOS POTE 90g x1",
    "foto": "7891025123040.jpg"
  },
  {
    "ean": "7891025123057",
    "nome": "DANONE GREGO FRUTAS VERMELHAS POTE 90g x1",
    "foto": "7891025123057.jpg"
  },
  {
    "ean": "7891025123064",
    "nome": "DANONE GREGO TRADICIONAL POTE 90g X1",
    "foto": "7891025123064.jpg"
  },
  {
    "ean": "7891025123361",
    "nome": "DANONE GREGO BANDEJA ORIGINAL 340g x4",
    "foto": "7891025123361.jpg"
  },
  {
    "ean": "7891025123378",
    "nome": "DANONE GREGO BAN ORI E FRUT. VERM 510g",
    "foto": "7891025123378.jpg"
  },
  {
    "ean": "7891025123392",
    "nome": "DANONE GREGO BAN LIGHT ORI E MOR 510g x6",
    "foto": "7891025123392.jpg"
  },
  {
    "ean": "7891025115304",
    "nome": "YoPRO Banana c/ Pasta de Amendoim 160g",
    "foto": "7891025115304.jpg"
  },
  {
    "ean": "7891025115311",
    "nome": "YoPRO Morango 160g",
    "foto": "7891025115311.jpg"
  },
  {
    "ean": "7891025115335",
    "nome": "YoPRO Coco Cremoso 160g",
    "foto": "7891025115335.jpg"
  },
  {
    "ean": "7891025116943",
    "nome": "YoPRO Polpa Natural 160g",
    "foto": "7891025116943.jpg"
  },
  {
    "ean": "7891025115588",
    "nome": "YoPRO Líquido Doce de Leite 250g",
    "foto": "7891025115588.jpg"
  },
  {
    "ean": "7891025115595",
    "nome": "YoPRO Líquido Morango 250g",
    "foto": "7891025115595.jpg"
  },
  {
    "ean": "7891025118312",
    "nome": "YoPRO Líquido Café Expresso 250g",
    "foto": "7891025118312.jpg"
  },
  {
    "ean": "7891025121435",
    "nome": "YoPRO Pouch Morango 160g",
    "foto": "7891025121435.jpg"
  },
  {
    "ean": "7891025121442",
    "nome": "YoPRO Pouch Acaí c/ Banana 160g",
    "foto": "7891025121442.jpg"
  },
  {
    "ean": "7891025124290",
    "nome": "YoPRO Pouch Banana c/ Pasta de Amendoim 160g",
    "foto": "7891025124290.jpg"
  },
  {
    "ean": "7891025123323",
    "nome": "YoPRO Líquido Morango 250g",
    "foto": "7891025123323.jpg"
  },
  {
    "ean": "7891025124207",
    "nome": "YOPRO LIQUIDO MORANGO 15g PROTEINAS 500g",
    "foto": "7891025124207.jpg"
  },
  {
    "ean": "7891025124214",
    "nome": "YOPRO LIQUIDO DOCE DE LEITE 15g PROTEINA 500g",
    "foto": "7891025124214.jpg"
  },
  {
    "ean": "7891025115632",
    "nome": "YoPRO Beb. Láctea UHT Banana 250ml",
    "foto": "7891025115632.jpg"
  },
  {
    "ean": "7891025115649",
    "nome": "YoPRO Beb. Láctea UHT Coco c/ Bat. Doce 250ml",
    "foto": "7891025115649.jpg"
  },
  {
    "ean": "7891025115656",
    "nome": "YoPRO Beb. Láctea UHT Chocolate 250ml",
    "foto": "7891025115656.jpg"
  },
  {
    "ean": "7891025122067",
    "nome": "YoPRO Beb. Láctea UHT Morango 250ml",
    "foto": "7891025122067.jpg"
  },
  {
    "ean": "7891025124252",
    "nome": "YOPRO UHT CAPPUCCINO 15g PROTEINA 250ml",
    "foto": "7891025124252.jpg"
  },
  {
    "ean": "7891025124269",
    "nome": "YOPRO UHT CAFE EXPRESSO 15g PROTEINA 250ml",
    "foto": "7891025124269.jpg"
  },
  {
    "ean": "7891025124627",
    "nome": "YOPRO UHT BAUNILHA 15g PROTEINA 250ml",
    "foto": "7891025124627.jpg"
  },
  {
    "ean": "7891025125013",
    "nome": "YOPRO UHT DOCE DE LEITE15g PROTEINA 250ml",
    "foto": "7891025125013.jpg"
  },
  {
    "ean": "7891025118978",
    "nome": "YoPRO Beb. Láctea UHT 25g Choc 250ml",
    "foto": "7891025118978.jpg"
  },
  {
    "ean": "7891025118985",
    "nome": "YoPRO Beb. Láctea UHT 25g Pro Milk Bau 250ml",
    "foto": "7891025118985.jpg"
  },
  {
    "ean": "7891025122050",
    "nome": "YoPRO UHT Chocolate 1L x1 15g",
    "foto": "7891025122050.jpg"
  },
  {
    "ean": "7891025122043",
    "nome": "YoPRO UHT 250ml Pack X12 15g Chocolate",
    "foto": "7891025122043.jpg"
  },
  {
    "ean": "7891025124221",
    "nome": "YoPRO UHT 250ml Pack X12 15g COC/ BAT DOC",
    "foto": "7891025124221.jpg"
  },
  {
    "ean": "7891025124818",
    "nome": "YoPRO UHT 250ml Pack X12 15g BAUNILHA",
    "foto": "7891025124818.jpg"
  },
  {
    "ean": "7891025124825",
    "nome": "YoPRO UHT 250ml Pack X12 15g BANANA",
    "foto": "7891025124825.jpg"
  },
  {
    "ean": "7891025124832",
    "nome": "YoPRO UHT 250ml Pack X12 15g MORANGO",
    "foto": "7891025124832.jpg"
  },
  {
    "ean": "7891025115199",
    "nome": "Silk Amêndoa com açúcar",
    "foto": "7891025115199.jpg"
  },
  {
    "ean": "7891025115229",
    "nome": "Silk Amêndoa sem açúcar",
    "foto": "7891025115229.jpg"
  },
  {
    "ean": "7891025116905",
    "nome": "Silk Castanha de Caju",
    "foto": "7891025116905.jpg"
  },
  {
    "ean": "7891025116936",
    "nome": "Silk Coco",
    "foto": "7891025116936.jpg"
  },
  {
    "ean": "7891025117049",
    "nome": "Silk Amêndoa e Cacau",
    "foto": "7891025117049.jpg"
  },
  {
    "ean": "7891025123095",
    "nome": "DANONE MANTEIGA POTE S/SAL 200g X1",
    "foto": "7891025123095.jpg"
  },
  {
    "ean": "7891025123101",
    "nome": "DANONE MANTEIGA POTE C/SAL 200g x1",
    "foto": "7891025123101.jpg"
  },
  {
    "ean": "7891025123132",
    "nome": "DANONE MANTEIGA 200g x1 S/ SAL TABLETE",
    "foto": "7891025123132.jpg"
  },
  {
    "ean": "7891025123149",
    "nome": "DANONE MANTEIGA 200g x1 C/ SAL TABLETE",
    "foto": "7891025123149.jpg"
  },
  {
    "ean": "7891025116790",
    "nome": "Danone Requeijão Cremoso Light 200g",
    "foto": "7891025116790.jpg"
  },
  {
    "ean": "7891025699880",
    "nome": "Danone Requeijão Cremoso Tradicional 200g",
    "foto": "7891025699880.jpg"
  },
  {
    "ean": "7622210772244",
    "nome": "Philadelphia Pote Zero Lactose 150g",
    "foto": "7622210772244.jpg"
  },
  {
    "ean": "7893333325000",
    "nome": "Philadelphia Pote Original 150g",
    "foto": "7893333325000.jpg"
  },
  {
    "ean": "7622300801779",
    "nome": "Philadelphia Pote Original 300g",
    "foto": "7622300801779.jpg"
  },
  {
    "ean": "7622300801786",
    "nome": "Philadelphia Pote Light 300g",
    "foto": "7622300801786.jpg"
  },
  {
    "ean": "7893333325109",
    "nome": "Philadelphia Pote Light 150g",
    "foto": "7893333325109.jpg"
  },
  {
    "ean": "7622300444242",
    "nome": "Philadelphia Bisnaga 1,5kg",
    "foto": "7622300444242.jpg"
  },
  {
    "ean": "7622300803001",
    "nome": "Philadelphia Bisnaga 400g",
    "foto": "7622300803001.jpg"
  },
  {
    "ean": "7622202306907",
    "nome": "Philadelphia Balde 3,6kg 147137 298",
    "foto": "7622202306907.jpg"
  },
  {
    "ean": "7622300992514",
    "nome": "Philadelphia Bisnaga 1kg",
    "foto": "7622300992514.jpg"
  },
  {
    "ean": "7891025107880",
    "nome": "APTAMIL PREMIUM 2 400g",
    "foto": "7891025107880.jpg"
  },
  {
    "ean": "7891025107897",
    "nome": "APTAMIL PREMIUM 2 800g",
    "foto": "7891025107897.jpg"
  },
  {
    "ean": "7891025111825",
    "nome": "APTAMIL PREMIUM 1 800g",
    "foto": "7891025111825.jpg"
  },
  {
    "ean": "7891025111832",
    "nome": "APTAMIL PREMIUM 1 400g",
    "foto": "7891025111832.jpg"
  },
  {
    "ean": "8718117114788",
    "nome": "APTAMIL PRE 400g",
    "foto": "8718117114788.jpg"
  },
  {
    "ean": "8718117114795",
    "nome": "APTAMIL PRE TRANSITION 400g",
    "foto": "8718117114795.jpg"
  },
  {
    "ean": "8718117614783",
    "nome": "APTAMIL PRE 400g",
    "foto": "8718117614783.jpg"
  },
  {
    "ean": "8718117614790",
    "nome": "APTAMIL PRE TRANSITION 400g",
    "foto": "8718117614790.jpg"
  },
  {
    "ean": "7891025112679",
    "nome": "APTAMIL PROFUTURA 1 400g",
    "foto": "7891025112679.jpg"
  },
  {
    "ean": "7891025112686",
    "nome": "APTAMIL PROFUTURA 1 800g",
    "foto": "7891025112686.jpg"
  },
  {
    "ean": "7891025112709",
    "nome": "APTAMIL PROFUTURA 2 800g",
    "foto": "7891025112709.jpg"
  },
  {
    "ean": "7891025123491",
    "nome": "APTAMIL PROFUTURA GOLD 1 800g",
    "foto": "7891025123491.jpg"
  },
  {
    "ean": "7891025123507",
    "nome": "APTAMIL PROFUTURA GOLD 2 800g",
    "foto": "7891025123507.jpg"
  },
  {
    "ean": "7795323001461",
    "nome": "APTAMIL SOJA 800g",
    "foto": "7795323001461.jpg"
  },
  {
    "ean": "7891025107323",
    "nome": "APTAMIL SL 800g",
    "foto": "7891025107323.jpg"
  },
  {
    "ean": "7891025112655",
    "nome": "APTAMIL RR 400g",
    "foto": "7891025112655.jpg"
  },
  {
    "ean": "7891025112662",
    "nome": "APTAMIL RR 800g",
    "foto": "7891025112662.jpg"
  },
  {
    "ean": "7891025119982",
    "nome": "APTAMIL PEPTI 800g",
    "foto": "7891025119982.jpg"
  },
  {
    "ean": "7891025119999",
    "nome": "APTAMIL PEPTI 400g",
    "foto": "7891025119999.jpg"
  },
  {
    "ean": "7891025120025",
    "nome": "APTAMIL SENSITIVE ACTIVE 800g",
    "foto": "7891025120025.jpg"
  },
  {
    "ean": "7891025124887",
    "nome": "APTAMIL ESPESSADO 800g",
    "foto": "7891025124887.jpg"
  },
  {
    "ean": "8712400746113",
    "nome": "APTAMIL SOJA 400g",
    "foto": "8712400746113.jpg"
  },
  {
    "ean": "8712400801553",
    "nome": "APTAMIL SL 400g",
    "foto": "8712400801553.jpg"
  },
  {
    "ean": "7891025120643",
    "nome": "APTAMIL APTABOX PREMIUM 2 1,5kg",
    "foto": "7891025120643.jpg"
  },
  {
    "ean": "7891025120667",
    "nome": "APTAMIL APTABOX PREMIUM 1 1,5kg",
    "foto": "7891025120667.jpg"
  },
  {
    "ean": "7891025107910",
    "nome": "APTANUTRI PREMIUM 3 800g",
    "foto": "7891025107910.jpg"
  },
  {
    "ean": "7891025118763",
    "nome": "APTANUTRI PROFUTURA 3 800g",
    "foto": "7891025118763.jpg"
  },
  {
    "ean": "7891025123934",
    "nome": "APTANUTRI PREMIUM 3 800g",
    "foto": "7891025123934.jpg"
  },
  {
    "ean": "7795323776116",
    "nome": "APTANUTRI SOJA 800g",
    "foto": "7795323776116.jpg"
  },
  {
    "ean": "7891025124894",
    "nome": "PACK DESCONTO APTANUTRI PREMIUM 800G",
    "foto": "7891025124894.jpg"
  },
  {
    "ean": "7891025113096",
    "nome": "FORTINI COMPLETE VITAMINA DE FRUTAS 400g",
    "foto": "7891025113096.jpg"
  },
  {
    "ean": "7891025113102",
    "nome": "FORTINI COMPLETE VITAMINA DE FRUTAS 800g",
    "foto": "7891025113102.jpg"
  },
  {
    "ean": "7891025113171",
    "nome": "FORTINI PLUS SEM SABOR 400g",
    "foto": "7891025113171.jpg"
  },
  {
    "ean": "7891025113201",
    "nome": "FORTINI PLUS PO BAUNILHA 400g",
    "foto": "7891025113201.jpg"
  },
  {
    "ean": "7891025113867",
    "nome": "FORTINI COMPLETE BAUNILHA 400g",
    "foto": "7891025113867.jpg"
  },
  {
    "ean": "7891025113874",
    "nome": "FORTINI COMPLETE BAUNILHA 800g",
    "foto": "7891025113874.jpg"
  },
  {
    "ean": "7891025118855",
    "nome": "FORTINI COMPLETE CHOCOLATE 800g",
    "foto": "7891025118855.jpg"
  },
  {
    "ean": "7891025118862",
    "nome": "FORTINI COMPLETE CHOCOLATE 400g",
    "foto": "7891025118862.jpg"
  },
  {
    "ean": "8712400155861",
    "nome": "FORTINI PLUS MULTI FIBER BAUNILHA 200ml",
    "foto": "8712400155861.jpg"
  },
  {
    "ean": "8712400155908",
    "nome": "FORTINI PLUS MULTI FIBER MORANGO 200ml",
    "foto": "8712400155908.jpg"
  },
  {
    "ean": "8712400156004",
    "nome": "FORTINI PLUS MULTI FIBER CHOCOLATE 200ml",
    "foto": "8712400156004.jpg"
  },
  {
    "ean": "8712400655866",
    "nome": "FORTINI PLUS MULTI FIBER BAUNILHA 200ml",
    "foto": "8712400655866.jpg"
  },
  {
    "ean": "8712400655903",
    "nome": "FORTINI PLUS MULTI FIBER MORANGO 200ml",
    "foto": "8712400655903.jpg"
  },
  {
    "ean": "8712400656009",
    "nome": "FORTINI PLUS MULTI FIBER CHOCOLATE 200ml",
    "foto": "8712400656009.jpg"
  },
  {
    "ean": "7891025119715",
    "nome": "INFATRINI 400g",
    "foto": "7891025119715.jpg"
  },
  {
    "ean": "8716900564963",
    "nome": "INFATRINI 125ml",
    "foto": "8716900564963.jpg"
  },
  {
    "ean": "8716900564970",
    "nome": "INFATRINI 125ml",
    "foto": "8716900564970.jpg"
  },
  {
    "ean": "7891025107842",
    "nome": "MILNUTRI PREMIUM 800g",
    "foto": "7891025107842.jpg"
  },
  {
    "ean": "7891025107859",
    "nome": "MILNUTRI PREMIUM 400g",
    "foto": "7891025107859.jpg"
  },
  {
    "ean": "7891025112105",
    "nome": "MILNUTRI PREMIUM BANANA E MAÇÃ 760g",
    "foto": "7891025112105.jpg"
  },
  {
    "ean": "7891025114185",
    "nome": "MILNUTRI PROFUTURA 800g",
    "foto": "7891025114185.jpg"
  },
  {
    "ean": "7891025107095",
    "nome": "MILNUTRI SOJA 800g",
    "foto": "7891025107095.jpg"
  },
  {
    "ean": "5016533637120",
    "nome": "NEOADVANCE 400g",
    "foto": "5016533637120.jpg"
  },
  {
    "ean": "5016533637137",
    "nome": "NEOADVANCE 400g",
    "foto": "5016533637137.jpg"
  },
  {
    "ean": "5016533657838",
    "nome": "NEOCATE LCP 400g",
    "foto": "5016533657838.jpg"
  },
  {
    "ean": "5016533657845",
    "nome": "NEOCATE LCP 400g",
    "foto": "5016533657845.jpg"
  },
  {
    "ean": "5016533646726",
    "nome": "NEOFORTE BAUNILHA 400g",
    "foto": "5016533646726.jpg"
  },
  {
    "ean": "5016533646733",
    "nome": "NEOFORTE BAUNILHA 400g",
    "foto": "5016533646733.jpg"
  },
  {
    "ean": "5016533649208",
    "nome": "NEOSPOON 400g",
    "foto": "5016533649208.jpg"
  },
  {
    "ean": "5016533650334",
    "nome": "NEOFORTE MORANGO 400g",
    "foto": "5016533650334.jpg"
  },
  {
    "ean": "5016533650341",
    "nome": "NEOFORTE MORANGO 400g",
    "foto": "5016533650341.jpg"
  },
  {
    "ean": "7891025119876",
    "nome": "PREGOMIN PEPTI 400g",
    "foto": "7891025119876.jpg"
  },
  {
    "ean": "7891025124368",
    "nome": "PREGOMIN PLUS 400g",
    "foto": "7891025124368.jpg"
  },
  {
    "ean": "8712400155670",
    "nome": "CALOGEN SEM SABOR (PB 200ml)",
    "foto": "8712400155670.jpg"
  },
  {
    "ean": "8716900569210",
    "nome": "CALOGEN SEM SABOR (PB 200ml)",
    "foto": "8716900569210.jpg"
  },
  {
    "ean": "8712400155045",
    "nome": "CUBITAN BAUNILHA (PB 200ml)",
    "foto": "8712400155045.jpg"
  },
  {
    "ean": "8712400155120",
    "nome": "CUBITAN MORANGO (PB 200ml)",
    "foto": "8712400155120.jpg"
  },
  {
    "ean": "8712400155205",
    "nome": "CUBITAN CHOCOLATE (PB 200ml)",
    "foto": "8712400155205.jpg"
  },
  {
    "ean": "8712400655040",
    "nome": "CUBITAN BAUNILHA (PB 200ml)",
    "foto": "8712400655040.jpg"
  },
  {
    "ean": "8712400655125",
    "nome": "CUBITAN MORANGO (PB 200ml)",
    "foto": "8712400655125.jpg"
  },
  {
    "ean": "8712400655200",
    "nome": "CUBITAN CHOCOLATE (PB 200ml)",
    "foto": "8712400655200.jpg"
  },
  {
    "ean": "8716900580758",
    "nome": "Diasip Baunilha PB 200ml",
    "foto": "8716900580758.jpg"
  },
  {
    "ean": "8716900580765",
    "nome": "Diasip Baunilha PB 200ml",
    "foto": "8716900580765.jpg"
  },
  {
    "ean": "8716900581236",
    "nome": "Diasip Morango PB 200ml",
    "foto": "8716900581236.jpg"
  },
  {
    "ean": "5016533648331",
    "nome": "HCU ANAMIX JUNIOR 400g",
    "foto": "5016533648331.jpg"
  },
  {
    "ean": "5016533648348",
    "nome": "HCU ANAMIX JUNIOR 400g",
    "foto": "5016533648348.jpg"
  },
  {
    "ean": "4008976413073",
    "nome": "KETOCAL 4:1 (LT 300g)",
    "foto": "4008976413073.jpg"
  },
  {
    "ean": "4008976459361",
    "nome": "KETOCAL 4:1 (LT 300g)",
    "foto": "4008976459361.jpg"
  },
  {
    "ean": "4008976455387",
    "nome": "MONOGEN",
    "foto": "4008976455387.jpg"
  },
  {
    "ean": "5016533635737",
    "nome": "MONOGEN",
    "foto": "5016533635737.jpg"
  },
  {
    "ean": "5016533649314",
    "nome": "MSUD 2 PRIMA (LT 500g)",
    "foto": "5016533649314.jpg"
  },
  {
    "ean": "5016533649321",
    "nome": "MSUD 2 PRIMA (LT 500g)",
    "foto": "5016533649321.jpg"
  },
  {
    "ean": "4008976467465",
    "nome": "NUTILIS (LT 300g)",
    "foto": "4008976467465.jpg"
  },
  {
    "ean": "4008976681267",
    "nome": "NUTILIS (LT 300g)",
    "foto": "4008976681267.jpg"
  },
  {
    "ean": "5016533650372",
    "nome": "NUTILIS CLEAR 6X175g ES IT PT",
    "foto": "5016533650372.jpg"
  },
  {
    "ean": "5016533650389",
    "nome": "NUTILIS CLEAR 6X175g ES IT PT",
    "foto": "5016533650389.jpg"
  },
  {
    "ean": "5016533648379",
    "nome": "MMA/PA ANAMIX JUNIOR 3X400g MLL1 (L)",
    "foto": "5016533648379.jpg"
  },
  {
    "ean": "5016533648386",
    "nome": "MMA/PA ANAMIX JUNIOR 3X400g MLL1 (L)",
    "foto": "5016533648386.jpg"
  },
  {
    "ean": "5016533655797",
    "nome": "MMA/PA ANAMIX INF 3X400g MLL1 (L)",
    "foto": "5016533655797.jpg"
  },
  {
    "ean": "5016533655803",
    "nome": "MMA/PA ANAMIX INF 3X400g MLL1 (L)",
    "foto": "5016533655803.jpg"
  },
  {
    "ean": "7891025120933",
    "nome": "NUTRIDRINK PROTEIN VANILLA 350g",
    "foto": "7891025120933.jpg"
  },
  {
    "ean": "7891025120940",
    "nome": "NUTRIDRINK PROTEIN NEUTRAL 700g",
    "foto": "7891025120940.jpg"
  },
  {
    "ean": "7891025120957",
    "nome": "NUTRIDRINK PROTEIN NEUTRAL 350g",
    "foto": "7891025120957.jpg"
  },
  {
    "ean": "8716900569821",
    "nome": "NUTRIDRINK PROTEIN BAUNILHA 200ml",
    "foto": "8716900569821.jpg"
  },
  {
    "ean": "8716900569838",
    "nome": "NUTRIDRINK PROTEIN BAUNILHA 200ml",
    "foto": "8716900569838.jpg"
  },
  {
    "ean": "8716900569845",
    "nome": "NUTRIDRINK PROTEIN MORANGO 200ml",
    "foto": "8716900569845.jpg"
  },
  {
    "ean": "8716900569852",
    "nome": "NUTRIDRINK PROTEIN MORANGO 200ml",
    "foto": "8716900569852.jpg"
  },
  {
    "ean": "8716900569869",
    "nome": "NUTRIDRINK PROTEIN CHOCOLATE 200ml",
    "foto": "8716900569869.jpg"
  },
  {
    "ean": "8716900569876",
    "nome": "NUTRIDRINK PROTEIN CHOCOLATE 200ml",
    "foto": "8716900569876.jpg"
  },
  {
    "ean": "4008976452898",
    "nome": "NUTRIDRINK PROTEIN ADVANCED (LT 600g)",
    "foto": "4008976452898.jpg"
  },
  {
    "ean": "4008976681892",
    "nome": "NUTRIDRINK PROTEIN ADVANCED (LT 600g)",
    "foto": "4008976681892.jpg"
  },
  {
    "ean": "7891025121459",
    "nome": "NUTRIDRINK PROTEIN SENIOR CHOCOLATE 750g",
    "foto": "7891025121459.jpg"
  },
  {
    "ean": "7891025121466",
    "nome": "NUTRIDRINK PROTEIN SENIOR CHOCOLATE 380g",
    "foto": "7891025121466.jpg"
  },
  {
    "ean": "7891025121473",
    "nome": "NUTRIDRINK PROTEIN CAFE C LEI 380g",
    "foto": "7891025121473.jpg"
  },
  {
    "ean": "7891025121480",
    "nome": "NUTRIDRINK PROTEIN CAFE C LEI 750g",
    "foto": "7891025121480.jpg"
  },
  {
    "ean": "8716900554971",
    "nome": "NDRINK COMPACT CHOC 6X4X125ML PB BR - NOVA FÓRMULA",
    "foto": "8716900554971.jpg"
  },
  {
    "ean": "8716900554988",
    "nome": "NDRINK COMPACT CHOC 6X4X125ML PB BR - NOVA FÓRMULA",
    "foto": "8716900554988.jpg"
  },
  {
    "ean": "8716900580383",
    "nome": "NUTRIDRINK COMPACT BAUNILHA (4XPB 125ml)",
    "foto": "8716900580383.jpg"
  },
  {
    "ean": "8716900580390",
    "nome": "NUTRIDRINK COMPACT BAUNILHA (4XPB 125ml)",
    "foto": "8716900580390.jpg"
  },
  {
    "ean": "8716900580888",
    "nome": "NUTRIDRINK COMPACT CAPUCCINO (4XPB 125ml)",
    "foto": "8716900580888.jpg"
  },
  {
    "ean": "8716900581809",
    "nome": "NUTRIDRINK COMPACT MORANGO (4XPB 125ml)",
    "foto": "8716900581809.jpg"
  },
  {
    "ean": "8716900581816",
    "nome": "NUTRIDRINK COMPACT MORANGO (4XPB 125ml)",
    "foto": "8716900581816.jpg"
  },
  {
    "ean": "8716900582868",
    "nome": "NDR COMPACT PROT VAN - NOVA FÓRMULA",
    "foto": "8716900582868.jpg"
  },
  {
    "ean": "8716900582875",
    "nome": "NDR COMPACT PROT VAN - NOVA FÓRMULA",
    "foto": "8716900582875.jpg"
  },
  {
    "ean": "8716900582998",
    "nome": "NUTRIDRINK COMPACT CAPUCCINO (4XPB 125ml)",
    "foto": "8716900582998.jpg"
  },
  {
    "ean": "7891025122395",
    "nome": "NUTRI ENTERAL 1.5 CHOCOLATE TP 200ml",
    "foto": "7891025122395.jpg"
  },
  {
    "ean": "7891025122401",
    "nome": "NUTRI ENTERAL 1.5 BAUNILHA TP 200ml",
    "foto": "7891025122401.jpg"
  },
  {
    "ean": "7891025123910",
    "nome": "NUTRI R 2.0 TP 200ml",
    "foto": "7891025123910.jpg"
  },
  {
    "ean": "7891025123927",
    "nome": "NUTRI R 2.0 TP 1000ml",
    "foto": "7891025123927.jpg"
  },
  {
    "ean": "7897426401053",
    "nome": "NUTRI RD 2.0 TP 1000ml - NOVA FÓRMULA",
    "foto": "7897426401053.jpg"
  },
  {
    "ean": "7897426401114",
    "nome": "NUTRI RD 2.0 BAU TP 200ml - NOVA FÓRMULA",
    "foto": "7897426401114.jpg"
  },
  {
    "ean": "8712400157148",
    "nome": "NUTRINI STANDARD (PACK 500ml)",
    "foto": "8712400157148.jpg"
  },
  {
    "ean": "8712400157155",
    "nome": "NUTRINI MF PACK (500ml)",
    "foto": "8712400157155.jpg"
  },
  {
    "ean": "8712400157186",
    "nome": "NUTRINI ENERGY MF PACK (500ml)",
    "foto": "8712400157186.jpg"
  },
  {
    "ean": "8712400157209",
    "nome": "NUTRINI PEPTI (PACK 500ml)",
    "foto": "8712400157209.jpg"
  },
  {
    "ean": "8712400657143",
    "nome": "NUTRINI STANDARD (PACK 500ml)",
    "foto": "8712400657143.jpg"
  },
  {
    "ean": "8712400657150",
    "nome": "NUTRINI MF PACK (500ml)",
    "foto": "8712400657150.jpg"
  },
  {
    "ean": "8712400657181",
    "nome": "NUTRINI ENERGY MF PACK (500ml)",
    "foto": "8712400657181.jpg"
  },
  {
    "ean": "8712400657204",
    "nome": "NUTRINI PEPTI (PACK 500ml)",
    "foto": "8712400657204.jpg"
  },
  {
    "ean": "8716900560019",
    "nome": "NUTRINIMAX MF (PB 500ml)",
    "foto": "8716900560019.jpg"
  },
  {
    "ean": "8716900560026",
    "nome": "NUTRINIMAX MF (PB 500ml)",
    "foto": "8716900560026.jpg"
  },
  {
    "ean": "8716900561870",
    "nome": "NUTRINI ENERGY MF (200ml)",
    "foto": "8716900561870.jpg"
  },
  {
    "ean": "8716900561887",
    "nome": "NUTRINI ENERGY MF (200ml)",
    "foto": "8716900561887.jpg"
  },
  {
    "ean": "8716900561955",
    "nome": "NUTRINI STANDARD (PB 200ml)",
    "foto": "8716900561955.jpg"
  },
  {
    "ean": "8716900561962",
    "nome": "NUTRINI STANDARD (PB 200ml)",
    "foto": "8716900561962.jpg"
  },
  {
    "ean": "8716900562037",
    "nome": "NUTRINI MF (200ml)",
    "foto": "8716900562037.jpg"
  },
  {
    "ean": "8716900562044",
    "nome": "NUTRINI MF (200ml)",
    "foto": "8716900562044.jpg"
  },
  {
    "ean": "7891025122845",
    "nome": "NUTRISON ENERGY (TP 1000ml)",
    "foto": "7891025122845.jpg"
  },
  {
    "ean": "7891025122852",
    "nome": "NUTRISON ENERGY MF 1000mL - Nova Fórmula",
    "foto": "7891025122852.jpg"
  },
  {
    "ean": "7891025122869",
    "nome": "NUTRISON ADVANCED CUBISON (TP 1000ml)",
    "foto": "7891025122869.jpg"
  },
  {
    "ean": "7891025122951",
    "nome": "NUTRISON ADV DIASON TP 1000ML - Nova Fórmula",
    "foto": "7891025122951.jpg"
  },
  {
    "ean": "8716900553110",
    "nome": "NUTRISON PROTEIN PLUS ENERGY (PACK 1000ml)",
    "foto": "8716900553110.jpg"
  },
  {
    "ean": "8716900553127",
    "nome": "NUTRISON PROTEIN PLUS ENERGY (PACK 1000ml)",
    "foto": "8716900553127.jpg"
  },
  {
    "ean": "8716900553134",
    "nome": "NUTRISON PROTEIN PLUS ENERGY (PACK 500ml)",
    "foto": "8716900553134.jpg"
  },
  {
    "ean": "8716900553141",
    "nome": "NUTRISON PROTEIN PLUS ENERGY (PACK 500ml)",
    "foto": "8716900553141.jpg"
  },
  {
    "ean": "8716900564710",
    "nome": "NUTRISON ADV DIASON ENERGY HP (PACK 1000ML)",
    "foto": "8716900564710.jpg"
  },
  {
    "ean": "8716900564727",
    "nome": "NUTRISON ADV DIASON ENERGY HP (PACK 1000ML)",
    "foto": "8716900564727.jpg"
  },
  {
    "ean": "8716900576140",
    "nome": "NUTRISON ADV PROTISON (PACK 500ml)",
    "foto": "8716900576140.jpg"
  },
  {
    "ean": "8716900576157",
    "nome": "NUTRISON ADV PROTISON (PACK 500ml)",
    "foto": "8716900576157.jpg"
  },
  {
    "ean": "8716900581533",
    "nome": "NUTRISON ENERGY (PACK 1000ml)",
    "foto": "8716900581533.jpg"
  },
  {
    "ean": "8716900581540",
    "nome": "NUTRISON ENERGY (PACK 1000ml)",
    "foto": "8716900581540.jpg"
  },
  {
    "ean": "8716900581618",
    "nome": "NUTRISON ADVANCED PEPTISORB (PACK 1000ml)",
    "foto": "8716900581618.jpg"
  },
  {
    "ean": "8716900581625",
    "nome": "NUTRISON ADVANCED PEPTISORB (PACK 1000ml)",
    "foto": "8716900581625.jpg"
  },
  {
    "ean": "8716900581632",
    "nome": "NUTRISON ADVANCED DIASON (PACK 1000ml)",
    "foto": "8716900581632.jpg"
  },
  {
    "ean": "8716900581649",
    "nome": "NUTRISON ADVANCED DIASON (PACK 1000ml)",
    "foto": "8716900581649.jpg"
  },
  {
    "ean": "8716900581656",
    "nome": "NUTRISON PROTEIN PLUS MF (PACK 1000ml)",
    "foto": "8716900581656.jpg"
  },
  {
    "ean": "8716900581663",
    "nome": "NUTRISON PROTEIN PLUS MF (PACK 1000ml)",
    "foto": "8716900581663.jpg"
  },
  {
    "ean": "8716900583261",
    "nome": "NUTRISON ADVANCED CUBISON (PACK 1000ml)",
    "foto": "8716900583261.jpg"
  },
  {
    "ean": "8716900583278",
    "nome": "NUTRISON ADVANCED CUBISON (PACK 1000ml)",
    "foto": "8716900583278.jpg"
  },
  {
    "ean": "5016533647181",
    "nome": "ÓLEO DE LORENZO (PB 500ML)",
    "foto": "5016533647181.jpg"
  },
  {
    "ean": "5016533647259",
    "nome": "ÓLEO DE LORENZO (PB 500ML)",
    "foto": "5016533647259.jpg"
  },
  {
    "ean": "5016533649000",
    "nome": "PKU NUTRI 3 CONCENTRATED (2 X 500g)",
    "foto": "5016533649000.jpg"
  },
  {
    "ean": "5016533649017",
    "nome": "PKU NUTRI 3 CONCENTRATED (2 X 500g)",
    "foto": "5016533649017.jpg"
  },
  {
    "ean": "5016533650754",
    "nome": "PKU NUTRI 2 CONCENTRATED (2 X 500g)",
    "foto": "5016533650754.jpg"
  },
  {
    "ean": "5016533650761",
    "nome": "PKU NUTRI 2 CONCENTRATED (2 X 500g)",
    "foto": "5016533650761.jpg"
  },
  {
    "ean": "5016533655391",
    "nome": "PKU NUTRI 1 CONCENTRATED (2 X 500g)",
    "foto": "5016533655391.jpg"
  },
  {
    "ean": "5016533655407",
    "nome": "PKU NUTRI 1 CONCENTRATED (2 X 500g)",
    "foto": "5016533655407.jpg"
  },
  {
    "ean": "8716900572807",
    "nome": "SOUVENAID VAN 6X4X125ml BR",
    "foto": "8716900572807.jpg"
  },
  {
    "ean": "8716900572814",
    "nome": "SOUVENAID VAN 6X4X125ml BR",
    "foto": "8716900572814.jpg"
  },
  {
    "ean": "8716900572944",
    "nome": "SOUVENAID STRAW 6X4X125ml PB BR",
    "foto": "8716900572944.jpg"
  },
  {
    "ean": "8716900572951",
    "nome": "SOUVENAID STRAW 6X4X125ml PB BR",
    "foto": "8716900572951.jpg"
  },
  {
    "ean": "5016533648430",
    "nome": "TYR ANAMIX JUNIOR 3X400g MLL1 (L)",
    "foto": "5016533648430.jpg"
  },
  {
    "ean": "5016533648447",
    "nome": "TYR ANAMIX JUNIOR 3X400g MLL1 (L)",
    "foto": "5016533648447.jpg"
  },
  {
    "ean": "5016533655650",
    "nome": "TYR ANAMIX INFANT 3X400g MLL1 (L)",
    "foto": "5016533655650.jpg"
  },
  {
    "ean": "5016533655667",
    "nome": "TYR ANAMIX INFANT 3X400g MLL1 (L)",
    "foto": "5016533655667.jpg"
  }
];

// Helper para obter a imagem correta de um produto por EAN ou Nome
function resolveProductImage(code, name) {
  const cleanCode = String(code || '').trim();
  if (cleanCode && cleanCode !== 'undefined' && cleanCode.length > 5) {
    return `images/${cleanCode}.jpg`;
  }
  const cleanName = String(name || '').toLowerCase().trim();
  if (cleanName) {
    // Procura na lista embutida
    const found = _EMBEDDED_DANONE_CATALOG.find(c => {
      const cNome = c.nome.toLowerCase();
      return cNome === cleanName || cNome.includes(cleanName) || cleanName.includes(cNome);
    });
    if (found) {
      return `images/${found.foto || found.ean + '.jpg'}`;
    }
  }
  return 'images/prazocerto_basket_3d.png';
}
window.resolveProductImage = resolveProductImage;

// ── RENDERIZAÇÃO COMPLETA DO HISTÓRICO ──────────────────────
function renderHistory() {
  let logs = getHistoryLogs();
  const allProds = Store.getAllProducts();
  const cats = Store.getCategories();
  const stores = Store.getStores();

  // Sempre sincroniza/atualiza o catálogo embutido com as fotos certas
  if (!logs || logs.length === 0) {
    const initialLogs = [];
    allProds.forEach((p, idx) => {
      const cat = cats.find(c => c.id === p.category);
      const prodImg = resolveProductImage(p.code, p.name);

      // Cadastro original
      initialLogs.push({
        id: 'h_seed_' + p.id + '_add',
        productId: p.id,
        productName: p.name,
        productCode: p.code || '',
        productImg: prodImg,
        timestamp: p.addedAt || new Date(Date.now() - (idx + 1) * 3600000 * 4).toISOString(),
        user: 'Leandro',
        store: p.location || 'Savegnago 24',
        actionType: 'cadastro',
        actionLabel: 'Produto cadastrado',
        actionField: 'Cadastro',
        beforeVal: '',
        afterVal: `Qtd: ${p.qty || 1}`
      });

      // Se foi editado, gera histórico de alteração realista
      if (p.updatedAt && p.updatedAt !== p.addedAt) {
        initialLogs.push({
          id: 'h_seed_' + p.id + '_upd',
          productId: p.id,
          productName: p.name,
          productCode: p.code || '',
          productImg: prodImg,
          timestamp: p.updatedAt || new Date().toISOString(),
          user: 'Leandro',
          store: p.location || 'Savegnago 24',
          actionType: (idx % 3 === 0) ? 'validade' : ((idx % 3 === 1) ? 'quantidade' : 'categoria'),
          actionLabel: (idx % 3 === 0) ? 'Validade alterada' : ((idx % 3 === 1) ? 'Quantidade alterada' : 'Categoria alterada'),
          actionField: (idx % 3 === 0) ? 'Validade' : ((idx % 3 === 1) ? 'Quantidade' : 'Categoria'),
          beforeVal: (idx % 3 === 0) ? formatDate(p.expDate) : ((idx % 3 === 1) ? String((p.qty || 1) + 2) : 'Iogurtes'),
          afterVal: (idx % 3 === 0) ? formatDate(p.expDate) : ((idx % 3 === 1) ? String(p.qty || 1) : (cat ? cat.name : 'Bebidas Lácteas'))
        });
      }
    });
    logs = initialLogs;
    saveHistoryLogs(logs);
  } else {
    // Corrige logs antigos que estejam sem imagem válida
    logs.forEach(l => {
      if (!l.productImg || l.productImg.includes('basket_icon.png') || !l.productImg.includes('imagens/')) {
        l.productImg = resolveProductImage(l.productCode, l.productName);
      }
    });
  }

  // Preenche opções dos selects de filtro com valores existentes
  const storeSel = document.getElementById('histFilterStore');
  if (storeSel) {
    const curVal = storeSel.value || 'all';
    const storeList = Array.from(new Set([
      ...allProds.map(p => p.location).filter(Boolean),
      ...logs.map(l => l.store).filter(Boolean)
    ]));
    if (!storeList.includes('Savegnago 22')) storeList.unshift('Savegnago 22');
    if (!storeList.includes('Savegnago 24')) storeList.push('Savegnago 24');

    const desiredHtml = '<option value="all">Todas as lojas</option>' +
      storeList.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    if (storeSel.dataset.loadedStores !== storeList.join(',')) {
      storeSel.innerHTML = desiredHtml;
      storeSel.dataset.loadedStores = storeList.join(',');
      storeSel.value = storeList.includes(curVal) || curVal === 'all' ? curVal : 'all';
    }
  }

  const userSel = document.getElementById('histFilterUser');
  if (userSel) {
    const curUser = userSel.value || 'all';
    const userList = Array.from(new Set(logs.map(l => l.user).filter(Boolean)));
    if (!userList.includes('Leandro')) userList.unshift('Leandro');

    const desiredUserHtml = '<option value="all">Todos os usuários</option>' +
      userList.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
    if (userSel.dataset.loadedUsers !== userList.join(',')) {
      userSel.innerHTML = desiredUserHtml;
      userSel.dataset.loadedUsers = userList.join(',');
      userSel.value = userList.includes(curUser) || curUser === 'all' ? curUser : 'all';
    }
  }

  // Aplica Filtros Ativos
  const search = (document.getElementById('histSearchInput')?.value || '').toLowerCase().trim();
  const selectedStore = document.getElementById('histFilterStore')?.value || 'all';
  const selectedUser = document.getElementById('histFilterUser')?.value || 'all';
  const selectedType = document.getElementById('histFilterType')?.value || 'all';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 7 * 86400000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // Escopo de registros filtrados por Período, Loja, Usuário e Busca
  const scopedLogs = logs.filter(l => {
    // Período
    const t = new Date(l.timestamp).getTime();
    if (_histPeriod === 'today') {
      if (t < startOfToday) return false;
    } else if (_histPeriod === 'week') {
      if (t < startOfWeek) return false;
    } else if (_histPeriod === 'month') {
      if (t < startOfMonth) return false;
    }

    // Loja
    if (selectedStore !== 'all' && (l.store || 'Sem Loja') !== selectedStore) return false;

    // Usuário
    if (selectedUser !== 'all' && l.user !== selectedUser) return false;

    // Busca textual
    if (search) {
      const nameMatch = l.productName && l.productName.toLowerCase().includes(search);
      const codeMatch = l.productCode && l.productCode.toLowerCase().includes(search);
      const userMatch = l.user && l.user.toLowerCase().includes(search);
      const actionMatch = l.actionLabel && l.actionLabel.toLowerCase().includes(search);
      return nameMatch || codeMatch || userMatch || actionMatch;
    }

    return true;
  });

  // Estatísticas calculadas instantaneamente sobre o escopo selecionado
  const totalCount = scopedLogs.length;
  const editsCount = scopedLogs.filter(l => l.actionType === 'validade' || l.actionType === 'quantidade' || l.actionType === 'categoria' || l.actionType === 'edicao').length;
  const addsCount = scopedLogs.filter(l => l.actionType === 'cadastro').length;
  const delCount = scopedLogs.filter(l => l.actionType === 'exclusao').length;
  const usersCount = Array.from(new Set(scopedLogs.map(l => l.user).filter(Boolean))).length;

  const statTotalEl = document.getElementById('histStatTotal');
  const statEditsEl = document.getElementById('histStatEdits');
  const statAddsEl = document.getElementById('histStatAdds');
  const statDelEl = document.getElementById('histStatDeletes');
  const statUsersEl = document.getElementById('histStatUsers');

  if (statTotalEl) statTotalEl.textContent = totalCount;
  if (statEditsEl) statEditsEl.textContent = editsCount;
  if (statAddsEl) statAddsEl.textContent = addsCount;
  if (statDelEl) statDelEl.textContent = delCount;
  if (statUsersEl) statUsersEl.textContent = usersCount;

  // Atualiza subtítulo do total com base no período ativo
  const periodLabel = _histPeriod === 'today' ? 'Hoje' : (_histPeriod === 'week' ? 'Esta semana' : (_histPeriod === 'month' ? 'Este mês' : 'Personalizado'));
  const statTotalSub = document.getElementById('histStatTotalSub');
  if (statTotalSub) statTotalSub.textContent = `Filtro: ${periodLabel}`;

  // Filtro por Tipo de Ação específico para a Timeline
  let filtered = selectedType === 'all'
    ? scopedLogs
    : scopedLogs.filter(l => l.actionType === selectedType);

  // Ordena pelo timestamp decrescente
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const container = document.getElementById('historyTimelineList');
  if (!container) return;

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 20px;">
        <div class="empty-icon">📜</div>
        <h3>Nenhum registro encontrado</h3>
        <p>Não há movimentações para os filtros selecionados.</p>
      </div>
    `;
    const loadMoreWrap = document.getElementById('histLoadMoreWrap');
    if (loadMoreWrap) loadMoreWrap.style.display = 'none';
    return;
  }

  // Agrupa por Dia (Hoje - 05 de agosto de 2026, Ontem, etc.)
  const groups = {};
  const visibleList = filtered.slice(0, _histLimit);

  visibleList.forEach(l => {
    const d = new Date(l.timestamp);
    const dateKey = d.toISOString().split('T')[0];
    if (!groups[dateKey]) {
      groups[dateKey] = {
        date: d,
        items: []
      };
    }
    groups[dateKey].items.push(l);
  });

  const formatDateHeader = (d) => {
    const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const isToday = dDate === startOfToday;
    const isYesterday = dDate === (startOfToday - 86400000);

    const fullDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (isToday) return `Hoje - ${fullDate}`;
    if (isYesterday) return `Ontem - ${fullDate}`;
    return fullDate.charAt(0).toUpperCase() + fullDate.slice(1);
  };

  const getActionIconSvg = (type) => {
    switch (type) {
      case 'validade':
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
      case 'quantidade':
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
      case 'cadastro':
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
      case 'categoria':
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
      case 'exclusao':
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      default:
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>`;
    }
  };

  let html = '';
  Object.keys(groups).forEach(dateKey => {
    const group = groups[dateKey];
    const groupHeader = formatDateHeader(group.date);
    const countLabel = `${group.items.length} ${group.items.length === 1 ? 'alteração' : 'alterações'}`;

    html += `
      <div class="hist-group-block">
        <div class="hist-group-header">
          <span class="hist-group-title">${groupHeader}</span>
          <span class="hist-group-badge">${countLabel}</span>
        </div>
        <div class="hist-cards-list">
    `;

    group.items.forEach(item => {
      const timeStr = new Date(item.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const fullTimeStr = new Date(item.timestamp).toLocaleString('pt-BR');
      const actionType = item.actionType || 'validade';
      const iconSvg = getActionIconSvg(actionType);
      const isSelected = _currentDetailLogId === item.id ? 'active-selected' : '';
      const resolvedImg = item.productImg || resolveProductImage(item.productCode, item.productName);

      let middleContent = '';
      if (item.beforeVal && item.afterVal) {
        middleContent = `
          <div class="hist-inline-diff">
            <div class="diff-col">
              <span>${escHtml(item.beforeVal)}</span>
              <small>Antes</small>
            </div>
            <div class="diff-arrow">→</div>
            <div class="diff-col diff-now">
              <span>${escHtml(item.afterVal)}</span>
              <small>Agora</small>
            </div>
          </div>
        `;
      } else {
        middleContent = `
          <div class="hist-single-foot">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <span>${fullTimeStr}</span>
          </div>
        `;
      }

      html += `
        <div class="hist-item-row hist-type-${actionType}">
          <div class="hist-node-col">
            <div class="hist-node-time">
              <span>${timeStr}</span>
              <div class="hist-node-dot"></div>
            </div>
            <div class="hist-node-icon">
              ${iconSvg}
            </div>
          </div>
          <div class="hist-card-box ${isSelected}" data-id="${item.id}" onclick="openHistoryDetail('${item.id}')">
            <div class="hist-prod-thumb">
              <img src="${resolvedImg}" alt="Produto" loading="lazy" decoding="async" onerror="if(this.src.includes('imagens/')){this.src=this.src.replace('imagens/','images/');}else if(this.src.includes('images/')){this.src='https://cdn-cosmos.bluesoft.com.br/products/'+'${item.productCode || ''}';this.onerror=function(){this.src='images/prazocerto_basket_3d.png';};}else{this.src='images/prazocerto_basket_3d.png';}">
            </div>
            <div class="hist-prod-main-details">
              <div class="hist-prod-title-line">
                <span class="hist-prod-name">${escHtml(item.productName || 'Produto')}</span>
                <svg class="hist-chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </div>
              <div class="hist-tags-row">
                <span class="hist-badge-pill badge-${actionType}">${escHtml(item.actionLabel || 'Registro')}</span>
                <span class="hist-meta-info">📍 ${escHtml(item.store || 'Savegnago 24')}</span>
                <span class="hist-meta-info">👤 ${escHtml(item.user || 'Leandro')}</span>
              </div>
              ${middleContent}
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  const loadMoreWrap = document.getElementById('histLoadMoreWrap');
  if (loadMoreWrap) {
    loadMoreWrap.style.display = filtered.length > _histLimit ? 'flex' : 'none';
  }
}
window.renderHistory = renderHistory;
function getSelectedAlerts() {
  const checkboxes = document.querySelectorAll('.alert-checkbox:checked');
  const ids = Array.from(checkboxes).map(cb => cb.dataset.id);
  if (ids.length === 0) {
    showToast('Selecione pelo menos um produto!', 'warning');
    return [];
  }
  const products = Store.getProducts();
  return products.filter(p => ids.includes(String(p.id)));
}

document.addEventListener('change', function (e) {
  if (e.target.id === 'selectAllAlerts') {
    const checkboxes = document.querySelectorAll('.alert-checkbox');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
  }
});

document.addEventListener('click', function (e) {
  if (e.target.id === 'btnExportCSV') {
    const selected = getSelectedAlerts();
    if (!selected.length) return;
    const header = 'Nome,EAN,Quantidade,Vencimento,Dias Restantes';
    const rows = selected.map(p => {
      const days = daysUntil(p.expDate);
      return ['"' + (p.name || '') + '"', '"' + (p.code || '') + '"', p.qty || 1, '"' + formatDate(p.expDate) + '"', days !== null ? days : 'N/A'].join(',');
    });
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'prazocerto_validades.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('CSV exportado!', 'success');
  }
  if (e.target.id === 'btnExportExcel') {
    const selected = getSelectedAlerts();
    if (!selected.length) return;
    if (!window.XLSX) { showToast('Biblioteca Excel carregando...', 'warning'); return; }
    const data = selected.map(p => ({ 'Nome': p.name || '', 'EAN': p.code || '', 'Qtd': p.qty || 1, 'Vencimento': formatDate(p.expDate) }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PrazoCerto');
    XLSX.writeFile(wb, 'prazocerto_validades.xlsx');
    showToast('Excel exportado!', 'success');
  }
  if (e.target.id === 'btnExportPDF') {
    const selected = getSelectedAlerts();
    if (!selected.length) return;
    if (!window.jspdf) { showToast('Biblioteca PDF carregando...', 'warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text('PrazoCerto - Relatório', 14, 20);
    const tableData = selected.map(p => [p.name || '', p.code || '-', formatDate(p.expDate), String(p.qty || 1)]);
    doc.autoTable({ startY: 30, head: [['Produto', 'EAN', 'Vencimento', 'Qtd']], body: tableData });
    doc.save('prazocerto_relatorio.pdf');
    showToast('PDF exportado!', 'success');
  }
  if (e.target.id === 'btnShareApp') {
    const selected = getSelectedAlerts();
    if (!selected.length) return;
    let text = 'PrazoCerto - Relatório de Validades\n\n';
    selected.forEach(p => {
      text += (p.name || '') + ' - Vence: ' + formatDate(p.expDate) + '\n';
    });
    const enc = encodeURIComponent(text);
    const m = document.createElement('div');
    m.id = 'shareModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;';
    m.innerHTML = '<div style="background:var(--bg-1);padding:1.5rem;border-radius:16px;width:300px;border:1px solid var(--border);"><h3 style="color:var(--primary);text-align:center;">Compartilhar</h3><div style="display:flex;flex-direction:column;gap:0.7rem;margin-top:1rem;"><a href="https://api.whatsapp.com/send?text=' + enc + '" target="_blank" style="background:#25D366;color:#fff;border-radius:10px;padding:0.8rem;text-align:center;font-weight:700;text-decoration:none;display:block;">WhatsApp</a><a href="mailto:?body=' + enc + '" style="background:var(--bg-3);color:var(--text-1);border:1px solid var(--border);border-radius:10px;padding:0.8rem;text-align:center;font-weight:700;text-decoration:none;display:block;">E-mail</a><button onclick="document.body.removeChild(document.getElementById(chr(39)+shareModal+chr(39)))" style="margin-top:0.5rem;width:100%;padding:0.6rem;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--text-2);cursor:pointer;">Fechar</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', ev => { if (ev.target === m) document.body.removeChild(m); });
  }
});

// ===========================
// FIREBASE AUTH & BOOT MODULE
// ===========================
(function () {
  var auth = firebase.auth();
  // NÃO aplica setPersistence globalmente aqui.
  // A persistência é definida dinamicamente no momento do login:
  //   - LOCAL  → se o usuário marcou "Lembrar minha conta"
  //   - SESSION → se não marcou (sessão é apagada ao fechar o app)
  var googleProvider = new firebase.auth.GoogleAuthProvider();

  window.toggleAuthForm = function (formType) {
    var splashEl = document.getElementById('splash');
    var onboardingEl = document.getElementById('onboardingView');
    var authBoxEl = document.getElementById('authBox');

    if (formType === 'onboarding') {
      if (authBoxEl) authBoxEl.style.display = 'none';
      if (onboardingEl) { onboardingEl.style.display = 'flex'; onboardingEl.style.flex = '1'; }
      if (splashEl) splashEl.style.alignItems = 'flex-start';
      return;
    }

    if (onboardingEl) onboardingEl.style.display = 'none';
    if (splashEl) splashEl.style.alignItems = 'center';
    if (authBoxEl) {
      authBoxEl.style.display = 'block';
      authBoxEl.style.position = 'relative';
      authBoxEl.style.zIndex = '10';
    }

    ['formLogin', 'formRegister', 'formForgot'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    var errEl = document.getElementById('authErrorMsg');
    if (errEl) { errEl.textContent = ''; errEl.style.color = 'var(--danger)'; }
    var target = document.getElementById('form' + formType.charAt(0).toUpperCase() + formType.slice(1));
    if (target) target.style.display = 'block';
  };

  function showAuthLoading(show) {
    var el = document.getElementById('authLoading');
    if (el) {
      el.style.display = show ? 'flex' : 'none';
      el.style.pointerEvents = show ? 'all' : 'none';
    }
  }

  function showAuthError(msg, isSuccess) {
    var el = document.getElementById('authErrorMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isSuccess ? '#00E5FF' : 'var(--danger)';
  }

  function translateAuthError(code, fallback) {
    var map = {
      'auth/email-already-in-use': 'Este e-mail já está em uso.',
      'auth/invalid-email': 'E-mail inválido.',
      'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
      'auth/user-not-found': 'Usuário não encontrado. Crie uma conta.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.',
      'auth/operation-not-allowed': '⚠️ Provedor não habilitado no Firebase. Vá em Authentication > Sign-in method e ative.',
      'auth/popup-closed-by-user': 'Login com Google cancelado.',
      'auth/popup-blocked': 'Popup bloqueado. Permita popups para este site.',
      'auth/network-request-failed': 'Erro de rede. Verifique sua conexão.'
    };
    return map[code] || fallback;
  }

  window._isLoggingIn = false;
  window.handleEmailLogin = function () {
    if (window._isLoggingIn) return;

    var emailEl = document.getElementById('loginEmail');
    var passEl = document.getElementById('loginPassword');
    var email = emailEl ? emailEl.value.trim() : '';
    var pass = passEl ? passEl.value : '';

    if (!email || !pass) {
      showAuthError('Preencha seu e-mail e sua senha.');
      return;
    }

    var firebaseAuth = null;
    try {
      firebaseAuth = (typeof auth !== 'undefined' && auth) ? auth : (window.firebase ? firebase.auth() : null);
    } catch (e) {
      console.error('Erro ao acessar Firebase Auth:', e);
      showAuthError('Erro ao conectar ao serviço de autenticação. Verifique sua internet.');
      return;
    }

    if (!firebaseAuth) {
      showAuthError('Serviço de autenticação indisponível. Reinicie o aplicativo.');
      return;
    }

    window._isLoggingIn = true;
    showAuthLoading(true);
    showAuthError('');

    var btnLogin = document.getElementById('btnActionLogin');
    if (btnLogin) {
      btnLogin.disabled = true;
      btnLogin.style.opacity = '0.7';
      btnLogin.style.pointerEvents = 'none';
    }

    // Timeout de segurança: se a rede travar ou Firebase não responder em 15s, destrava o botão
    var loginTimeout = setTimeout(function () {
      if (window._isLoggingIn) {
        window._isLoggingIn = false;
        showAuthLoading(false);
        if (btnLogin) {
          btnLogin.disabled = false;
          btnLogin.style.opacity = '1';
          btnLogin.style.pointerEvents = 'auto';
        }
        showAuthError('A conexão demorou muito a responder. Verifique sua conexão com a internet e tente novamente.');
      }
    }, 15000);

    var remember = false;
    try {
      var rememberEl = document.getElementById('rememberMe');
      remember = rememberEl ? rememberEl.checked : false;
      // Grava a preferência do usuário
      localStorage.setItem('cv_remember', remember ? '1' : '0');
      sessionStorage.setItem('cv_session_active', '1');
    } catch (e) { }

    // Define persistência ANTES do signIn:
    // LOCAL   → o Firebase mantém sessão mesmo após fechar o app
    // SESSION → o Firebase apaga a sessão ao fechar o app/aba
    var persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;

    // Encadeia: define persistência → autentica
    firebaseAuth.setPersistence(persistence)
      .catch(function() {}) // ignora falha de setPersistence, usa padrão
      .finally(function() {
        try {
          firebaseAuth.signInWithEmailAndPassword(email, pass)
            .then(function (cred) {
              clearTimeout(loginTimeout);
              window._isLoggingIn = false;
              showAuthLoading(false);
              if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.style.opacity = '1';
                btnLogin.style.pointerEvents = 'auto';
              }
              try { sessionStorage.setItem('cv_session_active', '1'); } catch (e) { }
              if (cred && cred.user && typeof window.bootApp === 'function') {
                window.bootApp(cred.user);
              }
            })
            .catch(function (error) {
              clearTimeout(loginTimeout);
              window._isLoggingIn = false;
              showAuthLoading(false);
              if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.style.opacity = '1';
                btnLogin.style.pointerEvents = 'auto';
              }
              console.error('Login error:', error);
              var msg = translateAuthError(error.code, error.message || 'Falha ao autenticar. Verifique e-mail e senha.');
              showAuthError(msg);
            });
        } catch (ex) {
          clearTimeout(loginTimeout);
          window._isLoggingIn = false;
          showAuthLoading(false);
          if (btnLogin) {
            btnLogin.disabled = false;
            btnLogin.style.opacity = '1';
            btnLogin.style.pointerEvents = 'auto';
          }
          console.error('Login exception:', ex);
          showAuthError('Erro inesperado ao fazer login. Tente novamente.');
        }
      });
  };

  window.handleEmailRegister = function () {
    var name = document.getElementById('regName').value.trim();
    var email = document.getElementById('regEmail').value.trim();
    var pass = document.getElementById('regPassword').value;
    var inviteCodeInput = document.getElementById('regInviteCode');
    var rawInviteCode = inviteCodeInput ? inviteCodeInput.value.trim().toUpperCase() : '';
    if (!name || !email || !pass) { showAuthError('Preencha todos os campos!'); return; }

    // Validação de formato e provedores permitidos (Gmail, Hotmail/Outlook)
    var emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailPattern.test(email)) {
      showAuthError('Por favor, informe um endereço de e-mail válido.');
      return;
    }

    var allowedDomains = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com'];
    var domain = email.split('@')[1] ? email.split('@')[1].toLowerCase() : '';
    if (!allowedDomains.includes(domain)) {
      showAuthError('O sistema aceita somente contas com e-mail Gmail ou Hotmail (ex: @gmail.com, @hotmail.com, @outlook.com).');
      return;
    }

    if (pass.length < 6) { showAuthError('A senha deve ter no mínimo 6 caracteres.'); return; }

    var cb = document.getElementById('acceptTermsCb');
    var termsAccepted = cb && cb.checked;
    if (!termsAccepted) {
      showAuthError('Marque a caixa para aceitar os Termos de Uso e Política de Privacidade.');
      return;
    }
    localStorage.setItem('prazocerto_terms_accepted', 'true');
    localStorage.setItem('cv_user_name', name);

    showAuthLoading(true);

    // Validação segura do código de convite (se fornecido)
    var validatePromise = (typeof window.validateInviteCodePromise === 'function')
      ? window.validateInviteCodePromise(rawInviteCode)
      : Promise.resolve({ isOwner: !rawInviteCode });

    validatePromise.then(function(inviteData) {
      return auth.createUserWithEmailAndPassword(email, pass).then(function(cred) {
        _remoteProducts = [];
        try {
          localStorage.removeItem('cv_products');
          localStorage.removeItem('cv_stores');
          localStorage.removeItem('cv_selected_store');
          localStorage.removeItem('cv_user_avatar');
        } catch(e){}

        var isOwner = !inviteData || inviteData.isOwner;
        var accountId = isOwner ? cred.user.uid : inviteData.accountId;
        var role = isOwner ? 'owner' : 'employee';

        // Salva perfil no users
        var userRecord = {
          uid: cred.user.uid,
          email: email,
          displayName: name,
          accountId: accountId,
          role: role,
          status: 'active',
          termsAccepted: true,
          termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!isOwner) {
          userRecord.invitedByCode = inviteData.inviteCode;
          userRecord.allowedStores = inviteData.allowedStores || [];
          userRecord.permissions = window.DEFAULT_EMPLOYEE_PERMISSIONS || {
            viewProducts: true,
            createProducts: true,
            editProducts: true,
            deleteProducts: false,
            viewAlerts: true,
            manageStores: false,
            manageUsers: false,
            manageSubscription: false
          };
        }

        var saveUserPromise = db.collection('users').doc(cred.user.uid).set(userRecord, { merge: true });

        // Se for dono, inicializa a conta e user_data no plano GRATUITO
        var initUserDataPromise = Promise.resolve();
        if (isOwner) {
          try { localStorage.setItem('cv_user_plan', 'GRATUITO'); } catch(e){}
          initUserDataPromise = db.collection('user_data').doc(cred.user.uid).set({
            planoId: 'GRATUITO',
            planoNome: 'GRATUITO',
            products: [],
            stores: [],
            planoCriadoEm: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else {
          // Marca convite como usado no Firestore
          if (inviteData.inviteCode) {
            db.collection('invites').doc(inviteData.inviteCode).update({
              status: 'used',
              usedBy: cred.user.uid,
              usedByEmail: email,
              usedByName: name,
              usedAt: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(function(e){ console.warn('Erro ao marcar convite como usado:', e); });
          }
        }

        return Promise.all([saveUserPromise, initUserDataPromise]).then(function() {
          return cred.user.updateProfile({ displayName: name });
        });
      });
    }).then(function() {
      // onAuthStateChanged vai ser disparado
    }).catch(function(error) {
      showAuthLoading(false);
      var msg = error && error.message ? error.message : 'Falha ao realizar cadastro.';
      if (error && error.code) {
        msg = translateAuthError(error.code, error.message);
      }
      showAuthError(msg);
    });
  };

  window.handlePasswordReset = function () {
    var email = document.getElementById('forgotEmail').value.trim();
    if (!email) { showAuthError('Preencha o e-mail!'); return; }
    showAuthLoading(true);
    auth.sendPasswordResetEmail(email).then(function () {
      showAuthLoading(false);
      showAuthError('✅ Link enviado! Verifique sua caixa de entrada.', true);
      setTimeout(function () { window.toggleAuthForm('login'); }, 3000);
    }).catch(function (error) {
      showAuthLoading(false);
      showAuthError(translateAuthError(error.code, error.message));
    });
  };

  window.handleGoogleLogin = function () {
    showAuthLoading(true);
    showAuthError('');

    var firebaseAuth = null;
    try {
      firebaseAuth = (typeof auth !== 'undefined' && auth) ? auth : (window.firebase ? firebase.auth() : null);
    } catch (e) {
      console.error('Erro ao obter auth:', e);
    }

    if (!firebaseAuth) {
      showAuthLoading(false);
      showAuthError('Serviço de autenticação indisponível.');
      return;
    }

    var provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    // Google login: sempre SESSION (usuário deve escolher explicitamente "Lembrar")
    // Marca como NÃO lembrar para que o onAuthStateChanged exija login na próxima abertura
    try { localStorage.setItem('cv_remember', '0'); } catch(e) {}
    firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(function(){});

    // Tenta signInWithPopup primeiro (ideal para web / navegadores)
    firebaseAuth.signInWithPopup(provider)
      .then(function (result) {
        showAuthLoading(false);
        if (result && result.user && typeof window.bootApp === 'function') {
          window.bootApp(result.user);
        }
      })
      .catch(function (error) {
        console.warn('Google signInWithPopup error/fallback:', error);
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
          showAuthLoading(false);
          return;
        }
        // Se popup bloqueado ou não suportado (ex: WebView / Android), usa redirect
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
          firebaseAuth.signInWithRedirect(provider).catch(function (redErr) {
            showAuthLoading(false);
            showAuthError(translateAuthError(redErr.code, redErr.message));
          });
        } else {
          showAuthLoading(false);
          showAuthError(translateAuthError(error.code, error.message));
        }
      });
  };

  // Captura resultado do redirect ao carregar a página
  if (typeof auth !== 'undefined' && auth.getRedirectResult) {
    auth.getRedirectResult().then(function(result) {
      if (result && result.user) {
        console.log('Google redirect login success:', result.user.email);
      }
    }).catch(function(error) {
      if (error && error.code !== 'auth/no-current-user') {
        console.warn('Redirect result error:', error.code);
      }
    });
  }

  window.handleLogout = function () {
    auth.signOut().then(function () { window.location.reload(); });
  };

  // Suporte a tecla Enter nos campos + Event listeners nos botões (fallback para Android WebView)
  function _attachAuthListeners() {
    var loginEmail = document.getElementById('loginEmail');
    var loginPass = document.getElementById('loginPassword');
    var forgotEmail = document.getElementById('forgotEmail');
    var regName = document.getElementById('regName');
    var regEmail = document.getElementById('regEmail');
    var regPass = document.getElementById('regPassword');
    var btnLogin = document.getElementById('btnActionLogin');
    var btnGoogleLogin = document.getElementById('btnGoogleLogin');

    function onEnter(fn) {
      return function (e) { if (e.key === 'Enter') fn(); };
    }
    if (loginEmail) loginEmail.addEventListener('keydown', onEnter(window.handleEmailLogin));
    if (loginPass) loginPass.addEventListener('keydown', onEnter(window.handleEmailLogin));
    if (forgotEmail) forgotEmail.addEventListener('keydown', onEnter(window.handlePasswordReset));
    if (regName) regName.addEventListener('keydown', onEnter(window.handleEmailRegister));
    if (regEmail) regEmail.addEventListener('keydown', onEnter(window.handleEmailRegister));
    if (regPass) regPass.addEventListener('keydown', onEnter(window.handleEmailRegister));

    // Listeners adicionais para todos os botões de envio
    var btnReg = document.getElementById('btnActionRegister');
    var btnForgot = document.getElementById('btnActionForgot');

    if (btnReg) {
      btnReg.addEventListener('click', function (e) { e.preventDefault(); if (typeof window.handleEmailRegister === 'function') window.handleEmailRegister(); });
    }
    if (btnForgot) {
      btnForgot.addEventListener('click', function (e) { e.preventDefault(); if (typeof window.handlePasswordReset === 'function') window.handlePasswordReset(); });
    }
    if (btnLogin) {
      btnLogin.addEventListener('click', function (e) { e.preventDefault(); if (typeof window.handleEmailLogin === 'function') window.handleEmailLogin(); });
    }
    if (btnGoogleLogin) {
      btnGoogleLogin.addEventListener('click', function (e) { e.preventDefault(); if (typeof window.handleGoogleLogin === 'function') window.handleGoogleLogin(); });
    }
  }

  var _authListenersAttached = false;
  function _attachAuthListenersSafe() {
    if (_authListenersAttached) return;
    _attachAuthListeners();
    _authListenersAttached = true;
    if (typeof initBiometricLoginButton === 'function') initBiometricLoginButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attachAuthListenersSafe);
  } else {
    _attachAuthListenersSafe();
  }
  window.addEventListener('load', _attachAuthListenersSafe);


  // ── SINCRONIZAÇÃO DE PRODUTOS DO USUÁRIO COM FIRESTORE ────
  function _syncProductsToFirestore(products) {
    var targetAccount = window._currentAccountId || _currentUserId;
    if (!targetAccount) return;
    if ((!products || products.length === 0) && window._lastKnownRemoteCount && window._lastKnownRemoteCount > 0) {
      console.warn('Proteção de dados: tentativa de sobrescrever nuvem com array vazio ignorada.');
      return;
    }
    if (Array.isArray(products) && products.length > 0) {
      window._lastKnownRemoteCount = products.length;
    }
    db.collection('user_data').doc(targetAccount).set({
      products: products || [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(function (e) {
      console.warn('Erro ao sincronizar produtos:', e);
      if (typeof showToast === 'function') {
        showToast('Erro ao salvar na nuvem (limite de tamanho ou permissão).', '❌');
      }
    });
  }

  function _loadUserDataFromFirestore(uid, callback) {
    if (_firestoreUnsubscribe) {
      _firestoreUnsubscribe();
      _firestoreUnsubscribe = null;
    }

    // Listener em tempo real dos dados do usuário (produtos, lojas e perfil)
    _firestoreUnsubscribe = db.collection('user_data').doc(uid).onSnapshot(function (doc) {
      if (doc.exists) {
        var data = doc.data();
        if (data.products && Array.isArray(data.products)) {
          _remoteProducts = data.products;
          try { localStorage.setItem('cv_products', JSON.stringify(data.products)); } catch (e) { }
        }
        // Carrega lojas se tiver salvo
        if (data.stores && Array.isArray(data.stores)) {
          try { localStorage.setItem('cv_stores', JSON.stringify(data.stores)); } catch (e) { }
          if (typeof renderPlansScreen === 'function' && currentPage === 'plans') renderPlansScreen();
          if (typeof updateHeroStoresCount === 'function') updateHeroStoresCount();
        }
        // Carrega nome e empresa do perfil se existirem
        if (data.displayName) {
          try { localStorage.setItem('cv_user_name', data.displayName); } catch (e) { }
        }
        if (data.company) {
          try { localStorage.setItem('cv_user_company', data.company); } catch (e) { }
        }
        // Carrega foto de perfil do usuário
        if (data.avatar) {
          try { localStorage.setItem('cv_user_avatar', data.avatar); } catch (e) { }
          var avatarImg = document.getElementById('userAvatarImg');
          if (avatarImg) avatarImg.src = data.avatar;
          var profileImg = document.getElementById('profileAvatarImg');
          if (profileImg) profileImg.src = data.avatar;
        }

        // Carrega plano de assinatura sincronizado na nuvem
        if (data.planoId) {
          try { localStorage.setItem('cv_user_plan', data.planoId); } catch (e) { }
          if (typeof updateSettingsPlanCard === 'function') updateSettingsPlanCard();
          if (typeof renderPlansScreen === 'function' && currentPage === 'plans') renderPlansScreen();
        }

        if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
        if (typeof populateStoreSelect === 'function') populateStoreSelect();
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof updateBadges === 'function') updateBadges();
      } else {
        // Documento novo
        _remoteProducts = [];
        try {
          localStorage.removeItem('cv_products');
          localStorage.removeItem('cv_stores');
          localStorage.removeItem('cv_history_logs');
          if (window._currentUserRole === 'owner') {
            localStorage.setItem('cv_user_plan', 'GRATUITO');
            if (db && targetDocId) {
              db.collection('user_data').doc(targetDocId).set({
                planoId: 'GRATUITO',
                planoNome: 'GRATUITO',
                products: [],
                stores: [],
                planoCriadoEm: firebase.firestore.FieldValue.serverTimestamp()
              }, { merge: true }).catch(function(){});
            }
          }
        } catch(e){}
        if (typeof updateSettingsPlanCard === 'function') updateSettingsPlanCard();
        if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof updateBadges === 'function') updateBadges();
      }
      if (callback) {
        var cb = callback;
        callback = null;
        cb();
      }
    }, function (e) {
      console.warn('Erro ao escutar dados do usuário:', e);
      if (callback) {
        var cb = callback;
        callback = null;
        cb();
      }
    });
  }

  window.bootApp = function (user) {
    var splash = document.getElementById('splash');
    var app = document.getElementById('app');
    var ob = document.getElementById('onboardingView');
    var ab = document.getElementById('authBox');
    var tv = document.getElementById('termsView');

    if (ob) ob.style.display = 'none';
    if (ab) ab.style.display = 'none';
    if (tv) tv.style.display = 'none';

    if (splash) {
      splash.classList.remove('booting');
      splash.classList.add('fade-out');
      splash.classList.add('hidden');
      splash.style.display = 'none';
    }
    if (app) {
      app.classList.remove('hidden');
      app.style.display = 'flex';
    }
    var bnav = document.getElementById('bottomNav');
    if (bnav) bnav.classList.add('bnav-visible');

    try {
      if (typeof loadSettings === 'function') loadSettings();
      if (typeof renderDashboard === 'function') renderDashboard();
      if (typeof updateBadges === 'function') updateBadges();
      if (typeof navigate === 'function') navigate('dashboard');
      if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();

      // Solicitar permissão de Notificações e Câmera
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        window.Capacitor.Plugins.LocalNotifications.requestPermissions().catch(function (e) { });
      } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(function (e) { });
      }

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: true })
          .then(function (stream) {
            stream.getTracks().forEach(function (track) { track.stop(); });
          })
          .catch(function (err) { });
      }

      setTimeout(function () {
        if (window.db) {
          db.collection('fichas_tecnicas').get().then(function (snapshot) {
            _catalogProducts = window._catalogProducts = snapshot.docs.map(function (doc) {
              var data = doc.data();
              return Object.assign({}, data, { id: data.ean || doc.id });
            });
            if (typeof updateBadges === 'function') updateBadges();
          }).catch(function (e) { console.error('Catalogo:', e); });
        }
      }, 300);
    } catch (err) {
      console.error('Erro ao renderizar interface principal:', err);
    }

    // Carrega dados do Firestore em segundo plano
    var targetAccount = window._currentAccountId || _currentUserId;
    if (targetAccount) {
      _loadUserDataFromFirestore(targetAccount, function () {
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof updateBadges === 'function') updateBadges();
      });
    }
  };

  auth.onAuthStateChanged(function (user) {
    showAuthLoading(false);
    if (user) {
      // ── Verificação "Lembrar minha conta" ──────────────────────────────────
      // Se o usuário NÃO marcou "Lembrar minha conta", não faz auto-login.
      // O onAuthStateChanged dispara ao abrir o app. Se a persistência for
      // SESSION e o app foi fechado, o Firebase já não retorna user.
      // Mas como segurança extra: verificamos cv_remember para o caso de
      // o dispositivo não limpar sessionStorage corretamente.
      var rememberFlag = '0';
      try { rememberFlag = localStorage.getItem('cv_remember') || '0'; } catch(e) {}
      var sessionActive = false;
      try { sessionActive = !!sessionStorage.getItem('cv_session_active'); } catch(e) {}

      // Se remember=0 e não há sessão ativa na mesma aba: desloga e pede login
      if (rememberFlag !== '1' && !sessionActive) {
        auth.signOut().catch(function(){});
        return; // onAuthStateChanged será chamado novamente com user=null
      }
      // ──────────────────────────────────────────────────────────────────────
      window._lastLoadedUserId = user.uid;
      _currentUserId = user.uid;
      localStorage.setItem('prazocerto_terms_accepted', 'true');

      // Restaura cache local isolado específico desta conta se existir
      try {
        var userCachedProds = localStorage.getItem(`cv_products_${user.uid}`);
        if (userCachedProds) {
          _remoteProducts = JSON.parse(userCachedProds);
        } else {
          _remoteProducts = [];
        }
      } catch(e) {
        _remoteProducts = [];
      }

      // Blindagem de Plano por Conta:
      // Se for a conta estudante.junior0@gmail.com, garante plano BRONZE
      if (user.email && user.email.toLowerCase() === 'estudante.junior0@gmail.com') {
        localStorage.setItem('cv_user_plan', 'BRONZE');
      } else {
        var userPlanCached = localStorage.getItem(`cv_user_plan_${user.uid}`) || 'GRATUITO';
        localStorage.setItem('cv_user_plan', userPlanCached);
      }

      // Define nome do usuário baseado na conta atual se não houver um customizado localmente para este usuário
      var currentAccountName = user.displayName || (user.email ? user.email.split('@')[0] : 'Usuário');
      if (!localStorage.getItem('cv_user_name')) {
        try { localStorage.setItem('cv_user_name', currentAccountName); } catch (e) { }
      }

      // Registro no Firestore e identificação de conta (multiusuário)
      window._currentAccountId = user.uid;
      window._currentUserRole = 'owner';
      window._currentUserStatus = 'active';

      try {
        db.collection('users').doc(user.uid).get().then(function(docSnap) {
          if (docSnap.exists) {
            var uData = docSnap.data();
            window._currentAccountId = uData.accountId || user.uid;
            window._currentUserRole = uData.role || 'owner';
            window._currentUserStatus = uData.status || 'active';
            window._currentUserPermissions = uData.permissions || null;
            window._currentUserAllowedStores = uData.allowedStores || [];

            if (uData.status === 'disabled') {
              showAuthError('Seu acesso à empresa foi desativado pelo proprietário.');
              window.handleLogout();
              return;
            }
          } else {
            // Conta legada ou novo registro sem doc: cria como owner
            db.collection('users').doc(user.uid).set({
              email: user.email,
              displayName: currentAccountName,
              accountId: user.uid,
              role: 'owner',
              status: 'active',
              termsAccepted: true,
              termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
              termsVersion: '1.0-2026',
              lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).catch(function(e){});
          }

          if (typeof window.loadTeamMembers === 'function') {
            window.loadTeamMembers();
          }
        }).catch(function(err) {
          console.warn('Erro ao consultar perfil de usuário:', err);
        });
      } catch (e) { }

      var nameEl = document.querySelector('.user-name');
      var avatarEl = document.querySelector('.user-avatar');
      var profileNameEl = document.getElementById('profileName');
      var profileEmailEl = document.getElementById('profileEmail');
      if (nameEl) nameEl.textContent = localStorage.getItem('cv_user_name') || currentAccountName;
      if (profileNameEl) profileNameEl.textContent = localStorage.getItem('cv_user_name') || currentAccountName;
      if (profileEmailEl) profileEmailEl.textContent = user.email || '—';
      if (avatarEl) {
        var label = (localStorage.getItem('cv_user_name') || currentAccountName).substring(0, 2).toUpperCase();
        avatarEl.textContent = label;
      }
      if (user.email) {
        try {
          localStorage.setItem('cv_user_email', user.email);
        } catch (e) { }
      }
      // Exibe email/nome na barra lateral se aberta
      var sidebarEmailEl = document.getElementById('sidebarUserEmail');
      if (sidebarEmailEl) sidebarEmailEl.textContent = user.email || currentAccountName;
      window.bootApp(user);
    } else {
      _currentUserId = null;
      sessionStorage.removeItem('cv_session_active');
      // Cancela listener em tempo real se ativo
      if (_firestoreUnsubscribe) { _firestoreUnsubscribe(); _firestoreUnsubscribe = null; }
      // Zera a memória ativa da tela
      _remoteProducts = [];
      try {
        localStorage.removeItem('cv_products');
        localStorage.removeItem('cv_stores');
        localStorage.removeItem('cv_user_name');
        localStorage.removeItem('cv_user_company');
        localStorage.removeItem('cv_user_avatar');
        localStorage.removeItem('cv_user_plan');
        localStorage.removeItem('cv_history_logs');
        localStorage.removeItem('cv_selected_store');
        localStorage.removeItem('cv_user_email');
        localStorage.removeItem('cv_categories');
      } catch (e) { }
      var splash = document.getElementById('splash');
      var app = document.getElementById('app');
      if (splash) {
        splash.classList.remove('hidden', 'fade-out');
        splash.style.display = 'flex';
      }
      if (app) {
        app.classList.add('hidden');
        app.style.display = 'none';
      }
      // Esconde bottom nav ao fazer logout
      var bnav = document.getElementById('bottomNav');
      if (bnav) bnav.classList.remove('bnav-visible');
    }
  });
})();

// ── COMPARTILHAMENTO DE PRODUTO (TEXTO E PRINT) ──
let currentShareProduct = null;

function openShareModal(id) {
  const products = Store.getProducts();
  const p = products.find(prod => String(prod.id) === String(id));
  if (!p) return;

  currentShareProduct = p;

  const modal = document.getElementById('shareModal');
  const imgPreview = document.getElementById('shareImgPreview');
  const btnDownload = document.getElementById('btnDownloadShareImg');

  // Gera a imagem estilizada do produto imediatamente para a prévia
  const dataUrl = generateProductShareDataUrl(p);
  if (imgPreview) imgPreview.src = dataUrl;
  if (btnDownload) btnDownload.href = dataUrl;

  if (modal) modal.classList.remove('hidden');
}

function generateProductShareDataUrl(p) {
  const canvas = document.createElement('canvas');
  const scale = 2; // Hi-DPI
  canvas.width = 600 * scale;
  canvas.height = 340 * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // Background
  const gradient = ctx.createLinearGradient(0, 0, 600, 340);
  gradient.addColorStop(0, '#0F172A');
  gradient.addColorStop(1, '#1E293B');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 600, 340);

  // Border
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, 580, 320);

  // Accent Line
  const accentGrad = ctx.createLinearGradient(10, 10, 590, 10);
  accentGrad.addColorStop(0, '#76C41B');
  accentGrad.addColorStop(1, '#5E9E1C');
  ctx.fillStyle = accentGrad;
  ctx.fillRect(10, 10, 580, 6);

  // Header Brand
  ctx.fillStyle = '#64748B';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText('PRAZOCERTO • INFORMAÇÃO DO PRODUTO', 30, 42);

  // Descrição do Produto
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillText('DESCRIÇÃO DO PRODUTO', 30, 85);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px Inter, sans-serif';

  const maxWidth = 540;
  const words = (p.name || '').split(' ');
  let line = '';
  let y = 120;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, 30, y);
      line = words[n] + ' ';
      y += 32;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, 30, y);

  // Divider
  const divY = Math.max(y + 25, 185);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, divY);
  ctx.lineTo(570, divY);
  ctx.stroke();

  // Quantidade (Col 1)
  const infoY = divY + 35;
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText('QUANTIDADE', 30, infoY);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 24px Inter, sans-serif';
  ctx.fillText(String(p.qty || 1), 30, infoY + 35);

  // Data de Vencimento (Col 2)
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText('DATA VENCIMENTO', 180, infoY);

  ctx.fillStyle = '#38BDF8';
  ctx.font = '700 24px Inter, sans-serif';
  ctx.fillText(formatDate(p.expDate), 180, infoY + 35);

  // Código EAN (Col 3 - se houver)
  if (p.code) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillText('CÓDIGO EAN', 380, infoY);

    ctx.fillStyle = '#A78BFA';
    ctx.font = '700 20px monospace';
    ctx.fillText(String(p.code), 380, infoY + 33);
  }

  return canvas.toDataURL('image/png');
}

function closeShareModal() {
  const modal = document.getElementById('shareModal');
  if (modal) modal.classList.add('hidden');
}

async function handleShareText() {
  if (!currentShareProduct) return;
  const p = currentShareProduct;
  const eanLine = p.code ? `\n🏷️ EAN: ${p.code}` : '';
  const text = `📦 PRODUTO: ${p.name}${eanLine}\n🔢 QUANTIDADE: ${p.qty || 1}\n📅 VENCIMENTO: ${formatDate(p.expDate)}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: p.name,
        text: text
      });
      showToast('Compartilhado com sucesso!', '✅');
      return;
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  }

  // Fallback: Clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('Texto copiado para a área de transferência!', '📋');
  } catch (e) {
    prompt('Copie o texto abaixo:', text);
  }
}

async function handleShareImage() {
  if (!currentShareProduct) return;
  const p = currentShareProduct;
  const dataUrl = generateProductShareDataUrl(p);

  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], `produto_${p.id || 'prazocerto'}.png`, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `PrazoCerto - ${p.name}`,
        text: `*${p.name}*\n📅 Validade: ${formatDate(p.expDate)}\n🔢 Quantidade: ${p.qty || 1}${p.code ? '\n🔖 EAN: ' + p.code : ''}`
      });
      showToast('Compartilhado com sucesso!', '✅');
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }

  // Fallback: download da imagem
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `produto_${p.id || 'prazocerto'}.png`;
  a.click();
  showToast('Imagem baixada!', '🖼️');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('shareClose')?.addEventListener('click', closeShareModal);
  document.getElementById('shareModal')?.addEventListener('click', e => { if (e.target.id === 'shareModal') closeShareModal(); });
  document.getElementById('btnShareText')?.addEventListener('click', handleShareText);
  document.getElementById('btnShareImage')?.addEventListener('click', handleShareImage);

  // Listeners do modal de relatório de alertas
  document.getElementById('alertsReportShareClose')?.addEventListener('click', closeAlertsReportShareModal);
  document.getElementById('alertsReportShareModal')?.addEventListener('click', e => { if (e.target.id === 'alertsReportShareModal') closeAlertsReportShareModal(); });
  document.getElementById('btnShareReportWhatsApp')?.addEventListener('click', handleAlertsReportWhatsApp);
  document.getElementById('btnShareReportNative')?.addEventListener('click', handleAlertsReportNative);
  document.getElementById('btnShareReportCopy')?.addEventListener('click', handleAlertsReportCopy);
});

// ══════════════════════════════════════════════════════════════════════════════
//  # 12. FLUXO DE ETIQUETAS DE PREÇO (SESSÃO TEMPORÁRIA)
// ══════════════════════════════════════════════════════════════════════════════
let _etiquetasSession = [];
let _etiquetasViewMode = 'single'; // 'single' (uma por vez) ou 'all' (ver todas)
let _etiquetasScannerActive = false;
let _etiquetasHtml5 = null;

// Remove etiqueta pelo índice
function removeEtiqueta(idx) {
  _etiquetasSession.splice(idx, 1);
  renderEtiquetasList();
}

// Atualiza quantidade de uma etiqueta
function updateEtiquetaQty(idx, val) {
  const q = parseInt(val);
  if (_etiquetasSession[idx]) {
    _etiquetasSession[idx].qty = (isNaN(q) || q < 1) ? 1 : q;
  }
}

// Configura swipe-to-delete nos itens da lista
function _setupEtiquetasSwipe(container) {
  const items = container.querySelectorAll('[data-etiqueta-idx]');
  items.forEach(card => {
    let startX = 0, startY = 0, dragging = false;
    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = false;
      card.style.transition = 'none';
    }, { passive: true });
    card.addEventListener('touchmove', e => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && dx > 8) {
        dragging = true;
        card.style.transform = `translateX(${Math.min(dx, 140)}px)`;
        card.style.opacity = Math.max(0.3, 1 - dx / 200);
      }
    }, { passive: true });
    card.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      if (dragging && dx > 90) {
        card.style.transition = 'transform 0.2s, opacity 0.2s';
        card.style.transform = 'translateX(110%)';
        card.style.opacity = '0';
        const idx = parseInt(card.dataset.etiquetaIdx);
        setTimeout(() => removeEtiqueta(idx), 210);
      } else {
        card.style.transition = 'transform 0.25s, opacity 0.25s';
        card.style.transform = 'translateX(0)';
        card.style.opacity = '1';
      }
    });
  });
}

function openEtiquetasFlow() {
  if (_etiquetasSession.length > 0) {
    openEtiquetasListModal();
  } else {
    const modal = document.getElementById('etiquetasIntroModal');
    if (modal) modal.classList.remove('hidden');
  }
}

function closeEtiquetasIntroModal() {
  const modal = document.getElementById('etiquetasIntroModal');
  if (modal) modal.classList.add('hidden');
}

function openEtiquetasListModal() {
  closeEtiquetasIntroModal();
  const modal = document.getElementById('etiquetasListModal');
  if (modal) {
    modal.classList.remove('hidden');
    renderEtiquetasList();
  }
}

function closeEtiquetasListModal() {
  const modal = document.getElementById('etiquetasListModal');
  if (modal) modal.classList.add('hidden');
}

function showEtiquetasBlockExitModal() {
  const modal = document.getElementById('etiquetasBlockExitModal');
  if (modal) modal.classList.remove('hidden');
}

function closeEtiquetasBlockExitModal() {
  const modal = document.getElementById('etiquetasBlockExitModal');
  if (modal) modal.classList.add('hidden');
}

function handleEtiquetasBlockStayClick() {
  closeEtiquetasBlockExitModal();
  openEtiquetasListModal();
}

async function handleEtiquetasBlockDeleteClick() {
  closeEtiquetasBlockExitModal();
  await confirmClearEtiquetasList();
}

async function requestCloseEtiquetasFlow() {
  if (_etiquetasSession.length > 0) {
    showEtiquetasBlockExitModal();
  } else {
    closeEtiquetasListModal();
    closeEtiquetasIntroModal();
  }
}

async function confirmClearEtiquetasList() {
  const confirmed = await confirm(
    'Excluir lista de etiquetas?',
    'Todas as etiquetas geradas nesta sessão serão apagadas permanentemente.'
  );
  if (confirmed) {
    _etiquetasSession = [];
    closeEtiquetasBlockExitModal();
    closeSingleEtiquetaModal();
    closeEtiquetasListModal();
    closeEtiquetasIntroModal();
    showToast('Lista de etiquetas excluída com sucesso.', '🗑️');
  }
}

function setEtiquetasViewMode(mode) {
  _etiquetasViewMode = mode;
  const tabSingle = document.getElementById('etiquetaTabOneByOne');
  const tabAll = document.getElementById('etiquetaTabAll');
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#76C41B';
  const dim = getComputedStyle(document.documentElement).getPropertyValue('--primary-dim').trim() || 'rgba(118,196,27,0.18)';
  if (tabSingle && tabAll) {
    if (mode === 'single') {
      tabSingle.style.setProperty('background', dim, 'important');
      tabSingle.style.setProperty('color', primary, 'important');
      tabSingle.style.setProperty('border', `2px solid ${primary}`, 'important');
      tabAll.style.setProperty('background', 'transparent', 'important');
      tabAll.style.setProperty('color', '#64748b', 'important');
      tabAll.style.setProperty('border', '1.5px solid rgba(255,255,255,0.08)', 'important');
    } else {
      tabAll.style.setProperty('background', dim, 'important');
      tabAll.style.setProperty('color', primary, 'important');
      tabAll.style.setProperty('border', `2px solid ${primary}`, 'important');
      tabSingle.style.setProperty('background', 'transparent', 'important');
      tabSingle.style.setProperty('color', '#64748b', 'important');
      tabSingle.style.setProperty('border', '1.5px solid rgba(255,255,255,0.08)', 'important');
    }
  }
  renderEtiquetasList();
}

function renderEtiquetasList() {
  const container = document.getElementById('etiquetasContainer');
  const countBadge = document.getElementById('etiquetasCountBadge');
  if (!container) return;

  const count = _etiquetasSession.length;
  if (countBadge) {
    countBadge.textContent = count === 1 ? '1 etiqueta gerada' : `${count} etiquetas geradas`;
  }

  // Garante que o estado visual das abas reflita _etiquetasViewMode corretamente
  const tabSingle = document.getElementById('etiquetaTabOneByOne');
  const tabAll = document.getElementById('etiquetaTabAll');
  const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#76C41B';
  const dim = getComputedStyle(document.documentElement).getPropertyValue('--primary-dim').trim() || 'rgba(118,196,27,0.18)';
  if (tabSingle && tabAll) {
    if (_etiquetasViewMode === 'single') {
      tabSingle.style.setProperty('background', dim, 'important');
      tabSingle.style.setProperty('color', primary, 'important');
      tabSingle.style.setProperty('border', `2px solid ${primary}`, 'important');
      tabAll.style.setProperty('background', 'transparent', 'important');
      tabAll.style.setProperty('color', '#64748b', 'important');
      tabAll.style.setProperty('border', '1.5px solid rgba(255,255,255,0.08)', 'important');
    } else {
      tabAll.style.setProperty('background', dim, 'important');
      tabAll.style.setProperty('color', primary, 'important');
      tabAll.style.setProperty('border', `2px solid ${primary}`, 'important');
      tabSingle.style.setProperty('background', 'transparent', 'important');
      tabSingle.style.setProperty('color', '#64748b', 'important');
      tabSingle.style.setProperty('border', '1.5px solid rgba(255,255,255,0.08)', 'important');
    }
  }

  if (count === 0) {
    container.innerHTML = `
      <div style="flex:1; padding:50px 20px; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px;">
        <div style="width:72px; height:72px; border-radius:20px; background:rgba(142,255,0,0.07); border:1px solid rgba(142,255,0,0.15); display:flex; align-items:center; justify-content:center;">
          <svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' fill='none' viewBox='0 0 24 24' stroke='rgba(142,255,0,0.5)' stroke-width='1.5'><rect x='3' y='5' width='18' height='14' rx='2'/><path d='M3 9h18M8 5v4M16 5v4'/></svg>
        </div>
        <div>
          <div style="font-size:1.1rem; font-weight:800; color:#e2e8f0; margin-bottom:6px;">Nenhuma etiqueta gerada</div>
          <div style="font-size:0.82rem; color:#475569; max-width:240px; line-height:1.5; margin:0 auto;">Toque em &ldquo;Escanear Próximo&rdquo; para ler o código de barras de um produto.</div>
        </div>
      </div>
    `;
    return;
  }

  if (_etiquetasViewMode === 'all') {
    // MODO VER TODAS: Etiquetas preto e branco
    container.innerHTML = _etiquetasSession.map((item, idx) => `
      <div style="background:#ffffff; color:#000000; border-radius:16px; padding:16px; border:2px solid #222222; box-shadow:0 4px 14px rgba(0,0,0,0.18); display:flex; flex-direction:column; align-items:center; width:100%; box-sizing:border-box; position:relative;">
        <!-- Topo: número e badge com quantas etiquetas imprimir no canto -->
        <div style="width:100%; display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
          <span style="font-size:0.8rem; font-weight:800; background:#000000; color:#ffffff; padding:4px 10px; border-radius:8px;">
            #${idx + 1}
          </span>
          <span style="font-size:0.8rem; font-weight:900; color:#000000; background:#f0f0f0; border:1.5px solid #333333; padding:4px 12px; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            🖨️ ${item.qty || 1} ${Number(item.qty || 1) === 1 ? 'etiqueta' : 'etiquetas'}
          </span>
        </div>

        <!-- 1. Nome do produto centralizado acima -->
        <div style="font-size:1.02rem; font-weight:900; color:#000000; text-align:center; text-transform:uppercase; line-height:1.3; width:100%; word-break:break-word; margin-bottom:12px; letter-spacing:0.3px;">
          ${escHtml(item.name)}
        </div>

        <!-- 2. Código de barra Zebra centralizado -->
        <div style="width:100%; max-width:280px; min-height:64px; display:flex; align-items:center; justify-content:center; background:#ffffff; border-radius:12px; padding:8px 14px; margin-bottom:8px; border:1.5px solid #cccccc; box-sizing:border-box;">
          <img src="https://bwipjs-api.metafloor.com/?bcid=ean13&text=${encodeURIComponent(item.code)}&scale=3&height=12&includetext=false" alt="Barcode ${escHtml(item.code)}" style="max-width:100%; height:50px; object-fit:contain;" onerror="this.src='https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(item.code)}&scale=3&height=12&includetext=false'" />
        </div>

        <!-- 3. Código em número centralizado abaixo -->
        <div style="font-family:monospace, 'Space Grotesk', sans-serif; font-size:1.18rem; font-weight:900; letter-spacing:3px; color:#000000; text-align:center; width:100%;">
          ${escHtml(item.code)}
        </div>
      </div>
    `).join('');
  } else {
    // MODO UMA POR VEZ — etiquetas preto e branco
    container.innerHTML = _etiquetasSession.map((item, idx) => `
      <div data-etiqueta-idx="${idx}" style="background:#ffffff; color:#000000; border-radius:16px; border:2px solid #222222; box-shadow:0 4px 14px rgba(0,0,0,0.18); width:100%; box-sizing:border-box; overflow:hidden; position:relative; flex-shrink:0;">
        <!-- Área superior com clique para zoom/modal individual -->
        <div onclick="openSingleEtiquetaModal(${idx})" style="cursor:pointer; padding:16px 14px 12px 14px; display:flex; flex-direction:column; align-items:center; position:relative; width:100%; box-sizing:border-box;">
          <!-- Número identificador no canto esquerdo -->
          <div style="position:absolute; left:14px; top:14px; width:34px; height:34px; border-radius:10px; background:#000000; border:1.5px solid #444444; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:0.9rem; color:#ffffff; font-family:'Space Grotesk',sans-serif;">
            ${idx + 1}
          </div>

          <!-- 1. Descrição do produto centralizada -->
          <div style="font-weight:900; font-size:0.95rem; color:#000000; text-align:center; width:calc(100% - 70px); margin:0 auto 12px auto; line-height:1.25; word-break:break-word;">
            ${escHtml(item.name)}
          </div>

          <!-- 2. Código de barras zebra centralizado e 3. Código em número centralizado logo abaixo -->
          <div style="background:#ffffff; border-radius:12px; padding:10px 16px 8px 16px; border:1.5px solid #cccccc; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; max-width:260px; box-sizing:border-box;">
            <img src="https://bwipjs-api.metafloor.com/?bcid=ean13&text=${encodeURIComponent(item.code)}&scale=3&height=12&includetext=false" alt="Barcode ${escHtml(item.code)}" style="max-width:100%; height:46px; object-fit:contain;" onerror="this.src='https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(item.code)}&scale=3&height=12&includetext=false'" />
            <span style="font-family:monospace, 'Space Grotesk', sans-serif; font-size:0.92rem; font-weight:800; color:#000000; letter-spacing:2px; margin-top:4px; text-align:center;">
              ${escHtml(item.code)}
            </span>
          </div>
        </div>

        <!-- Rodapé: quantidade a imprimir -->
        <div style="position:relative; z-index:1; display:flex; align-items:center; justify-content:flex-end; padding:8px 14px; border-top:1.5px solid #dddddd; gap:8px; background:#f5f5f5;">
          <span style="font-size:0.75rem; color:#444444; font-weight:600;">Qtd. a imprimir:</span>
          <div style="display:flex; align-items:center; gap:0; background:#ffffff; border:1.5px solid #333333; border-radius:8px; overflow:hidden;">
            <button onclick="event.stopPropagation(); const inp=document.getElementById('qty_${idx}'); inp.value=Math.max(1,parseInt(inp.value||1)-1); updateEtiquetaQty(${idx},inp.value)" style="width:30px; height:30px; background:transparent; border:none; color:#333333; font-size:1.1rem; cursor:pointer; display:flex; align-items:center; justify-content:center;">−</button>
            <input id="qty_${idx}" type="number" min="1" value="${item.qty || 1}" oninput="updateEtiquetaQty(${idx},this.value)" onclick="event.stopPropagation()" style="width:38px; background:transparent; border:none; outline:none; color:#000000; font-size:0.92rem; font-weight:900; text-align:center; padding:0; font-family:'Space Grotesk',sans-serif;" />
            <button onclick="event.stopPropagation(); const inp=document.getElementById('qty_${idx}'); inp.value=parseInt(inp.value||1)+1; updateEtiquetaQty(${idx},inp.value)" style="width:30px; height:30px; background:transparent; border:none; color:#333333; font-size:1.1rem; cursor:pointer; display:flex; align-items:center; justify-content:center;">+</button>
          </div>
        </div>
      </div>
    `).join('');
    // Ativa swipe-to-delete
    _setupEtiquetasSwipe(container);
  }
}

function openSingleEtiquetaModal(idx) {
  const item = _etiquetasSession[idx];
  if (!item) return;

  const wrap = document.getElementById('singleEtiquetaCardWrap');
  if (wrap) {
    wrap.innerHTML = `
      <div style="background:#ffffff; color:#000000; border-radius:16px; padding:20px 18px; border:2px solid #222222; box-shadow:0 10px 25px rgba(0,0,0,0.3); display:flex; flex-direction:column; align-items:center; width:100%; box-sizing:border-box;">
        <div style="width:100%; display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
          <span style="font-size:0.75rem; font-weight:800; background:#000000; color:#ffffff; padding:3px 10px; border-radius:6px;">#${idx + 1}</span>
          <span style="font-size:0.8rem; color:#444444; font-weight:700; text-transform:uppercase; border:1px solid #cccccc; padding:3px 10px; border-radius:6px;">Etiqueta</span>
        </div>
        <div style="font-size:1.15rem; font-weight:900; color:#000000; text-align:center; text-transform:uppercase; line-height:1.3; width:100%; word-break:break-word; margin-bottom:16px;">
          ${escHtml(item.name)}
        </div>
        <div style="width:100%; max-width:340px; min-height:80px; display:flex; align-items:center; justify-content:center; background:#ffffff; border:1px solid #cccccc; border-radius:10px; padding:10px; margin-bottom:10px; box-sizing:border-box;">
          <img src="https://bwipjs-api.metafloor.com/?bcid=ean13&text=${encodeURIComponent(item.code)}&scale=4&height=14&includetext=false" alt="Barcode ${escHtml(item.code)}" style="max-width:100%; height:70px; object-fit:contain; image-rendering:pixelated;" onerror="this.src='https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(item.code)}&scale=4&height=14&includetext=false'" />
        </div>
        <div style="font-family:monospace, 'Space Grotesk', sans-serif; font-size:1.4rem; font-weight:900; letter-spacing:4px; color:#000000; text-align:center; width:100%;">
          ${escHtml(item.code)}
        </div>
      </div>
    `;
  }

  const modal = document.getElementById('etiquetaSingleViewModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSingleEtiquetaModal() {
  const modal = document.getElementById('etiquetaSingleViewModal');
  if (modal) modal.classList.add('hidden');
}

// Interceptar botão Voltar do Android (Capacitor/Cordova/Browser History)
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', function (e) {
    if (typeof _etiquetasSession !== 'undefined' && _etiquetasSession.length > 0) {
      history.pushState(null, null, window.location.href);
      showEtiquetasBlockExitModal();
    }
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('backbutton', function (e) {
      if (typeof _etiquetasSession !== 'undefined' && _etiquetasSession.length > 0) {
        if (e && e.preventDefault) e.preventDefault();
        showEtiquetasBlockExitModal();
      }
    }, false);
  }
}

// ── SCANNER DEDICADO DO FLUXO DE ETIQUETAS (COM GOOGLE ML KIT / BARCODE DETECTOR NATIVO & HTML5QRCODE) ──
async function startEtiquetasScanner() {
  if (_etiquetasScannerActive) return;

  closeEtiquetasIntroModal();

  const overlay = document.createElement('div');
  overlay.id = 'etiquetasScanOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:999999;display:flex;flex-direction:column;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:calc(var(--safe-top, 0px) + 20px) 18px 14px 18px;background:rgba(0,0,0,0.95);border-bottom:1px solid rgba(59,130,246,0.3);z-index:10;box-sizing:border-box;width:100%;';
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="color:#60a5fa;font-size:0.95rem;font-weight:800;display:flex;align-items:center;gap:6px;">
        📷 Escanear para Etiqueta
      </span>
      <span style="background:#1e293b;color:#94a3b8;font-size:0.75rem;padding:3px 8px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);">
        ${_etiquetasSession.length} na lista
      </span>
    </div>
    <button id="closeEtiquetasScanBtn" style="background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:1.3rem;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
  `;

  const frameWrap = document.createElement('div');
  frameWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;';

  const frameDiv = document.createElement('div');
  frameDiv.id = 'etiquetasScanFrameDiv';
  frameDiv.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
  frameWrap.appendChild(frameDiv);

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:14px 16px;text-align:center;color:#94a3b8;font-size:0.85rem;background:rgba(0,0,0,0.92);border-top:1px solid rgba(255,255,255,0.08);z-index:10;';
  hint.innerHTML = 'Aponte a câmera para o <b style="color:#fff;">código de barras</b> do produto';

  overlay.appendChild(header);
  overlay.appendChild(frameWrap);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  let streamTrack = null;

  function closeEtiquetasScanner() {
    _etiquetasScannerActive = false;
    if (streamTrack) {
      try { streamTrack.stop(); } catch (e) { }
      streamTrack = null;
    }
    if (_etiquetasHtml5) {
      _etiquetasHtml5.stop().catch(() => { });
      try { _etiquetasHtml5.clear(); } catch (e) { }
      _etiquetasHtml5 = null;
    }
    if (typeof _forceStopCameraTracks === 'function') {
      _forceStopCameraTracks();
    }
    overlay.remove();
  }

  document.getElementById('closeEtiquetasScanBtn').addEventListener('click', () => {
    closeEtiquetasScanner();
    openEtiquetasListModal();
  });

  _etiquetasScannerActive = true;

  // 1. Tenta usar o Google BarcodeDetector (ML Kit nativo do Android/Chrome) para leitura ultra-rápida
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code']
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      streamTrack = stream.getVideoTracks()[0];

      const videoEl = document.createElement('video');
      videoEl.setAttribute('autoplay', '');
      videoEl.setAttribute('playsinline', '');
      videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;';
      frameDiv.appendChild(videoEl);
      videoEl.srcObject = stream;
      await videoEl.play();

      // Mira visual sobreposta
      const reticle = document.createElement('div');
      reticle.style.cssText = 'position:absolute;width:260px;height:260px;border:3px solid rgba(59,130,246,0.85);border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,0.5), 0 0 20px rgba(59,130,246,0.5);pointer-events:none;z-index:5;';
      frameWrap.appendChild(reticle);

      const detectFrame = async () => {
        if (!_etiquetasScannerActive) return;
        try {
          const barcodes = await detector.detect(videoEl);
          if (barcodes && barcodes.length > 0) {
            const rawCode = barcodes[0].rawValue;
            if (rawCode) {
              playScanSound();
              if (navigator.vibrate) navigator.vibrate([180]);
              closeEtiquetasScanner();
              await handleScannedEtiqueta(rawCode);
              return;
            }
          }
        } catch (err) { }
        if (_etiquetasScannerActive) {
          requestAnimationFrame(detectFrame);
        }
      };

      requestAnimationFrame(detectFrame);
      return;
    } catch (err) {
      console.warn('Google BarcodeDetector não disponível para Etiquetas, usando Html5Qrcode:', err);
    }
  }

  // 2. Fallback: Html5Qrcode com acelerador de leitura
  try {
    _etiquetasHtml5 = new Html5Qrcode('etiquetasScanFrameDiv', { experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    const cfg = {
      fps: 30,
      disableFlip: false,
      qrbox: (w, h) => {
        const side = Math.min(w * 0.8, h * 0.8, 280);
        return { width: Math.floor(side), height: Math.floor(side) };
      },
      experimentalFeatures: { useBarCodeDetectorIfSupported: true, willReadFrequently: true },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF, Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.QR_CODE
      ]
    };

    await _etiquetasHtml5.start(
      { facingMode: 'environment' },
      cfg,
      async (code) => {
        if (!_etiquetasScannerActive) return;
        playScanSound();
        if (navigator.vibrate) navigator.vibrate([180]);
        closeEtiquetasScanner();

        await handleScannedEtiqueta(code);
      },
      () => { }
    );
  } catch (e) {
    _etiquetasScannerActive = false;
    overlay.remove();
    showToast('Câmera bloqueada. Permita o acesso à câmera.', '⚠️', 4000);
    openEtiquetasListModal();
  }
}

async function handleScannedEtiqueta(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) {
    openEtiquetasListModal();
    return;
  }

  // 1. Verificar se o produto já está na lista da sessão
  const isDuplicate = _etiquetasSession.some(item => item.code === code);
  if (isDuplicate) {
    const scanAnother = await confirm(
      'Este produto já está na lista.',
      `O código ${code} já foi adicionado às etiquetas.\nDeseja escanear outro produto?`
    );
    if (scanAnother) {
      startEtiquetasScanner();
    } else {
      openEtiquetasListModal();
    }
    return;
  }

  showToast('Buscando produto...', '🔍', 2000);

  // 2. Buscar nome nas fontes existentes do projeto (Store local + APIs / Cache via lookupProductByBarcode)
  let productName = '';

  // 2.1 Verifica nos produtos cadastrados pelo usuário
  const userProducts = (typeof Store !== 'undefined' && Store.getAllProducts) ? Store.getAllProducts() : [];
  const foundUserProd = userProducts.find(p =>
    (p.code && p.code.trim() === code) ||
    (p.ean && String(p.ean).trim() === code)
  );
  if (foundUserProd && foundUserProd.name) {
    productName = foundUserProd.name;
  }

  // 2.2 Se não encontrou, busca na cascata de APIs / Firestore Cache existente
  if (!productName && typeof lookupProductByBarcode === 'function') {
    try {
      const apiProd = await lookupProductByBarcode(code);
      if (apiProd && (apiProd.nome || apiProd.name)) {
        productName = apiProd.nome || apiProd.name;
      }
    } catch (e) {
      console.warn('[Etiquetas] Erro na busca de produto:', e);
    }
  }

  // 3. Se não encontrar o nome nas APIs ou cadastro, define um título padrão e gera a etiqueta normalmente
  if (!productName) {
    productName = `PRODUTO ${code}`;
  }

  // 4. Adiciona ao final da lista de etiquetas
  _etiquetasSession.push({
    code: code,
    name: productName.trim()
  });

  showToast('Etiqueta gerada!', '🏷️', 2500);
  openEtiquetasListModal();
}

/* ==============================================================================
 * # 12. SISTEMA DE PLANOS DE ASSINATURA & GATILHOS DE PAYWALL
 * ============================================================================== */

const PLANOS_SISTEMA = {
  GRATUITO: {
    id: 'GRATUITO',
    nome: 'GRATUITO',
    tagline: 'Perfeito para começar',
    badge: null,
    limiteLojas: 1,
    limiteItensPorLoja: 20,
    limiteItensTotal: 20,
    lojasTexto: '1 loja',
    itensLojaTexto: '20 itens por loja',
    totalTexto: '20 itens total',
    multiTexto: 'Apenas o dono',
    precoStr: 'R$ 0,00',
    precoNum: 0.00,
    cor: '#76C41B',
    iconBadge: '🎁',
    btnTexto: 'Começar grátis',
    recursos: ['1 loja cadastrada', 'Até 20 itens por loja', 'Controle de validades básico', 'Alertas de vencimento', 'Acesso ao app mobile']
  },
  BRONZE: {
    id: 'BRONZE',
    nome: 'BRONZE',
    tagline: 'Para pequenos negócios',
    badge: null,
    limiteLojas: 3,
    limiteItensPorLoja: 180,
    limiteItensTotal: 540,
    lojasTexto: '3 lojas',
    itensLojaTexto: '180 itens por loja',
    totalTexto: '540 itens total',
    multiTexto: 'Apenas o dono',
    precoStr: 'R$ 15,00',
    precoNum: 15.00,
    cor: '#CD7F32',
    iconBadge: '🏅',
    btnTexto: 'Assinar Bronze',
    recursos: ['3 lojas cadastradas', '180 itens por loja (540 total)', 'Alertas automáticos de vencimento', 'Relatórios básicos', 'Suporte via WhatsApp']
  },
  PRATA: {
    id: 'PRATA',
    nome: 'PRATA',
    tagline: 'Mais controle e organização',
    badge: '★ MAIS POPULAR',
    badgeCor: '#5B21B6',
    limiteLojas: 5,
    limiteItensPorLoja: 200,
    limiteItensTotal: 1000,
    lojasTexto: '5 lojas',
    itensLojaTexto: '200 itens por loja',
    totalTexto: '1.000 itens total',
    multiTexto: 'Apenas o dono',
    precoStr: 'R$ 35,00',
    precoNum: 35.00,
    cor: '#A855F7',
    iconBadge: '🥈',
    btnTexto: 'Assinar Prata',
    recursos: ['5 lojas cadastradas', '200 itens por loja (1.000 total)', 'Alertas automáticos de vencimento', 'Relatórios completos', 'Histórico de movimentações', 'Suporte prioritário via WhatsApp']
  },
  OURO: {
    id: 'OURO',
    nome: 'OURO',
    tagline: 'Para quem quer crescer',
    badge: null,
    badgeCor: '#FFD700',
    limiteLojas: 6,
    limiteItensPorLoja: 210,
    limiteItensTotal: 1260,
    lojasTexto: '6 lojas',
    itensLojaTexto: '210 itens por loja',
    totalTexto: '1.260 itens total',
    multiTexto: 'Apenas o dono',
    precoStr: 'R$ 59,00',
    precoNum: 59.00,
    cor: '#FFD700',
    iconBadge: '🏆',
    btnTexto: 'Assinar Ouro',
    recursos: ['6 lojas cadastradas', '210 itens por loja (1.260 total)', 'Alertas avançados e personalizados', 'Relatórios completos + exportação', 'Histórico detalhado', 'Scanner QR/Barras ilimitado', 'Suporte VIP via WhatsApp']
  },
  MINIMERCADO: {
    id: 'MINIMERCADO',
    nome: 'MINIMERCADO',
    tagline: 'Ideal p/ minimercados',
    badge: null,
    limiteLojas: 2,
    limiteItensPorLoja: 750,
    limiteItensTotal: 1500,
    lojasTexto: 'Até 2 lojas',
    itensLojaTexto: '750 itens/loja',
    totalTexto: '1.500 itens total',
    multiTexto: 'Dono + 2 func.',
    precoStr: 'R$ 99,00',
    precoNum: 99.00,
    cor: '#00B4D8',
    iconBadge: 'B2B',
    btnTexto: 'Assinar Plano',
    recursos: ['Até 2 lojas', '750 itens por loja (1.500 total)', 'Dono + 2 funcionários', 'Relatórios B2B e exportação', 'Controle multiusuário', 'Suporte dedicado VIP']
  },
  DISTRIBUIDORA: {
    id: 'DISTRIBUIDORA',
    nome: 'DISTRIBUIÇÃO',
    tagline: 'Redes e distribuidoras',
    badge: null,
    limiteLojas: 5,
    limiteItensPorLoja: 1000,
    limiteItensTotal: 5000,
    lojasTexto: 'Até 5 lojas',
    itensLojaTexto: '1.000 itens/loja',
    totalTexto: '5.000 itens total',
    multiTexto: 'Dono + 2 func.',
    precoStr: 'R$ 199,00',
    precoNum: 199.00,
    cor: '#B5179E',
    iconBadge: 'B2B',
    btnTexto: 'Assinar Plano',
    recursos: ['Até 5 lojas', '1.000 itens por loja (5.000 total)', 'Dono + 2 funcionários', 'Relatórios avançados + exportação', 'Gestão de distribuidoras', 'Painel multiempresa', 'Suporte dedicado 24h']
  }
};

// PLAN_CIRCLE_ICONS é definido dentro de renderPlansScreen e exposto em window.PLAN_CIRCLE_ICONS


let _selectedCheckoutPlanId = null;

// Helpers de status de assinatura
function getSubscriptionState() {
  const currentPlan = getCurrentUserPlan();
  const isCanceled = localStorage.getItem('cv_subscription_canceled') === 'true';
  const autoRenew = localStorage.getItem('cv_auto_renew') !== 'false' && !isCanceled;
  const accessUntil = localStorage.getItem('cv_access_until') || '05/10/2026';
  const paymentMethod = localStorage.getItem('cv_payment_method') || 'Cartão de Crédito (•••• 4242)';

  return {
    plan: currentPlan,
    isCanceled: isCanceled,
    autoRenew: autoRenew,
    accessUntil: accessUntil,
    paymentMethod: paymentMethod
  };
}

function getCurrentUserPlan() {
  const currentEmail = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email)
    ? auth.currentUser.email
    : (localStorage.getItem('cv_user_email') || '');

  // Conta proprietária: estudante.junior0@gmail.com tem acesso garantido ao plano BRONZE
  if (currentEmail && currentEmail.toLowerCase() === 'estudante.junior0@gmail.com') {
    let p = localStorage.getItem('cv_user_plan');
    if (!p || p === 'GRATUITO') {
      try { localStorage.setItem('cv_user_plan', 'BRONZE'); } catch(e){}
      p = 'BRONZE';
    }
    return PLANOS_SISTEMA[p] || PLANOS_SISTEMA.BRONZE;
  }

  let planId = localStorage.getItem('cv_user_plan');
  if (!planId) {
    planId = 'GRATUITO';
    try { localStorage.setItem('cv_user_plan', 'GRATUITO'); } catch(e){}
  }
  return PLANOS_SISTEMA[planId] || PLANOS_SISTEMA.GRATUITO;
}

function _hexToRgb(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
}

// ── 3 BLOQUEIOS DE GATILHO (PAYWALL) ──

function checkProductPlanLimits(targetStoreName) {
  const currentPlan = getCurrentUserPlan();
  const allProds = Store.getAllProducts() || [];

  // 1. Limite Global
  if (allProds.length >= currentPlan.limiteItensTotal) {
    return {
      allowed: false,
      reason: `Você atingiu o limite global de ${currentPlan.limiteItensTotal} itens do plano ${currentPlan.nome} (${allProds.length}/${currentPlan.limiteItensTotal}).`
    };
  }

  // 2. Limite por Loja
  const storeFilter = (targetStoreName || '').trim();
  if (storeFilter) {
    const storeCount = allProds.filter(p => {
      const pLoc = (p.location ? p.location.trim() : '');
      return pLoc.toLowerCase() === storeFilter.toLowerCase();
    }).length;

    if (storeCount >= currentPlan.limiteItensPorLoja) {
      return {
        allowed: false,
        reason: `A loja "${storeFilter}" atingiu o limite máximo de ${currentPlan.limiteItensPorLoja} itens permitidos no plano ${currentPlan.nome}.`
      };
    }
  }

  return { allowed: true };
}

function getActiveAllowedStores() {
  const currentPlan = getCurrentUserPlan();
  const rawStores = Store.getStores() || [];
  const limit = currentPlan.limiteLojas || 1;
  return rawStores.slice(0, limit);
}

function enforcePlanLimitsOnDowngrade() {
  // Conforme regra de negócio: NUNCA apaga ou deleta produtos e lojas de planos anteriores.
  // Os itens e filiais continuam 100% salvos no banco de dados e são desbloqueados
  // automaticamente caso o usuário retorne a um plano superior.
  if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderProducts === 'function') renderProducts();
}

function getAllDistinctStores() {
  const storesSet = new Set();
  const registered = Store.getStores() || [];
  registered.forEach(s => {
    const name = String(s || '').trim();
    if (name && name !== 'Sem Loja') storesSet.add(name);
  });

  const sel = document.getElementById('globalLocationFilter');
  if (sel && sel.options && sel.options.length > 0) {
    Array.from(sel.options).forEach(o => {
      const v = String(o.value || '').trim();
      if (v && v !== 'all' && v !== 'Sem Loja') storesSet.add(v);
    });
  }

  const products = Store.getAllProducts() || [];
  products.forEach(p => {
    const loc = String(p.location || '').trim();
    if (loc && loc !== 'Sem Loja') storesSet.add(loc);
  });

  return Array.from(storesSet);
}

function checkStorePlanLimit() {
  const currentPlan = getCurrentUserPlan();
  const currentStores = getAllDistinctStores();

  if (currentStores.length >= currentPlan.limiteLojas) {
    return {
      allowed: false,
      reason: `Você atingiu o limite máximo de ${currentPlan.limiteLojas} loja(s) permitidas no plano ${currentPlan.nome}. Faça upgrade para adicionar mais filiais!`
    };
  }

  return { allowed: true };
}

function openPlanLimitModal(message) {
  const modal = document.getElementById('planLimitModal');
  const msgEl = document.getElementById('planLimitModalMsg');
  if (msgEl) msgEl.textContent = message || 'Você atingiu o limite do seu plano atual.';
  if (modal) modal.style.display = 'flex';
}

function closePlanLimitModal() {
  const modal = document.getElementById('planLimitModal');
  if (modal) modal.style.display = 'none';
}

// ── ATUALIZA CONTADOR DE LOJAS NO HERO (pode ser chamado a qualquer momento) ──
function updateHeroStoresCount() {
  const currentPlan = getCurrentUserPlan ? getCurrentUserPlan() : null;
  if (!currentPlan) return;
  const stores = getAllDistinctStores();
  const count = stores.length;
  const heroStoresCount = document.getElementById('planHeroStoresCount');
  if (heroStoresCount) {
    heroStoresCount.textContent = `${count} de ${currentPlan.limiteLojas}`;
    heroStoresCount.style.color = count >= currentPlan.limiteLojas ? '#FF3B30' : '#FFFFFF';
  }
  const heroStoresBar = document.getElementById('planHeroStoresProgressBar');
  const heroStoresLabel = document.getElementById('planHeroStoresUsedLabel');
  const storePct = Math.min(100, Math.round((count / currentPlan.limiteLojas) * 100));
  if (heroStoresBar) {
    heroStoresBar.style.width = `${storePct}%`;
    heroStoresBar.style.background = storePct >= 100 ? '#FF3B30' : (currentPlan.cor || '#76C41B');
  }
  if (heroStoresLabel) {
    heroStoresLabel.textContent = `${count} de ${currentPlan.limiteLojas} lojas utilizadas (${storePct}%)`;
    heroStoresLabel.style.color = storePct >= 100 ? '#FF3B30' : '#FFFFFF';
  }
}

// ── RENDERIZAÇÃO DA TELA DE PLANOS & CARDS VERTICAIS ──

function renderPlansScreen() {
  const subState = getSubscriptionState();
  const currentPlan = subState.plan;
  const allProds = Store.getAllProducts() || [];
  const currentStores = getAllDistinctStores();
  const totalItens = allProds.length;
  const totalStores = currentStores.length;
  const limiteTotal = currentPlan.limiteItensTotal;
  const pct = Math.min(100, Math.round((totalItens / limiteTotal) * 100));
  const rgb = _hexToRgb(currentPlan.cor);

  // ── HERO CARD (plano atual) ─────────────────────────────────
  const heroCard = document.getElementById('planCurrentHeroCard');
  const heroIconWrap = document.getElementById('planHeroIconWrap');
  const heroIcon = document.getElementById('planHeroIcon');
  const heroTitle = document.getElementById('planHeroTitle');
  const heroPrice = document.getElementById('planHeroPrice');
  const heroStatusText = document.getElementById('planHeroStatusText');
  const heroStatusDot = document.getElementById('planHeroStatusDot');
  const heroStatusBadge = document.getElementById('planHeroStatusBadge');
  const heroRenewalLabel = document.getElementById('planHeroRenewalLabel');
  const heroRenewalDate = document.getElementById('planHeroRenewalDate');
  const heroItemsUsed = document.getElementById('planHeroItemsUsed');
  const heroProgressBar = document.getElementById('planHeroProgressBar');
  const heroStoresCount = document.getElementById('planHeroStoresCount');
  const heroItemsPerStore = document.getElementById('planHeroItemsPerStore');
  const heroAutoRenewText = document.getElementById('planHeroAutoRenewText');
  const heroAutoRenewIcon = document.getElementById('planHeroAutoRenewIcon');
  const heroIconLoja = document.getElementById('heroIconLoja');
  const heroIconBox = document.getElementById('heroIconBox');
  const btnHeroManage = document.getElementById('btnHeroManage');
  const btnHeroManageIcon = document.getElementById('btnHeroManageIcon');

  if (heroCard) {
    heroCard.style.borderColor = currentPlan.cor;
    heroCard.style.boxShadow = `0 0 18px rgba(${rgb}, 0.22), inset 0 0 16px rgba(${rgb}, 0.04)`;
  }
  if (heroIconWrap) {
    heroIconWrap.style.borderColor = currentPlan.cor;
    heroIconWrap.style.background = `rgba(${rgb}, 0.12)`;
    heroIconWrap.style.boxShadow = `0 0 12px rgba(${rgb}, 0.3)`;
  }
  if (heroIcon) {
    const iconSvg = (typeof PLAN_CIRCLE_ICONS !== 'undefined' && PLAN_CIRCLE_ICONS[currentPlan.id])
      ? PLAN_CIRCLE_ICONS[currentPlan.id]
      : (currentPlan.iconBadge || '🏆');
    heroIcon.innerHTML = iconSvg;
  }
  if (heroTitle) { heroTitle.textContent = currentPlan.nome; heroTitle.style.color = currentPlan.cor; }
  if (heroPrice) heroPrice.textContent = currentPlan.precoStr;
  if (heroRenewalDate) heroRenewalDate.textContent = subState.accessUntil;
  if (heroItemsUsed) heroItemsUsed.textContent = `${totalItens} / ${limiteTotal.toLocaleString('pt-BR')} itens utilizados (${pct}%)`;
  if (heroProgressBar) {
    heroProgressBar.style.width = `${pct}%`;
    heroProgressBar.style.background = pct >= 100 ? '#FF3B30' : (currentPlan.cor || '#76C41B');
    heroProgressBar.style.boxShadow = pct >= 100 ? '0 0 8px #FF3B30' : `0 0 8px ${currentPlan.cor || '#76C41B'}`;
  }
  if (heroStoresCount) {
    heroStoresCount.textContent = `${totalStores} de ${currentPlan.limiteLojas}`;
    heroStoresCount.style.color = totalStores >= currentPlan.limiteLojas ? '#FF3B30' : '#FFFFFF';
  }
  const heroStoresBar = document.getElementById('planHeroStoresProgressBar');
  const heroStoresLabel = document.getElementById('planHeroStoresUsedLabel');
  const storePct = Math.min(100, Math.round((totalStores / currentPlan.limiteLojas) * 100));
  if (heroStoresBar) {
    heroStoresBar.style.width = `${storePct}%`;
    heroStoresBar.style.background = storePct >= 100 ? '#FF3B30' : (currentPlan.cor || '#76C41B');
  }
  if (heroStoresLabel) {
    heroStoresLabel.textContent = `${totalStores} de ${currentPlan.limiteLojas} lojas utilizadas (${storePct}%)`;
    heroStoresLabel.style.color = storePct >= 100 ? '#FF3B30' : '#FFFFFF';
  }
  if (heroItemsPerStore) heroItemsPerStore.textContent = currentPlan.limiteItensPorLoja.toLocaleString('pt-BR');
  if (heroIconLoja) heroIconLoja.setAttribute('stroke', currentPlan.cor);
  if (heroIconBox) heroIconBox.setAttribute('stroke', currentPlan.cor);
  const heroCalendarIcon = document.getElementById('heroCalendarIcon');
  if (heroCalendarIcon) heroCalendarIcon.setAttribute('stroke', currentPlan.cor);
  if (btnHeroManage) {
    btnHeroManage.style.borderColor = currentPlan.cor;
    btnHeroManage.style.color = currentPlan.cor;
    btnHeroManage.style.boxShadow = `0 0 10px rgba(${rgb}, 0.12)`;
  }
  if (btnHeroManageIcon) btnHeroManageIcon.setAttribute('stroke', currentPlan.cor);

  if (currentPlan.id === 'GRATUITO' || subState.isCanceled) {
    if (heroStatusText) { heroStatusText.textContent = 'Sem assinatura ativa'; heroStatusText.style.color = '#8E99A8'; }
    if (heroStatusDot) { heroStatusDot.textContent = '○'; heroStatusDot.style.color = '#8E99A8'; heroStatusDot.style.background = 'transparent'; heroStatusDot.style.boxShadow = 'none'; }
    if (heroStatusBadge) { heroStatusBadge.style.background = 'rgba(255,255,255,0.06)'; heroStatusBadge.style.borderColor = 'rgba(255,255,255,0.15)'; }
    if (heroRenewalLabel) heroRenewalLabel.textContent = 'Status do plano:';
    if (heroRenewalDate) heroRenewalDate.textContent = 'Gratuito';
    if (heroAutoRenewText) { heroAutoRenewText.textContent = 'Nenhuma renovação programada'; heroAutoRenewText.style.color = '#8E99A8'; }
    if (heroAutoRenewIcon) heroAutoRenewIcon.style.color = '#8E99A8';
  } else {
    if (heroStatusText) { heroStatusText.textContent = 'Assinatura ativa'; heroStatusText.style.color = '#86D926'; }
    if (heroStatusDot) { heroStatusDot.textContent = '★'; heroStatusDot.style.color = '#76C41B'; heroStatusDot.style.background = 'transparent'; heroStatusDot.style.boxShadow = 'none'; }
    if (heroStatusBadge) { heroStatusBadge.style.background = 'rgba(118,196,27,0.12)'; heroStatusBadge.style.borderColor = 'rgba(118,196,27,0.45)'; }
    if (heroRenewalLabel) heroRenewalLabel.textContent = 'Próxima renovação:';
    if (heroRenewalDate) heroRenewalDate.textContent = subState.accessUntil;
    if (heroAutoRenewText) { heroAutoRenewText.textContent = 'Renovação automática ativada'; heroAutoRenewText.style.color = '#86D926'; }
    if (heroAutoRenewIcon) heroAutoRenewIcon.style.color = '#86D926';
  }

  // ── GRID DE PLANOS — cópia fiel da imagem de referência ────
  const gridEl = document.getElementById('plansVerticalGrid');
  if (!gridEl) return;

  // SVGs de recursos (linha de specs de cada card)
  const icoHouse = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  const icoBox = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
  const icoLayer = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
  const icoUser = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  // Ícones 3D com gradientes, fitas e relevo idênticos às fotos de referência (disponível globalmente para a tela de assinatura)
  const circleIcons = window.PLAN_CIRCLE_ICONS = {
    GRATUITO: `
      <svg viewBox="0 0 36 36" width="26" height="26">
        <defs>
          <linearGradient id="box3dGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#9DEE35"/>
            <stop offset="100%" stop-color="#5E9E1C"/>
          </linearGradient>
          <linearGradient id="lidGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#B4F558"/>
            <stop offset="100%" stop-color="#76C41B"/>
          </linearGradient>
        </defs>
        <!-- Caixa do presente -->
        <rect x="7" y="15" width="22" height="15" rx="3" fill="url(#box3dGrad)" stroke="#B4F558" stroke-width="1.2"/>
        <!-- Tampa -->
        <rect x="5" y="11" width="26" height="6" rx="2" fill="url(#lidGrad)" stroke="#B4F558" stroke-width="1.2"/>
        <!-- Fita vertical -->
        <rect x="16" y="11" width="4" height="19" fill="#FFFFFF" opacity="0.9"/>
        <!-- Laço do presente 3D -->
        <path d="M14 11 C11 5, 6 8, 14 11 Z" fill="#FFFFFF" opacity="0.95"/>
        <path d="M22 11 C25 5, 30 8, 22 11 Z" fill="#FFFFFF" opacity="0.95"/>
        <circle cx="18" cy="11" r="2" fill="#FFFFFF"/>
      </svg>`,
    BRONZE: `
      <svg viewBox="0 0 36 36" width="26" height="26">
        <defs>
          <linearGradient id="ribbonBronze" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#FFBE76"/>
            <stop offset="50%" stop-color="#FFF0DB"/>
            <stop offset="100%" stop-color="#FFBE76"/>
          </linearGradient>
          <radialGradient id="medalBronze" cx="40%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#F39C12"/>
            <stop offset="45%" stop-color="#D35400"/>
            <stop offset="100%" stop-color="#7E3200"/>
          </radialGradient>
        </defs>
        <!-- Fitas da Medalha V -->
        <polygon points="12,4 18,17 14,17 9,6" fill="url(#ribbonBronze)" opacity="0.95"/>
        <polygon points="24,4 18,17 22,17 27,6" fill="url(#ribbonBronze)" opacity="0.95"/>
        <rect x="15" y="15" width="6" height="3" rx="1" fill="#FFBE76"/>
        <!-- Círculo da Medalha 3D -->
        <circle cx="18" cy="24" r="10" fill="url(#medalBronze)" stroke="#F5CBA7" stroke-width="1.2"/>
        <circle cx="18" cy="24" r="7.5" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>
        <!-- Número 1 relevo -->
        <text x="18" y="27.5" font-size="9" font-weight="900" fill="#FFF0DB" text-anchor="middle" font-family="'Inter',sans-serif">1</text>
      </svg>`,
    PRATA: `
      <svg viewBox="0 0 36 36" width="28" height="28">
        <defs>
          <linearGradient id="ribbonSilverV" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#FFFFFF"/>
            <stop offset="60%" stop-color="#E2E8F0"/>
            <stop offset="100%" stop-color="#94A3B8"/>
          </linearGradient>
          <radialGradient id="medalSilverGrad" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#FFFFFF"/>
            <stop offset="30%" stop-color="#E2E8F0"/>
            <stop offset="70%" stop-color="#94A3B8"/>
            <stop offset="100%" stop-color="#475569"/>
          </radialGradient>
          <radialGradient id="medalCenterShine" cx="45%" cy="40%" r="55%">
            <stop offset="0%" stop-color="#FFFFFF"/>
            <stop offset="50%" stop-color="#CBD5E1"/>
            <stop offset="100%" stop-color="#64748B"/>
          </radialGradient>
        </defs>
        <!-- Fitas superiores apontando para cima (idênticas à foto 4) -->
        <polygon points="12,5 15,5 18,17 15,17" fill="url(#ribbonSilverV)"/>
        <polygon points="24,5 21,5 18,17 21,17" fill="url(#ribbonSilverV)"/>
        <polygon points="12,5 15,5 16,14 13,14" fill="#CBD5E1" opacity="0.6"/>
        <polygon points="24,5 21,5 20,14 23,14" fill="#E2E8F0" opacity="0.9"/>
        <!-- Aro exterior da Medalha -->
        <circle cx="18" cy="22" r="10.5" fill="none" stroke="#FFFFFF" stroke-width="1.6"/>
        <circle cx="18" cy="22" r="9.8" fill="url(#medalSilverGrad)"/>
        <!-- Anel interno com relevo 3D -->
        <circle cx="18" cy="22" r="7.5" fill="url(#medalCenterShine)" stroke="rgba(255,255,255,0.7)" stroke-width="0.9"/>
        <!-- Número 1 branco puro com leve sombra -->
        <text x="18" y="25.8" font-size="9.5" font-weight="900" fill="#FFFFFF" text-anchor="middle" font-family="'Inter',-apple-system,sans-serif">1</text>
      </svg>`,
    OURO: `
      <svg viewBox="0 0 36 36" width="26" height="26">
        <defs>
          <linearGradient id="cupGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#FFF3A8"/>
            <stop offset="40%" stop-color="#FFD700"/>
            <stop offset="80%" stop-color="#E6A100"/>
            <stop offset="100%" stop-color="#996300"/>
          </linearGradient>
          <radialGradient id="cupShine" cx="35%" cy="35%" r="50%">
            <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#FFD700" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <!-- Alças do Troféu -->
        <path d="M10 13 C5 13, 5 21, 12 21" fill="none" stroke="url(#cupGold)" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M26 13 C31 13, 31 21, 24 21" fill="none" stroke="url(#cupGold)" stroke-width="2.2" stroke-linecap="round"/>
        <!-- Corpo do Troféu 3D -->
        <path d="M11 8 L25 8 L23 19 C22 23, 14 23, 13 19 Z" fill="url(#cupGold)" stroke="#FFF3A8" stroke-width="1"/>
        <path d="M12 9 L24 9 L22 18 C21 21, 15 21, 14 18 Z" fill="url(#cupShine)"/>
        <!-- Haste e Base 3D -->
        <rect x="16.5" y="21" width="3" height="5" fill="url(#cupGold)"/>
        <polygon points="12,30 24,30 22,26 14,26" fill="url(#cupGold)" stroke="#FFF3A8" stroke-width="0.8"/>
        <!-- Estrela gravada -->
        <polygon points="18,12 19,14.5 21.5,14.5 19.5,16 20.2,18.5 18,17 15.8,18.5 16.5,16 14.5,14.5 17,14.5" fill="#FFFFFF" opacity="0.9"/>
      </svg>`,
    MINIMERCADO: `
      <svg viewBox="0 0 36 36" width="26" height="26">
        <defs>
          <linearGradient id="b2bBlue" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#38BDF8"/>
            <stop offset="100%" stop-color="#0284C7"/>
          </linearGradient>
        </defs>
        <rect x="4" y="8" width="28" height="20" rx="6" fill="url(#b2bBlue)" stroke="#E0F2FE" stroke-width="1.2"/>
        <text x="18" y="22" font-size="10" font-weight="900" fill="#FFFFFF" text-anchor="middle" font-family="'Inter',sans-serif" letter-spacing="0.5">B2B</text>
      </svg>`,
    DISTRIBUIDORA: `
      <svg viewBox="0 0 36 36" width="26" height="26">
        <defs>
          <linearGradient id="b2bPink" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#F43F5E"/>
            <stop offset="100%" stop-color="#9F1239"/>
          </linearGradient>
        </defs>
        <rect x="4" y="8" width="28" height="20" rx="6" fill="url(#b2bPink)" stroke="#FFE4E6" stroke-width="1.2"/>
        <text x="18" y="22" font-size="10" font-weight="900" fill="#FFFFFF" text-anchor="middle" font-family="'Inter',sans-serif" letter-spacing="0.5">B2B</text>
      </svg>`
  };

  // Função que gera 1 card idêntico à imagem, com textos em branco puro e layout 3D
  function makeCard(plano) {
    const isCurrent = (plano.id === currentPlan.id);
    const r = _hexToRgb(plano.cor);

    const border = isCurrent
      ? `border:1.5px solid ${plano.cor};box-shadow:0 0 18px rgba(${r},0.35);`
      : `border:1px solid rgba(${r},0.45);box-shadow:0 0 8px rgba(${r},0.1);`;

    // Badge acima do card
    let badge = '';
    if (isCurrent) {
      badge = `<div style="position:absolute;top:-9px;left:9px;background:${plano.cor};color:#090D14;font-size:0.5rem;font-weight:900;padding:2px 7px;border-radius:3px;letter-spacing:0.5px;white-space:nowrap;z-index:2;">SEU PLANO</div>`;
    } else if (plano.id === 'PRATA') {
      badge = `<div style="position:absolute;top:-9px;left:9px;background:#7C3AED;color:#fff;font-size:0.5rem;font-weight:900;padding:2px 7px;border-radius:3px;letter-spacing:0.4px;white-space:nowrap;z-index:2;">★ MAIS POPULAR</div>`;
    }

    // Ícone circular 3D
    const iconInner = circleIcons[plano.id] || circleIcons.GRATUITO;

    // Botão semi-preenchido na cor do plano
    let btnTxt, btnBg, btnBorder;
    if (isCurrent) {
      btnTxt = 'Plano atual'; btnBg = `rgba(${r},0.22)`; btnBorder = plano.cor;
    } else if (plano.id === 'GRATUITO') {
      btnTxt = 'Grátis'; btnBg = 'rgba(118,196,27,0.18)'; btnBorder = '#76C41B';
    } else {
      btnTxt = plano.btnTexto; btnBg = `rgba(${r},0.16)`; btnBorder = plano.cor;
    }
    const btnFn = isCurrent ? `openManageSubscriptionModal()` : `openCheckoutModal('${plano.id}')`;

    return `
<div style="position:relative;border-radius:12px;padding:10px 8px 10px;background:#090E17;display:flex;flex-direction:column;justify-content:space-between;width:100%;min-width:0;max-width:100%;box-sizing:border-box;${border}">
  ${badge}
  <div>
    <!-- Topo do Card: Ícone 3D Circular + Nome + Subtítulo -->
    <div style="display:flex;align-items:center;gap:5px;margin-top:${badge ? '6px' : '0'};margin-bottom:8px;">
      <div style="width:32px;height:32px;border-radius:50%;background:radial-gradient(circle, rgba(${r},0.2) 0%, rgba(${r},0.06) 70%);border:1.5px solid ${plano.cor};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        ${iconInner}
      </div>
      <div style="min-width:0;flex:1;">
        <div style="font-size:0.65rem;font-weight:900;color:${plano.cor};line-height:1.15;letter-spacing:0.2px;word-break:break-word;">${plano.nome}</div>
        <div style="font-size:0.46rem;color:#FFFFFF;opacity:0.92;line-height:1.15;margin-top:2px;word-break:break-word;">${plano.tagline}</div>
      </div>
    </div>

    <!-- Lista de Recursos com TEXTOS BRANCOS PUROS -->
    <div style="font-size:0.60rem;color:#FFFFFF;font-weight:600;display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:5px;"><span style="color:${plano.cor};flex-shrink:0;">${icoHouse}</span><span style="color:#FFFFFF;white-space:nowrap;font-size:0.58rem;">${plano.lojasTexto}</span></div>
      <div style="display:flex;align-items:center;gap:5px;"><span style="color:${plano.cor};flex-shrink:0;">${icoBox}</span><span style="color:#FFFFFF;white-space:nowrap;font-size:0.58rem;">${plano.itensLojaTexto}</span></div>
      <div style="display:flex;align-items:center;gap:5px;"><span style="color:${plano.cor};flex-shrink:0;">${icoLayer}</span><span style="color:#FFFFFF;white-space:nowrap;font-size:0.58rem;">${plano.totalTexto}</span></div>
      <div style="display:flex;align-items:center;gap:5px;"><span style="color:${plano.cor};flex-shrink:0;">${icoUser}</span><span style="color:#FFFFFF;white-space:nowrap;font-size:0.58rem;">${plano.multiTexto}</span></div>
    </div>
  </div>

  <div>
    <!-- Preço -->
    <div style="display:flex;align-items:baseline;gap:2px;margin-bottom:8px;">
      <span style="font-size:1rem;font-weight:900;color:#FFFFFF;letter-spacing:-0.3px;">${plano.precoStr}</span>
      <span style="font-size:0.55rem;color:#FFFFFF;opacity:0.75;">/mês</span>
    </div>
    <!-- Botão de Ação -->
    <button onclick="${btnFn}" style="width:100%;height:30px;display:flex;align-items:center;justify-content:center;text-align:center;background:${btnBg};border:1.2px solid ${btnBorder};color:${btnBorder};border-radius:7px;font-size:0.50rem;font-weight:900;cursor:pointer;line-height:1;box-sizing:border-box;font-family:inherit;letter-spacing:-0.1px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${btnTxt}</button>
  </div>
</div>`;
  }

  gridEl.innerHTML = Object.values(PLANOS_SISTEMA).map(makeCard).join('');
  updateSettingsPlanCard();
}


function updateSettingsPlanCard() {
  const currentPlan = getCurrentUserPlan();
  const nameEl = document.getElementById('settingsPlanName');
  const descEl = document.getElementById('settingsPlanDesc');
  const starEl = document.getElementById('settingsPlanStar');

  if (nameEl) {
    nameEl.textContent = currentPlan.nome;
    nameEl.style.color = currentPlan.cor;
  }
  if (descEl) {
    descEl.textContent = `Até ${currentPlan.limiteItensTotal} itens e ${currentPlan.limiteLojas} loja(s)`;
  }
  if (starEl) {
    starEl.style.color = currentPlan.cor;
  }
}

// ── ÁREA E MODAL DE GERENCIAMENTO DA ASSINATURA ──

function openManageSubscriptionModal() {
  navigate('manage-subscription');
}

function renderManageSubscriptionPage() {
  const subState = getSubscriptionState();
  const plan = subState.plan;

  const nameEl = document.getElementById('mgPagePlanName');
  const priceEl = document.getElementById('mgPagePrice');
  const paymentEl = document.getElementById('mgPagePayment');
  const nextEl = document.getElementById('mgPageNextCharge');
  const statusEl = document.getElementById('mgPageStatus');
  const renewEl = document.getElementById('mgPageAutoRenew');
  const cancelContainer = document.getElementById('mgPageCancelOrReactivate');

  if (nameEl) { nameEl.textContent = plan.nome; nameEl.style.color = plan.cor; }
  if (priceEl) priceEl.textContent = `${plan.precoStr} /mês`;
  if (paymentEl) paymentEl.textContent = subState.paymentMethod;
  if (nextEl) nextEl.textContent = subState.accessUntil;

  if (plan.id === 'GRATUITO' || subState.isCanceled) {
    if (statusEl) { statusEl.innerHTML = '⚪ Plano Gratuito (Sem assinatura ativa)'; statusEl.style.color = '#8E99A8'; }
    if (renewEl) { renewEl.textContent = 'Nenhuma cobrança ativa'; renewEl.style.color = '#8E99A8'; }
    if (nextEl) { nextEl.textContent = 'Sem renovação'; nextEl.style.color = '#8E99A8'; }
    if (cancelContainer) cancelContainer.innerHTML = `
      <button onclick="navigate('plans')" style="width:100%;background:#00E676;color:#090D14;font-weight:900;font-size:0.82rem;padding:13px;border-radius:12px;border:none;cursor:pointer;">
        ⭐ Assinar um Plano
      </button>`;
  } else {
    if (statusEl) { statusEl.innerHTML = '🟢 Assinatura ativa'; statusEl.style.color = '#00E676'; }
    if (renewEl) { renewEl.textContent = 'Renovação automática ativada'; renewEl.style.color = '#00E676'; }
    if (cancelContainer) cancelContainer.innerHTML = `
      <button onclick="openCancelConfirmModal()" style="width:100%;background:rgba(255,59,48,0.08);border:1px solid rgba(255,59,48,0.3);color:#FF3B30;font-weight:700;font-size:0.82rem;padding:13px;border-radius:12px;cursor:pointer;">
        Cancelar assinatura
      </button>`;
  }
}

function closeManageSubscriptionModal() {
  const modal = document.getElementById('modalManageSubscription');
  if (modal) modal.style.display = 'none';
}

function scrollToAvailablePlans() {
  const grid = document.getElementById('plansVerticalGrid');
  if (grid) {
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Navega para Planos e rola até o card de Gerenciamento da Assinatura
function scrollToManageSubscription() {
  navigate('plans');
  setTimeout(() => {
    const card = document.getElementById('planCurrentHeroCard');
    const page = document.getElementById('page-plans');
    if (page) page.scrollTop = 0; // garante que começa do topo
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Destaque visual temporário no card
      card.style.transition = 'box-shadow 0.3s ease';
      card.style.boxShadow = '0 0 30px rgba(255,215,0,0.5), inset 0 0 20px rgba(255,215,0,0.08)';
      setTimeout(() => {
        card.style.boxShadow = '0 0 18px rgba(255,215,0,0.18), inset 0 0 16px rgba(255,215,0,0.04)';
      }, 1200);
    }
  }, 350);
}

// ── FLUXO DE CANCELAMENTO COM CONFIRMAÇÃO ──

function openCancelConfirmModal() {
  closeManageSubscriptionModal();
  const modal = document.getElementById('modalConfirmCancelPlan');
  if (modal) modal.style.display = 'flex';
}

function closeCancelConfirmModal() {
  const modal = document.getElementById('modalConfirmCancelPlan');
  if (modal) modal.style.display = 'none';
}

function confirmPlanCancellation() {
  // 1. Encerramento imediato do plano: corta os benefícios na hora e volta ao plano GRATUITO
  localStorage.setItem('cv_user_plan', 'GRATUITO');
  localStorage.setItem('cv_subscription_canceled', 'true');
  localStorage.setItem('cv_auto_renew', 'false');

  // 2. Registra no Firestore se conectado
  if (_currentUserId) {
    db.collection('user_data').doc(_currentUserId).set({
      planoId: 'GRATUITO',
      planoNome: 'GRATUITO',
      subscriptionCanceled: true,
      autoRenew: false,
      canceledAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(err => console.warn('Erro ao salvar cancelamento:', err));
  }

  // 3. Aplica regras e limites do plano Gratuito imediatamente
  if (typeof enforcePlanLimitsOnDowngrade === 'function') {
    enforcePlanLimitsOnDowngrade();
  }
  if (typeof updateSettingsPlanCard === 'function') {
    updateSettingsPlanCard();
  }

  closeCancelConfirmModal();
  showToast('Assinatura cancelada com sucesso. Seu plano agora é o Gratuito.', '🔴', 5000);
  renderPlansScreen();
}

function reactivateSubscription() {
  // Redireciona diretamente para a tela de planos para escolher e assinar novamente
  closeManageSubscriptionModal();
  scrollToAvailablePlans();
}

function openHowItWorksModal() {
  const modal = document.getElementById('modalHowItWorks');
  if (modal) modal.style.display = 'flex';
}

function closeHowItWorksModal() {
  const modal = document.getElementById('modalHowItWorks');
  if (modal) modal.style.display = 'none';
}

// ── POPOVER RENOVAÇÃO AUTOMÁTICA ──
function toggleAutoRenewPopover(e) {
  if (e) e.stopPropagation();
  const pop = document.getElementById('autoRenewPopover');
  if (!pop) return;
  const isOpen = pop.style.display !== 'none';
  pop.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Fecha ao clicar fora
    const close = (ev) => {
      if (!pop.contains(ev.target)) {
        pop.style.display = 'none';
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 10);
  }
}

// ── NAVEGAR PARA PLANOS E ROLAR ATÉ GERENCIAMENTO ──
function navigateAndScrollToSubscription() {
  navigate('manage-subscription');
}

function openCheckoutModal(planId) {
  const plano = PLANOS_SISTEMA[planId];
  if (!plano) return;
  _selectedCheckoutPlanId = planId;

  // Header: "Assinar Plano – PRATA"
  const headerName = document.getElementById('coHeaderPlanName');
  if (headerName) headerName.textContent = plano.nome;

  // Card: borda + glow com cor do plano
  const cardEl = document.getElementById('checkoutSelectedPlanCard');
  if (cardEl) cardEl.style.borderColor = plano.cor;
  const glowEl = document.getElementById('coCardGlow');
  if (glowEl) {
    const rgb = hexToRgb(plano.cor) || { r: 160, g: 174, b: 192 };
    glowEl.style.background = `linear-gradient(180deg,rgba(${rgb.r},${rgb.g},${rgb.b},0.10) 0%,transparent 100%)`;
  }

  // Avatar com o MESMO desenho 3D do card de planos (GRATUITO, BRONZE, PRATA, OURO, etc.)
  // IDs de gradiente são prefixados com "co_" para evitar conflito com os SVGs dos cards da grid
  const avatarEl = document.getElementById('coAvatarWrap');
  if (avatarEl) {
    avatarEl.style.borderColor = plano.cor;
    let iconSvg = (typeof window.PLAN_CIRCLE_ICONS !== 'undefined' && window.PLAN_CIRCLE_ICONS[plano.id])
      ? window.PLAN_CIRCLE_ICONS[plano.id]
      : (plano.iconBadge || '⭐');
    // Tornar IDs únicos para não colidir com os SVGs da grade de planos
    iconSvg = iconSvg.replace(/id="([^"]+)"/g, 'id="co_$1"').replace(/url\(#([^)]+)\)/g, 'url(#co_$1)');
    avatarEl.innerHTML = iconSvg;
  }

  // Nome + cor
  const nameEl = document.getElementById('checkoutModalPlanName');
  if (nameEl) { nameEl.textContent = plano.nome; nameEl.style.color = plano.cor; }

  // Badge popular
  const badgeEl = document.getElementById('coPlanBadge');
  if (badgeEl) {
    if (plano.badge && plano.badge !== 'SEU PLANO') {
      badgeEl.textContent = plano.badge;
      badgeEl.style.background = plano.badgeCor || '#8A2BE2';
      badgeEl.style.color = '#FFFFFF';
      badgeEl.style.display = 'inline-block';

    } else {
      badgeEl.style.display = 'none';
    }
  }

  // Tagline
  const taglineEl = document.getElementById('checkoutPlanTagline');
  if (taglineEl) taglineEl.textContent = plano.tagline || '';

  // Specs 4 colunas (lojas, itens/loja, total, usuários) exatamente como na referência visual
  const specsEl = document.getElementById('checkoutModalSpecs');
  if (specsEl) {
    const corPlano = plano.cor || '#A855F7';
    specsEl.innerHTML = `
      <div style="text-align:center;display:flex;flex-direction:column;align-items:center;">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${corPlano}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:6px;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        <div style="font-size:1.15rem;font-weight:900;color:#FFF;line-height:1;">${plano.limiteLojas}</div>
        <div style="font-size:0.68rem;color:#FFFFFF;margin-top:4px;">Lojas</div>
      </div>
      <div style="text-align:center;display:flex;flex-direction:column;align-items:center;">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${corPlano}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:6px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
        <div style="font-size:1.15rem;font-weight:900;color:#FFF;line-height:1;">${plano.limiteItensPorLoja}</div>
        <div style="font-size:0.68rem;color:#FFFFFF;margin-top:4px;">Itens por loja</div>
      </div>
      <div style="text-align:center;display:flex;flex-direction:column;align-items:center;">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${corPlano}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:6px;"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
        <div style="font-size:1.15rem;font-weight:900;color:#FFF;line-height:1;">${plano.limiteItensTotal >= 1000 ? (plano.limiteItensTotal / 1000).toFixed(0) + '.000' : plano.limiteItensTotal}</div>
        <div style="font-size:0.68rem;color:#FFFFFF;margin-top:4px;">Itens total</div>
      </div>
      <div style="text-align:center;display:flex;flex-direction:column;align-items:center;">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${corPlano}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:6px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        <div style="font-size:0.95rem;font-weight:900;color:#FFF;line-height:1.1;">${plano.multiTexto.includes('funcionários') ? plano.multiTexto.split('+')[0].trim() : 'Apenas'}</div>
        <div style="font-size:0.68rem;color:#FFFFFF;margin-top:4px;">${plano.multiTexto.includes('funcionários') ? 'equipe' : 'o dono'}</div>
      </div>
    `;
  }

  // Resumo da cobrança
  const resumoPrecoEl = document.getElementById('coResumoPreco');
  if (resumoPrecoEl) resumoPrecoEl.innerHTML = `${plano.precoStr} <span style="font-size:0.65rem;font-weight:500;color:#FFFFFF;">/mês</span>`;

  const cardBtnPrecoEl = document.getElementById('coCardBtnPreco');
  if (cardBtnPrecoEl) cardBtnPrecoEl.textContent = plano.precoStr;

  // Próxima cobrança dinâmica (30 dias a partir de hoje)
  const hoje = new Date();
  hoje.setDate(hoje.getDate() + 30);
  const dia = String(hoje.getDate()).padStart(2, '0');
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const ano = hoje.getFullYear();
  const proxCobrancaEl = document.getElementById('coProximaCobranca');
  if (proxCobrancaEl) proxCobrancaEl.textContent = `${dia}/${mes}/${ano}`;

  // Texto renovação
  const renovEl = document.getElementById('coRenovacaoPreco');
  if (renovEl) renovEl.textContent = plano.precoStr;

  // Reset checkboxes
  resetCoCheckbox('coAutoRenewCheck', 'coCheckboxUI');
  resetCoCheckbox('coCardTermsCheck', 'coCardCheckboxUI');

  // Selecionar PIX por padrão
  selectPayMethod('pix');
  if (plano.precoNum > 0) {
    generateRealPixForPlan(planId);
  }
  navigate('checkout');
}

function closeCheckoutModal() {
  _selectedCheckoutPlanId = null;
  navigate('plans');
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function selectPayMethod(method) {
  const pixEl = document.getElementById('payMethodPix');
  const cardEl = document.getElementById('payMethodCard');
  const pixContent = document.getElementById('checkoutPixContent');
  const cardContent = document.getElementById('checkoutCardContent');
  const pixCheck = document.getElementById('pixCheckIcon');
  const cardCheck = document.getElementById('cardCheckIcon');

  if (method === 'pix') {
    if (pixEl) { pixEl.style.borderColor = '#4EFA16'; pixEl.style.boxShadow = '0 0 16px rgba(78,250,22,0.18)'; }
    if (cardEl) { cardEl.style.borderColor = '#1B2433'; cardEl.style.boxShadow = 'none'; }
    if (pixContent) pixContent.style.display = 'flex';
    if (cardContent) cardContent.style.display = 'none';
    if (pixCheck) { pixCheck.style.background = '#4EFA16'; pixCheck.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#070A0F" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'; }
    if (cardCheck) { cardCheck.style.background = '#090E17'; cardCheck.innerHTML = ''; cardCheck.style.border = '2px solid #2A3548'; }
  } else {
    if (cardEl) { cardEl.style.borderColor = '#4EFA16'; cardEl.style.boxShadow = '0 0 16px rgba(78,250,22,0.18)'; }
    if (pixEl) { pixEl.style.borderColor = '#1B2433'; pixEl.style.boxShadow = 'none'; }
    if (cardContent) cardContent.style.display = 'flex';
    if (pixContent) pixContent.style.display = 'none';
    if (cardCheck) { cardCheck.style.background = '#4EFA16'; cardCheck.style.border = 'none'; cardCheck.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#070A0F" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'; }
    if (pixCheck) { pixCheck.style.background = '#1B2433'; pixCheck.innerHTML = ''; }
  }
}

function toggleCoCheckbox(checkId, uiId) {
  const chk = document.getElementById(checkId);
  const ui = document.getElementById(uiId);
  if (!chk || !ui) return;
  chk.checked = !chk.checked;
  if (chk.checked) {
    ui.style.background = '#4EFA16';
    ui.style.borderColor = '#4EFA16';
    ui.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#070A0F" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
  } else {
    ui.style.background = '#090D14';
    ui.style.borderColor = '#2A3548';
    ui.innerHTML = '';
  }
  updateCoConfirmBtn();
}

function resetCoCheckbox(checkId, uiId) {
  const chk = document.getElementById(checkId);
  const ui = document.getElementById(uiId);
  if (chk) chk.checked = false;
  if (ui) { ui.style.background = '#090D14'; ui.style.borderColor = '#2A3548'; ui.innerHTML = ''; }
}

function updateCoConfirmBtn() {
  const cardTerms = document.getElementById('coCardTermsCheck');
  const btnCard = document.getElementById('btnPagarCartao');
  if (!btnCard) return;
  const ok = cardTerms && cardTerms.checked;
  btnCard.disabled = !ok;
  btnCard.style.background = ok ? '#4EFA16' : '#1B2433';
  btnCard.style.color = ok ? '#070A0F' : '#4A5568';
  btnCard.style.cursor = ok ? 'pointer' : 'not-allowed';
  btnCard.style.boxShadow = ok ? '0 4px 20px rgba(78,250,22,0.35)' : 'none';
}

function switchCheckoutTab(type) {
  const tabPixBtn = document.getElementById('tabPixBtn');
  const tabCardBtn = document.getElementById('tabCardBtn');
  const pixContent = document.getElementById('checkoutPixContent');
  const cardContent = document.getElementById('checkoutCardContent');

  if (type === 'pix') {
    if (tabPixBtn) tabPixBtn.classList.add('active');
    if (tabCardBtn) tabCardBtn.classList.remove('active');
    if (pixContent) pixContent.style.display = 'block';
    if (cardContent) cardContent.style.display = 'none';
  } else {
    if (tabCardBtn) tabCardBtn.classList.add('active');
    if (tabPixBtn) tabPixBtn.classList.remove('active');
    if (pixContent) pixContent.style.display = 'none';
    if (cardContent) cardContent.style.display = 'flex';
  }
}

function copyPixCode() {
  const pixText = document.getElementById('checkoutPixKeyText')?.textContent;
  const btnText = document.getElementById('btnCopyPixText');
  const btnIcon = document.getElementById('btnCopyPixIcon');
  const btn = document.getElementById('btnCopyPix');

  if (pixText && navigator.clipboard) {
    navigator.clipboard.writeText(pixText.trim());
  }

  if (btnText) {
    btnText.textContent = '✓ Copiada';
    if (btn) btn.style.borderColor = '#4EFA16';
    setTimeout(() => {
      if (btnText) btnText.textContent = 'Copiar chave';
    }, 2000);
  }
  showToast('Chave Pix copiada com sucesso!', '📋');
}

let _currentPixPaymentId = null;
let _pixCheckInterval = null;

// Gerar Pix Real do Mercado Pago ao abrir o Checkout
async function generateRealPixForPlan(planId) {
  const plano = PLANOS_SISTEMA[planId];
  if (!plano) return;

  const qrImgContainer = document.getElementById('checkoutQrContainer');
  const pixKeyEl = document.getElementById('checkoutPixKeyText');
  const btnPix = document.getElementById('btnSimularPix');

  if (qrImgContainer) {
    qrImgContainer.innerHTML = '<div style="width:160px;height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#4A5568;font-size:0.75rem;font-weight:700;"><div style="border:3px solid #E2E8F0;border-top:3px solid #4EFA16;border-radius:50%;width:30px;height:30px;animation:spin 0.8s linear infinite;margin-bottom:8px;"></div>Gerando QR Code...</div>';
  }
  if (pixKeyEl) pixKeyEl.textContent = 'Gerando chave Pix dinâmica...';

  let _apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? '' 
    : 'https://prazocerto-backend-cf11.onrender.com';

  try {
    let email = 'cliente@prazocerto.com';
    let nome = 'Cliente PrazoCerto';
    if (_currentUserId && typeof auth !== 'undefined' && auth.currentUser) {
      email = auth.currentUser.email || email;
      nome = auth.currentUser.displayName || nome;
    }

    const res = await fetch(`${_apiBase}/api/checkout/pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: plano.id,
        planName: plano.nome,
        amount: plano.precoNum,
        email: email,
        firstName: nome,
        userId: _currentUserId || 'local_user'
      })
    });

    const data = await res.json();

    if (data && data.qrCodeBase64) {
      _currentPixPaymentId = data.id;
      if (qrImgContainer) {
        qrImgContainer.innerHTML = `<img src="data:image/png;base64,${data.qrCodeBase64}" alt="QR Code PIX" style="width:160px;height:160px;display:block;">`;
      }
      if (pixKeyEl) {
        pixKeyEl.textContent = data.qrCode || 'PIX-GERADO';
      }
      startPixPolling(data.id, plano);
    } else {
      throw new Error(data.error || 'Erro ao gerar Pix');
    }
  } catch (err) {
    console.warn('Erro ao conectar na API de Pix:', err);
    if (pixKeyEl) pixKeyEl.textContent = '00020126580014br.gov.bcb.pix013612345678-0001-90';
    if (qrImgContainer) {
      qrImgContainer.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=00020126580014br.gov.bcb.pix013612345678-0001-905204000053039865802BR5913PrazoCerto6009SaoPaulo62070503***6304E2CA" alt="QR Code PIX" style="width:160px;height:160px;display:block;">';
    }
  }
}

// Verificação em segundo plano da aprovação do Pix
function startPixPolling(paymentId, plano) {
  if (_pixCheckInterval) clearInterval(_pixCheckInterval);
  const _apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? '' 
    : 'https://prazocerto-backend-cf11.onrender.com';

  _pixCheckInterval = setInterval(async () => {
    try {
      const res = await fetch(`${_apiBase}/api/checkout/status/${paymentId}`);
      const data = await res.json();
      if (data.status === 'approved') {
        clearInterval(_pixCheckInterval);
        _pixCheckInterval = null;
        ativarPlanoSucesso(plano);
      }
    } catch (e) {
      // continua tentando silenciosamente
    }
  }, 4000);
}

// Ativação do plano após pagamento confirmado
function ativarPlanoSucesso(novoPlano) {
  if (_pixCheckInterval) {
    clearInterval(_pixCheckInterval);
    _pixCheckInterval = null;
  }

  localStorage.setItem('cv_user_plan', novoPlano.id);
  localStorage.setItem('cv_subscription_canceled', 'false');
  localStorage.setItem('cv_auto_renew', 'true');

  if (_currentUserId && typeof db !== 'undefined') {
    db.collection('user_data').doc(_currentUserId).set({
      planoId: novoPlano.id,
      planoNome: novoPlano.nome,
      planoAtualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      subscriptionCanceled: false,
      autoRenew: true
    }, { merge: true }).catch(err => console.warn('Erro ao salvar plano no Firebase:', err));
  }

  _selectedCheckoutPlanId = null;
  _currentPixPaymentId = null;
  if (typeof enforcePlanLimitsOnDowngrade === 'function') enforcePlanLimitsOnDowngrade();
  showToast(`🎉 Pagamento aprovado! Plano ${novoPlano.nome} liberado!`, '🎉', 5000);
  navigate('plans');
  if (typeof updateSettingsPlanCard === 'function') updateSettingsPlanCard();
}

// Botão "Já fiz o pagamento / Verificar pagamento"
async function simulatePaymentSuccess() {
  if (!_selectedCheckoutPlanId) return;
  const novoPlano = PLANOS_SISTEMA[_selectedCheckoutPlanId];
  if (!novoPlano) return;

  const btnPix = document.getElementById('btnSimularPix');
  const btnCard = document.getElementById('btnPagarCartao');
  if (btnPix) { btnPix.textContent = '⏳ Verificando no Mercado Pago...'; btnPix.disabled = true; }
  if (btnCard) { btnCard.textContent = '⏳ Processando cartão...'; btnCard.disabled = true; }

  // Somente ativa se houver confirmação real do sistema/gateway
  if (_currentPixPaymentId) {
    try {
      const res = await fetch(`/api/checkout/status/${_currentPixPaymentId}`);
      const data = await res.json();
      if (data && data.status === 'approved') {
        ativarPlanoSucesso(novoPlano);
        return;
      } else {
        showToast('Pagamento ainda não confirmado pela instituição financeira. Aguarde alguns instantes.', '⏳', 4000);
      }
    } catch (e) {
      console.warn('Erro ao checar status:', e);
      showToast('Não foi possível verificar o pagamento agora. Tente novamente em instantes.', '⚠️', 4000);
    }
  } else {
    showToast('Aguardando identificação da transação Pix ou Cartão pelo sistema.', '⏳', 4000);
  }

  if (btnPix) {
    btnPix.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-size:1.05rem;font-weight:900;"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#070A0F" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Já fiz o pagamento</span></div><span style="font-size:0.82rem;font-weight:800;color:#070A0F;opacity:0.9;">Verificar status no sistema</span>';
    btnPix.disabled = false;
  }
  if (btnCard) { btnCard.textContent = '🔒 Autorizar Cartão e Ativar Plano'; btnCard.disabled = false; }
}

// ── PROCESSAMENTO CRIPTOGRAFADO DE CARTÃO (PCI-DSS) ──
// Assegura que nenhum dado sensível de cartão trafegue pelo nosso backend nem seja armazenado
const MP_PUBLIC_KEY = 'APP_USR-34b9cd93-3f2a-4d17-90bf-a9b469184559';
let _mpInstance = null;

function getMercadoPagoInstance() {
  if (!_mpInstance && typeof MercadoPago !== 'undefined') {
    _mpInstance = new MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
  }
  return _mpInstance;
}

async function processCreditCardPayment() {
  if (!_selectedCheckoutPlanId) return;
  const novoPlano = PLANOS_SISTEMA[_selectedCheckoutPlanId];
  if (!novoPlano) return;

  const btnCard = document.getElementById('btnPagarCartao');
  const numInput = document.getElementById('coCardNumber');
  const nameInput = document.getElementById('coCardHolderName');
  const expInput = document.getElementById('coCardExpiry');
  const cvvInput = document.getElementById('coCardCvv');

  const rawNumber = (numInput?.value || '').replace(/\D/g, '');
  const holderName = (nameInput?.value || '').trim();
  const expiry = (expInput?.value || '').trim();
  const cvv = (cvvInput?.value || '').trim();

  if (rawNumber.length < 13) {
    showToast('Por favor, informe o número completo do cartão.', '⚠️');
    return;
  }
  if (!holderName) {
    showToast('Informe o nome como está impresso no cartão.', '⚠️');
    return;
  }
  if (!expiry.includes('/') || expiry.length < 4) {
    showToast('Informe a validade no formato MM/AA.', '⚠️');
    return;
  }
  if (cvv.length < 3) {
    showToast('Informe o código de segurança (CVV).', '⚠️');
    return;
  }

  const expParts = expiry.split('/');
  const expMonth = expParts[0].trim();
  let expYear = expParts[1].trim();
  if (expYear.length === 2) expYear = '20' + expYear;

  if (btnCard) {
    btnCard.disabled = true;
    btnCard.textContent = '🔒 Criptografando e Autorizando...';
  }

  try {
    const mp = getMercadoPagoInstance();
    if (!mp) {
      throw new Error('SDK do Mercado Pago não carregou. Verifique sua conexão.');
    }

    // 1. Tokenização direta no Mercado Pago (Blindagem PCI-DSS)
    // Os dados do cartão são criptografados pelo SDK e transformados num token de uso único
    const cardTokenRes = await mp.createCardToken({
      cardNumber: rawNumber,
      cardholderName: holderName,
      cardExpirationMonth: expMonth,
      cardExpirationYear: expYear,
      securityCode: cvv
    });

    if (!cardTokenRes || !cardTokenRes.id) {
      throw new Error('Não foi possível validar o cartão. Verifique os dados digitados.');
    }

    // 2. HIGIENIZAÇÃO DE SEGURANÇA: Apagar imediatamente os dados dos inputs da tela
    if (numInput) numInput.value = '';
    if (nameInput) nameInput.value = '';
    if (expInput) expInput.value = '';
    if (cvvInput) cvvInput.value = '';

    // 3. Enviar apenas o cardToken seguro para o backend
    let userEmail = 'cliente@prazocerto.com';
    if (_currentUserId && typeof auth !== 'undefined' && auth.currentUser) {
      userEmail = auth.currentUser.email || userEmail;
    }

    const _apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? '' 
      : 'https://prazocerto-backend-cf11.onrender.com';

    const res = await fetch(`${_apiBase}/api/checkout/card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardToken: cardTokenRes.id,
        email: userEmail,
        planId: novoPlano.id,
        planName: novoPlano.nome,
        amount: novoPlano.precoNum,
        userId: _currentUserId || 'local_user'
      })
    });

    const data = await res.json();

    if (res.ok && (data.status === 'authorized' || data.id)) {
      ativarPlanoSucesso(novoPlano);
    } else {
      throw new Error(data.error || 'Cartão recusado ou erro na operadora.');
    }

  } catch (err) {
    console.error('Erro no checkout de cartão:', err);
    showToast(err.message || 'Falha ao processar cartão.', '❌', 4500);
    if (btnCard) {
      btnCard.disabled = false;
      btnCard.innerHTML = `Confirmar assinatura &middot; <span id="coCardBtnPreco">${novoPlano.precoStr}</span> /mês`;
    }
  }
}

// Formatação automática do input de cartão e validade
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'coCardNumber') {
    let val = e.target.value.replace(/\D/g, '').substring(0, 16);
    e.target.value = val.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  if (e.target && e.target.id === 'coCardExpiry') {
    let val = e.target.value.replace(/\D/g, '').substring(0, 4);
    if (val.length >= 3) {
      e.target.value = val.substring(0, 2) + '/' + val.substring(2);
    } else {
      e.target.value = val;
    }
  }
});

// Inicializa no carregamento do sistema
document.addEventListener('DOMContentLoaded', () => {
  if (typeof loadSettings === 'function') loadSettings();
  if (typeof enforcePlanLimitsOnDowngrade === 'function') enforcePlanLimitsOnDowngrade();
  updateSettingsPlanCard();
  if (typeof initWhatsAppAutoDailyScheduler === 'function') initWhatsAppAutoDailyScheduler();
});

// ══════════════════════════════════════════════════════════
// 💬 CENTRAL DE AJUDA & FEEDBACK (prazoxcerto@gmail.com)
// ══════════════════════════════════════════════════════════

const SUPPORT_EMAIL = 'prazoxcerto@gmail.com';
let _feedbackAttachmentBase64 = null;
let _feedbackAttachmentName = '';

// Base de conhecimento estruturada da Central de Ajuda com sinônimos
const HELP_ARTICLES = [
  {
    id: 'art-1',
    category: 'Primeiros Passos',
    icon: '🚀',
    title: 'Como cadastrar e controlar a validade de um produto',
    keywords: ['cadastrar', 'adicionar', 'novo produto', 'validade', 'vencimento', 'lote', 'quantidade', 'inventario', 'estoque'],
    content: 'Na tela inicial, clique no botão <strong>"+"</strong> ou <strong>"Adicionar Produto"</strong>. Preencha o nome do item, categoria, data de vencimento e quantidade. O PrazoCerto alertará automaticamente as proximidades de vencimento com cores intuitivas.'
  },
  {
    id: 'art-2',
    category: 'Primeiros Passos',
    icon: '🚀',
    title: 'Como configurar notificações automáticas de vencimento no WhatsApp',
    keywords: ['whatsapp', 'notificacao', 'alerta', 'aviso', 'mensagem', 'horario', 'lembrete', 'resumo'],
    content: 'Vá em <strong>Configurações &rsaquo; Notificações WhatsApp</strong>, informe seu DDD + número de celular e marque o horário preferido (ex: 08:00). O aplicativo envia um compilado matinal dos itens próximos do vencimento.'
  },
  {
    id: 'art-3',
    category: 'Pagamentos e Planos',
    icon: '💳',
    title: 'Como assinar, alterar ou gerenciar planos (PRO e Empresarial)',
    keywords: ['plano', 'pagamento', 'cartao', 'pix', 'dinheiro', 'assinar', 'pro', 'empresarial', 'limite', 'upgrade'],
    content: 'Acesse <strong>Configurações &rsaquo; Plano Atual</strong> e clique em <strong>"Gerenciar plano"</strong>. Você pode selecionar o plano desejado e pagar instantaneamente via PIX com QR Code dinâmico ou Cartão de Crédito com ativação imediata.'
  },
  {
    id: 'art-4',
    category: 'Pagamentos e Planos',
    icon: '💳',
    title: 'Estorno, cancelamento de assinatura e 2ª via de fatura',
    keywords: ['estorno', 'dinheiro', 'devolucao', 'cancelamento', 'cancelar', 'fatura', 'segunda via', 'reembolso', 'cobranca'],
    content: 'Você tem garantia incondicional de 7 dias com devolução integral. Para cancelar renovações futuras ou solicitar estorno imediato, basta clicar no botão <strong>"Abrir Ticket"</strong> abaixo ou enviar um e-mail com o comprovante.'
  },
  {
    id: 'art-5',
    category: 'Segurança e Conta',
    icon: '🔒',
    title: 'Como ativar biometria, Face ID ou impressão digital',
    keywords: ['biometria', 'digital', 'face id', 'dedo', 'desbloqueio', 'leitor', 'rosto', 'seguranca', 'login rapido'],
    content: 'Vá em <strong>Configurações &rsaquo; Segurança &rsaquo; Autenticação Biométrica / Face ID</strong> e ative o botão. O app detectará os sensores do aparelho e registrará sua chave com segurança sem precisar digitar senha.'
  },
  {
    id: 'art-6',
    category: 'Segurança e Conta',
    icon: '🔒',
    title: 'Alterar senha ou recuperar conta de acesso',
    keywords: ['senha', 'recuperar', 'esqueci', 'trocar senha', 'redefinir', 'conta invadida', 'login', 'email'],
    content: 'Em <strong>Configurações &rsaquo; Segurança &rsaquo; Alterar Senha de Acesso</strong> você pode criar uma nova senha. Caso tenha esquecido, clique em "Esqueci minha senha" para receber o link seguro de recuperação no seu e-mail cadastrado.'
  },
  {
    id: 'art-7',
    category: 'Problemas Técnicos',
    icon: '🛠️',
    title: 'O aplicativo funciona sem internet (modo offline)?',
    keywords: ['offline', 'sem internet', 'sincronizacao', 'nuvem', 'carregamento', 'trava', 'salvar'],
    content: 'Sim! Todos os produtos e alterações são gravados no banco de dados local do seu dispositivo instantaneamente. Quando a conexão à internet for restabelecida, a sincronização com a nuvem ocorre em segundo plano.'
  },
  {
    id: 'art-8',
    category: 'Problemas Técnicos',
    icon: '🛠️',
    title: 'O que fazer se os alertas ou notificações não chegarem?',
    keywords: ['notificacao nao chega', 'aviso sonoro', 'permissao', 'bateria', 'segundo plano', 'travar', 'erro'],
    content: 'Certifique-se de que as permissões de notificação estão concedidas nas configurações do seu celular ou navegador. Verifique também se a economia de bateria do aparelho não está restringindo o funcionamento em segundo plano.'
  }
];

// Abre o modal interativo da Central de Ajuda
function openHelpCenter() {
  const modal = document.getElementById('helpCenterModal');
  if (modal) {
    modal.style.display = 'flex';
    clearHelpSearch();
    renderUserTicketsHistory();
  }
}
window.openHelpCenter = openHelpCenter;

// Fecha o modal da Central de Ajuda
function closeHelpCenterModal() {
  const modal = document.getElementById('helpCenterModal');
  if (modal) modal.style.display = 'none';
}
window.closeHelpCenterModal = closeHelpCenterModal;

// Alterna os sanfonados (accordions) de dúvidas frequentes
function toggleHelpAccordion(secId) {
  const sec = document.getElementById(secId);
  const arr = document.getElementById(secId + '-arr');
  if (!sec) return;
  const isHidden = sec.style.display === 'none' || !sec.style.display;
  sec.style.display = isHidden ? 'flex' : 'none';
  if (arr) {
    arr.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
  }
}
window.toggleHelpAccordion = toggleHelpAccordion;

// Busca Inteligente com Reconhecimento de Sinônimos e Auto-Completar
function handleHelpSearch(query, suppressSuggestions) {
  const q = (query || '').toLowerCase().trim();
  const btnClear = document.getElementById('btnHelpClearSearch');
  const suggestionsBox = document.getElementById('helpSearchSuggestions');
  const resultsArea = document.getElementById('helpSearchResultsArea');
  const resultsList = document.getElementById('helpSearchResultsList');
  const categoriesArea = document.getElementById('helpCategoriesArea');

  if (btnClear) btnClear.style.display = q ? 'block' : 'none';

  if (!q) {
    clearHelpSearch();
    return;
  }

  // Mapeamento de sinônimos conhecidos do nicho
  const synonymMap = {
    'dinheiro': ['pagamento', 'pix', 'cartao', 'estorno', 'reembolso', 'plano'],
    'grana': ['pagamento', 'estorno', 'plano'],
    'dedo': ['biometria', 'digital', 'impressao digital'],
    'rosto': ['face id', 'biometria', 'facial'],
    'venceu': ['validade', 'vencimento', 'cadastrar'],
    'alerta': ['notificacao', 'whatsapp', 'aviso'],
    'zap': ['whatsapp', 'notificacao'],
    'ajuda': ['suporte', 'ticket', 'chamado']
  };

  const terms = [q];
  for (const [key, synList] of Object.entries(synonymMap)) {
    if (q.includes(key)) {
      terms.push(...synList);
    }
  }

  // Filtra artigos correspondentes
  const matched = HELP_ARTICLES.filter(art => {
    const textTarget = (art.title + ' ' + art.category + ' ' + art.content + ' ' + art.keywords.join(' ')).toLowerCase();
    return terms.some(t => textTarget.includes(t));
  });

  // Mostra sugestões no dropdown rápido (apenas quando digitando, não ao selecionar)
  if (suggestionsBox) {
    if (!suppressSuggestions && matched.length > 0) {
      suggestionsBox.innerHTML = matched.slice(0, 4).map(art => `
        <div onclick="selectHelpSuggestion('${art.id}')" style="padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer; display:flex; align-items:center; gap:8px; -webkit-tap-highlight-color:transparent;" onmouseover="this.style.background='rgba(142,255,0,0.08)'" onmouseout="this.style.background='transparent'">
          <span>${art.icon}</span>
          <span style="font-size:0.8rem; color:#fff; font-weight:600;">${art.title}</span>
        </div>
      `).join('');
      suggestionsBox.style.display = 'block';
    } else {
      suggestionsBox.style.display = 'none';
    }
  }

  // Mostra na área de resultados principal
  if (resultsArea && resultsList && categoriesArea) {
    categoriesArea.style.display = 'none';
    resultsArea.style.display = 'flex';

    if (matched.length === 0) {
      resultsList.innerHTML = `
        <div style="background:#161D2B; border:1px dashed #2D3748; border-radius:12px; padding:18px; text-align:center;">
          <div style="font-size:1.8rem; margin-bottom:6px;">🔍</div>
          <div style="font-size:0.85rem; font-weight:700; color:#fff;">Nenhum artigo encontrado para "${query}"</div>
          <div style="font-size:0.75rem; color:#8E99A8; margin-top:4px;">Tente pesquisar com outras palavras ou abra um chamado direto com nossa equipe.</div>
          <button onclick="closeHelpCenterModal(); openFeedbackModal();" style="margin-top:10px; background:#8EFF00; color:#090D14; font-weight:800; font-size:0.78rem; padding:8px 14px; border-radius:8px; border:none; cursor:pointer;">Abrir Chamado Agora</button>
        </div>
      `;
    } else {
      resultsList.innerHTML = matched.map(art => `
        <div style="background:#161D2B; border:1px solid rgba(142,255,0,0.2); border-radius:12px; padding:14px;">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
            <span style="font-size:0.9rem;">${art.icon}</span>
            <span style="font-size:0.72rem; color:#8EFF00; font-weight:700; text-transform:uppercase;">${art.category}</span>
          </div>
          <div style="font-size:0.85rem; font-weight:800; color:#fff; margin-bottom:6px;">${art.title}</div>
          <div style="font-size:0.78rem; color:#94A3B8; line-height:1.5;">${art.content}</div>
        </div>
      `).join('');
    }
  }
}
window.handleHelpSearch = handleHelpSearch;

// Seleciona uma sugestão da busca (fecha dropdown e renderiza resultado sem reabrir sugestões)
function selectHelpSuggestion(artId) {
  const suggestionsBox = document.getElementById('helpSearchSuggestions');
  if (suggestionsBox) suggestionsBox.style.display = 'none';
  const art = HELP_ARTICLES.find(a => a.id === artId);
  if (!art) return;
  const input = document.getElementById('helpSearchInput');
  if (input) input.value = art.title;
  // Passa suppressSuggestions=true para não reabrir o dropdown
  handleHelpSearch(art.title, true);
}
window.selectHelpSuggestion = selectHelpSuggestion;

// Limpa campo e resultados da busca
function clearHelpSearch() {
  const input = document.getElementById('helpSearchInput');
  if (input) input.value = '';
  const btnClear = document.getElementById('btnHelpClearSearch');
  if (btnClear) btnClear.style.display = 'none';
  const suggestionsBox = document.getElementById('helpSearchSuggestions');
  if (suggestionsBox) suggestionsBox.style.display = 'none';
  const resultsArea = document.getElementById('helpSearchResultsArea');
  if (resultsArea) resultsArea.style.display = 'none';
  const categoriesArea = document.getElementById('helpCategoriesArea');
  if (categoriesArea) categoriesArea.style.display = 'flex';
}
window.clearHelpSearch = clearHelpSearch;

// Canal de suporte direto (e-mail & atendimento)
function openLiveSupportChat() {
  const userEmail = (typeof auth !== 'undefined' && auth?.currentUser?.email) || '';
  const subject = encodeURIComponent('PrazoCerto - Atendimento Direto ao Usuário');
  const body = encodeURIComponent(
    `Olá, Equipe de Suporte PrazoCerto!\n\nPreciso de auxílio com a minha conta: ${userEmail}\n\nAssunto/Dúvida:\n\n\n---\nVersão: 1.2.0 | Dispositivo: ${navigator.userAgent}`
  );
  window.open(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`, '_blank');
  if (typeof showToast === 'function') {
    showToast('Canal direto aberto para prazoxcerto@gmail.com', '💬');
  }
}
window.openLiveSupportChat = openLiveSupportChat;

// Carrega histórico de chamados recente do usuário
async function renderUserTicketsHistory() {
  const listEl = document.getElementById('userTicketsList');
  const badgeEl = document.getElementById('ticketCountBadge');
  if (!listEl) return;

  const user = (typeof auth !== 'undefined') ? auth?.currentUser : null;
  if (!user) {
    listEl.innerHTML = '<span style="color:#64748B;">Faça login para acompanhar o histórico dos seus chamados.</span>';
    if (badgeEl) badgeEl.textContent = '0 chamados';
    return;
  }

  try {
    if (typeof db !== 'undefined' && db && typeof collection === 'function' && typeof getDocs === 'function' && typeof query === 'function' && typeof where === 'function') {
      const q = query(collection(db, 'feedbacks'), where('userId', '==', user.uid));
      const snap = await getDocs(q);
      if (snap.empty) {
        listEl.innerHTML = '<span style="color:#64748B;">Nenhum chamado aberto recentemente nesta conta.</span>';
        if (badgeEl) badgeEl.textContent = '0 chamados';
        return;
      }

      if (badgeEl) badgeEl.textContent = `${snap.size} ${snap.size === 1 ? 'chamado' : 'chamados'}`;
      
      const tickets = [];
      snap.forEach(doc => tickets.push({ id: doc.id, ...doc.data() }));
      tickets.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      listEl.innerHTML = tickets.slice(0, 3).map(t => {
        const dateStr = t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : 'Hoje';
        return `
          <div style="padding:8px 0; border-bottom:1px dashed rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:700; color:#fff; font-size:0.75rem;">[${t.category}] ${t.description.substring(0, 35)}...</div>
              <div style="font-size:0.67rem; color:#8E99A8;">Aberto em: ${dateStr}</div>
            </div>
            <span style="font-size:0.68rem; background:rgba(142,255,0,0.12); color:#8EFF00; padding:2px 6px; border-radius:6px; font-weight:700;">Recebido</span>
          </div>
        `;
      }).join('');
    } else {
      listEl.innerHTML = '<span style="color:#64748B;">Nenhum chamado aberto recentemente nesta conta.</span>';
    }
  } catch (err) {
    console.warn('Erro ao carregar histórico de chamados:', err);
    listEl.innerHTML = '<span style="color:#64748B;">Histórico sincronizado localmente.</span>';
  }
}
window.renderUserTicketsHistory = renderUserTicketsHistory;

// Obtém informações técnicas automáticas do dispositivo/navegador
function getTechnicalDetails() {
  const ua = navigator.userAgent;
  let os = 'Desconhecido';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  const screenRes = `${window.screen.width}x${window.screen.height} (janela: ${window.innerWidth}x${window.innerHeight})`;
  const appVersion = '1.2.0';
  const onlineStatus = navigator.onLine ? 'Online' : 'Offline';

  return {
    appVersion,
    os,
    screenRes,
    onlineStatus,
    userAgent: ua,
    timestamp: new Date().toISOString()
  };
}

// Abre o modal de Enviar Feedback com campos pré-carregados
function openFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (!modal) return;

  // Preenche e-mail se logado
  const emailInput = document.getElementById('fbEmail');
  if (emailInput) {
    const userEmail = (typeof auth !== 'undefined' && auth?.currentUser?.email) ? auth.currentUser.email : '';
    if (!emailInput.value) emailInput.value = userEmail;
  }

  // Preenche dados técnicos automáticos
  const techDiv = document.getElementById('fbTechDetails');
  if (techDiv) {
    const tech = getTechnicalDetails();
    techDiv.innerHTML = `
      • <strong>App:</strong> PrazoCerto v${tech.appVersion}<br>
      • <strong>Sistema:</strong> ${tech.os}<br>
      • <strong>Resolução:</strong> ${tech.screenRes}<br>
      • <strong>Conexão:</strong> ${tech.onlineStatus}
    `;
  }

  modal.style.display = 'flex';
}
window.openFeedbackModal = openFeedbackModal;

// Fecha o modal de Enviar Feedback
function closeFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (modal) modal.style.display = 'none';
}
window.closeFeedbackModal = closeFeedbackModal;

// Trata anexo de imagem / captura de tela
function handleFeedbackAttachmentChange(input) {
  const file = input.files && input.files[0];
  const nameSpan = document.getElementById('fbAttachmentName');
  const btnRemove = document.getElementById('fbBtnRemoveAttachment');

  if (!file) {
    clearFeedbackAttachment();
    return;
  }

  if (!file.type.startsWith('image/')) {
    if (typeof showToast === 'function') showToast('Por favor, selecione apenas arquivos de imagem.', '⚠️');
    clearFeedbackAttachment();
    return;
  }

  // Limite de 5MB
  if (file.size > 5 * 1024 * 1024) {
    if (typeof showToast === 'function') showToast('A imagem deve ter no máximo 5MB.', '⚠️');
    clearFeedbackAttachment();
    return;
  }

  _feedbackAttachmentName = file.name;
  if (nameSpan) nameSpan.textContent = file.name;
  if (btnRemove) btnRemove.style.display = 'inline-block';

  const reader = new FileReader();
  reader.onload = (e) => {
    _feedbackAttachmentBase64 = e.target.result;
  };
  reader.readAsDataURL(file);
}
window.handleFeedbackAttachmentChange = handleFeedbackAttachmentChange;

// Limpa anexo de feedback
function clearFeedbackAttachment() {
  _feedbackAttachmentBase64 = null;
  _feedbackAttachmentName = '';
  const input = document.getElementById('fbAttachmentInput');
  const nameSpan = document.getElementById('fbAttachmentName');
  const btnRemove = document.getElementById('fbBtnRemoveAttachment');
  if (input) input.value = '';
  if (nameSpan) nameSpan.textContent = 'Nenhum arquivo';
  if (btnRemove) btnRemove.style.display = 'none';
}
window.clearFeedbackAttachment = clearFeedbackAttachment;

// Envio do formulário de feedback
async function handleSendFeedback(event) {
  event.preventDefault();

  const category = document.getElementById('fbCategory')?.value || 'Feedback';
  const description = document.getElementById('fbDescription')?.value?.trim() || '';
  const contactEmail = document.getElementById('fbEmail')?.value?.trim() || '';
  const tech = getTechnicalDetails();

  if (!description) {
    if (typeof showToast === 'function') showToast('Por favor, informe a descrição.', '⚠️');
    return;
  }

  const btnSubmit = document.getElementById('fbBtnSubmit');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = 'Preparando envio...';
  }

  try {
    // Salva cópia no Firestore se disponível
    if (typeof db !== 'undefined' && db && typeof collection === 'function' && typeof addDoc === 'function') {
      try {
        await addDoc(collection(db, 'feedbacks'), {
          category,
          description,
          contactEmail,
          technicalInfo: tech,
          hasAttachment: !!_feedbackAttachmentBase64,
          attachmentName: _feedbackAttachmentName || null,
          createdAt: new Date(),
          userId: (typeof auth !== 'undefined' && auth?.currentUser?.uid) || null
        });
      } catch (dbErr) {
        console.warn('Não foi possível salvar no Firestore feedbacks:', dbErr);
      }
    }

    // Prepara e-mail pré-formatado para prazoxcerto@gmail.com
    const subject = encodeURIComponent(`[${category}] Feedback PrazoCerto`);
    const emailBody = encodeURIComponent(
      `CATEGORIA: ${category}\n` +
      `CONTATO DO USUÁRIO: ${contactEmail || 'Não informado'}\n\n` +
      `DESCRIÇÃO:\n${description}\n\n` +
      `----------------------------------------\n` +
      `INFORMAÇÕES TÉCNICAS AUTOMÁTICAS:\n` +
      `- Versão do App: PrazoCerto ${tech.appVersion}\n` +
      `- Sistema Operacional: ${tech.os}\n` +
      `- Tela / Resolução: ${tech.screenRes}\n` +
      `- Conexão: ${tech.onlineStatus}\n` +
      `- User Agent: ${tech.userAgent}\n` +
      `- Data/Hora: ${tech.timestamp}\n` +
      `----------------------------------------\n` +
      (_feedbackAttachmentName ? `* Imagem selecionada: ${_feedbackAttachmentName} (Você pode anexá-la diretamente no seu e-mail caso deseje enviar o print completo)\n` : '')
    );

    // Abre mailto direto
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${emailBody}`;

    if (typeof showToast === 'function') {
      showToast('Obrigado! Formulário de feedback aberto para envio.', '🚀');
    }

    // Limpa formulário e fecha
    document.getElementById('feedbackForm')?.reset();
    clearFeedbackAttachment();
    closeFeedbackModal();
  } catch (err) {
    console.error('Erro ao enviar feedback:', err);
    if (typeof showToast === 'function') {
      showToast('Ocorreu um erro. Tente novamente.', '⚠️');
    }
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<span>✉️</span> Enviar';
    }
  }
}
window.handleSendFeedback = handleSendFeedback;




// ==============================================================================
// FUNCAO: ABRIR MODAL DE GESTAO DE EQUIPE
// ==============================================================================
window.openTeamManagerModal = function() {
  var modal = document.getElementById('teamManagerModal');
  if (!modal) return;
  modal.style.display = 'flex';
  // Carrega lista de membros
  if (typeof window.loadTeamMembers === 'function') {
    window.loadTeamMembers();
  }
};

window.closeTeamManagerModal = function() {
  var modal = document.getElementById('teamManagerModal');
  if (modal) modal.style.display = 'none';
};