import { v4 as uuidv4 } from 'uuid';
import * as endpointRepo from '../../repositories/endpointRepository.js';
import { encrypt, decrypt, maskApiKey } from '../utils/encryption.js';
import type { EndpointInput, EndpointOutput, EndpointList, Endpoint } from '../../types.js';

function toOutput(endpoint: Endpoint): EndpointOutput {
  let apiKeyMasked = '';
  if (endpoint.apiKey) {
    try {
      apiKeyMasked = maskApiKey(decrypt(endpoint.apiKey));
    } catch {
      apiKeyMasked = '****';
    }
  }
  return {
    id: endpoint.id,
    name: endpoint.name,
    apiUrl: endpoint.apiUrl,
    apiKeyMasked,
    modelId: endpoint.modelId,
    apiType: endpoint.apiType || 'openai-chat',
    verifiedAt: endpoint.verifiedAt ?? null,
    isActive: endpoint.isActive,
    sortOrder: endpoint.sortOrder,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}

export function list(): EndpointList {
  const endpoints = endpointRepo.getAll();
  return { endpoints: endpoints.map(toOutput) };
}

export function getById(id: string): EndpointOutput | null {
  const endpoint = endpointRepo.getById(id);
  return endpoint ? toOutput(endpoint) : null;
}

export function getActiveEndpoint(): Endpoint | null {
  return endpointRepo.getActive();
}

function validateInput(input: EndpointInput, existingId?: string): void {
  if (!input.name || !input.name.trim()) {
    throw Object.assign(new Error('端点名称不能为空'), { status: 400 });
  }
  if (input.name.length > 50) {
    throw Object.assign(new Error('端点名称不能超过50个字符'), { status: 400 });
  }
  if (!input.apiUrl || !input.apiUrl.trim()) {
    throw Object.assign(new Error('API URL 不能为空'), { status: 400 });
  }
  try {
    new URL(input.apiUrl);
  } catch {
    throw Object.assign(new Error('API URL 格式无效'), { status: 400 });
  }
  if (!input.modelId || !input.modelId.trim()) {
    throw Object.assign(new Error('Model ID 不能为空'), { status: 400 });
  }
  // 检查名称唯一性
  const all = endpointRepo.getAll();
  const duplicate = all.find((e) => e.name === input.name.trim() && e.id !== existingId);
  if (duplicate) {
    throw Object.assign(new Error('端点名称已存在'), { status: 409 });
  }
}

export function create(input: EndpointInput): EndpointOutput {
  validateInput(input);
  const id = uuidv4();
  const all = endpointRepo.getAll();
  const isActive = all.length === 0; // 首个端点自动激活
  const apiKey = input.apiKey ? encrypt(input.apiKey) : '';
  const endpoint = endpointRepo.insert({
    id,
    name: input.name.trim(),
    apiUrl: input.apiUrl.trim(),
    apiKey,
    modelId: input.modelId.trim(),
    apiType: input.apiType || 'openai-chat',
    isActive,
    sortOrder: all.length,
  });
  return toOutput(endpoint);
}

export function updateEndpoint(id: string, input: EndpointInput): EndpointOutput {
  validateInput(input, id);
  const existing = endpointRepo.getById(id);
  if (!existing) {
    throw Object.assign(new Error('端点不存在'), { status: 404 });
  }
  const fields: Record<string, unknown> = {
    name: input.name.trim(),
    apiUrl: input.apiUrl.trim(),
    modelId: input.modelId.trim(),
    apiType: input.apiType || 'openai-chat',
  };
  // apiKey 为脱敏值或空字符串时视为未修改
  if (input.apiKey !== undefined && input.apiKey !== '' && !input.apiKey.includes('****')) {
    fields.apiKey = encrypt(input.apiKey);
  }
  const updated = endpointRepo.update(id, fields);
  if (!updated) {
    throw Object.assign(new Error('更新失败'), { status: 500 });
  }
  endpointRepo.clearVerification(id);
  return toOutput(endpointRepo.getById(id) || updated);
}

export function remove(id: string): void {
  if (endpointRepo.count() <= 1) {
    throw Object.assign(new Error('至少保留一个端点'), { status: 400 });
  }
  const existing = endpointRepo.getById(id);
  if (!existing) {
    throw Object.assign(new Error('端点不存在'), { status: 404 });
  }
  endpointRepo.del(id);
  // 如果删除的是激活端点，激活第一个剩余端点
  if (existing.isActive) {
    const remaining = endpointRepo.getAll();
    if (remaining.length > 0) {
      endpointRepo.setActive(remaining[0].id);
    }
  }
}

export function activate(id: string): void {
  const existing = endpointRepo.getById(id);
  if (!existing) {
    throw Object.assign(new Error('端点不存在'), { status: 404 });
  }
  endpointRepo.setActive(id);
}

// 获取当前激活端点用于 AI 调用的内部数据（apiKey 已解密）
export function getActiveAiConfig(): {
  apiUrl: string;
  apiKey: string;
  modelId: string;
  apiType: string;
} | null {
  const active = endpointRepo.getActive();
  if (!active) return null;
  let apiKey = '';
  if (active.apiKey) {
    try {
      apiKey = decrypt(active.apiKey);
    } catch {
      apiKey = '';
    }
  }
  return {
    apiUrl: active.apiUrl,
    apiKey,
    modelId: active.modelId,
    apiType: active.apiType || 'openai-chat',
  };
}

/** Returns whether a verified text endpoint is available for first-use gating. */
export function hasVerifiedTextEndpoint(): boolean {
  return endpointRepo.getVerifiedActive() !== null;
}

/** Returns one endpoint's decrypted connection configuration for internal verification only. */
export function getAiConfig(
  id: string,
): { apiUrl: string; apiKey: string; modelId: string; apiType: string } | null {
  const endpoint = endpointRepo.getById(id);
  if (!endpoint) return null;
  let apiKey = '';
  if (endpoint.apiKey) {
    try {
      apiKey = decrypt(endpoint.apiKey);
    } catch {
      apiKey = '';
    }
  }
  return {
    apiUrl: endpoint.apiUrl,
    apiKey,
    modelId: endpoint.modelId,
    apiType: endpoint.apiType || 'openai-chat',
  };
}

/** Persists a successful live connection verification for one endpoint. */
export function markVerified(id: string): EndpointOutput {
  const verified = endpointRepo.markVerified(id, new Date().toISOString());
  if (!verified) throw Object.assign(new Error('端点不存在'), { status: 404 });
  return toOutput(verified);
}

// 迁移旧版配置（TP-006 调用）
export function migrateLegacyEndpoint(legacySettings: {
  apiUrl?: string;
  apiKey?: string;
  modelId?: string;
}): EndpointOutput | null {
  if (endpointRepo.count() > 0) return null;
  if (!legacySettings.apiUrl) return null;
  const id = uuidv4();
  let apiKey = '';
  if (legacySettings.apiKey) {
    // 旧 apiKey 可能是加密过的（复用密文），也可能是明文（需加密）
    if (legacySettings.apiKey.includes(':')) {
      apiKey = legacySettings.apiKey; // 已是加密格式，直接复用
    } else {
      apiKey = encrypt(legacySettings.apiKey);
    }
  }
  const endpoint = endpointRepo.insert({
    id,
    name: '默认端点',
    apiUrl: legacySettings.apiUrl,
    apiKey,
    modelId: legacySettings.modelId || 'gpt-4o-mini',
    apiType: 'openai-chat',
    isActive: true,
    sortOrder: 0,
  });
  return toOutput(endpoint);
}
