import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { cbeRateMonitor, verifyCronSecret } from './server/cbeRateService';
import { authInviteService, AuthServiceError } from './server/authInviteService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function escapeCsvField(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function extractClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim().length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function sendAuthError(res: Response, err: unknown): void {
  if (err instanceof AuthServiceError) {
    res.status(err.httpStatus).json({ error: err.message, code: err.code });
    return;
  }
  const message = err instanceof Error ? err.message : 'Authentication service error.';
  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const secret = process.env.CBE_SYNC_SECRET?.trim() ?? '';
    res.json({
      ok: true,
      service: 'ZENORATI',
      cbeCronConfigured: secret.length >= 64,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/exchange-rate/cbe', (_req: Request, res: Response) => {
    res.json(cbeRateMonitor.getState());
  });

  app.post('/api/exchange-rate/cbe/refresh', async (_req: Request, res: Response) => {
    try {
      const state = await cbeRateMonitor.checkNow({ respectCooldown: true });
      res.json(state);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to refresh CBE exchange rate.';
      res.status(502).json({ error: message, state: cbeRateMonitor.getState() });
    }
  });

  app.post('/api/exchange-rate/cbe/cron', async (req: Request, res: Response) => {
    const expectedSecret = process.env.CBE_SYNC_SECRET;
    if (!expectedSecret || expectedSecret.trim().length < 64) {
      res.status(503).json({
        error: 'External cron secret (CBE_SYNC_SECRET) is not configured on this server.',
      });
      return;
    }

    const authHeader = req.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;
    const headerSecret =
      typeof req.headers['x-cbe-sync-secret'] === 'string'
        ? req.headers['x-cbe-sync-secret']
        : typeof req.headers['x-cron-secret'] === 'string'
        ? req.headers['x-cron-secret']
        : bearerToken;

    if (!verifyCronSecret(headerSecret, expectedSecret)) {
      res.status(401).json({ error: 'Unauthorized cron trigger.' });
      return;
    }

    try {
      const state = await cbeRateMonitor.checkNow({ respectCooldown: false });
      res.json(state);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Scheduled CBE synchronization failed.';
      res.status(502).json({ error: message, state: cbeRateMonitor.getState() });
    }
  });

  app.get('/api/exchange-rate/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const sendEvent = (state: ReturnType<typeof cbeRateMonitor.getState>) => {
      res.write(`event: rate_state\ndata: ${JSON.stringify(state)}\n\n`);
    };

    sendEvent(cbeRateMonitor.getState());
    const unsubscribe = cbeRateMonitor.subscribe(sendEvent);

    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  app.get('/api/auth/session', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication token is required.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const session = await authInviteService.getSessionInfo(token);
      res.json(session);
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  app.post('/api/auth/invitations/check', (req: Request, res: Response) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const result = authInviteService.checkInvitationPreAuth(code, extractClientIp(req));
      res.json(result);
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  app.post('/api/auth/invitations/verify-authenticated', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication token is required.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const result = await authInviteService.verifyInvitationAuthenticated({
        idToken: token,
        code,
        clientKey: extractClientIp(req),
      });
      res.json(result);
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  app.post('/api/auth/invitations/redeem', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication token is required.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName : undefined;
      const businessName =
        typeof req.body?.businessName === 'string' ? req.body.businessName : undefined;

      const result = await authInviteService.redeemInvitationAndCreateTenant({
        idToken: token,
        code,
        fullName,
        businessName,
        clientKey: extractClientIp(req),
      });
      res.json(result);
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  app.get('/api/admin/invitations', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication token is required.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const invitations = await authInviteService.listInvitations(token);
      res.json({ invitations });
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  app.post('/api/admin/invitations', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication token is required.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const maxUses = Number(req.body?.maxUses ?? 1);
      const expiresAtIso =
        typeof req.body?.expiresAtIso === 'string' ? req.body.expiresAtIso : '';
      const label = typeof req.body?.label === 'string' ? req.body.label : '';
      const created = await authInviteService.createInvitation({
        idToken: token,
        maxUses,
        expiresAtIso,
        label,
      });
      res.status(201).json(created);
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  app.post('/api/admin/invitations/:inviteId/revoke', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication token is required.', code: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const inviteId = String(req.params.inviteId ?? '');
      const invitation = await authInviteService.revokeInvitation(token, inviteId);
      res.json({ invitation });
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  app.post('/api/ai/analyze', async (req: Request, res: Response) => {
    try {
      const {
        question,
        language,
        businessName,
        currency,
        metrics,
        topProducts,
        lowStockProducts,
        expensesByCategory,
      } = req.body ?? {};
      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        res.status(400).json({ error: 'Please enter a business question to analyze.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is not configured. Add your key in Settings > Secrets to enable the AI Assistant.',
        });
        return;
      }

      const contextPayload = {
        businessName: typeof businessName === 'string' ? businessName : 'ZENORATI Store',
        currency: typeof currency === 'string' ? currency : 'USD',
        metrics: metrics ?? {},
        topProducts: Array.isArray(topProducts) ? topProducts.slice(0, 8) : [],
        lowStockProducts: Array.isArray(lowStockProducts) ? lowStockProducts.slice(0, 8) : [],
        expensesByCategory: Array.isArray(expensesByCategory) ? expensesByCategory : [],
      };

      const baseInstruction =
        'You are ZENORATI Business Analyst, a concise, numbers-driven ecommerce advisor. Answer strictly using the provided Business Data Snapshot. Never invent external data, fake integrations, or fabricated metrics. Highlight actionable insights on revenue, net profit margin, expenses, inventory risk, and SKU performance using crisp bullet points.';
      const systemInstruction =
        language === 'ar'
          ? `${baseInstruction} Respond in clear Modern Standard Arabic while preserving exact Western digits, percentages, SKU codes, and currency codes (such as EGP and USD).`
          : baseInstruction;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Business Data Snapshot:\n${JSON.stringify(contextPayload, null, 2)}\n\nMerchant Question:\n${question.trim()}`,
        config: {
          systemInstruction,
        },
      });

      res.json({ answer: response.text ?? 'No analysis returned.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate analysis.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/reports/csv', (req: Request, res: Response) => {
    try {
      const { type, rows } = req.body ?? {};
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: 'No records available to export.' });
        return;
      }

      const headers = Object.keys(rows[0] as Record<string, unknown>);
      const lines = [
        headers.map(escapeCsvField).join(','),
        ...rows.map((row: Record<string, unknown>) =>
          headers.map((h) => escapeCsvField(row[h])).join(',')
        ),
      ];

      const safeType = typeof type === 'string' ? type.replace(/[^a-z0-9_-]/gi, '') : 'export';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="zenorati-${safeType}.csv"`);
      res.send(lines.join('\n'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export CSV.';
      res.status(500).json({ error: message });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*splat', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ZENORATI server listening on http://0.0.0.0:${PORT}`);
    cbeRateMonitor.startScheduler();
  });
}

startServer().catch((err) => {
  console.error('Failed to start ZENORATI server:', err);
  process.exit(1);
});
