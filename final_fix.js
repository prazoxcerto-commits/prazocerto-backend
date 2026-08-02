const fs = require('fs');

// 1. Fix app.html (remove JSON/CSV/Excel buttons)
let html = fs.readFileSync('app.html', 'utf8');
const searchHtml = `<button class="btn-outline" id="exportBtn">⬇ JSON</button>
            <button class="btn-outline" id="exportCsvBtn">📊 CSV</button>
            <button class="btn-outline" id="importBtn">⬆ JSON</button>
            <button class="btn-outline" id="importExcelBtn">📗 Excel</button>`;
html = html.replace(searchHtml, '');
fs.writeFileSync('app.html', html);

// 2. Fix app.js (optional chaining for prodNotes, and revert scanner auto-start)
let js = fs.readFileSync('app.js', 'utf8');

// A. Fix openAddModal
const searchJs1 = `document.getElementById('prodLocation').value = (currentLoc && currentLoc !== 'all') ? currentLoc : '';
  document.getElementById('prodNotes').value = '';
  document.getElementById('expiryPreview').classList.add('hidden');`;
const replaceJs1 = `document.getElementById('prodLocation').value = (currentLoc && currentLoc !== 'all') ? currentLoc : '';
  const prodNotes = document.getElementById('prodNotes');
  if(prodNotes) prodNotes.value = '';
  document.getElementById('expiryPreview').classList.add('hidden');`;
js = js.replace(searchJs1, replaceJs1);

// B. Fix openEditModal
const searchJs2 = `document.getElementById('prodLocation').value = p.location || '';
  document.getElementById('prodNotes').value    = p.notes || '';
  document.getElementById('expiryPreview').classList.add('hidden');`;
const replaceJs2 = `document.getElementById('prodLocation').value = p.location || '';
  const prodNotes = document.getElementById('prodNotes');
  if(prodNotes) prodNotes.value = p.notes || '';
  document.getElementById('expiryPreview').classList.add('hidden');`;
js = js.replace(searchJs2, replaceJs2);

// C. Revert Scanner start on navigate
// I see in navigate(): if (page === 'scanner') startScanner(); else if (scannerActive) try { stopScanner(); } catch(e){}
const searchJs3 = `  if (page === 'reports')   renderReports();
  if (page === 'scanner')   startScanner();
  else if (scannerActive)   try { stopScanner(); } catch(e){}
  if (page === 'catalog')   if(typeof renderCatalog === 'function') renderCatalog();`;
const replaceJs3 = `  if (page === 'reports')   renderReports();
  if (scannerActive)   try { stopScanner(); } catch(e){}
  if (page === 'catalog')   if(typeof renderCatalog === 'function') renderCatalog();`;
js = js.replace(searchJs3, replaceJs3);

fs.writeFileSync('app.js', js);

// 3. Fix style.css (move sidebar user profile up)
let css = fs.readFileSync('style.css', 'utf8');
const searchCss = `.sidebar-footer {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
}`;
const replaceCss = `.sidebar-footer {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
  padding-bottom: 3rem; /* Movido para cima */
}`;
css = css.replace(searchCss, replaceCss);
fs.writeFileSync('style.css', css);

console.log('Final fixes applied successfully.');
