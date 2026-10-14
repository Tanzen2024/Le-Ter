import {
  DirectPaymentUnavailableError,
  PaymentInitializationUncertainError,
  PaymentProfileIncompleteError,
} from '../../../src/domain/payments/payment';
import type { PaymentRepository } from '../../../src/repositories/payment.repository';
import { CinetPayGateway } from '../../../src/services/payments/cinetpay/cinetpay.gateway';
import {
  CinetPayError,
  CinetPayPaymentNotSentError,
} from '../../../src/services/payments/cinetpay/cinetpay-client';
import { createLogger, silentLogger } from '../../../src/utils/logger';

/** Exigences CinetPay v1 sur le payeur (D-050) : prénom et nom de 2 à 255 caractères. */
function gateway() {
  const createPayment = jest.fn();
  const payments = { create: jest.fn() } as unknown as PaymentRepository;
  const instance = new CinetPayGateway({
    client: { createPayment },
    payments,
    logger: silentLogger,
    notifyUrl: 'https://api.test.local/api/payments/cinetpay/notify',
    returnUrl: 'https://api.test.local/api/payments/cinetpay/return',
  });
  return { instance, createPayment, payments };
}

const customer = (firstName: string, lastName: string, phone = '+237692130271') => ({
  firstName,
  lastName,
  email: 'player@test.local',
  phone,
});

describe('CinetPayGateway.assertCollectionEligible', () => {
  it.each([
    ['Al', 'Bo'],
    ['Awa', 'Ndiaye'],
    ['Éa', 'Ôb'],
    ['a'.repeat(255), 'b'.repeat(255)],
  ])('accepté : %p %p', (first, last) => {
    expect(() =>
      gateway().instance.assertCollectionEligible(customer(first!, last!)),
    ).not.toThrow();
  });

  it.each([
    ['A', 'Ndiaye', ['firstName']],
    ['Awa', 'N', ['lastName']],
    ['A', 'N', ['firstName', 'lastName']],
    [' A ', 'Ndiaye', ['firstName']],
    ['a'.repeat(256), 'Ndiaye', ['firstName']],
  ])('refusé : %p %p → %p', (first, last, fields) => {
    let error: unknown;
    try {
      gateway().instance.assertCollectionEligible(customer(first, last));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PaymentProfileIncompleteError);
    expect((error as PaymentProfileIncompleteError).fields).toEqual(fields);
  });

  it.each(['', '692130271', '+237', '+237 692130271', '00237692130271', '+2376921302711234567'])(
    'numéro d’inscription non transmissible %p → ["phone"] (D-088)',
    (phone) => {
      let error: unknown;
      try {
        gateway().instance.assertCollectionEligible(customer('Awa', 'Ndiaye', phone));
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(PaymentProfileIncompleteError);
      expect((error as PaymentProfileIncompleteError).fields).toEqual(['phone']);
    },
  );

  it.each(['+237692130271', '+33612345678', '+2250707070700'])(
    'numéro international %p accepté',
    (phone) => {
      expect(() =>
        gateway().instance.assertCollectionEligible(customer('Awa', 'Ndiaye', phone)),
      ).not.toThrow();
    },
  );

  it('requestCollection refuse aussi, sans écrire ni appeler CinetPay', async () => {
    const { instance, createPayment, payments } = gateway();
    await expect(
      instance.requestCollection({
        transactionId: '11111111-1111-4111-8111-111111111111',
        msisdn: '+237600000000',
        tokens: 500,
        customer: customer('A', 'Ndiaye'),
      }),
    ).rejects.toBeInstanceOf(PaymentProfileIncompleteError);
    expect(payments.create).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });
});

/**
 * Journal d'échec d'initialisation (D-094) : motif, durée, repli vers la page. Décisions
 * inchangées (D-090/D-091) : demande non envoyée → échec sans repli ; refus certain d'un
 * direct → repli possible ; issue inconnue d'un direct → incertain, sans repli.
 */
describe('CinetPayGateway — journal d’échec d’initialisation', () => {
  const PHONE = '+237670000001';

  function directGateway(createPayment: jest.Mock) {
    const lines: string[] = [];
    const payments = {
      create: jest.fn(),
      markInitializationFailed: jest.fn().mockResolvedValue(undefined),
      markInitializationUncertain: jest.fn().mockResolvedValue(undefined),
    } as unknown as PaymentRepository;
    const instance = new CinetPayGateway({
      client: { createPayment },
      payments,
      logger: createLogger({}, (line) => lines.push(line)),
      notifyUrl: 'https://api.test.local/api/payments/cinetpay/notify',
      returnUrl: 'https://api.test.local/api/payments/cinetpay/return',
      directPayOperators: ['MTN_CM'],
    });
    const request = {
      transactionId: '22222222-2222-4222-8222-222222222222',
      msisdn: PHONE,
      tokens: 500,
      customer: customer('Awa', 'Ndiaye', PHONE),
      directOperator: 'MTN_CM' as const,
    };
    const entries = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    return { instance, payments, request, lines, entries };
  }

  it('demande jamais envoyée (login 522) : échec, durée, aucun repli, ni numéro ni secret', async () => {
    const createPayment = jest
      .fn()
      .mockRejectedValue(
        new CinetPayPaymentNotSentError(new CinetPayError('http', 'x', { httpStatus: 522 })),
      );
    const { instance, payments, request, lines, entries } = directGateway(createPayment);
    await expect(instance.requestCollection(request)).rejects.toBeInstanceOf(
      CinetPayPaymentNotSentError,
    );
    const failed = entries().find((e) => e.message === 'cinetpay payment initialization failed');
    expect(failed).toMatchObject({
      reason: 'CinetPayPaymentNotSentError:http:522',
      pageFallback: false,
    });
    expect(typeof failed?.durationMs).toBe('number');
    expect(payments.markInitializationFailed).toHaveBeenCalledTimes(1);
    expect(payments.markInitializationUncertain).not.toHaveBeenCalled();
    expect(lines.join('\n')).not.toContain(PHONE.slice(4));
  });

  it('refus certain du direct (422 NOT_ALLOWED) : repli vers la page annoncé', async () => {
    const createPayment = jest
      .fn()
      .mockRejectedValue(
        new CinetPayError('http', 'x', {
          httpStatus: 422,
          apiCode: 2011,
          apiStatus: 'NOT_ALLOWED',
        }),
      );
    const { instance, request, entries } = directGateway(createPayment);
    await expect(instance.requestCollection(request)).rejects.toBeInstanceOf(
      DirectPaymentUnavailableError,
    );
    expect(
      entries().find((e) => e.message === 'cinetpay payment initialization failed'),
    ).toMatchObject({ pageFallback: true, apiCode: 2011 });
  });

  it('délai APRÈS l’envoi d’un direct : incertain, aucun repli, aucun échec déclaré', async () => {
    const createPayment = jest.fn().mockRejectedValue(new CinetPayError('timeout', 'x'));
    const { instance, payments, request, entries } = directGateway(createPayment);
    await expect(instance.requestCollection(request)).rejects.toBeInstanceOf(
      PaymentInitializationUncertainError,
    );
    expect(
      entries().find((e) => e.message === 'cinetpay direct payment initialization uncertain'),
    ).toMatchObject({ reason: 'CinetPayError:timeout', pageFallback: false });
    expect(payments.markInitializationUncertain).toHaveBeenCalledTimes(1);
    expect(payments.markInitializationFailed).not.toHaveBeenCalled();
  });
});
