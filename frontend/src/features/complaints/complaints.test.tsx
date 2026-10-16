/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import type { SupportState } from '../../types/complaint';
import { AssistantChat } from './AssistantChat';
import { ComplaintForm } from './ComplaintForm';
import { getComplaintMessages } from './complaint-messages';
import { useAssistantStatus, useConversation, useCreateComplaint } from './hooks';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockSend = jest.fn();
const mockCreate = jest.fn();

jest.mock('./hooks', () => ({
  useAssistantStatus: jest.fn(),
  useConversation: jest.fn(),
  useStartConversation: () => ({ isPending: false, mutate: jest.fn() }),
  useSendToAssistant: () => ({ isPending: false, error: null, mutate: mockSend }),
  useCreateComplaint: jest.fn(),
}));

/** Toutes les clés (chemins) d'un dictionnaire. */
function keysOf(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null
      ? keysOf(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const CONVERSATION: SupportState = {
  conversation: {
    id: 'c-1',
    status: 'ACTIVE',
    language: 'fr',
    playerTurns: 1,
    maxTurns: 15,
    createdAt: '2026-10-15T08:00:00Z',
  },
  messages: [
    {
      id: 'm-1',
      role: 'PLAYER',
      content: 'Mon paiement MTN Money a été validé, mais rien sur mon compte.',
      createdAt: '2026-10-15T08:00:00Z',
    },
    {
      id: 'm-2',
      role: 'ASSISTANT',
      content: 'Voici ce que j’ai pu vérifier sur votre compte.',
      createdAt: '2026-10-15T08:00:01Z',
      meta: {
        mode: 'AI',
        category: 'PAYMENT',
        verified: ['Vérifié : votre recharge de 5000 FCFA attend la confirmation de l’opérateur.'],
        checks: [{ tool: 'check_payment', outcome: 'FOUND' }],
        needsHuman: false,
        draft: {
          category: 'PAYMENT',
          title: 'Recharge non créditée',
          description: 'Mon paiement MTN Money a été validé, mais rien sur mon compte.',
          links: { paymentId: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed' },
          recommended: true,
        },
        greeting: false,
      },
    },
  ],
};

beforeEach(() => {
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  mockSend.mockReset();
  mockCreate.mockReset();
  (useAssistantStatus as jest.Mock).mockReturnValue({ data: { mode: 'AI' } });
  (useConversation as jest.Mock).mockReturnValue({ data: CONVERSATION, isPending: false });
  (useCreateComplaint as jest.Mock).mockReturnValue({
    isPending: false,
    error: null,
    mutate: mockCreate,
  });
});

describe('textes FR / EN', () => {
  it("l'anglais a exactement les mêmes clés que le français", () => {
    const fr = getComplaintMessages('fr');
    const en = getComplaintMessages('en');
    expect(keysOf(en).sort()).toEqual(keysOf(fr).sort());
    expect(Object.keys(en.categories)).toHaveLength(10);
  });

  it('les notifications ne citent ni montant ni solde', () => {
    for (const language of ['fr', 'en'] as const) {
      const t = getComplaintMessages(language);
      for (const event of ['CREATED', 'INFO_REQUESTED', 'REPLY', 'DECISION', 'CLOSED', 'X']) {
        expect(t.notification('RCL-20261015-7K3M9Q', event)).not.toMatch(
          /\d+\s*(jetons|tokens|FCFA)/,
        );
      }
    }
  });
});

describe('AssistantChat', () => {
  it("rappelle qu'il s'agit d'un assistant automatisé et sépare les faits vérifiés de sa réponse", async () => {
    await render(<AssistantChat onFileComplaint={jest.fn()} />);
    expect(
      screen.getByText(/Assistant automatisé : il consulte uniquement vos informations/),
    ).toBeTruthy();
    expect(screen.getByText(/Vérifié par le serveur/)).toBeTruthy();
    expect(screen.getByText(/5000 FCFA attend la confirmation/)).toBeTruthy();
  });

  it('propose la réclamation recommandée avec le brouillon et la conversation', async () => {
    const onFile = jest.fn();
    await render(<AssistantChat onFileComplaint={onFile} />);
    await fireEvent.press(screen.getByText('Déposer cette réclamation (recommandé)'));
    expect(onFile).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'PAYMENT', recommended: true }),
      'c-1',
    );
  });

  it('envoie le message saisi', async () => {
    await render(<AssistantChat onFileComplaint={jest.fn()} />);
    await fireEvent.changeText(
      screen.getByLabelText('Décrivez votre problème…'),
      'Et mon retrait ?',
    );
    await fireEvent.press(screen.getByLabelText('Envoyer le message à l’assistant'));
    expect(mockSend).toHaveBeenCalledWith(
      { conversationId: 'c-1', content: 'Et mon retrait ?' },
      expect.anything(),
    );
  });

  it('annonce le mode dégradé : la réclamation reste possible', async () => {
    (useAssistantStatus as jest.Mock).mockReturnValue({ data: { mode: 'DEGRADED' } });
    await render(<AssistantChat onFileComplaint={jest.fn()} />);
    expect(screen.getByText(/Assistant intelligent indisponible/)).toBeTruthy();
    expect(screen.getByText('Déposer cette réclamation (recommandé)')).toBeTruthy();
  });

  it("s'affiche en anglais", async () => {
    usePreferencesStore.setState({ ...DEFAULT_PREFERENCES, language: 'en' });
    await render(<AssistantChat onFileComplaint={jest.fn()} />);
    expect(
      screen.getByText(/Automated assistant: it only reads your own information/),
    ).toBeTruthy();
    expect(screen.getByText('File this complaint (recommended)')).toBeTruthy();
  });
});

describe('ComplaintForm', () => {
  it('reprend la catégorie proposée, que le joueur peut corriger avant le dépôt', async () => {
    await render(
      <ComplaintForm
        draft={CONVERSATION.messages[1]!.meta!.draft}
        conversationId="c-1"
        onCreated={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText('Catégorie proposée : vous pouvez la corriger.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Solde ou jetons'));
    await fireEvent.press(screen.getByText('Déposer la réclamation'));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'BALANCE',
        title: 'Recharge non créditée',
        conversationId: 'c-1',
        links: { paymentId: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed' },
      }),
      expect.anything(),
    );
  });
});
