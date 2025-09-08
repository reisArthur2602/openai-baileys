import express from "express";
import cors from "cors";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrCodeTerminal from "qrcode-terminal";

const app = express();
app.use(cors());
app.use(express.json());

type IRequest = {
  telefone: string;
  token: string;
};

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const sock = makeWASocket({ auth: state });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { qr } = update;

    if (qr) {
      qrCodeTerminal.generate(qr, { small: true });
    }
  });

  app.post("/enviar", async (req, res) => {
    const { telefone, token } = req.body as IRequest;
    console.log(req.body)
    
    await sock.sendMessage(`${telefone}@s.whatsapp.net`, {
      text: `O seu token de acesso: ${token}`,
    });

    return res.sendStatus(200);
  });

  app.listen(3333, () => {
    console.log("🚀 Server rodando na porta 3333!");
  });
}

startBot();
