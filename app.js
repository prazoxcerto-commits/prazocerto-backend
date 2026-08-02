/* =============================================
   PrazoCerto – app.js
   Full feature: Products, QR/Barcode scanner,
   Charts, Alerts, Categories, Reports, Settings
   ============================================= */

'use strict';

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
  if (firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
  }
} catch(e) {
  console.warn('Firebase Messaging não disponível:', e.message);
}

let _remoteProducts = [];
let _catalogProducts = [];
let _firestoreUnsubscribe = null; // listener em tempo real de produtos do usuário
let _currentUserId = null;        // UID do usuário logado

// ── SINCRONIZAÇÃO DE PRODUTOS COM FIRESTORE ──
function _syncProductsToFirestore(products) {
  if (!_currentUserId) return;
  db.collection('user_data').doc(_currentUserId).set({
    products: products,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(function(e) {
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

  function get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
  }
  function set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  return {
    getAllProducts: () => _remoteProducts,
    getProducts: () => {
      const loc = window.currentLocationFilter || 'all';
      if (loc === 'all') return _remoteProducts;
      return _remoteProducts.filter(p => (p.location || 'Sem Loja') === loc);
    },
    getCatalog: () => _catalogProducts,
    setProducts: (v) => {
      _remoteProducts = v;
      if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
      // Salva no localStorage (cache offline)
      try { localStorage.setItem('cv_products', JSON.stringify(v)); } catch(e) {}
      // Sincroniza com Firestore se logado
      if (_currentUserId) {
        _syncProductsToFirestore(v);
      }
      // Atualiza todas as exibições em tempo real imediatamente
      if (typeof renderDashboard === 'function') renderDashboard();
      if (typeof renderProducts === 'function') renderProducts();
      if (typeof renderAlerts === 'function') renderAlerts();
      if (typeof updateBadges === 'function') updateBadges();
      if (typeof renderReports === 'function') renderReports();
      if (typeof renderHistory === 'function') renderHistory();
    },
    getCategories: () => get(KEYS.categories) || [
      { id: 'cat-1', name: 'Alimentos', emoji: '🥗', color: '#6EE7B7' },
      { id: 'cat-2', name: 'Laticínios', emoji: '🥛', color: '#3B82F6' },
      { id: 'cat-3', name: 'Carnes', emoji: '🥩', color: '#EF4444' },
      { id: 'cat-4', name: 'Higiene', emoji: '🧴', color: '#A78BFA' },
      { id: 'cat-5', name: 'Medicamentos', emoji: '💊', color: '#F59E0B' },
      { id: 'cat-6', name: 'Limpeza', emoji: '🧹', color: '#06B6D4' },
    ],
    setCategories: v => set(KEYS.categories, v),
    getSettings: () => get(KEYS.settings) || { warnDays: 7, critDays: 3, theme: 'dark', animations: true },
    setSettings: v => set(KEYS.settings, v),
    getStores: () => get('cv_stores') || [],
    setStores: v => {
      set('cv_stores', v);
      if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
      // Sincroniza lojas com Firestore se logado
      if (_currentUserId) {
        db.collection('user_data').doc(_currentUserId).set(
          { stores: v, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        ).catch(function(e) { console.warn('Erro ao sincronizar lojas:', e); });
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
  now.setHours(0,0,0,0);
  return Math.round((exp - now) / 86400000);
}

function formatDate(dateVal) {
  const ds = toDateString(dateVal);
  if (!ds) return '—';
  const [y,m,d] = ds.split('-');
  return `${d}/${m}/${y}`;
}

function getStatus(days, settings) {
  if (days === null || isNaN(days)) return 'ok';
  if (days < 0) return 'expired';
  if (days <= (settings.critDays || 3)) return 'expired';
  if (days <= (settings.warnDays || 7)) return 'warn';
  return 'ok';
}

function statusLabel(days) {
  if (days === null || isNaN(days)) return 'Data Inválida';
  if (days < 0) return `Vencido há ${Math.abs(days)} dias`;
  if (days === 0) return 'Vence hoje!';
  if (days === 1) return 'Vence 1 dia';
  return `Vence ${days} dias`;
}

function showToast(msg, icon = '✅', duration = 3000) {
  const t = document.getElementById('toast');
  const ti = document.getElementById('toastIcon');
  const tm = document.getElementById('toastMsg');
  ti.textContent = icon;
  tm.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function confirm(title, msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    modal.classList.remove('hidden');
    const yes = document.getElementById('confirmYes');
    const no  = document.getElementById('confirmNo');
    const close = document.getElementById('confirmClose');
    const cleanup = (val) => {
      modal.classList.add('hidden');
      resolve(val);
    };
    yes.onclick = () => cleanup(true);
    no.onclick  = () => cleanup(false);
    close.onclick = () => cleanup(false);
  });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia! 👋';
  if (h < 18) return 'Boa tarde! 👋';
  return 'Boa noite! 🌙';
}

// ── NAVIGATION ───────────────────────────────────
let currentPage = 'dashboard';
let currentFilter = 'ok';
let currentAlertFilter = 'expired';
let editingProduct = null;

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  const navEl  = document.getElementById('nav-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');
  const titles = { dashboard:'Dashboard', products:'Produtos', alerts:'Alertas', scanner:'Scanner QR/Barras', categories:'Categorias', reports:'Relatórios', settings:'Configurações' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');

  if (page === 'dashboard') renderDashboard();
  if (page === 'products')  renderProducts();
  if (page === 'alerts')    renderAlerts();
  if (page === 'categories') renderCategories();
  if (page === 'reports')   renderReports();
  if (page === 'scanner')   startScanner();
  else if (scannerActive)   try { stopScanner(); } catch(e){} // para se sair do scanner manualmente
  if (page === 'catalog')   if(typeof renderCatalog === 'function') renderCatalog();
  if (page === 'history')   if(typeof renderHistory === 'function') renderHistory();
}

function updateLocationFilterOptions() {
  const products = Store.getAllProducts();
  const registered = Store.getStores();
  const locations = new Set([...registered, ...products.map(p => p.location ? p.location.trim() : 'Sem Loja')]);
  const sorted = Array.from(locations).sort();
  const sel = document.getElementById('globalLocationFilter');
  if (!sel) return;
  const saved = localStorage.getItem('cv_selected_store') || 'all';
  window.currentLocationFilter = saved;
  sel.innerHTML = '<option value="all">Todas as Lojas</option>' +
    sorted.map(loc => `<option value="${loc}">${escHtml(loc)}</option>`).join('');
  sel.value = sorted.includes(saved) || saved === 'all' ? saved : 'all';
  window.currentLocationFilter = sel.value;
}

function populateStoreSelect(selected) {
  const sel = document.getElementById('prodLocation');
  if (!sel) return;
  const products = Store.getAllProducts();
  const registered = Store.getStores();
  const locations = new Set([...registered, ...products.map(p => p.location ? p.location.trim() : '')]);
  locations.delete('');
  locations.delete('Sem Loja');
  const sorted = Array.from(locations).sort();
  sel.innerHTML = '<option value="">Sem Loja</option>' +
    sorted.map(s => `<option value="${s}" ${s === selected ? 'selected' : ''}>${escHtml(s)}</option>`).join('');
}


// ── RENDER PRODUCTS ──────────────────────────────
function renderProducts(filter) {
  if (filter !== undefined) currentFilter = filter;
  const settings = Store.getSettings();
  let products = Store.getProducts();
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
  // Search
  const q = document.getElementById('productSearch')?.value?.toLowerCase() || '';
  if (q) products = products.filter(p => p.name.toLowerCase().includes(q) || (p.code||'').includes(q));

  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  if (!products.length) {
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
  grid.innerHTML = products.map((p, index) => productCardHTML(p, cats, settings, index + 1)).join('');
  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.product-action-btn')) return;
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
  const totalLife = p.mfgDate ? Math.max(1, Math.round((new Date(p.expDate) - new Date(p.mfgDate)) / 86400000)) : 365;
  const remaining = days !== null ? Math.max(0, days) : 0;
  const pct = Math.min(100, Math.round((remaining / totalLife) * 100));

  return `<div class="product-card status-${status}" data-id="${p.id}">
    <div class="product-card-body">
      <div class="product-thumb" style="${cat ? `background:${cat.color}22;` : ''}" ${p.code ? `data-ean="${p.code}"` : ''}>
        ${cat ? cat.emoji : '📦'}
      </div>
      <div class="product-details">
        <div class="product-header-row">
          <div class="product-name" style="width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;"><span style="color:#94A3B8; font-size:0.8em; margin-right:6px; font-weight:400;">${index || ''}${index ? '.' : ''}</span>${escHtml(p.name)}</div>
        </div>
        <div class="info-pills" style="margin-bottom: 0.4rem; margin-top: 0.2rem; display: flex; flex-wrap: nowrap; gap: 0.25rem; overflow: hidden;">
          <span class="info-pill" style="padding: 0.1rem 0.25rem; font-size: 0.65rem;"><span class="pill-icon">📅</span> Val: <b>${formatDate(p.expDate)}</b></span>
          <span class="info-pill" style="padding: 0.1rem 0.25rem; font-size: 0.65rem;"><span class="pill-icon">🔢</span> Qtd: <b>${p.qty||1}</b></span>
          ${p.location ? `<span class="info-pill" style="padding: 0.1rem 0.25rem; font-size: 0.65rem;"><span class="pill-icon">📍</span> <b>${escHtml(p.location)}</b></span>` : ''}
        </div>
        <div class="product-expiry-bar"><div class="product-expiry-fill" style="width:${pct}%"></div></div>
        <span class="product-days" style="margin-bottom: 0.5rem; display: inline-block;">${statusLabel(days)}</span>
        
        <!-- Linha de Botões alinhados na mesma linha abaixo da Validade -->
        <div class="product-actions-visible">
          <button class="product-action-btn edit-btn" title="Editar">✏️ Editar</button>
          <button class="product-action-btn delete-btn delete" title="Excluir">🗑 Excluir</button>
          <button class="product-action-btn share-btn" title="Compartilhar" data-id="${p.id}">📲 Compartilhar</button>
        </div>
      </div>
    </div>
  </div>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── IMAGENS ────────────────────────────────
async function fetchProductImage(ean) {
  if (!ean) return null;
  return `imagens/${ean}.jpg`;
}

function attachProductImages(container) {
  container.querySelectorAll('[data-ean]').forEach(async el => {
    const ean = el.dataset.ean;
    if (!ean) return;
    const localUrl = `imagens/${ean}.jpg`;
    const originalContent = el.innerHTML;
    
    const img = document.createElement('img');
    img.alt = "foto";
    img.style.cssText = "width:100%; height:100%; object-fit:contain; border-radius:6px;";
    
    img.onerror = () => {
      // Fallback 1: CDN Cosmos (Bluesoft)
      const imgCosmos = document.createElement('img');
      imgCosmos.alt = "foto";
      imgCosmos.style.cssText = "width:100%; height:100%; object-fit:contain; border-radius:6px;";
      
      imgCosmos.onerror = async () => {
        // Fallback 2: OpenFoodFacts API
        try {
          const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${ean}.json`);
          const data = await res.json();
          if (data && data.product && data.product.image_url) {
            const imgGlobal = document.createElement('img');
            imgGlobal.alt = "foto";
            imgGlobal.style.cssText = "width:100%; height:100%; object-fit:contain; border-radius:6px;";
            imgGlobal.src = data.product.image_url;
            imgGlobal.onerror = () => { el.innerHTML = originalContent; };
            imgGlobal.onload = () => { el.innerHTML = ''; el.appendChild(imgGlobal); };
          } else {
            el.innerHTML = originalContent;
          }
        } catch (e) {
          el.innerHTML = originalContent;
        }
      };
      
      imgCosmos.onload = () => { el.innerHTML = ''; el.appendChild(imgCosmos); };
      imgCosmos.src = `https://cdn-cosmos.bluesoft.com.br/products/${ean}`;
    };
    
    img.onload = () => {
      el.innerHTML = '';
      el.appendChild(img);
    };
    img.src = localUrl;
  });
}

// ── RENDER DASHBOARD ─────────────────────────────
function renderDashboard() {
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

  animateNumber('stat-total', products.length);
  animateNumber('stat-ok', ok);
  animateNumber('stat-warn', warn);
  animateNumber('stat-expired', expired);

  // Date
  document.getElementById('greetingText').textContent = greeting();
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Urgent alerts (exp or warn within critDays)
  const urgent = products
    .filter(p => { const d = daysUntil(p.expDate); return d !== null && d <= (settings.warnDays||7); })
    .sort((a, b) => daysUntil(a.expDate) - daysUntil(b.expDate))
    .slice(0, 5);

  const alertsList = document.getElementById('urgentAlertsList');
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
        navigate('products');
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

  // Donut chart
  drawDonut(ok, warn, expired);

  // Recent
  const recent = [...products].sort((a,b) => (b.addedAt||'') > (a.addedAt||'') ? 1 : -1).slice(0,8);
  const recentList = document.getElementById('recentList');
  if (!recent.length) {
    recentList.innerHTML = '<div class="empty-state-small">Nenhum produto ainda</div>';
  } else {
    recentList.innerHTML = recent.map(p => {
      const d = daysUntil(p.expDate);
      const s = getStatus(d, settings);
      const cat = cats.find(c => c.id === p.category);
      return `<div class="recent-item">
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
function alertItemHTMLFull(p, settings, cats, itemIndex) {
  const days = daysUntil(p.expDate);
  const cat = cats.find(c => c.id === p.category);
  const numPrefix = (typeof itemIndex === 'number') ? `<span style="color:#94A3B8; font-size:0.8em; margin-right:4px; font-weight:600;">${itemIndex + 1}.</span>` : '';
  
  let badge, tip, customBg, customText, customBorder;
  if (days < 0) {
    tip = 'Risco de Quebra: Retirar da área de vendas imediatamente.';
    badge = `<span class="alert-badge" onclick="showToast('${tip.replace(/'/g, "\\'")}', '⚫', 6000)" style="background:#111827;color:#fff;cursor:pointer;" title="Clique para ver dica">Vencido</span>`;
    customBg = '#111827'; customText = '#ffffff'; customBorder = '#111827';
  } else if (days <= 2) {
    tip = `Risco de Quebra: Retirar da área de vendas se não houver saída hoje. Preparar documentação de recolhimento.`;
    badge = `<span class="alert-badge" onclick="showToast('${tip.replace(/'/g, "\\'")}', '⚫', 6000)" style="background:#111827;color:#fff;cursor:pointer;" title="Clique para ver dica">Crítico</span>`;
    customBg = '#111827'; customText = '#ffffff'; customBorder = '#111827';
  } else if (days <= 5) {
    tip = `Urgente: Solicite rebaixamento agressivo (30% a 50%) e aplique adesivo de Vencimento Próximo.`;
    badge = `<span class="alert-badge" onclick="showToast('${tip.replace(/'/g, "\\'")}', '🔴', 6000)" style="background:#fee2e2;color:#991b1b;border:1px solid #ef4444;cursor:pointer;" title="Clique para ver dica">Urgente</span>`;
    customBg = '#fee2e2'; customText = '#991b1b'; customBorder = '#ef4444';
  } else if (days <= 10) {
    tip = `Sugerir Promoção: Sugira mecânica Leve 3 Pague 2 ou desconto leve.`;
    badge = `<span class="alert-badge" onclick="showToast('${tip.replace(/'/g, "\\'")}', '🟠', 6000)" style="background:#ffedd5;color:#9a3412;border:1px solid #f97316;cursor:pointer;" title="Clique para ver dica">Ação</span>`;
    customBg = '#ffedd5'; customText = '#9a3412'; customBorder = '#f97316';
  } else if (days <= 15) {
    tip = `Ponto Extra: Aplique FEFO e negocie ponto extra ou ilha com o gerente.`;
    badge = `<span class="alert-badge" onclick="showToast('${tip.replace(/'/g, "\\'")}', '🟡', 6000)" style="background:#fef9c3;color:#854d0e;border:1px solid #eab308;cursor:pointer;" title="Clique para ver dica">Atenção</span>`;
    customBg = '#fef9c3'; customText = '#854d0e'; customBorder = '#eab308';
  } else {
    tip = `Validade Segura.`;
    badge = `<span class="alert-badge" onclick="showToast('${tip.replace(/'/g, "\\'")}', '🟢', 6000)" style="background:#dcfce7;color:#166534;border:1px solid #22c55e;cursor:pointer;" title="Clique para ver dica">Estoque Normal</span>`;
    customBg = '#dcfce7'; customText = '#166534'; customBorder = '#22c55e';
  }

  const nameColor = (days <= 2 || days < 0) ? '#ffffff' : '#1e293b';

  let daysColor = '#10B981'; // Verde (na validade)
  if (days < 0 || days <= 3) {
    daysColor = '#EF4444'; // Vermelho (vencido ou vence em até 3 dias)
  } else if (days <= 15) {
    daysColor = '#F59E0B'; // Amarelo (atenção/ação)
  }

  const daysLabelText = statusLabel(days);

  return `<div class="alert-item" style="background:${customBg}; border:1px solid ${customBorder}; color:${customText}; display:flex; align-items:center; gap:0.5rem;">
    <div class="alert-thumb" ${p.code ? `data-ean="${p.code}"` : ''} style="width:48px; height:48px; min-width:48px; background:rgba(255,255,255,0.2); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.5rem; overflow:hidden;">${cat ? cat.emoji : '⚠️'}</div>
    <div class="alert-info" style="flex:1; min-width: 0;">
      <div class="alert-name" style="color:${nameColor}; font-weight:700; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${numPrefix}${escHtml(p.name)}</div>
      <div class="info-pills" style="opacity: 0.9; display:flex; flex-wrap:wrap; gap:0.35rem; align-items:center; margin-top:3px; margin-bottom:6px;">
        <span class="info-pill" style="color:${customText}; border-color:${customBorder}; padding: 0.22rem 0.5rem; font-size: 0.85rem; white-space:nowrap;"><span class="pill-icon">📅</span> Val: <b>${formatDate(p.expDate)}</b></span>
        <span class="info-pill" style="color:${customText}; border-color:${customBorder}; padding: 0.22rem 0.5rem; font-size: 0.85rem; white-space:nowrap;"><span class="pill-icon">🔢</span> Qtd: <b>${p.qty||1}</b></span>
      </div>
      <div class="alert-actions-visible">
        <button class="alert-edit-btn" data-id="${p.id}" title="Editar" style="color:${customText}; border: 1px solid #111827;">✏️ Editar</button>
        <button class="alert-consume-btn" data-id="${p.id}" title="Consumido/Descartar" style="color:${customText}; border: 1px solid #111827;">🗑 Excluir</button>
        <button class="alert-share-btn" data-id="${p.id}" title="Compartilhar" style="color:${customText}; border: 1px solid #111827;">📲 Compartilhar</button>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.35rem; flex-shrink:0; min-width:76px; text-align:center;">
      ${badge}
      <span style="color:${daysColor}; font-weight:800; font-size:0.75rem; text-shadow: 0 1px 2px rgba(0,0,0,0.5); white-space:nowrap;">${daysLabelText}</span>
    </div>
  </div>`;
}

function drawDonut(ok, warn, expired) {
  const canvas = document.getElementById('statusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const total = ok + warn + expired;
  // Canvas is 180x180 in new layout
  const W = canvas.width || 180;
  const cx = W/2, cy = W/2, r = W*0.42, innerR = W*0.28;

  ctx.clearRect(0, 0, W, W);

  if (!total) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,18,24,0.9)';
    ctx.fill();
    const tot = document.getElementById('donutTotal');
    const leg = document.getElementById('chartLegend');
    if (tot) tot.textContent = 0;
    if (leg) leg.innerHTML = '';
    return;
  }

  const segments = [
    { val: ok,      color: '#4ADE80', label: 'Na Validade' },
    { val: warn,    color: '#FCD34D', label: 'Vence em Breve' },
    { val: expired, color: '#F87171', label: 'Vencidos' },
  ];

  let startAngle = -Math.PI / 2;
  segments.forEach(seg => {
    if (!seg.val) return;
    const sweep = (seg.val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
    ctx.arc(cx, cy, innerR, startAngle + sweep, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    startAngle += sweep;
  });

  // Inner fill
  ctx.beginPath();
  ctx.arc(cx, cy, innerR - 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,18,24,0.95)';
  ctx.fill();

  const tot = document.getElementById('donutTotal');
  const leg = document.getElementById('chartLegend');
  if (tot) tot.textContent = total;
  if (leg) {
    leg.innerHTML = segments.map(s =>
      `<div class="legend-item-new"><div class="legend-dot-new" style="background:${s.color}"></div><div class="legend-item-text"><div class="legend-item-label">${s.label}</div><div class="legend-item-val">${s.val}</div></div></div>`
    ).join('');
  }
}

// Atualiza o gráfico de visão geral conforme período selecionado
function updateDashChart() {
  const products = Store.getProducts();
  const settings = Store.getSettings();
  const periodSel = document.getElementById('dashPeriodSelect');
  const period = periodSel ? periodSel.value : 'week';

  // Janela de dias para cada período
  const windowDays = { today: 1, week: 7, month: 30 };
  const maxDays = windowDays[period] ?? 7;

  // Filtra produtos relevantes para o período:
  // inclui vencidos (d < 0) e os que vencem dentro da janela
  const filtered = products.filter(p => {
    const d = daysUntil(p.expDate);
    if (d === null) return false;
    return d < 0 || d <= maxDays;
  });

  let ok = 0, warn = 0, expired = 0;
  filtered.forEach(p => {
    const d = daysUntil(p.expDate);
    const s = getStatus(d, settings);
    if (s === 'ok') ok++;
    else if (s === 'warn') warn++;
    else expired++;
  });

  // Atualiza título da seção com o período
  const periodLabels = { today: 'Hoje', week: 'Esta semana', month: 'Este mês' };
  const headerEl = document.querySelector('.visao-geral-header h3');
  if (headerEl) headerEl.textContent = `Visão Geral — ${periodLabels[period] || 'Esta semana'}`;

  drawDonut(ok, warn, expired);
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

function easeOut(t) { return 1 - (1-t)**3; }

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
  } else if (currentAlertFilter === '15') { list = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d > 7 && d <= 15; }); } else if (currentAlertFilter === 'soon') {
    list = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d > 7 && d <= 30; });
  } else {
    list = products.filter(p => { const d = daysUntil(p.expDate); return d !== null && d <= 30; });
  }
  list.sort((a,b) => daysUntil(a.expDate) - daysUntil(b.expDate));

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
      navigate('products');
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

// ── REPORTS ──────────────────────────────────────
function renderReports() {
  const products = Store.getProducts();
  const settings = Store.getSettings();

  // Timeline
  const upcoming = products
    .filter(p => { const d = daysUntil(p.expDate); return d !== null && d >= 0 && d <= 60; })
    .sort((a,b) => daysUntil(a.expDate) - daysUntil(b.expDate));
  const timeline = document.getElementById('timelineList');
  if (!upcoming.length) {
    timeline.innerHTML = '<div class="empty-state-small">Nenhum produto vence nos próximos 60 dias 🎉</div>';
  } else {
    timeline.innerHTML = upcoming.map(p => {
      const d = daysUntil(p.expDate);
      const s = getStatus(d, settings);
      const colors = { ok:'var(--success)', warn:'var(--warn)', expired:'var(--danger)' };
      return `<div class="timeline-item">
        <span class="timeline-date">${formatDate(p.expDate)}</span>
        <span class="timeline-name">${escHtml(p.name)}</span>
        <span class="timeline-days" style="color:${colors[s]}">${d} dias</span>
      </div>`;
    }).join('');
  }

  // Monthly Chart
  drawMonthlyChart(products, settings);
  // Category Chart
  drawCategoryChart(products);
}

function drawMonthlyChart(products, settings) {
  const canvas = document.getElementById('monthlyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Count by month (next 6 months)
  const now = new Date();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({ label: d.toLocaleDateString('pt-BR', { month:'short' }), ok: 0, exp: 0 });
  }
  products.forEach(p => {
    if (!p.expDate) return;
    const exp = new Date(p.expDate);
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
      if (exp >= d && exp <= end) {
        const days = daysUntil(p.expDate);
        if (days !== null && days < 0) months[i].exp++;
        else months[i].ok++;
      }
    }
  });

  const W = canvas.width, H = canvas.height;
  const pad = { top:10, bottom:30, left:30, right:10 };
  const maxVal = Math.max(1, ...months.map(m => m.ok + m.exp));
  const barW = ((W - pad.left - pad.right) / months.length) * 0.6;
  const gap  = ((W - pad.left - pad.right) / months.length);

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(pad.left, pad.top, W - pad.left - pad.right, H - pad.top - pad.bottom);

  months.forEach((m, i) => {
    const x = pad.left + i * gap + gap/2 - barW/2;
    const okH  = ((m.ok  / maxVal) * (H - pad.top - pad.bottom - 10));
    const expH = ((m.exp / maxVal) * (H - pad.top - pad.bottom - 10));

    // ok bar
    if (m.ok) {
      const grad = ctx.createLinearGradient(0, H-pad.bottom-okH, 0, H-pad.bottom);
      grad.addColorStop(0, '#10B981'); grad.addColorStop(1, '#059669');
      ctx.fillStyle = grad;
      ctx.roundRect(x, H-pad.bottom-okH, barW/2-2, okH, [3,3,0,0]);
      ctx.fill();
    }
    // exp bar
    if (m.exp) {
      const grad2 = ctx.createLinearGradient(0, H-pad.bottom-expH, 0, H-pad.bottom);
      grad2.addColorStop(0, '#EF4444'); grad2.addColorStop(1, '#B91C1C');
      ctx.fillStyle = grad2;
      ctx.roundRect(x + barW/2, H-pad.bottom-expH, barW/2-2, expH, [3,3,0,0]);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(m.label, x + barW/2, H - pad.bottom + 14);
  });
}

function drawCategoryChart(products) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cats = Store.getCategories();
  const W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2 - 10, r = Math.min(cx, cy) - 20;

  const data = cats.map(cat => ({
    label: cat.name, color: cat.color,
    count: products.filter(p => p.category === cat.id).length
  })).filter(d => d.count > 0);

  if (!data.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Sem dados', cx, cy);
    return;
  }

  const total = data.reduce((s, d) => s + d.count, 0);
  let startAngle = -Math.PI / 2;
  data.forEach(d => {
    const sweep = (d.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    startAngle += sweep;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0a12';
  ctx.fill();
}

// ── PRODUCT MODAL ────────────────────────────────
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
  document.getElementById('prodLocation').value = (currentLoc && currentLoc !== 'all') ? currentLoc : '';
  populateCategorySelect();
  populateStoreSelect(currentLoc === 'all' ? '' : currentLoc);

  if (prefillCode) {
    document.getElementById('prodCode').value = prefillCode;
    // Garante scroll no topo antes e depois do catálogo carregar
    const modalBody = document.querySelector('#productModal .modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    document.getElementById('productModal').classList.remove('hidden');
    // Dispara busca no catálogo (o handler vai preencher nome/imagem)
    document.getElementById('prodCode').dispatchEvent(new Event('input'));
    // Scroll para o topo novamente após catálogo carregar (800ms = debounce 600 + render)
    setTimeout(() => {
      if (modalBody) modalBody.scrollTop = 0;
    }, 900);
  } else {
    document.getElementById('productModal').classList.remove('hidden');
    setTimeout(() => {
      const modalBody = document.querySelector('#productModal .modal-body');
      if (modalBody) modalBody.scrollTop = 0;
      document.getElementById('prodName').focus();
    }, 50);
  }
}

function openEditModal(id) {
  const products = Store.getAllProducts();
  const p = products.find(x => x.id === id);
  if (!p) return;
  editingProduct = p;
  document.getElementById('modalTitle').textContent = 'Editar Produto';
  document.getElementById('prodName').value    = p.name;
  document.getElementById('prodCode').value    = p.code || '';
  document.getElementById('prodExpDate').value = p.expDate || '';
  document.getElementById('prodMfgDate').value = p.mfgDate || '';
  document.getElementById('prodQty').value     = p.qty || 1;
  document.getElementById('prodLocation').value = p.location || '';
  document.getElementById('prodNotes').value   = p.notes || '';
  populateCategorySelect(p.category);
  populateStoreSelect(p.location);
  updateExpiryPreview();
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
    filterSel.innerHTML = '<option value="all">Todas as Categorias</option>' +
      cats.map(c => `<option value="${c.id}">${c.emoji} ${escHtml(c.name)}</option>`).join('');
    filterSel.value = currFilter || 'all';
  }
}

function getAutoCategory(name) {
  if (!name) return '';
  const n = name.toLowerCase();
  const cats = Store.getCategories();
  const matchCat = (keywords) => cats.find(c => keywords.some(k => c.name.toLowerCase().includes(k) || n.includes(k)));
  
  if (n.includes('leite') || n.includes('iogurte') || n.includes('iorgute') || n.includes('queijo') || n.includes('manteiga') || n.includes('requeijão') || n.includes('danone') || n.includes('danoninho') || n.includes('margarina')) {
    const c = matchCat(['laticínio', 'laticinios', 'leite']);
    if (c) return c.id;
  } else if (n.includes('carne') || n.includes('frango') || n.includes('porco') || n.includes('peixe') || n.includes('salsicha') || n.includes('linguiça') || n.includes('bife') || n.includes('calabresa')) {
    const c = matchCat(['carne']);
    if (c) return c.id;
  } else if (n.includes('sabão') || n.includes('detergente') || n.includes('amaciante') || n.includes('desinfetante') || n.includes('limpeza') || n.includes('veja')) {
    const c = matchCat(['limpeza']);
    if (c) return c.id;
  } else if (n.includes('sabonete') || n.includes('shampoo') || n.includes('condicionador') || n.includes('pasta') || n.includes('escova') || n.includes('desodorante')) {
    const c = matchCat(['higiene']);
    if (c) return c.id;
  } else if (n.includes('dipirona') || n.includes('paracetamol') || n.includes('remédio') || n.includes('comprimido') || n.includes('xarope')) {
    const c = matchCat(['medicamento', 'farmacia']);
    if (c) return c.id;
  } else if (n.includes('arroz') || n.includes('feijão') || n.includes('macarrão') || n.includes('açúcar') || n.includes('sal') || n.includes('café') || n.includes('óleo') || n.includes('biscoito') || n.includes('suco') || n.includes('fruta') || n.includes('legume') || n.includes('morango')) {
    const c = matchCat(['alimento', 'hortifruti', 'mercearia']);
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

  const p = {
    id:       editingProduct?.id || uid(),
    name,
    code:     document.getElementById('prodCode').value.trim(),
    expDate,
    mfgDate:  document.getElementById('prodMfgDate').value,
    qty:      parseInt(document.getElementById('prodQty').value) || 1,
    location: document.getElementById('prodLocation').value.trim(),
    notes:    document.getElementById('prodNotes').value.trim(),
    category: categoryId,
    addedAt:  editingProduct?.addedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let products = Store.getAllProducts();
  if (editingProduct) {
    products = products.map(x => x.id === p.id ? p : x);
    showToast(`"${name}" atualizado`, '✅');
    document.getElementById('productModal').classList.add('hidden');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  } else {
    products.unshift(p);
    showToast(`"${name}" adicionado!`, '✅');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    
    // Limpa tudo e fecha o modal
    resetProductForm();
    _resetScanCooldown();
    document.getElementById('productModal').classList.add('hidden');

    // Se veio do scanner, volta para câmera automaticamente para escanear o próximo produto
    if (wasScanning) {
      wasScanning = false;
      setTimeout(() => navigate('scanner'), 200);
    }
  }
  Store.setProducts(products);
  
  if (currentPage === 'products') renderProducts();
  if (currentPage === 'dashboard') renderDashboard();
  if (typeof renderHistory === 'function') renderHistory();
  updateBadges();
  scheduleNotifications();
}

function deleteProduct(id) {
  let products = Store.getAllProducts().filter(p => p.id !== id);
  Store.setProducts(products);
  renderProducts();
  if (currentPage === 'dashboard') renderDashboard();
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
  const colors = { ok:'var(--gradient-ok)', warn:'var(--gradient-warn)', expired:'var(--gradient-danger)' };
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
        } catch(e) {}
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
    try { await html5QrCode.stop(); } catch(e) {}
    try { html5QrCode.clear(); } catch(e) {}
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
        const width  = Math.floor(viewfinderWidth  * 0.85);
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

        // Interrompe o scanner em background para liberar os recursos do navegador
        setTimeout(async () => {
          try {
            if (html5QrCode) {
              await html5QrCode.stop();
              html5QrCode.clear();
              html5QrCode = null;
            }
          } catch(e) { console.warn(e); }
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
    if (html5QrCode) { try { html5QrCode.clear(); } catch(_){} html5QrCode = null; }
    if (startBtn) startBtn.style.display = '';
    if (stopBtn) stopBtn.style.display = 'none';
    // Mostra erro e botão para tentar de novo
    showToast('Câmera bloqueada. Toque em "Iniciar Scanner" para tentar novamente.', '⚠️', 5000);
    console.warn('Scanner error:', e.message);
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
      try { html5QrCode.clear(); } catch(_){}
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
              if (navigator.vibrate) navigator.vibrate([200]);

              document.getElementById('prodCode').value = code;
              document.getElementById('inlineScannerContainer').style.display = 'none';
              showToast('Código detectado (Google ML Kit): ' + code, '✅');
              document.getElementById('prodCode').dispatchEvent(new Event('input'));
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
  }, function(err) {
    if (err) {
      console.error(err);
      showToast('Erro ao iniciar a câmera.', '❌');
      stopInlineScanner();
      return;
    }
    Quagga.start();
  });

  try { Quagga.offDetected(); } catch(e) {}

  Quagga.onDetected(function(result) {
    if (!inlineScannerActive) return;
    
    const code = result.codeResult.code;
    if (code) {
      if (_isScanCooldown(code)) return;
      inlineScannerActive = false;
      if (navigator.vibrate) navigator.vibrate([200]);
      
      document.getElementById('prodCode').value = code;
      document.getElementById('inlineScannerContainer').style.display = 'none';
      
      showToast('Código detectado: ' + code, '✅');
      document.getElementById('prodCode').dispatchEvent(new Event('input'));

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
    try { _inlineStreamTrack.stop(); } catch(e){}
    _inlineStreamTrack = null;
  }
  _inlineGoogleDetector = null;
  try { Quagga.offDetected(); } catch(e) {}
  try { if (typeof Quagga !== 'undefined') Quagga.stop(); } catch(e) {}
}

// ── NOTIFICATIONS ────────────────────────────────
async function scheduleNotifications() {
  const settings = Store.getSettings();
  if (!settings.notifications) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  
  const products = Store.getAllProducts();
  const urgent = products.filter(p => {
    const d = daysUntil(p.expDate);
    return d !== null && d >= 0 && d <= (settings.critDays || 3);
  });
  
  if (Notification.permission === 'granted' && urgent.length > 0) {
    try {
      const reg = await navigator.serviceWorker.ready;
      urgent.forEach(p => {
        const days = daysUntil(p.expDate);
        const timeText = days === 0 ? "vence hoje" : (days === 1 ? "vence amanhã" : `vence em ${days} dias`);
        
        reg.showNotification(`🚨 Seu ${p.name} ${timeText}!`, {
          body: `Coloque na frente da geladeira ou consuma logo.`,
          icon: 'https://cdn-icons-png.flaticon.com/512/6863/6863985.png',
          badge: 'https://cdn-icons-png.flaticon.com/512/6863/6863985.png',
          vibrate: [300, 100, 300, 100, 300],
          tag: 'alert-' + p.id,
          data: { productId: p.id },
          actions: [
            { action: 'consume', title: '✅ Já consumi' },
            { action: 'discard', title: '🗑 Descartar' }
          ]
        });
      });
    } catch (err) {
      console.error("Erro ao mostrar notificação push:", err);
    }
  }
}

// ── EXPORT / IMPORT ──────────────────────────────
function exportData() {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    products: Store.getAllProducts(),
    categories: Store.getCategories(),
    settings: Store.getSettings(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `prazocerto-backup-${today()}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Dados exportados (JSON)', '⬇');
}

function exportCSV() {
  const products = Store.getAllProducts();
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
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `prazocerto-${today()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`${products.length} produto(s) exportados (CSV)`, '📊');
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
              return `${y.padStart(4,'20')}-${m.padStart(2,'0')}-${d2.padStart(2,'0')}`;
            }
          }
          const d = new Date(v);
          if (!isNaN(d)) return d.toISOString().split('T')[0];
        }
        if (typeof v === 'number') {
          const date = XLSX.SSF.parse_date_code(v);
          if (date) return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
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
      if (!data.products) throw new Error('Arquivo inválido');
      if (!await confirm('Importar dados', 'Isso substituirá todos os dados atuais. Continuar?')) return;
      if (data.products)   Store.setProducts(data.products);
      if (data.categories) Store.setCategories(data.categories);
      if (data.settings)   Store.setSettings(data.settings);
      renderDashboard();
      renderProducts();
      showToast('Dados importados com sucesso', '⬆');
    } catch (err) {
      showToast('Erro ao importar: arquivo inválido', '❌');
    }
  };
  reader.readAsText(file);
}

// ── SETTINGS ─────────────────────────────────────
function loadSettings() {
  const s = Store.getSettings();
  const warnEl = document.getElementById('warnDays');
  const critEl = document.getElementById('critDays');
  const notifEl = document.getElementById('notifToggle');
  const themeEl = document.getElementById('themeSelect');
  const animEl  = document.getElementById('animToggle');
  if (warnEl)  warnEl.value   = s.warnDays ?? 7;
  if (critEl)  critEl.value   = s.critDays ?? 3;
  if (notifEl) notifEl.checked = s.notifications ?? false;
  if (themeEl) themeEl.value  = s.theme ?? 'dark';
  if (animEl)  animEl.checked = s.animations ?? true;
  applyTheme(s.theme);
}

function applyTheme(theme) {
  document.body.classList.remove('theme-purple','theme-green','theme-darker','theme-light');
  if (theme === 'purple') document.body.classList.add('theme-purple');
  if (theme === 'green')  document.body.classList.add('theme-green');
  if (theme === 'darker') document.body.classList.add('theme-darker');
  if (theme === 'light')  document.body.classList.add('theme-light');
}

function saveSettings() {
  const s = {
    warnDays:      parseInt(document.getElementById('warnDays')?.value) || 7,
    critDays:      parseInt(document.getElementById('critDays')?.value) || 3,
    notifications: document.getElementById('notifToggle')?.checked || false,
    theme:         document.getElementById('themeSelect')?.value || 'dark',
    animations:    document.getElementById('animToggle')?.checked ?? true,
  };
  Store.setSettings(s);
  applyTheme(s.theme);
  showToast('Configurações salvas', '✅');
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
            ['userAvatarImg','profileAvatarImg'].forEach(id => {
              const el = document.getElementById(id);
              if (el) el.src = compressed;
            });
            try { localStorage.setItem('cv_user_avatar', compressed); } catch(err) {}
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
            try { localStorage.setItem('cv_user_avatar', compressed); } catch(e) {}
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
          messaging.getToken({ serviceWorkerRegistration: reg }).then(token => {
            if (token) {
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
    
    // LOCATION FILTER
    window.currentLocationFilter = localStorage.getItem('cv_selected_store') || 'all';
    document.getElementById('globalLocationFilter')?.addEventListener('change', e => {
      window.currentLocationFilter = e.target.value;
      localStorage.setItem('cv_selected_store', e.target.value);
      if (typeof renderDashboard === 'function') renderDashboard();
      if (typeof renderProducts === 'function') renderProducts();
      if (typeof renderAlerts === 'function') renderAlerts();
      if (typeof updateBadges === 'function') updateBadges();
      if (typeof renderReports === 'function') renderReports();
      if (typeof renderHistory === 'function') renderHistory();
    });

    // Carrega produtos do localStorage para uso offline
    try { const s = JSON.parse(localStorage.getItem('cv_products') || '[]'); _remoteProducts = s; } catch(e) { _remoteProducts = []; }
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
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('sidebarClose').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });

  // ADD PRODUCT
  document.getElementById('addProductBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openAddModal();
  });
  document.getElementById('emptyAddBtn')?.addEventListener('click', () => openAddModal());
  document.getElementById('quickScanBtn')?.addEventListener('click', () => navigate('products'));
  document.getElementById('addStoreBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
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
    if (await confirm('Excluir Loja', `Deseja excluir a loja "${storeName}" da sua lista? (Os produtos não serão apagados)`)) {
      let stores = Store.getStores();
      stores = stores.filter(s => s !== storeName);
      Store.setStores(stores);
      populateStoreSelect('');
      updateLocationFilterOptions();
      showToast('Loja removida!', '🗑');
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

  // ALERTS FILTER
  document.querySelectorAll('[data-alert-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-alert-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAlerts(btn.dataset.alertFilter);
    });
  });

  // CLEAR EXPIRED
  document.getElementById('clearExpiredBtn')?.addEventListener('click', async () => {
    const settings = Store.getSettings();
    const expired = Store.getAllProducts().filter(p => daysUntil(p.expDate) < 0);
    if (!expired.length) { showToast('Nenhum produto vencido', 'ℹ️'); return; }
    if (await confirm('Remover vencidos', `Remover ${expired.length} produto(s) vencido(s)?`)) {
      Store.setProducts(Store.getAllProducts().filter(p => daysUntil(p.expDate) >= 0));
      renderAlerts();
      renderDashboard();
      showToast(`${expired.length} produto(s) removido(s)`, '🗑');
    }
  });

  // SCANNER
  document.getElementById('startScanBtn')?.addEventListener('click', startScanner);
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
  document.getElementById('notifToggle')?.addEventListener('change', e => {
    if (e.target.checked && Notification.permission !== 'granted') {
      Notification.requestPermission().then(perm => {
        if (perm !== 'granted') { e.target.checked = false; showToast('Permissão negada', '⚠️'); }
        else saveSettings();
      });
    } else saveSettings();
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
  document.getElementById('importExcelFile')?.addEventListener('change', e => { if (e.target.files[0]) { importExcel(e.target.files[0]); e.target.value=''; } });
  document.getElementById('importExcelAllFile')?.addEventListener('change', e => { if (e.target.files[0]) { importExcel(e.target.files[0]); e.target.value=''; } });

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
    item.addEventListener('click', () => {
      document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
      item.classList.add('active');
      navigate(item.dataset.page);
    });
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

  // Initial notifications check
  scheduleNotifications();

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
          
          // 1. Tenta no backend local se estiver rodando em localhost
          if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            try {
              const res = await fetch(`http://localhost:3000/api/produtos/${searchEan}`);
              if (res.ok) prod = await res.json();
            } catch(err) {}
          }
          
          // 2. Tenta no catálogo local e produtos cadastrados (com correspondência flexível)
          if (!prod) {
            const catalogProducts = Store.getCatalog() || [];
            const remoteProducts = Store.getAllProducts() || [];
            const allProds = [...catalogProducts, ...remoteProducts];
            prod = allProds.find(p => {
              const code = String(p.code || p.ean || p.id || '').trim();
              return code === searchEan || code.replace(/^0+/, '') === cleanSearch;
            });
          }

          // 3. Tenta no Firestore fichas_tecnicas
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
            } catch (err) {}
          }

          // 4. Fallback global: Open Food Facts API
          if (!prod) {
            try {
              const offRes = await fetch(`https://world.openfoodfacts.org/api/v0/product/${cleanSearch}.json`);
              if (offRes.ok) {
                const offData = await offRes.json();
                if (offData.status === 1 && offData.product) {
                  const p = offData.product;
                  prod = {
                    nome: p.product_name_pt || p.product_name || p.generic_name_pt || p.generic_name || '',
                    foto: p.image_front_url || p.image_url || ''
                  };
                }
              }
            } catch(e) {}
          }

          // *** GUARD CONTRA RACE CONDITION ***
          if (document.getElementById('prodCode').value.trim() !== searchEan) return;

          if (prod) {
            document.getElementById('prodName').value = prod.nome || prod.name || '';
            const fotoUrl = prod.foto ? (prod.foto.startsWith('http') ? prod.foto : `imagens/${prod.foto}`) : `imagens/${searchEan}.jpg`;
            document.getElementById('prodImage').src = fotoUrl;
            document.getElementById('prodImageContainer').style.display = 'flex';
            
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
            document.getElementById('prodName').value = '';
            document.getElementById('prodImageContainer').style.display = 'none';
            document.getElementById('prodNotFoundMsg').style.display = 'block';
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

async function renderCatalog() {
  const search = document.getElementById('catalogSearch')?.value.toLowerCase() || '';
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '<div class="empty-state"><h3>Carregando...</h3></div>';
  try {
    let produtos = _catalogProducts.length > 0 ? [..._catalogProducts] : [];
    if (!produtos.length) {
      const snapshot = await db.collection('fichas_tecnicas').get();
      snapshot.forEach(doc => produtos.push(doc.data()));
    }
    // Filter by brand (marca field or all Danone for now)
    if (_currentBrand) {
      const b = _currentBrand.toLowerCase();
      produtos = produtos.filter(p => { const m = (p.marca || p.brand || '').toLowerCase(); return m.includes(b) || (b === 'danone' && !m); });
    }
    if (search) {
      produtos = produtos.filter(p => (p.nome || p.name || '').toLowerCase().includes(search) || (p.ean || p.code || '').includes(search));
    }
    produtos.sort((a,b) => (a.nome || a.name || '').localeCompare(b.nome || b.name || ''));
    if (!produtos.length) {
      grid.innerHTML = '<div class="empty-state"><h3>Nenhum produto encontrado</h3></div>';
      return;
    }
    const uniqueProds = [];
    const seenEans = new Set();
    for (const p of produtos) {
      const e = p.ean || p.code;
      if (e && !seenEans.has(e)) { seenEans.add(e); uniqueProds.push(p); }
    }
    grid.innerHTML = uniqueProds.map(p => {
      const ean = p.ean || p.code;
      const barcodeSrc = `imagens/${ean}_barcode.jpg`;
      return `<div class="product-card" style="text-align:center; font-size:12px; padding:10px 8px; display:flex; flex-direction:column; justify-content:space-between; align-items:center;">
        <div style="width:100%;">
          <h4 style="font-size:0.8rem; font-weight:700; margin:0 0 4px 0; color:#F1F5F9; line-height:1.3; text-align:center;">${escHtml(p.nome || p.name)}</h4>
          <p style="color:#00E5FF; font-size:0.72rem; margin:0 0 6px 0; font-family:monospace; font-weight:600; letter-spacing:0.05em;">EAN: ${ean}</p>
        </div>
        <div style="background:#FFFFFF; border-radius:4px; padding:2px 4px; display:inline-block; max-width:100%; box-sizing:border-box; cursor:pointer;" onclick="openImgModal('imagens/${ean}_barcode.jpg')">
          <img src="${barcodeSrc}" onerror="this.src='https://bwipjs-api.metafloor.com/?bcid=ean13&text=${ean}&scale=2&includetext'; this.parentElement.onclick=()=>openImgModal(this.src);" style="max-width:100%; height:32px; object-fit:contain; display:block; margin:0 auto; background:white;">
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><h3>Erro ao carregar</h3></div>';
  }
}

function openImgModal(src) {
  const modal = document.getElementById('imgModal');
  document.getElementById('imgModalSrc').src = src;
  modal.style.display = 'flex';
}

document.getElementById('catalogSearch')?.addEventListener('input', () => {
  if (currentPage === 'catalog') renderCatalog();
});

function renderHistory() {
  const search = (document.getElementById('historySearch')?.value || '').toLowerCase();
  // Usa todos os produtos (não filtrado por loja), mas exibe a loja
  const allProds = Store.getAllProducts();
  const selectedLoc = window.currentLocationFilter || 'all';
  const cats = Store.getCategories();
  const container = document.getElementById('historyList');
  
  let list = allProds;
  // Filtra por loja se uma estiver selecionada
  if (selectedLoc !== 'all') {
    list = list.filter(p => (p.location || 'Sem Loja') === selectedLoc);
  }

  const filtered = list.filter(p => {
      if (!search) return true;
      const cat = cats.find(c => c.id === p.category);
      const catName = cat ? cat.name.toLowerCase() : '';
      return (p.name && p.name.toLowerCase().includes(search)) || 
             (p.code && p.code.toLowerCase().includes(search)) || 
             catName.includes(search) || 
             (p.addedAt && p.addedAt.includes(search)) ||
             (p.updatedAt && p.updatedAt.includes(search));
  }).sort((a,b) => new Date(b.updatedAt || b.addedAt || 0) - new Date(a.updatedAt || a.addedAt || 0));

  if (!filtered.length) {
    const msg = selectedLoc !== 'all' ? `Nenhum histórico para a loja "${selectedLoc}"` : 'Nenhum histórico encontrado';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📜</div><h3>${msg}</h3></div>`;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const cat = cats.find(c => c.id === p.category);
    const dtUpdated = p.updatedAt ? new Date(p.updatedAt).toLocaleString('pt-BR') : null;
    const dtAdded   = p.addedAt   ? new Date(p.addedAt).toLocaleString('pt-BR')   : 'Desconhecido';
    const lojaLabel = p.location ? `<span class="info-pill">📍 ${escHtml(p.location)}</span>` : '';
    const updLabel  = dtUpdated ? `<span class="info-pill" style="color:#F59E0B;">✏️ Alterado: ${dtUpdated}</span>` : '';
    return `<div class="alert-item" style="display:flex; gap:12px; align-items:flex-start; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">
      <div style="width:48px; height:48px; min-width:48px; background:#1e1e2d; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">
        ${cat ? cat.emoji : '📦'}
      </div>
      <div class="alert-info" style="flex:1; min-width:0;">
        <div class="alert-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(p.name)}</div>
        <div class="info-pills" style="margin-top:5px; flex-wrap:wrap;">
           <span class="info-pill">🏷️ ${cat ? cat.name : 'Sem categoria'}</span>
           ${lojaLabel}
           <span class="info-pill">📅 Val: ${formatDate(p.expDate)}</span>
           <span class="info-pill">🔢 Qtd: ${p.qty||1}</span>
           <span class="info-pill">🕒 Cadastrado: ${dtAdded}</span>
           ${updLabel}
        </div>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('historySearch')?.addEventListener('input', () => {
   if (currentPage === 'history') renderHistory();
});
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

document.addEventListener('change', function(e) {
  if (e.target.id === 'selectAllAlerts') {
    const checkboxes = document.querySelectorAll('.alert-checkbox');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
  }
});

document.addEventListener('click', function(e) {
  if (e.target.id === 'btnExportCSV') {
    const selected = getSelectedAlerts();
    if (!selected.length) return;
    const header = 'Nome,EAN,Quantidade,Vencimento,Dias Restantes';
    const rows = selected.map(p => {
      const days = daysUntil(p.expDate);
      return ['"' + (p.name||'') + '"', '"' + (p.code||'') + '"', p.qty||1, '"' + formatDate(p.expDate) + '"', days!==null?days:'N/A'].join(',');
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
    const data = selected.map(p => ({ 'Nome': p.name||'', 'EAN': p.code||'', 'Qtd': p.qty||1, 'Vencimento': formatDate(p.expDate) }));
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
    const tableData = selected.map(p => [p.name||'', p.code||'-', formatDate(p.expDate), String(p.qty||1)]);
    doc.autoTable({ startY: 30, head: [['Produto', 'EAN', 'Vencimento', 'Qtd']], body: tableData });
    doc.save('prazocerto_relatorio.pdf');
    showToast('PDF exportado!', 'success');
  }
  if (e.target.id === 'btnShareApp') {
    const selected = getSelectedAlerts();
    if (!selected.length) return;
    let text = 'PrazoCerto - Relatório de Validades\n\n';
    selected.forEach(p => {
      text += (p.name||'') + ' - Vence: ' + formatDate(p.expDate) + '\n';
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
(function() {
  var auth = firebase.auth();
  var googleProvider = new firebase.auth.GoogleAuthProvider();

  window.toggleAuthForm = function(formType) {
    var onboardingEl = document.getElementById('onboardingView');
    var authBoxEl = document.getElementById('authBox');

    if (formType === 'onboarding') {
      if (authBoxEl) authBoxEl.style.display = 'none';
      if (onboardingEl) onboardingEl.style.display = 'flex';
      return;
    }

    if (onboardingEl) onboardingEl.style.display = 'none';
    if (authBoxEl) authBoxEl.style.display = 'block';

    ['formLogin','formRegister','formForgot'].forEach(function(id) {
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
    if (el) el.style.display = show ? 'flex' : 'none';
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

  window.handleEmailLogin = function() {
    var email = document.getElementById('loginEmail').value.trim();
    var pass = document.getElementById('loginPassword').value;
    if (!email || !pass) { showAuthError('Preencha e-mail e senha!'); return; }
    var remember = document.getElementById('rememberMe')?.checked || false;
    // Salva preferência do checkbox
    localStorage.setItem('cv_remember', remember ? '1' : '0');
    // Define persistence: LOCAL (persiste entre sessões) ou SESSION (expira ao fechar o browser)
    var persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    showAuthLoading(true);
    auth.setPersistence(persistence).then(function() {
      return auth.signInWithEmailAndPassword(email, pass);
    }).catch(function(error) {
      showAuthLoading(false);
      showAuthError(translateAuthError(error.code, error.message));
    });
  };

  window.handleEmailRegister = function() {
    var name = document.getElementById('regName').value.trim();
    var email = document.getElementById('regEmail').value.trim();
    var pass = document.getElementById('regPassword').value;
    if (!name || !email || !pass) { showAuthError('Preencha todos os campos!'); return; }
    if (pass.length < 6) { showAuthError('A senha deve ter no mínimo 6 caracteres.'); return; }
    showAuthLoading(true);
    auth.createUserWithEmailAndPassword(email, pass).then(function(cred) {
      return cred.user.updateProfile({ displayName: name });
    }).then(function() {
      // onAuthStateChanged vai disparar e chamar bootApp automaticamente
    }).catch(function(error) {
      showAuthLoading(false);
      showAuthError(translateAuthError(error.code, error.message));
    });
  };

  window.handlePasswordReset = function() {
    var email = document.getElementById('forgotEmail').value.trim();
    if (!email) { showAuthError('Preencha o e-mail!'); return; }
    showAuthLoading(true);
    auth.sendPasswordResetEmail(email).then(function() {
      showAuthLoading(false);
      showAuthError('✅ Link enviado! Verifique sua caixa de entrada.', true);
      setTimeout(function() { window.toggleAuthForm('login'); }, 3000);
    }).catch(function(error) {
      showAuthLoading(false);
      showAuthError(translateAuthError(error.code, error.message));
    });
  };

  window.handleGoogleLogin = function() {
    showAuthLoading(true);
    auth.signInWithPopup(googleProvider).catch(function(error) {
      showAuthLoading(false);
      showAuthError(translateAuthError(error.code, error.message));
    });
  };

  window.handleLogout = function() {
    auth.signOut().then(function() { window.location.reload(); });
  };

  // Suporte a tecla Enter nos campos
  window.addEventListener('load', function() {
    var loginEmail = document.getElementById('loginEmail');
    var loginPass = document.getElementById('loginPassword');
    var forgotEmail = document.getElementById('forgotEmail');
    var regName = document.getElementById('regName');
    var regEmail = document.getElementById('regEmail');
    var regPass = document.getElementById('regPassword');

    function onEnter(fn) {
      return function(e) { if (e.key === 'Enter') fn(); };
    }
    if (loginEmail) loginEmail.addEventListener('keydown', onEnter(window.handleEmailLogin));
    if (loginPass) loginPass.addEventListener('keydown', onEnter(window.handleEmailLogin));
    if (forgotEmail) forgotEmail.addEventListener('keydown', onEnter(window.handlePasswordReset));
    if (regName) regName.addEventListener('keydown', onEnter(window.handleEmailRegister));
    if (regEmail) regEmail.addEventListener('keydown', onEnter(window.handleEmailRegister));
    if (regPass) regPass.addEventListener('keydown', onEnter(window.handleEmailRegister));
  });


// ── SINCRONIZAÇÃO DE PRODUTOS DO USUÁRIO COM FIRESTORE ────
function _syncProductsToFirestore(products) {
  if (!_currentUserId) return;
  // Salva lista completa como um único documento (simples e eficiente até ~1MB)
  db.collection('user_data').doc(_currentUserId).set({
    products: products,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(function(e) {
    console.warn('Erro ao sincronizar produtos:', e);
    if (typeof showToast === 'function') {
      showToast('Erro ao salvar na nuvem (limite de tamanho ou permissão).', '❌');
    }
  });
}

function _loadUserDataFromFirestore(uid, callback) {
  // Carrega dados do usuário uma única vez ao logar
  db.collection('user_data').doc(uid).get().then(function(doc) {
    if (doc.exists) {
      var data = doc.data();
      if (data.products && Array.isArray(data.products)) {
        _remoteProducts = data.products;
        try { localStorage.setItem('cv_products', JSON.stringify(data.products)); } catch(e) {}
      }
      // Carrega lojas se tiver salvo
      if (data.stores && Array.isArray(data.stores)) {
        try { localStorage.setItem('cv_stores', JSON.stringify(data.stores)); } catch(e) {}
      }
      // Carrega foto de perfil do usuário
      if (data.avatar) {
        try { localStorage.setItem('cv_user_avatar', data.avatar); } catch(e) {}
        var avatarImg = document.getElementById('userAvatarImg');
        if (avatarImg) avatarImg.src = data.avatar;
      }
    }
    if (callback) callback();
  }).catch(function(e) {
    console.warn('Erro ao carregar dados do usuário:', e);
    if (callback) callback();
  });
}

  window.bootApp = function(user) {
    var splash = document.getElementById('splash');
    if (splash && !splash.classList.contains('booting')) {
      splash.classList.add('booting');
      splash.classList.add('fade-out');
      // Carrega dados do Firestore antes de renderizar
      _loadUserDataFromFirestore(_currentUserId, function() {
        setTimeout(function() {
          splash.classList.add('hidden');
          splash.classList.remove('booting');
          document.getElementById('app').classList.remove('hidden');
          if (typeof loadSettings === 'function') loadSettings();
          if (typeof renderDashboard === 'function') renderDashboard();
          if (typeof updateBadges === 'function') updateBadges();
          if (typeof navigate === 'function') navigate('dashboard');
          if (typeof updateLocationFilterOptions === 'function') updateLocationFilterOptions();
          setTimeout(function() {
            db.collection('fichas_tecnicas').get().then(function(snapshot) {
              _catalogProducts = window._catalogProducts = snapshot.docs.map(function(doc) {
                var data = doc.data();
                return Object.assign({}, data, { id: data.ean || doc.id });
              });
              if (typeof updateBadges === 'function') updateBadges();
            }).catch(function(e) { console.error('Catalogo:', e); });
          }, 500);
        }, 350);
      });
    }
  };

  auth.onAuthStateChanged(function(user) {
    showAuthLoading(false);
    if (user) {
      _currentUserId = user.uid;
      var nameEl = document.querySelector('.user-name');
      var avatarEl = document.querySelector('.user-avatar');
      if (nameEl) nameEl.textContent = user.displayName || user.email.split('@')[0];
      if (avatarEl) {
        var label = (user.displayName || user.email).substring(0, 2).toUpperCase();
        avatarEl.textContent = label;
      }
      // Exibe email/nome na barra inferior mobile
      var sidebarEmailEl = document.getElementById('sidebarUserEmail');
      if (sidebarEmailEl) sidebarEmailEl.textContent = user.email || user.displayName || '';
      var bnavBar = document.getElementById('bnavUserBar');
      if (bnavBar) bnavBar.style.display = 'flex';
      window.bootApp(user);
    } else {
      _currentUserId = null;
      // Cancela listener em tempo real se ativo
      if (_firestoreUnsubscribe) { _firestoreUnsubscribe(); _firestoreUnsubscribe = null; }
      // Limpa dados locais da memória e do localStorage ao sair
      _remoteProducts = [];
      try {
        localStorage.removeItem('cv_products');
        localStorage.removeItem('cv_stores');
      } catch(e) {}
      if (localStorage.getItem('cv_remember') !== '1') {
        auth.signOut().catch(function(){});
      }
      var splash = document.getElementById('splash');
      var app = document.getElementById('app');
      if (splash) splash.classList.remove('hidden');
      if (app) app.classList.add('hidden');
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
  const nameEl = document.getElementById('shareProdName');
  const expEl = document.getElementById('shareProdExp');
  const qtyEl = document.getElementById('shareProdQty');
  const codeEl = document.getElementById('shareProdCode');
  const codeBox = document.getElementById('shareCodeBox');
  const imgContainer = document.getElementById('shareImgPreviewContainer');
  
  if (nameEl) nameEl.textContent = p.name;
  if (expEl) expEl.textContent = formatDate(p.expDate);
  if (qtyEl) qtyEl.textContent = p.qty || 1;
  if (codeEl) codeEl.textContent = p.code || '—';
  if (codeBox) codeBox.style.display = p.code ? 'block' : 'none';
  if (imgContainer) imgContainer.style.display = 'none';

  if (modal) modal.classList.remove('hidden');
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
    } catch(err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  }

  // Fallback: Clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('Texto copiado para a área de transferência!', '📋');
  } catch(e) {
    prompt('Copie o texto abaixo:', text);
  }
}

async function handleShareImage() {
  if (!currentShareProduct) return;
  const p = currentShareProduct;

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
  const words = p.name.split(' ');
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

  const dataUrl = canvas.toDataURL('image/png');

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `produto_${p.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: p.name,
          text: `Produto: ${p.name} | EAN: ${p.code||'N/A'} | Qtd: ${p.qty||1} | Val: ${formatDate(p.expDate)}`
        });
        showToast('Print compartilhado com sucesso!', '🖼️');
        return;
      } catch(err) {
        if (err.name !== 'AbortError') console.error(err);
      }
    }

    const imgPreview = document.getElementById('shareImgPreview');
    const btnDownload = document.getElementById('btnDownloadShareImg');
    const container = document.getElementById('shareImgPreviewContainer');
    if (imgPreview && btnDownload && container) {
      imgPreview.src = dataUrl;
      btnDownload.href = dataUrl;
      container.style.display = 'block';
    }
    showToast('Imagem gerada! Clique em Baixar para salvar.', '🖼️');
  }, 'image/png');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('shareClose')?.addEventListener('click', closeShareModal);
  document.getElementById('shareModal')?.addEventListener('click', e => { if (e.target.id === 'shareModal') closeShareModal(); });
  document.getElementById('btnShareText')?.addEventListener('click', handleShareText);
  document.getElementById('btnShareImage')?.addEventListener('click', handleShareImage);
});

