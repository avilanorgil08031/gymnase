import { useEffect, useState } from "react";
import { shopApi } from "../../services/api";
import { Plus, Edit2, Trash2, ShoppingBag } from "lucide-react";
import { useConfirm, Select } from "../../components/ui";

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
const PAY_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "WAVE", label: "Wave" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
  { value: "MTN_MONEY", label: "MTN Money" },
  { value: "CARD", label: "Carte" },
  { value: "BANK_TRANSFER", label: "Virement bancaire" },
];

export function AdminBoutique() {
  const [products, setProducts] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showSale, setShowSale] = useState(false);
  const [saleItems, setSaleItems] = useState<{ product_id: number; quantity: number }[]>([]);
  const [payMethod, setPayMethod] = useState("CASH");
  const [msg, setMsg] = useState({ type: "", text: "" });
  const { confirm, dialog } = useConfirm();

  useEffect(() => { load(); }, []);
  const load = () => {
    Promise.all([shopApi.getProducts(false), shopApi.getSaleStats()]).then(([pRes, sRes]) => {
      setProducts(pRes.data.data); setStats(sRes.data.data); setLoading(false);
    }).catch(() => setLoading(false));
  };

  const addToSale = (productId: number) => {
    const existing = saleItems.find((i) => i.product_id === productId);
    if (existing) setSaleItems(saleItems.map((i) => i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i));
    else setSaleItems([...saleItems, { product_id: productId, quantity: 1 }]);
    setShowSale(true);
  };

  const handleSale = async () => {
    if (saleItems.length === 0) return;
    try {
      await shopApi.createSale({ payment_method: payMethod, items: saleItems });
      setMsg({ type: "success", text: "Vente enregistree" });
      setSaleItems([]); setShowSale(false); load();
    } catch (err: any) { setMsg({ type: "error", text: err.response?.data?.message || "Erreur" }); }
  };

  const saleTotal = saleItems.reduce((sum, item) => {
    const p = products.find((pr) => pr.id === item.product_id);
    return sum + (p ? Number(p.price) * item.quantity : 0);
  }, 0);

  // Product form
  const [showProduct, setShowProduct] = useState(false);
  const [prodForm, setProdForm] = useState({ name: "", description: "", price: "", category: "Accessoire", stock_quantity: "0" });

  const handleCreateProduct = async () => {
    if (!prodForm.name || !prodForm.price) { setMsg({ type: "error", text: "Nom et prix requis" }); return; }
    try {
      await shopApi.createProduct({ name: prodForm.name, description: prodForm.description || null, price: Number(prodForm.price), category: prodForm.category, stock_quantity: Number(prodForm.stock_quantity) || 0 });
      setMsg({ type: "success", text: "Produit cree" }); setShowProduct(false);
      setProdForm({ name: "", description: "", price: "", category: "Accessoire", stock_quantity: "0" }); load();
    } catch (err: any) { setMsg({ type: "error", text: err.response?.data?.message || "Erreur" }); }
  };

  if (loading) return <div className="text-center py-10 text-zinc-400">Chargement...</div>;

  return (
    <div>
      {dialog}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Boutique</h1>
        <button onClick={() => setShowProduct(!showProduct)} className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-4 py-2 rounded-lg text-sm">
          <Plus size={16} /> Nouveau produit
        </button>
      </div>
      {msg.text && <div className={`rounded-xl p-3 mb-4 text-sm ${msg.type === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{msg.text}</div>}

      {/* Formulaire produit */}
      {showProduct && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4">Nouveau produit</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-zinc-400 mb-1">Nom *</label>
              <input value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} placeholder="Gourde sport"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Prix (FCFA) *</label>
              <input type="number" value={prodForm.price} onChange={(e) => setProdForm({ ...prodForm, price: e.target.value })} placeholder="5000"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Categorie</label>
              <input value={prodForm.category} onChange={(e) => setProdForm({ ...prodForm, category: e.target.value })} placeholder="Accessoire"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Stock initial</label>
              <input type="number" value={prodForm.stock_quantity} onChange={(e) => setProdForm({ ...prodForm, stock_quantity: e.target.value })} placeholder="50"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" /></div>
            <div className="sm:col-span-2"><label className="block text-xs text-zinc-400 mb-1">Description</label>
              <input value={prodForm.description} onChange={(e) => setProdForm({ ...prodForm, description: e.target.value })} placeholder="Description du produit"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" /></div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleCreateProduct} className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm">Creer</button>
            <button onClick={() => setShowProduct(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-5 py-2.5 rounded-lg text-sm">Annuler</button>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><div className="text-xs text-zinc-400">Ventes du jour</div><div className="text-xl font-black text-green-400">{fmt(stats.today.revenue)}</div></div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><div className="text-xs text-zinc-400">Ventes du mois</div><div className="text-xl font-black text-amber-400">{fmt(stats.month.revenue)}</div></div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><div className="text-xs text-zinc-400">Top produit</div><div className="text-sm font-bold">{stats.top_products[0]?.name || "—"}</div></div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><div className="text-xs text-zinc-400">Stock bas</div><div className="text-xl font-black text-red-400">{stats.low_stock.length}</div></div>
        </div>
      )}

      {/* Panier vente */}
      {showSale && saleItems.length > 0 && (
        <div className="bg-zinc-900 border border-amber-400/30 rounded-2xl p-5 mb-6">
          <h3 className="font-bold mb-3 flex items-center gap-2"><ShoppingBag size={18} className="text-amber-400" /> Nouvelle vente</h3>
          <div className="space-y-2 mb-3">
            {saleItems.map((item) => {
              const p = products.find((pr) => pr.id === item.product_id);
              return p ? (
                <div key={item.product_id} className="flex items-center justify-between text-sm">
                  <span>{p.name} x{item.quantity}</span>
                  <span className="font-bold">{fmt(Number(p.price) * item.quantity)}</span>
                </div>
              ) : null;
            })}
          </div>
          <div className="flex items-center justify-between border-t border-zinc-700 pt-3 mb-3">
            <span className="font-bold">Total</span><span className="text-xl font-black text-amber-400">{fmt(saleTotal)}</span>
          </div>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1">Methode</label>
              <Select value={payMethod} onChange={setPayMethod} options={PAY_OPTIONS} />
            </div>
            <button onClick={handleSale} className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm">Encaisser</button>
            <button onClick={() => { setSaleItems([]); setShowSale(false); }} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-lg text-sm">Annuler</button>
          </div>
        </div>
      )}

      {/* Produits */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((p) => (
          <div key={p.id} className={`bg-zinc-900 border rounded-2xl p-5 ${p.is_active ? "border-zinc-800" : "border-red-500/30 opacity-50"}`}>
            <div className="font-bold">{p.name}</div>
            <div className="text-xs text-zinc-500 mb-2">{p.category}</div>
            <div className="text-xl font-black text-amber-400 mb-1">{fmt(Number(p.price))}</div>
            <div className={`text-xs mb-3 ${Number(p.stock_quantity) <= 5 ? "text-red-400 font-bold" : "text-zinc-500"}`}>
              Stock : {p.stock_quantity}
            </div>
            {p.is_active && (
              <button onClick={() => addToSale(p.id)} className="w-full bg-zinc-800 hover:bg-amber-400 hover:text-zinc-950 font-medium py-2 rounded-lg text-sm transition">
                + Ajouter a la vente
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
