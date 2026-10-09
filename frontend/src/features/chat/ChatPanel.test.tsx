/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { ChatMessage } from '../../types/chat';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';

const GAME = '11111111-1111-4111-8111-111111111111';

const message = (id: string, senderId: string, content: string, name = senderId): ChatMessage => ({
  id,
  gameId: GAME,
  senderId,
  senderDisplayName: name,
  content,
  createdAt: '2026-10-08T10:15:00.000Z',
});

async function renderPanel(overrides: Partial<ChatPanelProps> = {}) {
  const props: ChatPanelProps = {
    top: 80,
    bottom: 60,
    onClose: jest.fn(),
    myId: 'moi',
    messages: [],
    loading: false,
    hasMore: false,
    loadingOlder: false,
    onLoadOlder: jest.fn(),
    canSend: true,
    maxLength: 500,
    connection: 'connected',
    sending: false,
    onSend: jest.fn(),
    ...overrides,
  };
  await render(<ChatPanel {...props} />);
  return props;
}

describe('ChatPanel', () => {
  it('se ferme par le bouton ✕', async () => {
    const props = await renderPanel();
    await fireEvent.press(screen.getByLabelText('Fermer le chat'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('affiche le chargement, puis l’état vide', async () => {
    await renderPanel({ loading: true });
    expect(screen.getByTestId('chat-loading')).toBeTruthy();
    await screen.unmount();
    await renderPanel();
    expect(screen.getByText('Aucun message pour l’instant.')).toBeTruthy();
  });

  it('distingue mes messages, nomme les autres joueurs, n’affiche aucun identifiant', async () => {
    await renderPanel({
      messages: [
        message('11111111-0000-4000-8000-000000000001', 'lui', 'Salut !', 'Roly'),
        message('11111111-0000-4000-8000-000000000002', 'moi', 'Bonne chance', 'Hugues'),
      ],
    });
    expect(screen.getAllByTestId('chat-bubble-other')).toHaveLength(1);
    expect(screen.getAllByTestId('chat-bubble-mine')).toHaveLength(1);
    expect(screen.getByText('Roly')).toBeTruthy();
    expect(screen.queryByText('Hugues')).toBeNull(); // Pas de nom sur ses propres bulles.
    expect(screen.queryByText(/11111111-0000/)).toBeNull();
    expect(screen.queryByText(/lui|moi/)).toBeNull(); // senderId jamais affiché
  });

  it('rend le contenu comme du texte brut (HTML/script non interprété)', async () => {
    const payload = '<script>alert(1)</script><b>gras</b>';
    await renderPanel({ messages: [message('m1', 'lui', payload)] });
    expect(screen.getByText(payload)).toBeTruthy();
  });

  it('envoie le texte nettoyé ; le champ n’est vidé qu’après la confirmation', async () => {
    let confirm: () => void = () => undefined;
    const onSend = jest.fn((_content: string, onSent: () => void) => {
      confirm = onSent;
    });
    await renderPanel({ onSend });
    const input = screen.getByLabelText('Message');
    await fireEvent.changeText(input, '  bien joué  ');
    await fireEvent.press(screen.getByLabelText('Envoyer'));
    expect(onSend).toHaveBeenCalledWith('bien joué', expect.any(Function));
    expect(screen.getByLabelText('Message').props.value).toBe('  bien joué  ');
    await act(async () => confirm());
    expect(screen.getByLabelText('Message').props.value).toBe('');
  });

  it('envoi au clavier (touche Envoyer) ; rien n’est envoyé pour un message vide', async () => {
    const onSend = jest.fn();
    await renderPanel({ onSend });
    await fireEvent(screen.getByLabelText('Message'), 'submitEditing');
    expect(onSend).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Message'), 'ok');
    await fireEvent(screen.getByLabelText('Message'), 'submitEditing');
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('pendant l’envoi, le bouton est désactivé (aucun double envoi)', async () => {
    const onSend = jest.fn();
    await renderPanel({ onSend, sending: true });
    await fireEvent.changeText(screen.getByLabelText('Message'), 'deux fois');
    await fireEvent.press(screen.getByLabelText('Envoyer'));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Envoyer').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });

  it('affiche l’erreur d’envoi du serveur', async () => {
    await renderPanel({ sendError: 'Trop de messages. Patientez quelques secondes.' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Trop de messages. Patientez quelques secondes.',
    );
  });

  it('partie terminée : historique visible, saisie remplacée par la lecture seule', async () => {
    await renderPanel({ canSend: false, messages: [message('m1', 'lui', 'gg')] });
    expect(screen.getByText('gg')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.getByText(/lecture seule/)).toBeTruthy();
  });

  it('signale une reconnexion en cours', async () => {
    await renderPanel({ connection: 'offline' });
    expect(screen.getByText('Reconnexion…')).toBeTruthy();
  });
});
