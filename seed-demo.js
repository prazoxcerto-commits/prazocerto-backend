// ===================================================
// CONTROLVALD – Demo Data Seeder
// Abra controlvald/index.html e cole este código no
// console do navegador (F12) para popular com dados
// de exemplo baseados na sua planilha.
// ===================================================

(function seedDemoData() {
  const KEYS = {
    products: 'cv_products',
    categories: 'cv_categories',
  };

  const categories = [
    { id: 'cat-1', name: 'Alimentos',    emoji: '🥗', color: '#6EE7B7' },
    { id: 'cat-2', name: 'Laticínios',   emoji: '🥛', color: '#3B82F6' },
    { id: 'cat-3', name: 'Carnes',       emoji: '🥩', color: '#EF4444' },
    { id: 'cat-4', name: 'Higiene',      emoji: '🧴', color: '#A78BFA' },
    { id: 'cat-5', name: 'Medicamentos', emoji: '💊', color: '#F59E0B' },
    { id: 'cat-6', name: 'Limpeza',      emoji: '🧹', color: '#06B6D4' },
    { id: 'cat-7', name: 'Bebidas',      emoji: '🍷', color: '#EC4899' },
    { id: 'cat-8', name: 'Panificação',  emoji: '🍞', color: '#F97316' },
  ];

  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function daysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  const products = [
    { name: 'Leite Integral 1L',        code: '7891000100103', expDate: daysFromNow(2),  mfgDate: daysFromNow(-28), category: 'cat-2', qty: 6,  location: 'Geladeira A1' },
    { name: 'Queijo Mussarela 500g',     code: '7892840813875', expDate: daysFromNow(-1), mfgDate: daysFromNow(-15), category: 'cat-2', qty: 2,  location: 'Geladeira A2' },
    { name: 'Pão de Forma Integral',     code: '7896183002001', expDate: daysFromNow(5),  mfgDate: daysFromNow(-3),  category: 'cat-8', qty: 3,  location: 'Prateleira B1' },
    { name: 'Iogurte Natural 200g',      code: '7891025102008', expDate: daysFromNow(3),  mfgDate: daysFromNow(-7),  category: 'cat-2', qty: 12, location: 'Geladeira A1' },
    { name: 'Frango Congelado 1kg',      code: '7897534100016', expDate: daysFromNow(45), mfgDate: daysFromNow(-5),  category: 'cat-3', qty: 4,  location: 'Freezer C1' },
    { name: 'Arroz Agulhinha 5kg',       code: '7896006707528', expDate: daysFromNow(365),mfgDate: daysFromNow(-30), category: 'cat-1', qty: 10, location: 'Depósito D1' },
    { name: 'Feijão Preto 1kg',          code: '7896006704206', expDate: daysFromNow(300),mfgDate: daysFromNow(-20), category: 'cat-1', qty: 8,  location: 'Depósito D1' },
    { name: 'Shampoo Anticaspa 400ml',   code: '7891035000143', expDate: daysFromNow(180),mfgDate: daysFromNow(-60), category: 'cat-4', qty: 5,  location: 'Banheiro E1' },
    { name: 'Dipirona 500mg 20cp',       code: '7896004401301', expDate: daysFromNow(6),  mfgDate: daysFromNow(-720),category: 'cat-5', qty: 1,  location: 'Farmácia F1' },
    { name: 'Detergente Neutro 500ml',   code: '7896013400113', expDate: daysFromNow(730),mfgDate: daysFromNow(-10), category: 'cat-6', qty: 15, location: 'Cozinha G1' },
    { name: 'Suco de Laranja 1L',        code: '7894900011593', expDate: daysFromNow(10), mfgDate: daysFromNow(-20), category: 'cat-7', qty: 4,  location: 'Geladeira A3' },
    { name: 'Manteiga sem sal 200g',     code: '7891000230206', expDate: daysFromNow(60), mfgDate: daysFromNow(-30), category: 'cat-2', qty: 3,  location: 'Geladeira A2' },
    { name: 'Biscoito Cream Cracker',    code: '7896003740079', expDate: daysFromNow(-3), mfgDate: daysFromNow(-90), category: 'cat-1', qty: 2,  location: 'Prateleira B2' },
    { name: 'Café Torrado e Moído 500g', code: '7896224900011', expDate: daysFromNow(180),mfgDate: daysFromNow(-14), category: 'cat-1', qty: 6,  location: 'Depósito D2' },
    { name: 'Ovo Caipira (dz)',          code: '7891234560012', expDate: daysFromNow(7),  mfgDate: daysFromNow(-3),  category: 'cat-1', qty: 24, location: 'Geladeira A1' },
  ].map(p => ({ ...p, id: uid(), addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), notes: '' }));

  localStorage.setItem(KEYS.categories, JSON.stringify(categories));
  localStorage.setItem(KEYS.products, JSON.stringify(products));
  alert('✅ Dados de exemplo carregados! Atualize a página (F5).');
})();
