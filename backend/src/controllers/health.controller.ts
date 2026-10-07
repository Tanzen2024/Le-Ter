import type { Request, Response } from 'express';

import { getDatabaseStatus } from '../config/database';

export function getHealth(_req: Request, res: Response): void {
  res.json({ status: 'ok', database: getDatabaseStatus() });
}
