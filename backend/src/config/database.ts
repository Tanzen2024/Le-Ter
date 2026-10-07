import mongoose from 'mongoose';

export type DatabaseStatus = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

const STATES: Record<number, DatabaseStatus> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function getDatabaseStatus(): DatabaseStatus {
  return STATES[mongoose.connection.readyState] ?? 'disconnected';
}
