import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';

export function localRequest(req: IncomingMessage) {
  const ip = req.socket.remoteAddress;
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  let hostname = '';
  try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { return false; }
  return loopback && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
export function localOnly(req: Request, res: Response, next: NextFunction) {
  if (!localRequest(req)) return res.status(403).json({error: 'The library and editor are available only on the MacBook at localhost.'});
  next();
}
export function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}
