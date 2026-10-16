import type { AssistantEnv, SupportLimitsEnv } from '../../config/assistant-env';
import type { SqlClient } from '../../database/sql-client';
import { PostgresComplaintEvidenceRepository } from '../../repositories/postgres-complaint-evidence.repository';
import {
  PostgresComplaintRepository,
  PostgresSupportConversationRepository,
} from '../../repositories/postgres-complaint.repository';
import type { Logger } from '../../utils/logger';
import { createLanguageModel } from '../ai/create-language-model';
import type { LanguageModel } from '../ai/language-model';
import { AssistantToolbox } from './assistant-tools';
import { ComplaintAnalyzer } from './complaint-analyzer';
import { ComplaintService, type ComplaintSignalPublisher } from './complaint.service';
import { SupportAssistantService } from './support-assistant.service';

export interface ComplaintServices {
  complaints: ComplaintService;
  assistant: SupportAssistantService;
  analyzer: ComplaintAnalyzer;
}

/**
 * Assemblage des réclamations et de l'assistant (D-114). `model` remplace le fournisseur
 * (tests : faux modèle, aucun appel réseau) ; sinon Ollama si `assistant` est configuré, sinon
 * AUCUN modèle (mode dégradé, réclamations pleinement utilisables).
 */
export function createComplaintServices(options: {
  sql: SqlClient;
  logger: Logger;
  assistant?: AssistantEnv;
  limits?: SupportLimitsEnv;
  model?: LanguageModel;
  signals?: ComplaintSignalPublisher;
  clock?: () => Date;
}): ComplaintServices {
  const { sql, logger, clock } = options;
  const evidence = new PostgresComplaintEvidenceRepository(sql);
  const conversations = new PostgresSupportConversationRepository(sql);
  const toolbox = new AssistantToolbox(evidence);

  const model = createLanguageModel(options.assistant, options.model);
  const maxOutputTokens = options.assistant?.maxOutputTokens;

  const complaints = new ComplaintService({
    repository: new PostgresComplaintRepository(sql),
    evidence,
    conversations,
    logger,
    ...(options.signals && { signals: options.signals }),
    ...(clock && { clock }),
  });
  const assistant = new SupportAssistantService({
    conversations,
    toolbox,
    ...(model && { model }),
    ...(maxOutputTokens && { maxOutputTokens }),
    maxTurnsPerConversation: options.limits?.maxTurnsPerConversation ?? 15,
    logger,
    ...(clock && { clock }),
  });
  const analyzer = new ComplaintAnalyzer({
    complaints,
    toolbox,
    ...(model && { model }),
    ...(maxOutputTokens && { maxOutputTokens }),
    logger,
    ...(clock && { clock }),
  });
  complaints.setAnalysisScheduler(analyzer);
  return { complaints, assistant, analyzer };
}
