const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// 1. Fix clearExpiredBtn
const search1 = `  // CLEAR EXPIRED
  document.getElementById('clearExpiredBtn')?.addEventListener('click', async () => {
    const settings = Store.getSettings();
    const expired = Store.getAllProducts().filter(p => daysUntil(p.expDate) < 0);
    if (!expired.length) { showToast('Nenhum produto vencido', 'ℹ️'); return; }
    if (await confirm('Remover vencidos', \`Remover \${expired.length} produto(s) vencido(s)?\`)) {
      Store.setProducts(Store.getAllProducts().filter(p => daysUntil(p.expDate) >= 0));
      renderAlerts();
      renderDashboard();
      showToast(\`\${expired.length} produto(s) removido(s)\`, '🗑');
    }
  });`;

const replace1 = `  // CLEAR EXPIRED
  document.getElementById('clearExpiredBtn')?.addEventListener('click', async () => {
    const expired = Store.getAllProducts().filter(p => daysUntil(p.expDate) < 0);
    if (!expired.length) { showToast('Nenhum produto vencido', 'ℹ️'); return; }
    
    let html = \`<div id="selModal" style="position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:999; display:flex; align-items:center; justify-content:center; padding:20px;">
      <div style="background:var(--bg-1); padding:20px; border-radius:10px; width:100%; max-width:400px; max-height:80vh; overflow-y:auto;">
        <h3 style="margin-bottom:10px">Remover Vencidos</h3><p style="margin-bottom:15px; color:var(--text-2);">Selecione os produtos que deseja remover:</p>
        <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
          \${expired.map(p => \`<label style="display:flex; align-items:center; gap:10px; font-size:14px; cursor:pointer;"><input type="checkbox" class="exp-chk" value="\${p.id}" checked> \${p.name || 'Sem nome'} (venc: \${formatDate(p.expDate) || '?'})</label>\`).join('')}
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button class="btn-outline" onclick="document.getElementById('selModal').remove()">Cancelar</button>
          <button class="btn-primary" id="confirmRemVenc">Remover Selecionados</button>
        </div>
      </div>
    </div>\`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('confirmRemVenc').addEventListener('click', () => {
       const selectedIds = Array.from(document.querySelectorAll('.exp-chk:checked')).map(cb => cb.value);
       if(selectedIds.length === 0) { showToast('Nenhum selecionado', '⚠️'); document.getElementById('selModal').remove(); return; }
       Store.setProducts(Store.getAllProducts().filter(p => !selectedIds.includes(p.id)));
       renderAlerts(); renderDashboard(); showToast(\`\${selectedIds.length} produto(s) removido(s)\`, '✅');
       document.getElementById('selModal').remove();
    });
  });`;

// 2. Fix openAddModal event object issue
const search2 = `function openAddModal(prefillCode) {
  editingProduct = null;
  document.getElementById('modalTitle').textContent = 'Novo Produto';
  document.getElementById('prodName').value = '';
  document.getElementById('prodCode').value = prefillCode || '';`;
  
const replace2 = `function openAddModal(prefillCode) {
  try {
    editingProduct = null;
    document.getElementById('modalTitle').textContent = 'Novo Produto';
    document.getElementById('prodName').value = '';
    if(prefillCode && typeof prefillCode === 'object') prefillCode = '';
    document.getElementById('prodCode').value = prefillCode || '';`;

const search3 = `  setTimeout(() => document.getElementById('prodName').focus(), 100);
}`;
const replace3 = `  setTimeout(() => { try { document.getElementById('prodName').focus(); } catch(e){} }, 100);
  } catch (err) {
    console.error(err);
    alert('Erro ao abrir tela de cadastro: ' + err.message);
  }
}`;

code = code.replace(search1, replace1);
code = code.replace(search2, replace2);
code = code.replace(search3, replace3);
fs.writeFileSync('app.js', code);
console.log('Fixed app.js');
