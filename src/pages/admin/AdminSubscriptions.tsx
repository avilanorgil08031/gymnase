import { useEffect, useState } from "react";
import { subscriptionsApi } from "../../services/api";
import { Check, X, RefreshCw, Plus } from "lucide-react";
import { useConfirm, Select } from "../../components/ui";

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
const STATUS_OPTIONS = [{ value: "", label: "Tous statuts" }, { value: "ACTIVE", label: "Actif" }, { value: "PENDING", label: "En attente" }, { value: "EXPIRED", label: "Expire" }, { value: "CANCELLED", label: "Annule" }];
const PAY_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "WAVE", label: "Wave" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
  { value: "MTN_MONEY", label: "MTN Money" },
  { value: "CARD", label: "Carte" },
  { value: "BANK_TRANSFER", label: "Virement bancaire" },
];

export function AdminSubscriptions() {
  const [subs, setSubs] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const { confirm, dialog } = useConfirm();

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ user_id: "", plan_id: "", payment_method: "CASH", auto_activate: false });

  useEffect(() => { load(); }, []);
  const load = (page = 1) => {
    subscriptionsApi.getAll({ page, status: filterStatus || undefined }).then(({ data }) => {
      setSubs(data.data); setPagination(data.pagination); setLoading(false);
    }).catch(() => setLoading(false));
  };

  const handleCreate = async () => {
    if (!createForm.user_id || !createForm.plan_id) { setMsg({ type: "error", text: "ID membre et plan requis" }); return; }
    try {
      await subscriptionsApi.create({ user_id: Number(createForm.user_id), plan_id: Number(createForm.plan_id), payment_method: createForm.payment_method, auto_activate: createForm.auto_activate });
      setMsg({ type: "success", text: "Abonnement cree" }); setShowCreate(false);
      setCreateForm({ user_id: "", plan_id: "", payment_method: "CASH", auto_activate: false }); load();
    } catch (err: any) { setMsg({ type: "error", text: err.response?.data?.message || "Erreur" }); }
  };

  const handleAction = (action: string, id: number, label: string) => {
    const configs: Record<string, { msg: string; variant: "success" | "warning" | "danger"; label: string }> = {
      activate: { msg: `Activer l'abonnement "${label}" ?`, variant: "success", label: "Activer" },
      cancel: { msg: `Annuler l'abonnement "${label}" ?`, variant: "danger", label: "Annuler" },
      renew: { msg: `Renouveler l'abonnement "${label}" ?`, variant: "success", label: "Renouveler" },
    };
    const c = configs[action];
    if (!c) return;
    confirm(c.msg, async () => {
      try {
        if (action === "activate") await subscriptionsApi.activate(id);
        else if (action === "cancel") await subscriptionsApi.cancel(id);
        else if (action === "renew") await subscriptionsApi.renew(id);
        setMsg({ type: "success", text: "Action effectuee" }); load(pagination.page);
      } catch (err: any) { setMsg({ type: "error", text: err.response?.data?.message || "Erreur" }); }
    }, { title: c.label, variant: c.variant, confirmLabel: c.label });
  };

  if (loading) return <div className="text-center py-10 text-zinc-400">Chargement...</div>;

  return (
    <div>
      {dialog}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Abonnements</h1>
        <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-4 py-2 rounded-lg text-sm">
          <Plus size={16} /> Creer un abonnement
        </button>
      </div>

      {msg.text && <div className={`rounded-xl p-3 mb-4 text-sm ${msg.type === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{msg.text}</div>}

      {/* Formulaire creation */}
      {showCreate && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4">Nouvel abonnement</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-zinc-400 mb-1">ID membre *</label>
              <input value={createForm.user_id} onChange={(e) => setCreateForm({ ...createForm, user_id: e.target.value })} placeholder="ID"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">ID plan *</label>
              <input value={createForm.plan_id} onChange={(e) => setCreateForm({ ...createForm, plan_id: e.target.value })} placeholder="ID du plan"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">Methode paiement</label>
              <Select value={createForm.payment_method} onChange={(v) => setCreateForm({ ...createForm, payment_method: v })} options={PAY_OPTIONS} /></div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={createForm.auto_activate} onChange={(e) => setCreateForm({ ...createForm, auto_activate: e.target.checked })} />
                Activer immediatement
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleCreate} className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-5 py-2.5 rounded-lg text-sm">Creer</button>
            <button onClick={() => setShowCreate(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-5 py-2.5 rounded-lg text-sm">Annuler</button>
          </div>
        </div>
      )}

      {/* Filtre */}
      <div className="mb-4 flex gap-3 items-center">
        <Select value={filterStatus} onChange={(v) => { setFilterStatus(v); }} options={STATUS_OPTIONS} placeholder="Tous statuts" />
        <button onClick={() => load(1)} className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-4 py-2 rounded-lg text-sm">Filtrer</button>
      </div>

      {/* Liste */}
      {subs.length === 0 ? <div className="text-center py-10 text-zinc-500">Aucun abonnement</div> : (
        <div className="space-y-3">
          {subs.map((s) => (
            <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-bold">{s.user_name}</div>
                <div className="text-sm text-zinc-400">{s.plan_name} &middot; {fmt(Number(s.plan_price))} &middot; {s.duration_days}j</div>
                <div className="text-xs text-zinc-500">{new Date(s.start_date).toLocaleDateString("fr-FR")} → {new Date(s.end_date).toLocaleDateString("fr-FR")}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "ACTIVE" ? "bg-green-500/10 text-green-400" : s.status === "PENDING" ? "bg-amber-400/10 text-amber-400" : s.status === "EXPIRED" ? "bg-red-500/10 text-red-400" : "bg-zinc-800 text-zinc-400"}`}>{s.status}</span>
                {s.status === "PENDING" && <button onClick={() => handleAction("activate", s.id, s.plan_name)} className="p-1.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400"><Check size={14} /></button>}
                {(s.status === "ACTIVE" || s.status === "EXPIRED") && <button onClick={() => handleAction("renew", s.id, s.plan_name)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400"><RefreshCw size={14} /></button>}
                {s.status !== "CANCELLED" && <button onClick={() => handleAction("cancel", s.id, s.plan_name)} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"><X size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: pagination.totalPages }, (_, i) => (
            <button key={i} onClick={() => load(i + 1)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${pagination.page === i + 1 ? "bg-amber-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"}`}>{i + 1}</button>
          ))}
        </div>
      )}
    </div>
  );
}
