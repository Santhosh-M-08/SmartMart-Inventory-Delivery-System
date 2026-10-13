/* SmartMart — OPTIONAL inventory REST API (not needed for the first review).
   Same product contract as the frontend: { id, name, category, price, stock }.
   Run:  cd backend && npm install && npm start   ->  http://localhost:3000/api/products */
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {            // allow the static frontend to call the API during development
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const SAMPLE = [
  { id: 1, name: 'Sona Masoori Rice 5kg', category: 'Grains', price: 320, stock: 40 },
  { id: 2, name: 'Fresh Toned Milk 500ml', category: 'Dairy', price: 28, stock: 8 },
  { id: 3, name: 'Sunflower Oil 1L', category: 'Oils', price: 135, stock: 6 }
];

function readProducts() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (err) { writeProducts(SAMPLE); return SAMPLE.slice(); }
}
function writeProducts(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function clean(body) {
  return {
    name: String(body.name ?? '').trim().replace(/\s+/g, ' '),
    category: String(body.category ?? '').trim().replace(/\s+/g, ' '),
    price: Number(body.price),
    stock: Number(body.stock)
  };
}
function validate(d) {
  const e = {};
  if (d.name.length < 2 || d.name.length > 60) e.name = 'Name must be 2–60 characters.';
  if (!d.category) e.category = 'Category is required.';
  if (!Number.isFinite(d.price) || d.price <= 0) e.price = 'Price must be greater than 0.';
  if (!Number.isInteger(d.stock) || d.stock < 0) e.stock = 'Stock must be a whole number, 0 or more.';
  return e;
}
const isDup = (list, d, ignoreId) => list.some(p => p.id !== ignoreId &&
  p.name.toLowerCase() === d.name.toLowerCase() && p.category.toLowerCase() === d.category.toLowerCase());

app.get('/api/products', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const category = String(req.query.category || '');
  res.json(readProducts().filter(p => (!q || p.name.toLowerCase().includes(q)) && (!category || p.category === category)));
});

app.post('/api/products', (req, res) => {
  const list = readProducts(), d = clean(req.body), errors = validate(d);
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  if (isDup(list, d)) return res.status(409).json({ errors: { name: 'Product already exists in that category.' } });
  const product = { id: list.reduce((m, p) => Math.max(m, p.id), 0) + 1, ...d };
  list.push(product); writeProducts(list);
  res.status(201).json(product);
});

app.put('/api/products/:id', (req, res) => {
  const list = readProducts(), id = Number(req.params.id), p = list.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const d = clean(req.body), errors = validate(d);
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  if (isDup(list, d, id)) return res.status(409).json({ errors: { name: 'Product already exists in that category.' } });
  Object.assign(p, d); writeProducts(list);
  res.json(p);
});

app.delete('/api/products/:id', (req, res) => {
  const list = readProducts(), id = Number(req.params.id);
  if (!list.some(x => x.id === id)) return res.status(404).json({ error: 'Product not found.' });
  writeProducts(list.filter(x => x.id !== id));
  res.sendStatus(204);
});

app.listen(PORT, () => console.log(`SmartMart API running on http://localhost:${PORT}`));