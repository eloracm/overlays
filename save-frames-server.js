// save-frames-server.js
import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const framesDir = path.join(__dirname, "frames");

// Create frames folder if missing
if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);

// ✅ Enable CORS for all origins (or restrict to localhost:8000 if you prefer)
app.use(cors({ origin: "*" }));

// ✅ Parse raw binary data for image uploads
app.use(
    "/save-frame",
    express.raw({
        type: "image/png",
        limit: "10mb",
    })
);

app.post("/save-frame", (req, res) => {
    const f = req.query.f;
    const filename = path.join(framesDir, `frame_${f}.png`);

    if (!req.body || !req.body.length) {
        console.error(`❌ No data received for frame ${f}`);
        return res.status(400).send("No data received");
    }

    try {
        fs.writeFileSync(filename, req.body);
        console.log(`✅ Saved ${filename}`);
        res.setHeader("Access-Control-Allow-Origin", "*"); // CORS header for this response
        res.send("ok");
    } catch (err) {
        console.error(`❌ Error saving frame ${f}:`, err);
        res.status(500).send("Write error");
    }
});

app.get("/", (req, res) => {
    res.send("Frame capture server running ✅");
});

app.listen(8080, () => console.log("✅ Listening on http://localhost:8080"));
