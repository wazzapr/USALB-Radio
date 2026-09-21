import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
