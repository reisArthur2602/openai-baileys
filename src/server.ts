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

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map<string, WASocket>();

const start = async (sessionId: string = "default") => {
  const { state, saveCreds } = await useMultiFileAuthState(`auth/${sessionId}`);

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sessions.set(sessionId, sock);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.clear();
      console.log(`📲 [${sessionId}] Escaneie o QR Code abaixo para logar:`);
      qrCodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") console.log();

    if (connection === "close") {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        console.log(`⚠️ [${sessionId}] Sessão deslogada. Limpando arquivos...`);
        sessions.delete(sessionId);
        fs.rmSync(`auth/${sessionId}`, { recursive: true, force: true });
        await start("default");
      } else {
        console.log(`🔄 Reconectando sessão ${sessionId}...`);
        await start("default");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
};

app.post("/enviar", async (req, res) => {
  const { telefone, token } = req.body as {
    telefone: string;
    token: string;
  };

  if (!telefone || !token) {
    return res.status(400).json({
      status: "error",
      message: "É necessário informar o token e o telefone",
    });
  }

  const sessionId = "default";

  const sock = sessions.get(sessionId);

  if (!sock) {
    return res.status(500).json({
      status: "error",
      message: "Sessão não iniciada",
    });
  }

  await sock.sendMessage(`${telefone}@s.whatsapp.net`, {
    text: `O seu token de acesso: ${token}`,
  });

  return res.sendStatus(200);
});

app.listen(3333, async () => {
  console.log("🚀 Server rodando na porta 3333");
  await start("default");
});
