import express from "express";
import cors from "cors";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import qrCodeTerminal from "qrcode-terminal";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

type IRequest = {
  telefone: string;
  token: string;
};

const instancePath = path.join("./instance", "token-medico");

let sock: ReturnType<typeof makeWASocket> | null = null;
let isConnected = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(instancePath);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📲 Escaneie o QR Code abaixo para conectar:");
      qrCodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      isConnected = true;
      console.log("✅ Conectado ao WhatsApp!");
    }

    if (connection === "close") {
      isConnected = false;
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      console.log("❌ Conexão fechada!", lastDisconnect?.error);

      if (shouldReconnect) {
        console.log("🔄 Tentando reconectar...");
        startBot();
      } else {
        console.log("🚪 Sessão encerrada. Escaneie o QR Code novamente.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

app.post("/enviar", async (req, res) => {
  const { telefone, token } = req.body as IRequest;
  console.log(req.body);

  if (!sock || !isConnected) {
    return res
      .status(500)
      .json({ error: "WhatsApp não está conectado. Escaneie o QR Code." });
  }

  try {
    await sock.sendMessage(`${telefone}@s.whatsapp.net`, {
      text: `O seu token de acesso: ${token}`,
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err);
    return res.status(500).json({ error: "Falha ao enviar mensagem." });
  }
});

startBot();

app.listen(3333, () => {
  console.log("🚀 Server rodando na porta 3333!");
});
