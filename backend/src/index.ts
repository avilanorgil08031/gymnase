import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Server } from "http";
import { env } from "./config/env.js";
import { pool, testConnection } from "./config/database.js";
import { sanitizeInputs } from "./middlewares/validate.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { startCronJobs, stopCronJobs } from "./services/cronJobs.js";
import routes from "./routes/index.js";

const app = express();
let server: Server | null = null;

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: env.nodeEnv === "production"
    ? env.frontendUrl
    : (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        const allowed = [
          env.frontendUrl,
          "http://localhost:5173",
          "http://127.0.0.1:5173",
        ];
        const isLocalNetwork = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):5173$/.test(origin);
        callback(null, allowed.includes(origin) || isLocalNetwork);
      },
  credentials: true,
}));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Trop de tentatives, reessayez dans 15 minutes" },
});
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: { error: "Trop de requetes" },
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api", apiLimiter);

// Body parsing
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Sanitize inputs (XSS protection)
app.use(sanitizeInputs);

// API Routes
app.use("/api", routes);

// Error handler
app.use(errorHandler);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route introuvable", error: "NOT_FOUND" });
});

async function start() {
  const dbOk = await testConnection();
  if (!dbOk) {
    console.error("[SERVER] Impossible de se connecter a MySQL.");
    console.error(`[SERVER] Host: ${env.db.host}:${env.db.port}, DB: ${env.db.name}, User: ${env.db.user}`);
    process.exit(1);
  }

  startCronJobs();

  server = app.listen(env.port, () => {
    console.log(`[SERVER] Elite Gym API running on port ${env.port} (${env.nodeEnv})`);
    console.log(`[SERVER] DB: ${env.db.name} @ ${env.db.host}:${env.db.port}`);
    console.log(`[SERVER] Frontend: ${env.frontendUrl}`);
  });
}

async function shutdown(signal: NodeJS.Signals) {
  console.log(`[SERVER] ${signal} recu, arret en cours...`);
  stopCronJobs();

  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) console.error("[SERVER] Erreur fermeture HTTP:", err);
      resolve();
    });
  });

  await pool.end();
  console.log("[SERVER] Arret termine");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  console.error("[SERVER] Erreur au demarrage:", err);
  process.exit(1);
});
