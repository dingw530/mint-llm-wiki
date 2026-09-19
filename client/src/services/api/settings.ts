import type { VisibleSettings, SettingsInput } from '@/types';
import { callEndpoint } from '../api/_base';

export function getSettings(): Promise<VisibleSettings> {
  return callEndpoint('settings:get');
}

export function saveSettings(settings: SettingsInput): Promise<void> {
  return callEndpoint('settings:save', settings);
}

export interface VectorConnectionTestResult {
  success: boolean;
  message?: string;
  dimensions?: number;
}

export function testEmbeddingConnection(data: {
  apiUrl: string;
  model: string;
  dimensions: number;
}): Promise<VectorConnectionTestResult> {
  return callEndpoint('settings:testEmbeddingConnection', data);
}

export function testChromaConnection(data: {
  url: string;
  apiKey?: string;
}): Promise<VectorConnectionTestResult> {
  return callEndpoint('settings:testChromaConnection', data);
}

export interface JevConnectionTestResult {
  success: boolean;
  message: string;
}

/** 用当前表单值探测 Jev 端点；留空的字段由服务端回退到已存值。 */
export function testJevConnection(data: {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<JevConnectionTestResult> {
  return callEndpoint('settings:testJevConnection', data);
}
