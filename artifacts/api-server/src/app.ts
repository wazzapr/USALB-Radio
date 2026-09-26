import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleLiveStreamRequest } from "./lib/live-relay";
import { handleLiquidsoapStreamRequest } from "./lib/liquidsoap";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the authenticated broadcaster's live MP3 relay before the API
// router so /api/radio-stream is handled by the same relay that receives
// /api/live/ws audio.
app.use((req, res, next) => {
  // The proven live MP3 relay is the primary public stream path.
  // Liquidsoap remains connected as the radio engine, but it must not be
  // allowed to block the broadcaster or make the public stream go offline.
  if (handleLiveStreamRequest(req, res)) return;
  if (handleLiquidsoapStreamRequest(req, res)) return;
  next();
});

// Buffer short audio POST bodies so the ingest route cannot lose request-body
// events while it performs broadcaster authentication against the database.
app.use(
  "/api/radio-ingest",
  express.raw({
    type: ["audio/*", "application/octet-stream"],
    limit: "10mb",
  }),
);

app.use("/api", router);
app.use((_req, res) => {
  res.status(404).json({ error: "API route not found" });
});

export default app;
