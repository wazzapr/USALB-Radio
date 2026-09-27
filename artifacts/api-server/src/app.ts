import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleLiveIngestRequest, handleLiveStreamRequest } from "./lib/live-relay";

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

// The Windows Broadcaster uses one long-lived chunked POST. Handle this path
// before the normal /api router so Express never converts it into a generic
// 404/JSON request. The live relay performs token authentication and returns
// the HTTP 200 handshake itself.
app.use((req, res, next) => {
  if (handleLiveIngestRequest(req, res)) return;
  next();
});

// Serve the authenticated broadcaster's live MP3 relay before the API
// router so /api/radio-stream is handled by the same relay that receives
// /api/live/ws audio.
app.use((req, res, next) => {
  // One public stream path: the authenticated broadcaster feeds this relay,
  // and listeners receive the same encoded MP3 stream.
  if (handleLiveStreamRequest(req, res)) return;
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
