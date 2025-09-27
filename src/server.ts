import express from "express";
import cors from "cors";
import { pino } from "pino";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
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
    options: {
      colorize: true,
    },
  },
});

const app = express();
app.use(express.json());
app.use(cors());

let sock: WASocket | null = null;
let lastQr: string | null = null; // QR atual

type Doctor = {
  phone: string;
  state: "await_confirmation" | "idle";
  name: string;
  link: string;
};

const doctors = new Map<string, Doctor>();

const start = async (sessionId: string = "default") => {
  const { state, saveCreds } = await useMultiFileAuthState(`auth/${sessionId}`);

  const sockWa = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock = sockWa;

  sockWa.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQr = qr; // salva QR para a rota HTTP
      logger.info(
        `[PENDING] QR code gerado. Acesse http://<VPS_IP>:3334/qr para escanear`
      );
      qrCodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      logger.info(`[ONLINE] Sessão conectada com sucesso`);
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        logger.warn(`[${sessionId}] Sessão encerrada`);
        fs.rmSync(`auth/${sessionId}`, { recursive: true, force: true });
      }

      await start(sessionId);
    }
  });

  sockWa.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const phone = msg.key.remoteJid!;
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""
    )
      .toLowerCase()
      .trim();

    logger.info(`[RECEIVED] Mensagem recebida de ${phone} -> ${text}`);

    const currentDoctor = doctors.get(phone);
    if (!currentDoctor || currentDoctor.state !== "await_confirmation") return;

    logger.info(`[DOCTOR] Encontrado médico cadastrado: ${currentDoctor.name}`);

    if (text.includes("sim")) {
      await sockWa.sendMessage(phone, {
        text: `✅ Acesse o link abaixo para ter acesso ao seu sistema:\n${currentDoctor.link}`,
      });
      doctors.set(phone, { ...currentDoctor, state: "idle" });
    } else if (text.includes("nao")) {
      await sockWa.sendMessage(phone, {
        text: `❌ Pedimos desculpas pelo incômodo. Tenha um bom dia.`,
      });
      doctors.set(phone, { ...currentDoctor, state: "idle" });
    }
  });

  sockWa.ev.on("creds.update", saveCreds);
};

// ================== ROTAS ==================

// Rota para QR code
app.get("/qr", async (req, res) => {
  if (!lastQr) return res.status(404).send("QR ainda não gerado");
  res.setHeader("Content-Type", "image/png");
  QRCode.toFileStream(res, lastQr, { width: 300 });
});

// Enviar token
app.post("/enviar", async (req, res) => {
  try {
    const { telefone, token } = req.body as { telefone: string; token: string };
    if (!telefone || !token) {
      logger.error(
        `[SEND] Requisição inválida: telefone ou token não informado`
      );
      return res.status(400).json({
        status: "error",
        message: "Informe telefone e token no corpo da requisição",
      });
    }

    const jid = `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;

    if (!sock) {
      logger.error(`[SESSION] Nenhuma sessão ativa`);
      return res.status(503).json({
        status: "unavailable",
        message:
          "Sessão WhatsApp indisponível. Escaneie o QR code no console ou acesse /qr",
      });
    }

    await sock.sendMessage(jid, {
      text: `🔑 Olá! Seu token de acesso é: ${token}.\n\nUtilize este código para validar o acesso ao sistema.`,
    });

    logger.info(`[SEND] Mensagem enviada para ${jid}`);
    return res.status(200).json({
      status: "success",
      message: `Mensagem enviada com sucesso para +${telefone}`,
    });
  } catch (error) {
    logger.error(
      `[ERROR] Falha ao enviar mensagem -> ${(error as Error).message}`
    );
    return res.status(500).json({
      status: "error",
      message:
        "Não foi possível enviar a mensagem. Confirme sessão e número (DDI + DDD)",
    });
  }
});

// Cadastro de médico
app.post("/cadastro-medico", async (req, res) => {
  try {
    const { telefone, nome_medico, link } = req.body as {
      telefone: string;
      nome_medico: string;
      link: string;
    };
    if (!telefone || !nome_medico || !link) {
      logger.error(`[CADASTRO] Requisição inválida`);
      return res.status(400).json({
        status: "error",
        message:
          "Informe nome do médico, telefone e link no corpo da requisição",
      });
    }

    const jid = `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;

    if (!sock) {
      logger.error(`[SESSION] Nenhuma sessão ativa`);
      return res.status(503).json({
        status: "unavailable",
        message:
          "Sessão WhatsApp indisponível. Escaneie o QR code no console ou acesse /qr",
      });
    }

    await sock.sendMessage(jid, {
      text: `👨‍⚕️ Olá, ${nome_medico}! Digite "SIM" ou "NÃO" para confirmar sua identidade.`,
    });

    doctors.set(jid, {
      phone: jid,
      name: nome_medico,
      state: "await_confirmation",
      link,
    });
    logger.info(`[CADASTRO] Médico cadastrado e mensagem enviada para ${jid}`);

    return res.status(200).json({
      status: "success",
      message: `Cadastro realizado e mensagem enviada para +${telefone}`,
    });
  } catch (error) {
    logger.error(`[ERROR] Falha no cadastro -> ${(error as Error).message}`);
    return res.status(500).json({
      status: "error",
      message:
        "Não foi possível realizar o cadastro. Confirme sessão e número (DDI + DDD)",
    });
  }
});

// Inicialização do servidor
app.listen(3334, "0.0.0.0", async () => {
  logger.info("[BOOT] Servidor iniciado na porta 3334");
  await start("default");
});
