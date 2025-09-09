import express from "express";
import cors from "cors";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import qrCodeTerminal from "qrcode-terminal";
import fs from "fs";
import { pino } from "pino";

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
    },
  },
});

const app = express();
app.use(cors());
app.use(express.json());

let sock: WASocket | null = null;

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
      logger.info(
        `[PENDING] QR code gerado. Abra o WhatsApp e escaneie para conectar`
      );
      qrCodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      logger.info(`[ONLINE] Sessao conectada com sucesso`);
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        logger.warn(`[${sessionId}] Sessao encerrada pelo WhatsApp`);
        fs.rmSync(`auth/${sessionId}`, { recursive: true, force: true });
        await start("default");
      } else {
        logger.warn(`[${sessionId}] Restabelecendo conexAo...`);
        await start("default");
      }
    }
  });

  sockWa.ev.on("creds.update", saveCreds);
};

app.post("/enviar", async (req, res) => {
  try {
    const { telefone, token } = req.body as {
      telefone: string;
      token: string;
    };

    if (!telefone || !token) {
      logger.error(
        `[SEND] Requisicao invalida: telefone ou token nao informado`
      );
      return res.status(400).json({
        status: "error",
        message: "Informe telefone e token no corpo da requisicao",
      });
    }

    const jid = `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;

    if (!sock) {
      logger.error(
        `[SESSION] Nenhuma sessao ativa. Escaneie o QR code para conectar`
      );
      return res.status(503).json({
        status: "unavailable",
        message:
          "Sessao WhatsApp indisponivel. Escaneie o QR code no console do servidor",
      });
    }

    await sock.sendMessage(jid, {
      text: `Olá, seu token de acesso é: ${token}.\n \nUtilize este codigo para validar o acesso ao sistema.`,
    });

    logger.info(`[SEND] Mensagem enviada para ${jid}`);
    return res.status(200).json({
      status: "success",
      message: `Mensagem enviada com sucesso para +${telefone}`,
    });
  } catch (error) {
    logger.error(`[ERROR] Falha ao enviar mensagem`);
    return res.status(500).json({
      status: "error",
      message:
        "Nao foi possivel enviar a mensagem. Confirme sessao e numero (DDI + DDD)",
    });
  }
});

app.listen(3333, async () => {
  logger.info("[BOOT] Servidor iniciado na porta 3333");
  await start("default");
});
