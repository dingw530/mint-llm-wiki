import fs from 'node:fs/promises';
import path from 'node:path';

function extractIds(text, prefix) {
  return [
    ...new Set(
      [...text.matchAll(new RegExp(`\\b${prefix}-\\d+\\b`, 'g'))].map((match) => match[0]),
    ),
  ];
}

function extractTaskPlans(text) {
  return extractIds(text, 'TP');
}

function extractDesignDecisions(text) {
  return extractIds(text, 'DS');
}

function extractAcceptanceCriteria(text) {
  return extractIds(text, 'AC');
}

function extractCurrentTp(text) {
  const match = text.match(/^\|\s*(TP-\d+)\s*\|[^|]*\|\s*(进行中|in_progress|in progress)\s*\|/m);
  return match?.[1] || null;
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

/**
 * 读取 SDD 产物，不依赖 sdd-doc-generator 的实现细节。
 * @param {string} rootDir
 * @param {string} changeId
 * @returns {Promise<SddDocument>}
 */
export async function readSddDocument(rootDir, changeId) {
  const changePath = path.join(rootDir, 'docs', 'changes', changeId);
  const [productSpec, designDoc, execPlan, traceability, verificationPlan] = await Promise.all([
    readIfExists(path.join(changePath, 'product-spec.md')),
    readIfExists(path.join(changePath, 'design-doc.md')),
    readIfExists(path.join(changePath, 'exec-plan.md')),
    readIfExists(path.join(changePath, 'traceability.md')),
    readJsonIfExists(path.join(changePath, 'verification-plan.json')),
  ]);

  if (!productSpec && !designDoc && !execPlan && !traceability) {
    throw new Error(`No SDD documents found for change: ${changeId}`);
  }

  return {
    changeId,
    changePath,
    productSpec,
    designDoc,
    execPlan,
    traceability,
    acceptanceCriteria: extractAcceptanceCriteria(`${productSpec}\n${designDoc}\n${traceability}`),
    designDecisions: extractDesignDecisions(`${designDoc}\n${execPlan}\n${traceability}`),
    taskPlans: extractTaskPlans(`${execPlan}\n${traceability}`),
    currentTp: extractCurrentTp(execPlan),
    verificationPlan,
  };
}

/**
 * @typedef {Object} SddDocument
 * @property {string} changeId
 * @property {string} changePath
 * @property {string} productSpec
 * @property {string} designDoc
 * @property {string} execPlan
 * @property {string} traceability
 * @property {string[]} acceptanceCriteria
 * @property {string[]} designDecisions
 * @property {string[]} taskPlans
 * @property {string|null} currentTp
 * @property {Object|null} verificationPlan
 */
