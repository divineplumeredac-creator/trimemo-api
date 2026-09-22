import crypto from "node:crypto";

const TTL_SECONDS = 12 * 60 * 60;

const ALLOWED_ORIGINS = [
  "https://trimemo-frontend.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function configureCors(req: any, res: any) {
  const origin = req.headers?.origin || "";

  const configuredOrigin =
    process.env.TRIMEMO_FRONTEND_ORIGIN?.trim() || "";

  const isAllowedOrigin =
    ALLOWED_ORIGINS.includes(origin) ||
    (configuredOrigin !== "" && origin === configuredOrigin);

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
}

function json(res: any, status: number, payload: unknown) {
  return res.status(status).json(payload);
}

function getSecret() {
  return (
    process.env.TRIMEMO_OWNER_AUTH_SECRET ||
    process.env.TRIMEMO_OWNER_PASSWORD ||
    ""
  );
}

function sign(input: string, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(input)
    .digest("base64url");
}

function createToken(email: string) {
  const secret = getSecret();

  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;

  const payload = Buffer.from(
    JSON.stringify({
      sub: email.toLowerCase(),
      role: "owner",
      exp,
    })
  ).toString("base64url");

  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token: string) {
  const secret = getSecret();

  const parts = token.split(".");

  if (parts.length !== 2 || !secret) {
    return null;
  }

  const [payload, signature] = parts;

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload, secret);

  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as {
      sub: string;
      role: string;
      exp: number;
    };

    if (
      data.role !== "owner" ||
      !data.sub ||
      !data.exp ||
      Date.now() / 1000 >= data.exp
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function getRequestBody(req: any) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
}

export default function handler(req: any, res: any) {
  configureCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
    });
  }

  const ownerEmail = (
    process.env.TRIMEMO_OWNER_EMAIL || ""
  )
    .trim()
    .toLowerCase();

  const ownerPassword =
    process.env.TRIMEMO_OWNER_PASSWORD || "";

  const secret = getSecret();

  if (!ownerEmail || !ownerPassword || !secret) {
    return json(res, 503, {
      ok: false,
      error: "OWNER_AUTH_NOT_CONFIGURED",
    });
  }

  const body = getRequestBody(req);

  const {
    action,
    email,
    password,
    token,
  } = body;

  if (action === "login") {
    const validEmail =
      typeof email === "string" &&
      email.trim().toLowerCase() === ownerEmail;

    const validPassword =
      typeof password === "string" &&
      password === ownerPassword;

    if (!validEmail || !validPassword) {
      return json(res, 401, {
        ok: false,
        error: "INVALID_CREDENTIALS",
      });
    }

    return json(res, 200, {
      ok: true,
      role: "owner",
      token: createToken(ownerEmail),
      expiresIn: TTL_SECONDS,
    });
  }

  if (action === "verify") {
    const data =
      typeof token === "string"
        ? verifyToken(token)
        : null;

    if (!data || data.sub !== ownerEmail) {
      return json(res, 401, {
        ok: false,
        error: "INVALID_SESSION",
      });
    }

    return json(res, 200, {
      ok: true,
      role: "owner",
      email: data.sub,
      exp: data.exp,
    });
  }

  return json(res, 400, {
    ok: false,
    error: "INVALID_ACTION",
  });
}
