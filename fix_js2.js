const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const search = `function openAddModal(prefillCode) {
  editingProduct = null;
  document.getElementById('modalTitle').textContent = 'Novo Produto';
  document.getElementById('prodName').value = '';
  document.getElementById('prodCode').value = prefillCode || '';
  document.getElementById('prodExpDate').value = '';
  document.getElementById('prodMfgDate').value = '';
  document.getElementById('prodQty').value = 1;
  const currentLoc = document.getElementById('globalLocationFilter')?.value;
  document.getElementById('prodLocation').value = (currentLoc && currentLoc !== 'all') ? currentLoc : '';
  document.getElementById('prodNotes').value = '';
  document.getElementById('expiryPreview').classList.add('hidden');
  populateCategorySelect();
  populateStoreSelect(document.getElementById('globalLocationFilter')?.value === 'all' ? '' : document.getElementById('globalLocationFilter')?.value);
  document.getElementById('productModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('prodName').focus(), 100);
}`;

const replace = `function openAddModal(prefillCode) {
  try {
    editingProduct = null;
    document.getElementById('modalTitle').textContent = 'Novo Produto';
    document.getElementById('prodName').value = '';
    // Fix: If prefillCode is an event object (e.g., from a click handler), ignore it.
    if (prefillCode && typeof prefillCode === 'object') prefillCode = '';
    document.getElementById('prodCode').value = prefillCode || '';
    document.getElementById('prodExpDate').value = '';
    document.getElementById('prodMfgDate').value = '';
    document.getElementById('prodQty').value = 1;
    const currentLoc = document.getElementById('globalLocationFilter')?.value;
    document.getElementById('prodLocation').value = (currentLoc && currentLoc !== 'all') ? currentLoc : '';
    document.getElementById('prodNotes').value = '';
    
    const ep = document.getElementById('expiryPreview');
    if(ep) ep.classList.add('hidden');
    
    try { populateCategorySelect(); } catch(e) { console.error(e); }
    try { populateStoreSelect(currentLoc === 'all' ? '' : currentLoc); } catch(e) { console.error(e); }
    
    const modal = document.getElementById('productModal');
    if(modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    } else {
      alert('Modal não encontrado no HTML');
    }
    setTimeout(() => { try { document.getElementById('prodName').focus(); } catch(e){} }, 100);
  } catch (err) {
    console.error('Erro openAddModal:', err);
    alert('Erro openAddModal: ' + err.message);
  }
}`;

code = code.replace(search, replace);
fs.writeFileSync('app.js', code);
console.log('Failsafe applied to openAddModal');
