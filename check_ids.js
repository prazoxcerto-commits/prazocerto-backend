const fs = require('fs');
const lines = fs.readFileSync('app.html', 'utf8').split('\n');
const ids = ['modalTitle', 'prodName', 'prodCode', 'prodExpDate', 'prodMfgDate', 'prodQty', 'prodLocation', 'prodNotes', 'prodCategory'];
ids.forEach(id => {
  const found = lines.some(l => l.includes('id="' + id + '"'));
  console.log(id + ': ' + found);
});
