const fs = require('fs');

let html = fs.readFileSync('app.html', 'utf8');
const searchHtml = `<select id="filterCategory" class="select-styled">`;
const replaceHtml = `<div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:10px;">
              <button class="btn-outline" id="exportBtn">⬇ JSON</button>
              <button class="btn-outline" id="exportCsvBtn">📊 CSV</button>
              <button class="btn-outline" id="importBtn">⬆ JSON</button>
              <button class="btn-outline" id="importExcelBtn">📗 Excel</button>
              <input type="file" id="importFile" accept=".json" style="display:none"/>
              <input type="file" id="importExcelFile" accept=".xlsx,.xls" style="display:none"/>
            </div>
            <select id="filterCategory" class="select-styled">`;
if(!html.includes('id="exportBtn"')) {
  html = html.replace(searchHtml, replaceHtml);
}
fs.writeFileSync('app.html', html);
console.log('Restored buttons.');
