import {
  withdrawalOperatorOfPhone,
  type WithdrawalOperator,
} from '../../domain/wallet/withdrawal';
import type { SqlExecutor } from '../../database/sql-client';

/** Retrait non final, avec le numéro d'inscription ACTUEL de son titulaire. */
export interface OpenWithdrawalRow {
  withdrawalId: string;
  status: 'CREATED' | 'PROCESSING';
  operator: WithdrawalOperator;
  phone: string;
}

/** Retrait dont l'opérateur enregistré n'est pas celui que D-163 déduirait aujourd'hui. */
export interface WithdrawalOperatorMismatch {
  withdrawalId: string;
  status: 'CREATED' | 'PROCESSING';
  storedOperator: WithdrawalOperator;
  /** Opérateur déduit du numéro, ou motif de refus (numéro non pris en charge…). */
  deduced: WithdrawalOperator | 'PHONE_UNSUPPORTED' | 'OPERATOR_NOT_ALLOWED';
}

/**
 * Retraits créés avant D-163 : l'opérateur était choisi par le client et reste celui utilisé
 * par les envois différés et les relectures (décision D-163, « Retraits existants »). Cette
 * vérification les compare à l'opérateur que le serveur déduit aujourd'hui du numéro
 * d'inscription. Elle ne modifie rien : un écart se traite par rapprochement administratif.
 */
export function findOperatorMismatches(rows: readonly OpenWithdrawalRow[]): WithdrawalOperatorMismatch[] {
  return rows.flatMap((row) => {
    const resolved = withdrawalOperatorOfPhone(row.phone);
    const deduced = resolved.ok ? resolved.operator : resolved.reason;
    return deduced === row.operator
      ? []
      : [{ withdrawalId: row.withdrawalId, status: row.status, storedOperator: row.operator, deduced }];
  });
}

/** Lecture seule : retraits CREATED / PROCESSING et numéro actuel de leur titulaire. */
export async function loadOpenWithdrawals(sql: SqlExecutor): Promise<OpenWithdrawalRow[]> {
  const { rows } = await sql.query<OpenWithdrawalRow>(
    `SELECT w.id AS "withdrawalId", w.status, w.operator, u.phone
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
      WHERE w.status IN ('CREATED', 'PROCESSING')
      ORDER BY w.created_at`,
  );
  return rows;
}
