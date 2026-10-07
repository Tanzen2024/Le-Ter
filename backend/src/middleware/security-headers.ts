import type { NextFunction, Request, Response } from 'express';

/**
 * En-têtes de sécurité d'une API JSON consommée par l'application mobile (sans
 * dépendance). `no-store` est essentiel : les réponses contiennent la main privée du
 * joueur et des jetons, qu'aucun cache (proxy, navigateur) ne doit conserver.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
}
