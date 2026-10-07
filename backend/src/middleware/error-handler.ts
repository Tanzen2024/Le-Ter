import type { NextFunction, Request, Response } from 'express';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found' });
}

// Express reconnaît un gestionnaire d'erreurs à ses 4 paramètres.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
}
