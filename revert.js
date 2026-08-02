const fs = require('fs');
let html = fs.readFileSync('app.html', 'utf8');

const searchHtml = `<div style="display:flex; gap:0.5rem; align-items:center;">
              <button class="btn-outline" id="exportCsvBtn">📊 CSV</button>
              <button class="btn-outline" id="importExcelBtn">📗 Excel</button>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
              <button class="btn-outline" id="exportBtn">⬇ JSON</button>
              <button class="btn-outline" id="importBtn">⬆ JSON</button>
            </div>`;
const replaceHtml = `<button class="btn-outline" id="exportBtn">⬇ JSON</button>
            <button class="btn-outline" id="exportCsvBtn">📊 CSV</button>
            <button class="btn-outline" id="importBtn">⬆ JSON</button>
            <button class="btn-outline" id="importExcelBtn">📗 Excel</button>`;
html = html.replace(searchHtml, replaceHtml);
fs.writeFileSync('app.html', html);

let js = fs.readFileSync('app.js', 'utf8');
const searchJs1 = `  // CLEAR EXPIRED
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

const replaceJs1 = `  // CLEAR EXPIRED
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

js = js.replace(searchJs1, replaceJs1);
fs.writeFileSync('app.js', js);
console.log('Reverted all.');
