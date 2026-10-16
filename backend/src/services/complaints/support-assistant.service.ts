import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JSON_SCHEMA,
  guardReply,
  heuristicAnalysis,
  parseAnalysis,
  parseReply,
  REPLY_JSON_SCHEMA,
  requiresHuman,
  toolsFor,
  verifiedValuesOf,
  type AssistantAnalysis,
  type AssistantLanguage,
} from '../../domain/complaints/assistant';
import { COMPLAINT_LIMITS, type ComplaintLinks } from '../../domain/complaints/complaint';
import type { UserId } from '../../domain/users/user';
import type {
  SupportConversation,
  SupportConversationRepository,
  SupportMessage,
} from '../../repositories/complaint.repository';
import type { Logger } from '../../utils/logger';
import { ModelUnavailableError, type LanguageModel, type ModelMessage } from '../ai/language-model';
import {
  analysisPrompt,
  ASSISTANT_TEXT,
  clarifyingQuestion,
  draftTitle,
  insightText,
  replyPrompt,
} from './assistant-messages';
import type { AssistantToolbox, Insight, ToolResult } from './assistant-tools';

export interface SupportAssistantDependencies {
  conversations: SupportConversationRepository;
  toolbox: AssistantToolbox;
  /** Absent : mode dégradé permanent (aucun fournisseur configuré). */
  model?: LanguageModel & { available?: () => boolean };
  maxOutputTokens?: number;
  maxTurnsPerConversation: number;
  logger: Logger;
  clock?: () => Date;
}

/** Messages de l'historique transmis au modèle (borne de coût et de données). */
const HISTORY_FOR_MODEL = 8;
const MESSAGE_CHARS_FOR_MODEL = 1000;
/** Faits transmis au modèle : bornés (les plus récents d'abord dans chaque liste). */
const FACTS_CHARS_FOR_MODEL = 6000;

export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation introuvable.');
    this.name = 'ConversationNotFoundError';
  }
}

/** Proposition de réclamation : le JOUEUR la confirme (et peut corriger la catégorie). */
export interface ComplaintDraft {
  category: AssistantAnalysis['category'];
  title: string;
  description: string;
  links: ComplaintLinks;
  recommended: boolean;
}

export function supportMessageView(m: SupportMessage) {
  const meta = m.metadata as {
    mode?: string;
    category?: string;
    verified?: string[];
    checks?: { tool: string; outcome: string }[];
    needsHuman?: boolean;
    draft?: ComplaintDraft | null;
    greeting?: boolean;
  };
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    ...(m.role === 'ASSISTANT' && {
      meta: {
        mode: meta.mode ?? 'DEGRADED',
        category: meta.category ?? null,
        // Faits VÉRIFIÉS par le serveur (textes déterministes), distincts de la réponse.
        verified: meta.verified ?? [],
        checks: meta.checks ?? [],
        needsHuman: meta.needsHuman ?? false,
        draft: meta.draft ?? null,
        greeting: meta.greeting ?? false,
      },
    }),
  };
}

/**
 * Assistant conversationnel des réclamations (D-114). Pour chaque message du joueur :
 *  1. analyse (modèle, validée ; sinon repli par mots-clés) : catégorie, identifiants cités ;
 *  2. outils serveur en lecture seule, avec l'identité du jeton (jamais celle du modèle) ;
 *  3. réponse (modèle, contrôlée par `guardReply` ; sinon réponse déterministe) ;
 *  4. proposition de réclamation, que le joueur confirme.
 * L'assistant n'écrit rien d'autre que la conversation : aucun solde, aucune partie.
 */
export class SupportAssistantService {
  private readonly clock: () => Date;

  constructor(private readonly deps: SupportAssistantDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /** État public : jamais l'URL, le fournisseur interne ni la configuration. */
  status(): { mode: 'AI' | 'DEGRADED' } {
    const model = this.deps.model;
    return { mode: model && (model.available?.() ?? true) ? 'AI' : 'DEGRADED' };
  }

  async current(userId: UserId) {
    const conversation = await this.deps.conversations.findActive(userId);
    if (!conversation) return { conversation: null, messages: [] };
    const messages = await this.deps.conversations.messages(conversation.id, 100);
    return {
      conversation: this.conversationView(conversation),
      messages: messages.map(supportMessageView),
    };
  }

  /** Ouvre (ou reprend) la conversation active ; le 1er message rappelle qu'il s'agit d'un automate. */
  async start(userId: UserId, language: AssistantLanguage) {
    const now = this.clock();
    const conversation = await this.deps.conversations.openActive({
      id: randomUUID(),
      userId,
      status: 'ACTIVE',
      language,
      playerTurns: 0,
      lastAnalysis: {},
      createdAt: now,
      updatedAt: now,
    });
    const existing = await this.deps.conversations.messages(conversation.id, 100);
    if (existing.length === 0) {
      await this.deps.conversations.insertMessage({
        id: randomUUID(),
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: ASSISTANT_TEXT[language].disclaimer,
        metadata: { greeting: true, mode: this.status().mode },
        createdAt: now,
        idempotencyKey: `greeting-${conversation.id}`,
      });
    }
    return this.current(userId);
  }

  /** Nouvelle conversation : l'active est close (elle reste liée aux réclamations créées). */
  async reset(userId: UserId, language: AssistantLanguage) {
    const active = await this.deps.conversations.findActive(userId);
    if (active) await this.deps.conversations.close(active.id, this.clock());
    return this.start(userId, language);
  }

  async send(
    userId: UserId,
    conversationId: string,
    content: string,
    language: AssistantLanguage,
    idempotencyKey: string,
  ) {
    const repo = this.deps.conversations;
    const conversation = await repo.findConversation(userId, conversationId);
    if (!conversation || conversation.status !== 'ACTIVE') throw new ConversationNotFoundError();

    // Rejeu (coupure, double appui) : le même échange est renvoyé, sans nouvel appel au modèle.
    const replay = await repo.findMessageByKey(conversation.id, idempotencyKey);
    if (replay) {
      const reply = await repo.findReplyTo(conversation.id, replay.id);
      if (reply)
        return {
          playerMessage: supportMessageView(replay),
          assistantMessage: supportMessageView(reply),
        };
    }
    const now = this.clock();
    const playerMessage: SupportMessage = replay ?? {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'PLAYER',
      content,
      metadata: {},
      createdAt: now,
    };
    if (!replay) {
      const inserted = await repo.insertMessage({ ...playerMessage, idempotencyKey });
      if (!inserted) {
        // Course entre deux envois de la même clé : l'autre requête répond.
        const winner = await repo.findMessageByKey(conversation.id, idempotencyKey);
        const reply = winner ? await repo.findReplyTo(conversation.id, winner.id) : null;
        if (winner && reply)
          return {
            playerMessage: supportMessageView(winner),
            assistantMessage: supportMessageView(reply),
          };
        throw new ConversationNotFoundError();
      }
    }

    const assistantMessage =
      conversation.playerTurns >= this.deps.maxTurnsPerConversation
        ? this.fullConversationReply(conversation, playerMessage, language)
        : await this.answer(userId, conversation, playerMessage, language);
    await repo.insertMessage({ ...assistantMessage, idempotencyKey: null });
    await repo.recordTurn(
      conversation.id,
      (assistantMessage.metadata.analysis as Record<string, unknown>) ?? conversation.lastAnalysis,
      language,
      this.clock(),
    );
    return {
      playerMessage: supportMessageView(playerMessage),
      assistantMessage: supportMessageView(assistantMessage),
    };
  }

  private fullConversationReply(
    conversation: SupportConversation,
    playerMessage: SupportMessage,
    language: AssistantLanguage,
  ): SupportMessage {
    const previous = conversation.lastAnalysis as { draft?: ComplaintDraft };
    return {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: ASSISTANT_TEXT[language].conversationFull,
      metadata: {
        replyTo: playerMessage.id,
        mode: 'DEGRADED',
        verified: [],
        checks: [],
        needsHuman: true,
        draft: previous.draft ? { ...previous.draft, recommended: true } : null,
        analysis: conversation.lastAnalysis,
      },
      createdAt: this.clock(),
    };
  }

  private async answer(
    userId: UserId,
    conversation: SupportConversation,
    playerMessage: SupportMessage,
    language: AssistantLanguage,
  ): Promise<SupportMessage> {
    const history = await this.deps.conversations.messages(conversation.id, 30);
    const playerText = history
      .filter((m) => m.role === 'PLAYER')
      .map((m) => m.content)
      .join('\n');
    const modelHistory: ModelMessage[] = history
      .filter((m) => !(m.metadata as { greeting?: boolean }).greeting)
      .slice(-HISTORY_FOR_MODEL)
      .map((m) => ({
        role: m.role === 'PLAYER' ? 'user' : 'assistant',
        content: m.content.slice(0, MESSAGE_CHARS_FOR_MODEL),
      }));

    const model = this.usableModel();
    const validation: Record<string, string> = {};
    let mode: 'AI' | 'DEGRADED' = model ? 'AI' : 'DEGRADED';

    // 1. Analyse.
    let analysis: AssistantAnalysis | null = null;
    if (model) {
      try {
        const raw = await model.generate({
          system: analysisPrompt(language),
          messages: modelHistory,
          schema: ANALYSIS_JSON_SCHEMA,
          maxOutputTokens: this.deps.maxOutputTokens ?? 350,
        });
        const parsed = parseAnalysis(raw, playerText);
        if (parsed.ok) {
          analysis = parsed.value;
          validation.analysis = 'OK';
        } else {
          validation.analysis = `REJECTED:${parsed.reason}`;
        }
      } catch (err) {
        validation.analysis = `UNAVAILABLE:${err instanceof ModelUnavailableError ? err.failure : 'ERROR'}`;
        mode = 'DEGRADED';
      }
    }
    if (!analysis) analysis = heuristicAnalysis(playerText, playerMessage.content);

    // 2. Outils serveur, identité du jeton.
    const tools = toolsFor(analysis);
    const results: ToolResult[] = [];
    for (const tool of tools)
      results.push(await this.deps.toolbox.run(tool, userId, analysis.references));
    const insights = results.flatMap((r) => r.insights);
    const verified = insights.map((i) => insightText(language, i));
    const facts = this.minimizedFacts(results);
    const needsHuman =
      analysis.needsHuman || requiresHuman(analysis.category) || insights.some((i) => i.needsHuman);

    // 3. Réponse.
    let reply: string | null = null;
    let modelSuggests = false;
    // La réponse est confrontée aux faits ET aux constats du serveur (contradictions, crédits).
    const values = {
      ...verifiedValuesOf(facts, ''),
      findings: new Set<string>(insights.map((i) => i.code)),
    };
    if (model && mode === 'AI') {
      if (results.length === 0 && analysis.clarifyingQuestion) {
        const guard = guardReply(analysis.clarifyingQuestion, values);
        if (guard.ok) reply = analysis.clarifyingQuestion;
        else validation.reply = `REJECTED:${guard.reason}`;
      } else {
        try {
          const raw = await model.generate({
            system: replyPrompt(language, facts, verified),
            messages: modelHistory,
            schema: REPLY_JSON_SCHEMA,
            maxOutputTokens: this.deps.maxOutputTokens ?? 350,
          });
          const parsed = parseReply(raw);
          if (!parsed.ok) validation.reply = `REJECTED:${parsed.reason}`;
          else {
            const guard = guardReply(parsed.value.reply, values);
            if (guard.ok) {
              reply = parsed.value.reply;
              modelSuggests = parsed.value.suggestComplaint;
              validation.reply = 'OK';
            } else {
              validation.reply = `REJECTED:${guard.reason}`;
            }
          }
        } catch (err) {
          validation.reply = `UNAVAILABLE:${err instanceof ModelUnavailableError ? err.failure : 'ERROR'}`;
          mode = 'DEGRADED';
        }
      }
    }
    const recommend =
      needsHuman ||
      analysis.playerWantsComplaint ||
      modelSuggests ||
      results.some((r) => r.outcome === 'ERROR');
    if (reply === null) {
      reply = this.deterministicReply(
        language,
        analysis,
        results,
        insights,
        recommend,
        // Aucun fournisseur configuré, ou fournisseur en panne : le joueur en est informé.
        mode === 'DEGRADED',
      );
    }
    if (
      validation.analysis?.startsWith('UNAVAILABLE') ||
      validation.reply?.startsWith('UNAVAILABLE')
    ) {
      this.deps.logger.warn('support assistant degraded', {
        analysis: validation.analysis,
        reply: validation.reply,
      });
    }

    const links = this.verifiedLinks(analysis, results);
    const draft: ComplaintDraft = {
      category: analysis.category,
      title: draftTitle(language, analysis.category),
      description: playerText.slice(-COMPLAINT_LIMITS.descriptionMax) || playerMessage.content,
      links,
      recommended: recommend,
    };
    const checks = results.map((r) => ({ tool: r.tool, outcome: r.outcome }));
    return {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: reply,
      metadata: {
        replyTo: playerMessage.id,
        mode,
        category: analysis.category,
        confidence: analysis.confidence,
        verified,
        checks,
        insights: insights.map((i) => i.code),
        needsHuman,
        draft,
        validation,
        ...(model && { provider: model.provider, model: model.model }),
        // Dernière analyse : reprise par la création d'une réclamation (catégorie suggérée,
        // vérifications effectuées, avec leurs faits).
        analysis: {
          category: analysis.category,
          references: links,
          draft,
          checks: results.map((r) => ({ tool: r.tool, outcome: r.outcome, facts: r.facts })),
        },
      },
      createdAt: this.clock(),
    };
  }

  private usableModel(): LanguageModel | null {
    const model = this.deps.model;
    if (!model) return null;
    return model.available?.() === false ? null : model;
  }

  /** Identifiants retenus pour le brouillon : seulement ceux VÉRIFIÉS comme appartenant au joueur. */
  private verifiedLinks(analysis: AssistantAnalysis, results: ToolResult[]): ComplaintLinks {
    const found = (tool: string) => results.some((r) => r.tool === tool && r.outcome === 'FOUND');
    const refs = analysis.references;
    const links: ComplaintLinks = {};
    if (refs.gameId && found('get_game')) links.gameId = refs.gameId;
    if (refs.paymentId && found('check_payment')) links.paymentId = refs.paymentId;
    if (refs.withdrawalId && found('check_withdrawal')) links.withdrawalId = refs.withdrawalId;
    if (refs.tournamentId && found('get_tournament_status')) links.tournamentId = refs.tournamentId;
    const wallet = results.find((r) => r.tool === 'get_wallet_history');
    if (refs.transactionId && wallet?.facts.transaction)
      links.walletTransactionId = refs.transactionId;
    return links;
  }

  /** Faits transmis au modèle : ceux des outils (déjà minimisés), bornés en taille. */
  private minimizedFacts(results: ToolResult[]): Record<string, unknown> {
    const facts: Record<string, unknown> = {};
    for (const result of results) facts[result.tool] = { outcome: result.outcome, ...result.facts };
    let text = JSON.stringify(facts);
    if (text.length <= FACTS_CHARS_FOR_MODEL) return facts;
    // Trop long : on garde le premier élément de chaque liste.
    const trimmed = JSON.parse(text, (_key, value: unknown) =>
      Array.isArray(value) ? value.slice(0, 1) : value,
    ) as Record<string, unknown>;
    text = JSON.stringify(trimmed);
    return text.length <= FACTS_CHARS_FOR_MODEL ? trimmed : {};
  }

  private deterministicReply(
    language: AssistantLanguage,
    analysis: AssistantAnalysis,
    results: ToolResult[],
    insights: Insight[],
    recommend: boolean,
    providerDown: boolean,
  ): string {
    const text = ASSISTANT_TEXT[language];
    const parts: string[] = [];
    if (providerDown) parts.push(text.degraded);
    if (insights.length === 0) {
      parts.push(
        results.length > 0 ? text.nothingVerified : clarifyingQuestion(language, analysis.category),
      );
    } else if (!providerDown) {
      // Les constats sont affichés à part (« vérifications effectuées ») : on les introduit.
      parts.push(
        language === 'fr'
          ? 'Voici ce que j’ai pu vérifier sur votre compte.'
          : 'Here is what I could verify on your account.',
      );
    }
    if (recommend) parts.push(text.recommendComplaint);
    return parts.join(' ');
  }

  private conversationView(c: SupportConversation) {
    return {
      id: c.id,
      status: c.status,
      language: c.language,
      playerTurns: c.playerTurns,
      maxTurns: this.deps.maxTurnsPerConversation,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
