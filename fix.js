const fs = require('fs');
let html = fs.readFileSync('app.html', 'utf8');
const search = '<select id="sortProducts" class="select-styled">\n          <div class="empty-state">';
const replace = `<select id="sortProducts" class="select-styled">
              <option value="name">Nãome A-Z</option>
              <option value="expiry">Validade ↑</option>
              <option value="expiry-desc">Validade ↓</option>
              <option value="category">Categoria</option>
            </select>
            <div style="display:flex; gap:0.5rem; align-items:center;">
              <button class="btn-outline" id="exportCsvBtn">📊 CSV</button>
              <button class="btn-outline" id="importExcelBtn">📗 Excel</button>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
              <button class="btn-outline" id="exportBtn">⬇ JSON</button>
              <button class="btn-outline" id="importBtn">⬆ JSON</button>
            </div>
            <input type="file" id="importFile" accept=".json" style="display:none"/>
            <input type="file" id="importExcelFile" accept=".xlsx,.xls" style="display:none"/>
          </div>
        </div>
        <div class="products-grid" id="productsGrid">
          <div class="empty-state">`;
html = html.replace(search, replace);
fs.writeFileSync('app.html', html);
console.log('Fixed app.html');
