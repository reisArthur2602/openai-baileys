import express from "express";
import cors from "cors";
import { pino } from "pino";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrCodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import fs from "fs";

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

const app = express();
app.use(express.json());
app.use(cors());

let sock: WASocket | null = null;
let lastQr: string | null = null;
const AUTH_DIR = "auth_info_baileys";

const start = async (sessionId = "default") => {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sockWa = makeWASocket({
    version, // versão do WA Web
    auth: state, // credenciais
    printQRInTerminal: false, // não mostra automaticamente QR no terminal
    browser: ["Ubuntu", "Chrome", "22.04"], // identificador do navegador
    syncFullHistory: false, // evita baixar histórico antigo
    markOnlineOnConnect: false, // não marca online automaticamente
    emitOwnEvents: false, // não dispara eventos de mensagens enviadas pelo bot
    connectTimeoutMs: 60_000, // timeout para conexão
    defaultQueryTimeoutMs: 60_000, // timeout padrão para requisições internas
    logger, // logger customizado
  });

  sock = sockWa;

  sockWa.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQr = qr;
      logger.info("Novo QR gerado — escaneie para conectar.");
      qrCodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") logger.info("Conectado ao WhatsApp!");
    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        logger.warn("Sessao encerrada, limpando dados...");
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
      logger.warn("Reconectando...");
      await start(sessionId);
    }
  });

  sockWa.ev.on("creds.update", saveCreds);
};

// ================== ROTAS ==================

// QR Code atual
app.get("/qr", async (req, res) => {
  if (!lastQr) return res.status(404).send("QR ainda nao gerado");
  res.setHeader("Content-Type", "image/png");
  QRCode.toFileStream(res, lastQr, { width: 300 });
});

app.post("/enviar", async (req, res) => {
  try {
    const { telefone, token } = req.body;
    if (!telefone || !token)
      return res.status(400).json({
        status: "error",
        message: "Informe telefone e token no corpo da requisicao",
      });

    if (!sock)
      return res.status(503).json({
        status: "unavailable",
        message: "Sessão WhatsApp nao ativa. Escaneie o QR code.",
      });

    const jid = `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;
    
    await sock.sendMessage(jid, {
      text: `🔑 Olá! Seu token de acesso é: ${token}.\n\nUtilize este código para validar o acesso ao sistema.`,
    });

    logger.info(`📤 Mensagem enviada para ${jid}`);

    return res.status(200).json({ status: "success" });
  } catch (err) {
    logger.error(`Erro ao enviar mensagem: ${(err as Error).message}`);
    return res.status(500).json({ status: "error" });
  }
});

// Inicialização
app.listen(3334, "0.0.0.0", async () => {
  logger.info("🚀 Servidor iniciado na porta 3334");
  await start("default");
});
