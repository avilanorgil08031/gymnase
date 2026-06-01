import { Request, Response } from "express";
import { z } from "zod";
import { query } from "../config/database.js";
import { success, error, paginated, ErrorCode } from "../utils/response.js";
import { logActivity } from "../services/activityLog.js";

const productSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().max(500).optional().nullable(),
  price: z.number().positive(),
  category: z.string().max(100).default("Accessoire"),
  stock_quantity: z.number().int().min(0).default(0),
  image_url: z.string().max(500).optional().nullable(),
  is_active: z.boolean().default(true),
});

const saleSchema = z.object({
  user_id: z.number().int().positive().optional().nullable(),
  payment_method: z.enum(["CASH", "WAVE", "ORANGE_MONEY", "MTN_MONEY", "CARD", "BANK_TRANSFER"]),
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1),
  notes: z.string().max(500).optional().nullable(),
});

// ── PRODUITS ───────────────────────────────────────────────────

export async function getProducts(req: Request, res: Response) {
  try {
    const activeOnly = req.query.active !== "false";
    const where = activeOnly ? "WHERE is_active = TRUE" : "";
    const products = await query<any[]>(`SELECT * FROM products ${where} ORDER BY category, name`);
    success(res, products);
  } catch (err) {
    console.error("[SHOP] getProducts error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

export async function createProduct(req: Request, res: Response) {
  try {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.errors.map((e) => e.message).join(", "), 400, ErrorCode.VALIDATION_ERROR);
      return;
    }
    const d = parsed.data;
    const result = await query<any>(
      "INSERT INTO products (name, description, price, category, stock_quantity, image_url, is_active) VALUES (?,?,?,?,?,?,?)",
      [d.name, d.description || null, d.price, d.category, d.stock_quantity, d.image_url || null, d.is_active]
    );
    await logActivity(req, { action: "CREATE", targetType: "SETTING", targetId: result.insertId, description: `Produit cree : ${d.name}` });
    success(res, { id: result.insertId, ...d }, 201, "Produit cree");
  } catch (err) {
    console.error("[SHOP] createProduct error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

export async function updateProduct(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const parsed = productSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.errors.map((e) => e.message).join(", "), 400, ErrorCode.VALIDATION_ERROR);
      return;
    }
    const d = parsed.data;
    const fields: string[] = [];
    const values: any[] = [];
    if (d.name !== undefined) { fields.push("name=?"); values.push(d.name); }
    if (d.description !== undefined) { fields.push("description=?"); values.push(d.description); }
    if (d.price !== undefined) { fields.push("price=?"); values.push(d.price); }
    if (d.category !== undefined) { fields.push("category=?"); values.push(d.category); }
    if (d.stock_quantity !== undefined) { fields.push("stock_quantity=?"); values.push(d.stock_quantity); }
    if (d.image_url !== undefined) { fields.push("image_url=?"); values.push(d.image_url); }
    if (d.is_active !== undefined) { fields.push("is_active=?"); values.push(d.is_active); }
    if (fields.length === 0) { error(res, "Rien a modifier"); return; }
    values.push(id);
    await query<any>(`UPDATE products SET ${fields.join(",")} WHERE id=?`, values);
    success(res, null, 200, "Produit modifie");
  } catch (err) {
    console.error("[SHOP] updateProduct error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

export async function deleteProduct(req: Request, res: Response) {
  try {
    await query<any>("UPDATE products SET is_active = FALSE WHERE id = ?", [req.params.id]);
    success(res, null, 200, "Produit desactive");
  } catch (err) {
    console.error("[SHOP] deleteProduct error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

// ── VENTES ─────────────────────────────────────────────────────

export async function createSale(req: Request, res: Response) {
  try {
    const parsed = saleSchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.errors.map((e) => e.message).join(", "), 400, ErrorCode.VALIDATION_ERROR);
      return;
    }

    const { user_id, payment_method, items, notes } = parsed.data;

    // Calculer le total et verifier le stock
    let totalAmount = 0;
    const resolvedItems: { product_id: number; quantity: number; unit_price: number; name: string }[] = [];

    for (const item of items) {
      const [product] = await query<any[]>("SELECT id, name, price, stock_quantity FROM products WHERE id = ? AND is_active = TRUE", [item.product_id]);
      if (!product) {
        error(res, `Produit #${item.product_id} introuvable`, 404, ErrorCode.NOT_FOUND);
        return;
      }
      if (product.stock_quantity < item.quantity) {
        error(res, `Stock insuffisant pour "${product.name}" (dispo: ${product.stock_quantity})`, 400, ErrorCode.VALIDATION_ERROR);
        return;
      }
      resolvedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price: Number(product.price), name: product.name });
      totalAmount += Number(product.price) * item.quantity;
    }

    // Creer la vente
    const saleResult = await query<any>(
      "INSERT INTO sales (user_id, total_amount, payment_method, status, notes) VALUES (?,?,?,'PAID',?)",
      [user_id || null, totalAmount, payment_method, notes || null]
    );

    // Creer les lignes + decrémenter stock
    for (const item of resolvedItems) {
      await query<any>(
        "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?,?,?,?)",
        [saleResult.insertId, item.product_id, item.quantity, item.unit_price]
      );
      await query<any>(
        "UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?",
        [item.quantity, item.product_id]
      );
    }

    await logActivity(req, { action: "CREATE", targetType: "PAYMENT", targetId: saleResult.insertId, description: `Vente boutique : ${totalAmount} FCFA (${resolvedItems.map((i) => i.name).join(", ")})` });

    success(res, {
      id: saleResult.insertId,
      total_amount: totalAmount,
      items: resolvedItems,
      payment_method,
    }, 201, "Vente enregistree");
  } catch (err) {
    console.error("[SHOP] createSale error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

export async function getSales(req: Request, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [cnt] = await query<any[]>("SELECT COUNT(*) as total FROM sales");

    const sales = await query<any[]>(
      `SELECT s.*, u.full_name as buyer_name
       FROM sales s LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
    );

    // Charger les items pour chaque vente
    for (const sale of sales) {
      sale.items = await query<any[]>(
        "SELECT si.*, p.name as product_name FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?",
        [sale.id]
      );
    }

    paginated(res, sales, cnt.total, page, limit);
  } catch (err) {
    console.error("[SHOP] getSales error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}

export async function getSaleStats(req: Request, res: Response) {
  try {
    const [today] = await query<any[]>("SELECT COALESCE(SUM(total_amount),0) as revenue, COUNT(*) as count FROM sales WHERE DATE(created_at) = CURDATE() AND status = 'PAID'");
    const [month] = await query<any[]>("SELECT COALESCE(SUM(total_amount),0) as revenue, COUNT(*) as count FROM sales WHERE MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE()) AND status = 'PAID'");
    const topProducts = await query<any[]>(
      `SELECT p.name, SUM(si.quantity) as total_sold, SUM(si.quantity * si.unit_price) as revenue
       FROM sale_items si JOIN products p ON p.id = si.product_id
       JOIN sales s ON s.id = si.sale_id AND s.status = 'PAID'
       GROUP BY p.id, p.name ORDER BY total_sold DESC LIMIT 5`
    );
    const lowStock = await query<any[]>("SELECT name, stock_quantity FROM products WHERE is_active = TRUE AND stock_quantity <= 5 ORDER BY stock_quantity ASC");

    success(res, {
      today: { revenue: Number(today.revenue), count: today.count },
      month: { revenue: Number(month.revenue), count: month.count },
      top_products: topProducts,
      low_stock: lowStock,
    });
  } catch (err) {
    console.error("[SHOP] getSaleStats error:", err);
    error(res, "Erreur serveur", 500, ErrorCode.INTERNAL_ERROR);
  }
}
