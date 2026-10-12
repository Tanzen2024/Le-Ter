import { PaymentProfileIncompleteError } from '../../../src/domain/payments/payment';
import type { PaymentRepository } from '../../../src/repositories/payment.repository';
import { CinetPayGateway } from '../../../src/services/payments/cinetpay/cinetpay.gateway';
import { silentLogger } from '../../../src/utils/logger';

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
