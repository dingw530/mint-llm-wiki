import { callJev } from './jev-client.js';
import { toJevConfig } from './config.js';
import type { JevAnswer, JevQuestion } from './types.js';
import type {
  WikiIdentityCandidate,
  WikiIdentityInput,
  WikiIdentityProviderResult,
  WikiIdentityResolverOptions,
} from '../../../domains/wiki/index.js';

const JEV_IDENTITY_MIN_CONFIDENCE = 0.9;
const JEV_NAME_MATCH_MIN_PROBABILITY = 0.75;
const JEV_SCOPE_CONFLICT_MAX_PROBABILITY = 0.2;

/** Serialize the incoming page and bounded existing candidates for Jev. */
function buildState(
  input: WikiIdentityInput,
  candidates: readonly WikiIdentityCandidate[],
): Record<string, string> {
  return {
    incoming: JSON.stringify({
      title: input.title,
      category: input.category,
      aliases: input.aliases,
      tags: input.tags,
      summary: input.summary,
      content: input.content.slice(0, 1800),
    }),
    candidates: JSON.stringify(
      candidates.map((candidate, index) => ({
        key: `candidate_${index}`,
        filename: candidate.filename,
        title: candidate.title,
        category: candidate.category,
        aliases: candidate.aliases,
        tags: candidate.tags,
        summary: candidate.summary || '',
      })),
    ),
  };
}

/** Build one Score and two supporting Noul judgments for each candidate. */
function buildQuestions(candidates: readonly WikiIdentityCandidate[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  candidates.forEach((candidate, index) => {
    const candidateRef = `the candidate with key "candidate_${index}" in state.candidates`;
    questions[`identity_${index}`] = {
      type: 'score',
      instructions: `How do incoming and ${candidateRef} relate as one specific knowledge object?`,
      criteria: [
        'They describe different objects or concepts.',
        'They are related, but the available information does not establish that they are the same.',
        'They describe the same specific object or concept, including a supported alias, translation, or spelling variant.',
      ],
    };
    questions[`name_match_${index}`] = {
      type: 'noul',
      instructions: `Do the title or aliases of incoming and ${candidateRef} support a name-variation match for the same identity?`,
      criteria: {
        true: 'A title or explicit alias supports that both refer to the same identity.',
        false: 'The names are merely related, or no identity link is established.',
      },
    };
    questions[`scope_conflict_${index}`] = {
      type: 'noul',
      instructions: `Does the provided information show that incoming and ${candidateRef} have different versions, scopes, or identities?`,
      criteria: {
        true: 'They are distinct versions, scopes, or identities and must not be merged.',
        false: 'No clear version, scope, or identity difference is present.',
      },
    };
  });
  return questions;
}

/** Accept only a finite typed Score answer. */
function readScore(answer: JevAnswer | undefined): { score: number; confidence: number } | null {
  if (
    answer?.type !== 'score' ||
    !Number.isFinite(answer.score) ||
    !Number.isFinite(answer.confidence)
  ) {
    return null;
  }
  return { score: answer.score, confidence: answer.confidence };
}

/** Accept only a finite Noul probability and clamp it to its documented range. */
function readNoul(answer: JevAnswer | undefined): number | null {
  if (answer?.type !== 'noul' || !Number.isFinite(answer.noul)) return null;
  return Math.max(0, Math.min(1, answer.noul));
}

/** Apply the conservative unique-target policy to Jev's typed candidate answers. */
function resolveCandidateAnswers(
  answers: Record<string, JevAnswer>,
  candidates: readonly WikiIdentityCandidate[],
): WikiIdentityProviderResult {
  const matches: WikiIdentityCandidate[] = [];
  let allDifferent = candidates.length > 0;

  for (const [index, candidate] of candidates.entries()) {
    const identity = readScore(answers[`identity_${index}`]);
    const nameMatch = readNoul(answers[`name_match_${index}`]);
    const scopeConflict = readNoul(answers[`scope_conflict_${index}`]);
    if (!identity || nameMatch === null || scopeConflict === null) {
      return { kind: 'unavailable', reason: 'malformed_response' };
    }

    const confidentlyDifferent =
      identity.score <= 0.5 && identity.confidence >= JEV_IDENTITY_MIN_CONFIDENCE;
    allDifferent &&= confidentlyDifferent;
    if (
      identity.score >= 1.5 &&
      identity.confidence >= JEV_IDENTITY_MIN_CONFIDENCE &&
      nameMatch >= JEV_NAME_MATCH_MIN_PROBABILITY &&
      scopeConflict <= JEV_SCOPE_CONFLICT_MAX_PROBABILITY
    ) {
      matches.push(candidate);
    }
  }

  if (matches.length === 1) {
    return { kind: 'match', targetPath: matches[0].filename, provider: 'jev' };
  }
  if (matches.length > 1) {
    return { kind: 'uncertain', provider: 'jev', reason: 'multiple_candidates_matched' };
  }
  if (allDifferent) return { kind: 'different', provider: 'jev' };
  return { kind: 'uncertain', provider: 'jev', reason: 'confidence_below_merge_gate' };
}

/** Ask Jev to classify each bounded candidate pair using typed judgments. */
export async function resolveWikiIdentityWithJev(
  input: WikiIdentityInput,
  candidates: readonly WikiIdentityCandidate[],
  settings: WikiIdentityResolverOptions,
): Promise<WikiIdentityProviderResult> {
  const jevSettings = settings.jevSettings;
  if (!jevSettings) return { kind: 'unavailable', reason: 'not_configured' };
  try {
    const result = await callJev(
      toJevConfig(jevSettings),
      {
        state: buildState(input, candidates),
        model: jevSettings.model,
        questions: buildQuestions(candidates),
      },
      { operation: 'wiki_identity_resolution' },
    );
    if (!result.ok) return { kind: 'unavailable', reason: result.reason };
    return resolveCandidateAnswers(result.answers, candidates);
  } catch {
    return { kind: 'unavailable', reason: 'provider_threw' };
  }
}
